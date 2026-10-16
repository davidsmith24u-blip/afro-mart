// Marketing: customer segments, campaigns, newsletter subscribers and promo codes.
export const SEGMENTS = [
  { key: 'all', label: 'All customers' },
  { key: 'new', label: 'New (joined in the last 30 days)' },
  { key: 'active', label: 'Active (ordered in the last 30 days)' },
  { key: 'lapsed', label: 'Lapsed (no order in 60 days)' },
  { key: 'vip', label: 'VIP (500+ loyalty points)' },
];

const SEGMENT_WHERE = {
  all: "u.role = 'customer'",
  new: "u.role = 'customer' AND u.created_at >= datetime('now','-30 days')",
  active: `u.role = 'customer' AND EXISTS (
    SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.status != 'cancelled' AND o.created_at >= datetime('now','-30 days'))`,
  lapsed: `u.role = 'customer'
    AND EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.status != 'cancelled')
    AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.status != 'cancelled' AND o.created_at >= datetime('now','-60 days'))`,
  vip: "u.role = 'customer' AND u.loyalty_points >= 500",
};

export function segmentUsers(db, segment, limit = 5000) {
  const where = SEGMENT_WHERE[segment];
  if (!where) throw new Error(`Unknown segment ${segment}`);
  return db.prepare(
    `SELECT u.id, u.email, u.name, u.loyalty_points FROM users u WHERE ${where} ORDER BY u.id LIMIT ?`).all(limit);
}

export function listSegments(db) {
  return SEGMENTS.map(({ key, label }) => ({
    key,
    label,
    count: db.prepare(`SELECT COUNT(*) AS n FROM users u WHERE ${SEGMENT_WHERE[key]}`).get().n,
  }));
}

export function computeDiscount(promo, totalCents) {
  if (!promo) return 0;
  const raw = promo.discount_type === 'fixed' ? promo.value : Math.floor((totalCents * promo.value) / 100);
  return Math.max(0, Math.min(raw, totalCents));
}

export function validatePromo(db, code, totalCents, { userId, email } = {}) {
  const promo = db.prepare('SELECT * FROM promo_codes WHERE UPPER(code) = UPPER(?)').get(String(code));
  if (!promo || !promo.active) throw Object.assign(new Error('Promo code is not valid'), { status: 400 });
  if (promo.expires_at && promo.expires_at < new Date().toISOString().slice(0, 10)) {
    throw Object.assign(new Error('Promo code has expired'), { status: 400 });
  }
  if (promo.max_uses != null && promo.used_count >= promo.max_uses) {
    throw Object.assign(new Error('Promo code has reached its usage limit'), { status: 409 });
  }
  if (totalCents < promo.min_total_cents) {
    throw Object.assign(new Error('Order total is below the promo code minimum'), { status: 400 });
  }
  // A welcome-first-order coupon is reserved for shoppers who have not ordered yet.
  if (promo.first_order_only) {
    const prior = userId
      ? db.prepare("SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND status != 'cancelled'").get(userId).n
      : email
        ? db.prepare("SELECT COUNT(*) AS n FROM orders WHERE guest_email = ? AND status != 'cancelled'").get(String(email).toLowerCase()).n
        : 0;
    if (prior > 0) throw Object.assign(new Error('This code is for a first order only'), { status: 400 });
  }
  return promo;
}

export function registerMarketingRoutes(api) {
  const { route, all, get, run, transaction, requireStaff, reply, bad, notFound, str, int, HttpError, comms } = api;
  const email = (v) => {
    const value = str(v, 'email', { max: 254 }).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) throw bad('email is invalid');
    return value;
  };

  // ---- Segments ----
  route('GET', '/api/marketing/segments', (ctx) => { requireStaff(ctx); return listSegments(api.db); });

  // ---- Subscribers ----
  route('POST', '/api/marketing/subscribe', (ctx) => {
    const address = email(ctx.body.email);
    const name = str(ctx.body.name, 'name', { required: false });
    const source = str(ctx.body.source ?? 'storefront', 'source', { max: 60, required: false });
    const existing = get('SELECT * FROM subscribers WHERE email = ?', address);
    if (existing) {
      run('UPDATE subscribers SET active = 1, name = COALESCE(?, name) WHERE id = ?', name, existing.id);
      return get('SELECT * FROM subscribers WHERE id = ?', existing.id);
    }
    const { lastInsertRowid } = run('INSERT INTO subscribers (email, name, source) VALUES (?,?,?)', address, name, source);
    return reply(201, get('SELECT * FROM subscribers WHERE id = ?', lastInsertRowid));
  });
  route('GET', '/api/marketing/subscribers', (ctx) => {
    requireStaff(ctx);
    const limit = Math.min(Math.max(Number(ctx.query.get('limit')) || 100, 1), 500);
    return all('SELECT * FROM subscribers ORDER BY id DESC LIMIT ?', limit);
  });

  // ---- Campaigns ----
  route('GET', '/api/marketing/campaigns', (ctx) => { requireStaff(ctx); return all('SELECT * FROM campaigns ORDER BY id DESC'); });
  route('GET', '/api/marketing/campaigns/:id', (ctx) => {
    requireStaff(ctx);
    const campaign = get('SELECT * FROM campaigns WHERE id = ?', ctx.params.id);
    if (!campaign) throw notFound();
    return campaign;
  });
  route('POST', '/api/marketing/campaigns', (ctx) => {
    requireStaff(ctx);
    const name = str(ctx.body.name, 'name', { max: 160 });
    const segment = str(ctx.body.segment ?? 'all', 'segment', { max: 40 });
    if (!SEGMENTS.some((s) => s.key === segment)) throw bad(`segment must be one of ${SEGMENTS.map((s) => s.key).join(', ')}`);
    const channel = str(ctx.body.channel ?? 'email', 'channel', { max: 20 });
    const subject = str(ctx.body.subject, 'subject', { max: 300, required: false });
    const body = str(ctx.body.body ?? '', 'body', { max: 10000, required: false }) ?? '';
    const scheduledAt = str(ctx.body.scheduled_at, 'scheduled_at', { max: 30, required: false });
    const status = scheduledAt ? 'scheduled' : 'draft';
    const { lastInsertRowid } = run(
      'INSERT INTO campaigns (name, channel, segment, subject, body, status, scheduled_at) VALUES (?,?,?,?,?,?,?)',
      name, channel, segment, subject, body, status, scheduledAt);
    return reply(201, get('SELECT * FROM campaigns WHERE id = ?', lastInsertRowid));
  });
  route('PUT', '/api/marketing/campaigns/:id', (ctx) => {
    requireStaff(ctx);
    const current = get('SELECT * FROM campaigns WHERE id = ?', ctx.params.id);
    if (!current) throw notFound();
    if (current.status === 'sent') throw new HttpError(409, 'Campaign already sent');
    const name = str(ctx.body.name ?? current.name, 'name', { max: 160 });
    const segment = str(ctx.body.segment ?? current.segment, 'segment', { max: 40 });
    if (!SEGMENTS.some((s) => s.key === segment)) throw bad(`segment must be one of ${SEGMENTS.map((s) => s.key).join(', ')}`);
    const channel = str(ctx.body.channel ?? current.channel, 'channel', { max: 20 });
    const subject = ctx.body.subject === undefined ? current.subject : str(ctx.body.subject, 'subject', { max: 300, required: false });
    const body = ctx.body.body === undefined ? current.body : (str(ctx.body.body, 'body', { max: 10000, required: false }) ?? '');
    run('UPDATE campaigns SET name = ?, channel = ?, segment = ?, subject = ?, body = ? WHERE id = ?',
      name, channel, segment, subject, body, current.id);
    return get('SELECT * FROM campaigns WHERE id = ?', current.id);
  });
  route('POST', '/api/marketing/campaigns/:id/send', (ctx) => {
    requireStaff(ctx);
    const campaign = get('SELECT * FROM campaigns WHERE id = ?', ctx.params.id);
    if (!campaign) throw notFound();
    if (campaign.status === 'sent') throw new HttpError(409, 'Campaign already sent');
    const recipients = segmentUsers(api.db, campaign.segment);
    transaction(api.db, () => {
      for (const user of recipients) {
        comms.enqueue({
          channel: campaign.channel,
          recipient: user.email,
          subject: campaign.subject,
          body: campaign.body,
          campaign_id: campaign.id,
        });
      }
      run("UPDATE campaigns SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?", campaign.id);
    });
    return { campaign: get('SELECT * FROM campaigns WHERE id = ?', campaign.id), recipients: recipients.length };
  });

  // ---- Promo codes ----
  route('GET', '/api/marketing/promo-codes', (ctx) => { requireStaff(ctx); return all('SELECT * FROM promo_codes ORDER BY id DESC'); });
  route('POST', '/api/marketing/promo-codes', (ctx) => {
    requireStaff(ctx);
    const code = str(ctx.body.code, 'code', { max: 40 }).toUpperCase();
    if (get('SELECT 1 FROM promo_codes WHERE UPPER(code) = ?', code)) throw new HttpError(409, 'Promo code exists');
    const type = str(ctx.body.discount_type ?? 'percent', 'discount_type', { max: 10 }).toLowerCase();
    if (!['percent', 'fixed'].includes(type)) throw bad('discount_type must be percent or fixed');
    const value = int(ctx.body.value, 'value', { min: 1 });
    if (type === 'percent' && value > 100) throw bad('percent discount cannot exceed 100');
    const minTotal = ctx.body.min_total_cents === undefined ? 0 : int(ctx.body.min_total_cents, 'min_total_cents');
    const maxUses = ctx.body.max_uses === undefined || ctx.body.max_uses === null ? null : int(ctx.body.max_uses, 'max_uses', { min: 1 });
    const firstOrderOnly = ctx.body.first_order_only ? 1 : 0;
    const expiresAt = str(ctx.body.expires_at, 'expires_at', { max: 10, required: false });
    const { lastInsertRowid } = run(
      'INSERT INTO promo_codes (code, discount_type, value, min_total_cents, max_uses, first_order_only, expires_at) VALUES (?,?,?,?,?,?,?)',
      code, type, value, minTotal, maxUses, firstOrderOnly, expiresAt);
    return reply(201, get('SELECT * FROM promo_codes WHERE id = ?', lastInsertRowid));
  });
  route('PUT', '/api/marketing/promo-codes/:id', (ctx) => {
    requireStaff(ctx);
    const current = get('SELECT * FROM promo_codes WHERE id = ?', ctx.params.id);
    if (!current) throw notFound();
    const active = ctx.body.active === undefined ? current.active : (ctx.body.active ? 1 : 0);
    run('UPDATE promo_codes SET active = ? WHERE id = ?', active, current.id);
    return get('SELECT * FROM promo_codes WHERE id = ?', current.id);
  });
  route('POST', '/api/marketing/promo-codes/validate', (ctx) => {
    const total = int(ctx.body.total_cents, 'total_cents');
    const promo = validatePromo(api.db, ctx.body.code ?? '', total, {
      userId: ctx.user ? ctx.user.id : undefined,
      email: ctx.body.email ? str(ctx.body.email, 'email', { max: 254 }).toLowerCase() : undefined,
    });
    return {
      code: promo.code,
      discount_cents: computeDiscount(promo, total),
      discount_type: promo.discount_type,
      value: promo.value,
      min_total_cents: promo.min_total_cents,
      first_order_only: promo.first_order_only,
    };
  });
}
