// Monthly pantry subscriptions: a user's bundle delivered or collected on a
// recurring schedule. Staff (or a cron job) call /api/subscriptions/process to
// turn every due subscription into a normal order.
import { transaction } from './db.js';
import { expandBundle } from './bundles.js';
import { adjustStock, stockAt } from './locations.js';
import { pointsFor, tierFor, lifetimeSpendCents } from './loyalty.js';

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const nextRun = () => new Date(Date.now() + MONTH_MS).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

const fulfillmentOf = (v) => (String(v ?? 'delivery').toLowerCase() === 'pickup' ? 'pickup' : 'delivery');

function entitlement(db, body, fulfillment) {
  if (fulfillment === 'pickup') {
    const pickupLocationId = body.pickup_location_id !== undefined
      ? Number(body.pickup_location_id)
      : (db.prepare("SELECT id FROM locations WHERE active = 1 AND is_primary = 1").get()?.id ?? null);
    if (!pickupLocationId) {
      const e = new Error('pickup_location_id is required for pickup fulfilments');
      e.status = 400;
      throw e;
    }
    const location = db.prepare('SELECT id, active FROM locations WHERE id = ?').get(pickupLocationId);
    if (!location || !location.active) {
      const e = new Error('Pickup location is not available');
      e.status = 400;
      throw e;
    }
    const pickupAt = typeof body.pickup_at === 'string' ? body.pickup_at.trim() : '';
    return { shipping_address: '', pickup_location_id: pickupLocationId, pickup_at: pickupAt || null };
  }
  const raw = typeof body.shipping_address === 'string' ? body.shipping_address.trim() : '';
  if (!raw) {
    const e = new Error('shipping_address is required for delivery');
    e.status = 400;
    throw e;
  }
  return { shipping_address: raw, pickup_location_id: null, pickup_at: null };
}

const subWithBundle = (db, sub) => {
  const bundle = db.prepare('SELECT id, sku, name, bundle_type, savings_percent, active FROM bundles WHERE id = ?').get(sub.bundle_id);
  return { ...sub, bundle };
};

function makeSubscriptionOrder(db, sub, user) {
  const bundle = db.prepare('SELECT * FROM bundles WHERE id = ? AND active = 1').get(sub.bundle_id);
  if (!bundle) throw new Error(`Bundle ${sub.bundle_id} is not available`);
  const { lines, discount_cents } = expandBundle(db, bundle, 1);
  const primary = db.prepare('SELECT id FROM locations WHERE active = 1 AND is_primary = 1 ORDER BY id LIMIT 1').get();
  const locationId = sub.fulfillment === 'pickup' ? (sub.pickup_location_id || primary?.id) : primary?.id;
  if (!locationId) throw new Error('No active fulfilment location');

  return transaction(db, () => {
    let total = 0;
    const packed = [];
    for (const line of lines) {
      const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(line.product_id);
      if (!p) throw new Error(`Product ${line.product_id} is not available`);
      if (stockAt(db, p.id, locationId) < line.quantity) throw new Error(`Insufficient stock for ${p.name}`);
      total += p.price_cents * line.quantity;
      packed.push({ p, qty: line.quantity });
    }
    const payable = total - Math.min(total, discount_cents);
    const tier = tierFor(lifetimeSpendCents(db, user.id));
    const points = pointsFor(payable, tier);
    const { lastInsertRowid: oid } = db.prepare(
      `INSERT INTO orders (user_id, total_cents, discount_cents, location_id, points_earned,
         shipping_address, delivery_service, shipping_country, fulfillment, pickup_location_id, pickup_at,
         delivery_fee_cents, payment_status, payment_method)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,0,'unpaid','manual')`,
    ).run(user.id, payable, discount_cents, locationId, points,
      sub.shipping_address || '', 'dhl', 'DE', sub.fulfillment, sub.pickup_location_id, sub.pickup_at);
    for (const it of packed) {
      db.prepare('INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents) VALUES (?,?,?,?)')
        .run(oid, it.p.id, it.qty, it.p.price_cents);
      adjustStock(db, it.p.id, locationId, -it.qty);
    }
    db.prepare('UPDATE users SET loyalty_points = loyalty_points + ? WHERE id = ?').run(points, user.id);
    return { order_id: Number(oid), total_cents: payable, points_earned: points, location_id: locationId };
  });
}

export function registerSubscriptionRoutes(api) {
  const { db, route, all, get, run, reply, bad, notFound, str, int, requireUser, requireStaff, HttpError, comms } = api;

  route('GET', '/api/subscriptions', (ctx) => {
    const user = requireUser(ctx);
    return (user.role === 'customer'
      ? all('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY id DESC', user.id)
      : all('SELECT * FROM subscriptions ORDER BY id DESC')
    ).map((s) => subWithBundle(db, s));
  });

  route('POST', '/api/subscriptions', (ctx) => {
    const user = requireUser(ctx);
    const num = int(ctx.body.bundle_id, 'bundle_id', { min: 1 });
    const bundle = get('SELECT * FROM bundles WHERE id = ? AND active = 1', num);
    if (!bundle) throw bad('Unknown or inactive bundle');
    const fulfillment = fulfillmentOf(ctx.body.fulfillment);
    const parcel = entitlement(db, ctx.body, fulfillment);
    const { lastInsertRowid } = run(
      `INSERT INTO subscriptions (user_id, bundle_id, fulfillment, shipping_address, pickup_location_id, pickup_at, next_run_on)
       VALUES (?,?,?,?,?,?,?)`,
      user.id, num, fulfillment, parcel.shipping_address, parcel.pickup_location_id, parcel.pickup_at, nextRun());
    return reply(201, subWithBundle(db, get('SELECT * FROM subscriptions WHERE id = ?', lastInsertRowid)));
  });

  route('PUT', '/api/subscriptions/:id', (ctx) => {
    const user = requireUser(ctx);
    const current = get('SELECT * FROM subscriptions WHERE id = ?', ctx.params.id);
    if (!current) throw notFound();
    if (user.role === 'customer' && current.user_id !== user.id) throw notFound();
    const status = ctx.body.status === undefined ? current.status : str(ctx.body.status, 'status', { max: 12 });
    if (!['active', 'paused', 'cancelled'].includes(status)) throw bad('status must be active, paused or cancelled');
    if (current.status === 'cancelled' && status !== 'cancelled') throw new HttpError(409, 'Cancelled subscriptions cannot be resumed');
    const fulfillment = ctx.body.fulfillment === undefined ? current.fulfillment : fulfillmentOf(ctx.body.fulfillment);
    const parcel = ctx.body.fulfillment === undefined
      ? { shipping_address: current.shipping_address, pickup_location_id: current.pickup_location_id, pickup_at: current.pickup_at }
      : entitlement(db, ctx.body, fulfillment);
    const next = ctx.body.next_run_on === undefined ? current.next_run_on : str(ctx.body.next_run_on, 'next_run_on', { max: 10 });
    run(
      `UPDATE subscriptions SET status = ?, fulfillment = ?, shipping_address = ?, pickup_location_id = ?, pickup_at = ?, next_run_on = ?
       WHERE id = ?`,
      status, fulfillment, parcel.shipping_address, parcel.pickup_location_id, parcel.pickup_at, next, current.id);
    return subWithBundle(db, get('SELECT * FROM subscriptions WHERE id = ?', current.id));
  });

  // Turn every due subscription into a fulfilled order (staff or cron).
  route('POST', '/api/subscriptions/process', async (ctx) => {
    requireStaff(ctx);
    const due = all("SELECT * FROM subscriptions WHERE status = 'active' AND next_run_on <= ? ORDER BY id", today());
    const results = [];
    for (const sub of due) {
      const user = get('SELECT * FROM users WHERE id = ?', sub.user_id);
      if (!user) continue;
      try {
        const made = makeSubscriptionOrder(db, sub, user);
        run('UPDATE subscriptions SET next_run_on = ?, last_run_on = ? WHERE id = ?', nextRun(), today(), sub.id);
        if (user.email) comms.emit('order.placed', {
          email: user.email, name: user.name, order_id: made.order_id,
          total_cents: made.total_cents, location_id: made.location_id,
        });
        results.push({ subscription_id: sub.id, ...made });
      } catch (e) {
        results.push({ subscription_id: sub.id, error: e.message });
      }
    }
    return { processed: results.length, results };
  });
}