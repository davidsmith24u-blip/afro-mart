// Retention automations: "back in stock" alerts and abandoned-cart recovery.
// Requests are recorded here and turned into outbox messages by staff/cron
// endpoints, reusing the communications pipeline (templates, transport, outbox).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ABANDONED_MINUTES = Math.max(5, Number(process.env.CART_ABANDON_MINUTES) || 60);

export function registerRetentionRoutes(api) {
  const { route, all, get, run, reply, notFound, bad, int, requireUser, requireStaff, comms, audit } = api;

  const email = (value, name = 'email') => {
    const v = String(value ?? '').trim().toLowerCase();
    if (!v || v.length > 200 || !EMAIL_RE.test(v)) throw bad(`${name} must be a valid email`);
    return v;
  };

  // Public: register interest in an out-of-stock product.
  route('POST', '/api/stock-alerts', (ctx) => {
    const productId = int(ctx.body.product_id, 'product_id', { min: 1 });
    const address = email(ctx.body.email);
    const product = get('SELECT id, name FROM products WHERE id = ?', productId);
    if (!product) throw notFound();
    run('INSERT OR IGNORE INTO stock_alerts (product_id, email) VALUES (?, ?)', productId, address);
    return reply(201, { product_id: productId, product: product.name, email: address, queued: true });
  });

  // Staff: the pending back-in-stock queue.
  route('GET', '/api/stock-alerts', (ctx) => {
    requireStaff(ctx);
    return all(
      `SELECT sa.id, sa.product_id, sa.email, sa.created_at, p.name AS product_name, p.stock
       FROM stock_alerts sa JOIN products p ON p.id = sa.product_id
       WHERE sa.notified_at IS NULL ORDER BY sa.id DESC`);
  });

  // Staff/cron: email everyone waiting on products that are back in stock.
  route('POST', '/api/automations/back-in-stock', (ctx) => {
    requireStaff(ctx);
    const waiting = all(
      `SELECT sa.id, sa.email, p.id AS product_id, p.name AS product_name, p.price_cents
       FROM stock_alerts sa JOIN products p ON p.id = sa.product_id
       WHERE sa.notified_at IS NULL AND p.stock > 0 AND p.active = 1
       ORDER BY sa.id`);
    for (const row of waiting) {
      comms.enqueue({
        channel: 'email',
        recipient: row.email,
        subject: `${row.product_name} is back in stock`,
        body: `Good news! ${row.product_name} is back in stock at Afro Mart. Order now before it sells out again.`,
      });
      run('UPDATE stock_alerts SET notified_at = CURRENT_TIMESTAMP WHERE id = ?', row.id);
    }
    audit(ctx, 'automation.back_in_stock', 'automation', null, String(waiting.length));
    return { notified: waiting.length, products: [...new Set(waiting.map((row) => row.product_name))] };
  });

  // Auth: store a snapshot of the signed-in customer's cart for recovery.
  route('PUT', '/api/cart', (ctx) => {
    const user = requireUser(ctx);
    const items = Array.isArray(ctx.body.items) ? ctx.body.items.slice(0, 100) : [];
    const clean = items
      .map((item) => ({ product_id: item.product_id ?? null, bundle_id: item.bundle_id ?? null, quantity: Math.max(1, Number(item.quantity) || 1) }))
      .filter((item) => item.product_id || item.bundle_id);
    const subtotal = Math.max(0, Number(ctx.body.subtotal_cents) || 0);
    const existing = get('SELECT id FROM carts WHERE user_id = ?', user.id);
    if (existing) {
      run("UPDATE carts SET email = ?, items = ?, subtotal_cents = ?, updated_at = CURRENT_TIMESTAMP, reminded_at = NULL, recovered_at = NULL WHERE id = ?",
        user.email, JSON.stringify(clean), subtotal, existing.id);
      return { id: existing.id, items: clean.length, subtotal_cents: subtotal };
    }
    const { lastInsertRowid } = run('INSERT INTO carts (user_id, email, items, subtotal_cents) VALUES (?,?,?,?)',
      user.id, user.email, JSON.stringify(clean), subtotal);
    return reply(201, { id: Number(lastInsertRowid), items: clean.length, subtotal_cents: subtotal });
  });

  // Staff/cron: email customers whose saved carts have gone quiet.
  route('POST', '/api/automations/abandoned-carts', (ctx) => {
    requireStaff(ctx);
    const minutes = Math.max(5, Number(ctx.body && ctx.body.minutes) || ABANDONED_MINUTES);
    const lapsed = all(
      `SELECT c.id, c.email, c.items, c.subtotal_cents FROM carts c
       WHERE c.reminded_at IS NULL AND c.recovered_at IS NULL
         AND c.items NOT IN ('[]', '')
         AND c.updated_at <= datetime('now', ?) ORDER BY c.id`,
      `-${minutes} minutes`);
    for (const row of lapsed) {
      comms.enqueue({
        channel: 'email',
        recipient: row.email,
        subject: 'Still thinking it over? Your Afro Mart bag is waiting',
        body: `You left ${JSON.parse(row.items).length} item(s) in your Afro Mart bag. Come back and finish your order — we will keep it warm.`,
      });
      run('UPDATE carts SET reminded_at = CURRENT_TIMESTAMP WHERE id = ?', row.id);
    }
    audit(ctx, 'automation.abandoned_carts', 'automation', null, String(lapsed.length));
    return { reminded: lapsed.length, after_minutes: minutes };
  });

  // Staff: current saved carts (for the dashboard).
  route('GET', '/api/carts', (ctx) => {
    requireStaff(ctx);
    return all(
      `SELECT id, user_id, email, subtotal_cents, updated_at, reminded_at, recovered_at, items
       FROM carts ORDER BY updated_at DESC LIMIT 100`).map((row) => {
      let itemCount = 0;
      try { itemCount = JSON.parse(row.items || '[]').length; } catch { itemCount = 0; }
      return { ...row, items: undefined, item_count: itemCount };
    });
  });
}
