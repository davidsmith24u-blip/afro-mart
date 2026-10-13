// Communications automation: templates, event-triggered automations and an outbox.
// Delivery uses a pluggable transport (defaults to a webhook via COMMS_WEBHOOK_URL, or a log line).
const EVENTS = ['customer.registered', 'order.placed', 'order.status_changed', 'inventory.low_stock'];
const CHANNELS = ['email', 'sms', 'push', 'webhook'];

export async function defaultTransport(message) {
  const url = process.env.COMMS_WEBHOOK_URL;
  if (!url) {
    console.log(`[comms:${message.channel}] -> ${message.recipient}${message.subject ? ` | ${message.subject}` : ''}`);
    return;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: message.channel, to: message.recipient, subject: message.subject, body: message.body }),
  });
  if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
}

export function createCommunications(db, { transport } = {}) {
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);

  let send = transport || defaultTransport;

  const render = (text, payload = {}) =>
    String(text ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
      const value = key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), payload);
      return value === undefined || value === null ? '' : String(value);
    });

  function enqueue({ channel = 'email', recipient, subject = null, body = '', automation_id = null, campaign_id = null }) {
    const { lastInsertRowid } = run(
      'INSERT INTO messages (channel, recipient, subject, body, automation_id, campaign_id) VALUES (?,?,?,?,?,?)',
      channel, recipient, subject, body, automation_id, campaign_id);
    return Number(lastInsertRowid);
  }

  // Fan an application event out to every active automation listening for it.
  function emit(event, payload = {}) {
    const recipient = payload.email ?? payload.recipient ?? null;
    if (!recipient) return [];
    const automations = all(
      `SELECT a.id, a.channel, t.subject, t.body
       FROM automations a JOIN message_templates t ON t.id = a.template_id
       WHERE a.active = 1 AND a.event = ?`, event);
    const ids = [];
    for (const a of automations) {
      ids.push(enqueue({
        channel: a.channel || 'email',
        recipient,
        subject: render(a.subject, payload),
        body: render(a.body, payload),
        automation_id: a.id,
      }));
    }
    return ids;
  }

  async function deliver(idOrMessage) {
    const message = typeof idOrMessage === 'object' ? idOrMessage : get('SELECT * FROM messages WHERE id = ?', idOrMessage);
    if (!message) return null;
    if (message.status === 'sent') return message;
    try {
      await send(message);
      run("UPDATE messages SET status = 'sent', sent_at = CURRENT_TIMESTAMP, error = NULL WHERE id = ?", message.id);
    } catch (e) {
      run("UPDATE messages SET status = 'failed', error = ? WHERE id = ?", String(e?.message ?? e), message.id);
    }
    return get('SELECT * FROM messages WHERE id = ?', message.id);
  }

  async function deliverQueued(limit = 100) {
    const queued = all("SELECT * FROM messages WHERE status = 'queued' ORDER BY id LIMIT ?", limit);
    const delivered = [];
    for (const message of queued) delivered.push(await deliver(message));
    return delivered;
  }

  return { enqueue, emit, deliver, deliverQueued, render, events: EVENTS, channels: CHANNELS, setTransport: (t) => { send = t; } };
}

export function registerCommunicationsRoutes(api) {
  const { route, all, get, run, requireStaff, reply, bad, notFound, str, int, HttpError, comms } = api;

  const channel = (v) => {
    const value = str(v ?? 'email', 'channel', { max: 20 }).toLowerCase();
    if (!comms.channels.includes(value)) throw bad(`channel must be one of ${comms.channels.join(', ')}`);
    return value;
  };

  // ---- Templates ----
  route('GET', '/api/communications/templates', (ctx) => { requireStaff(ctx); return all('SELECT * FROM message_templates ORDER BY name'); });
  route('POST', '/api/communications/templates', (ctx) => {
    requireStaff(ctx);
    const name = str(ctx.body.name, 'name', { max: 120 });
    if (get('SELECT 1 FROM message_templates WHERE name = ?', name)) throw new HttpError(409, 'Template name exists');
    const subject = str(ctx.body.subject, 'subject', { max: 300, required: false });
    const body = str(ctx.body.body ?? '', 'body', { max: 10000, required: false }) ?? '';
    const { lastInsertRowid } = run('INSERT INTO message_templates (name, channel, subject, body) VALUES (?,?,?,?)',
      name, channel(ctx.body.channel), subject, body);
    return reply(201, get('SELECT * FROM message_templates WHERE id = ?', lastInsertRowid));
  });
  route('PUT', '/api/communications/templates/:id', (ctx) => {
    requireStaff(ctx);
    const current = get('SELECT * FROM message_templates WHERE id = ?', ctx.params.id);
    if (!current) throw notFound();
    const name = str(ctx.body.name ?? current.name, 'name', { max: 120 });
    const subject = ctx.body.subject === undefined ? current.subject : str(ctx.body.subject, 'subject', { max: 300, required: false });
    const body = ctx.body.body === undefined ? current.body : (str(ctx.body.body, 'body', { max: 10000, required: false }) ?? '');
    const chan = ctx.body.channel === undefined ? current.channel : channel(ctx.body.channel);
    run('UPDATE message_templates SET name = ?, channel = ?, subject = ?, body = ? WHERE id = ?',
      name, chan, subject, body, current.id);
    return get('SELECT * FROM message_templates WHERE id = ?', current.id);
  });

  // ---- Automations ----
  route('GET', '/api/communications/automations', (ctx) => {
    requireStaff(ctx);
    return all(`SELECT a.*, t.name AS template, t.subject AS template_subject
                FROM automations a JOIN message_templates t ON t.id = a.template_id ORDER BY a.id`);
  });
  route('GET', '/api/communications/events', (ctx) => { requireStaff(ctx); return comms.events; });
  route('POST', '/api/communications/automations', (ctx) => {
    requireStaff(ctx);
    const name = str(ctx.body.name, 'name', { max: 120 });
    const event = str(ctx.body.event, 'event', { max: 60 });
    if (!comms.events.includes(event)) throw bad(`event must be one of ${comms.events.join(', ')}`);
    const templateId = int(ctx.body.template_id, 'template_id', { min: 1 });
    if (!get('SELECT 1 FROM message_templates WHERE id = ?', templateId)) throw bad('Unknown template_id');
    const chan = ctx.body.channel === undefined || ctx.body.channel === null ? null : channel(ctx.body.channel);
    const active = ctx.body.active === undefined ? 1 : (ctx.body.active ? 1 : 0);
    const { lastInsertRowid } = run('INSERT INTO automations (name, event, template_id, channel, active) VALUES (?,?,?,?,?)',
      name, event, templateId, chan, active);
    return reply(201, get('SELECT * FROM automations WHERE id = ?', lastInsertRowid));
  });
  route('PUT', '/api/communications/automations/:id', (ctx) => {
    requireStaff(ctx);
    const current = get('SELECT * FROM automations WHERE id = ?', ctx.params.id);
    if (!current) throw notFound();
    const name = str(ctx.body.name ?? current.name, 'name', { max: 120 });
    const event = str(ctx.body.event ?? current.event, 'event', { max: 60 });
    if (!comms.events.includes(event)) throw bad(`event must be one of ${comms.events.join(', ')}`);
    const templateId = ctx.body.template_id === undefined ? current.template_id : int(ctx.body.template_id, 'template_id', { min: 1 });
    if (!get('SELECT 1 FROM message_templates WHERE id = ?', templateId)) throw bad('Unknown template_id');
    const chan = ctx.body.channel === undefined ? current.channel : (ctx.body.channel === null ? null : channel(ctx.body.channel));
    const active = ctx.body.active === undefined ? current.active : (ctx.body.active ? 1 : 0);
    run('UPDATE automations SET name = ?, event = ?, template_id = ?, channel = ?, active = ? WHERE id = ?',
      name, event, templateId, chan, active, current.id);
    return get('SELECT * FROM automations WHERE id = ?', current.id);
  });
  route('DELETE', '/api/communications/automations/:id', (ctx) => {
    requireStaff(ctx);
    if (!get('SELECT 1 FROM automations WHERE id = ?', ctx.params.id)) throw notFound();
    run('DELETE FROM automations WHERE id = ?', ctx.params.id);
    return reply(204, '');
  });

  // ---- Outbox ----
  route('GET', '/api/communications/messages', (ctx) => {
    requireStaff(ctx);
    const status = ctx.query.get('status');
    const limit = Math.min(Math.max(Number(ctx.query.get('limit')) || 50, 1), 200);
    const offset = Math.max(Number(ctx.query.get('offset')) || 0, 0);
    const where = status ? 'WHERE status = ?' : '';
    const params = status ? [status] : [];
    return all(`SELECT * FROM messages ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  });
  route('POST', '/api/communications/dispatch', async (ctx) => {
    requireStaff(ctx);
    const limit = Math.min(Math.max(Number(ctx.body.limit) || 100, 1), 500);
    const messages = await comms.deliverQueued(limit);
    return { delivered: messages.filter((m) => m?.status === 'sent').length, messages };
  });
  route('POST', '/api/communications/messages/:id/send', async (ctx) => {
    requireStaff(ctx);
    if (!get('SELECT 1 FROM messages WHERE id = ?', ctx.params.id)) throw notFound();
    return comms.deliver(Number(ctx.params.id));
  });
}
