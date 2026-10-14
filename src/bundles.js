// Meal packs & gift boxes: curated bundles of products sold at a bundle price.
// The bundle price is the sum of its contents minus a percentage saving, so it
// always stays in sync with the catalog. Orders can reference a bundle directly.
import { transaction } from './db.js';

export const BUNDLE_TYPES = ['meal_pack', 'starter_pack', 'party_pack', 'gift_box', 'taste_box'];
export const TYPE_LABELS = {
  meal_pack: 'Meal pack',
  starter_pack: 'Starter kit',
  party_pack: 'Party pack',
  gift_box: 'Gift box',
  taste_box: 'Taste box',
};

export function bundleItems(db, bundleId) {
  return db.prepare(
    `SELECT bi.product_id, p.sku, p.name, p.price_cents, p.stock, p.active, bi.quantity
     FROM bundle_items bi JOIN products p ON p.id = bi.product_id
     WHERE bi.bundle_id = ? ORDER BY p.name`).all(bundleId);
}

export function bundlePayload(db, bundle) {
  const items = bundleItems(db, bundle.id);
  const subtotal = items.reduce((sum, item) => sum + item.price_cents * item.quantity, 0);
  const savings = Math.floor((subtotal * bundle.savings_percent) / 100);
  return {
    ...bundle,
    type_label: TYPE_LABELS[bundle.bundle_type] || bundle.bundle_type,
    item_count: items.length,
    items,
    subtotal_cents: subtotal,
    savings_cents: savings,
    price_cents: Math.max(0, subtotal - savings),
  };
}

// Expand a bundle order line into its component products.
export function expandBundle(db, bundle, quantity) {
  const rows = bundleItems(db, bundle.id).filter((item) => item.active);
  if (!rows.length) {
    const e = new Error(`Bundle ${bundle.name} contains no available products`);
    e.status = 409;
    throw e;
  }
  const lines = new Map();
  let subtotal = 0;
  for (const item of rows) {
    lines.set(item.product_id, (lines.get(item.product_id) ?? 0) + item.quantity * quantity);
    subtotal += item.price_cents * item.quantity * quantity;
  }
  const discount = Math.floor((subtotal * bundle.savings_percent) / 100);
  return {
    lines: [...lines.entries()].map(([product_id, lineQuantity]) => ({ product_id, quantity: lineQuantity })),
    discount_cents: discount,
  };
}

export function registerBundleRoutes(api) {
  const { db, route, all, get, run, requireStaff, reply, bad, notFound, str, int, HttpError } = api;

  const list = (ctx) => {
    const staff = ctx.user && ctx.user.role !== 'customer';
    const rows = staff && ctx.query.get('all') === '1'
      ? all('SELECT * FROM bundles ORDER BY id')
      : all('SELECT * FROM bundles WHERE active = 1 ORDER BY id');
    return rows.map((bundle) => bundlePayload(db, bundle));
  };

  route('GET', '/api/bundles', list);
  route('GET', '/api/bundles/:id', (ctx) => {
    const bundle = get('SELECT * FROM bundles WHERE id = ?', ctx.params.id);
    if (!bundle || (!bundle.active && !(ctx.user && ctx.user.role !== 'customer'))) throw notFound();
    return bundlePayload(db, bundle);
  });

  route('POST', '/api/bundles', (ctx) => {
    requireStaff(ctx);
    const sku = str(ctx.body.sku, 'sku', { max: 64 });
    if (get('SELECT 1 FROM bundles WHERE sku = ?', sku)) throw new HttpError(409, 'Bundle SKU exists');
    const name = str(ctx.body.name, 'name');
    const description = str(ctx.body.description ?? '', 'description', { max: 2000, required: false }) ?? '';
    const type = str(ctx.body.bundle_type ?? 'meal_pack', 'bundle_type', { max: 30 });
    if (!BUNDLE_TYPES.includes(type)) throw bad(`bundle_type must be one of ${BUNDLE_TYPES.join(', ')}`);
    const savings = int(ctx.body.savings_percent ?? 10, 'savings_percent', { min: 0, required: false }) ?? 10;
    if (savings > 100) throw bad('savings_percent cannot exceed 100');
    const serves = int(ctx.body.serves ?? 0, 'serves', { min: 0, required: false }) ?? 0;
    const active = ctx.body.active === undefined ? 1 : (ctx.body.active ? 1 : 0);
    const items = fillItems(ctx.body.items);
    const bundle = transaction(db, () => {
      const { lastInsertRowid } = run(
        'INSERT INTO bundles (sku, name, description, bundle_type, savings_percent, serves, active) VALUES (?,?,?,?,?,?,?)',
        sku, name, description, type, savings, serves, active);
      insertItems(lastInsertRowid, items);
      return get('SELECT * FROM bundles WHERE id = ?', lastInsertRowid);
    });
    return reply(201, bundlePayload(db, bundle));
  });

  route('PUT', '/api/bundles/:id', (ctx) => {
    requireStaff(ctx);
    const current = get('SELECT * FROM bundles WHERE id = ?', ctx.params.id);
    if (!current) throw notFound();
    const bundle = transaction(db, () => {
      const sku = str(ctx.body.sku ?? current.sku, 'sku', { max: 64 });
      const duplicate = get('SELECT 1 FROM bundles WHERE sku = ? AND id != ?', sku, current.id);
      if (duplicate) throw new HttpError(409, 'Bundle SKU exists');
      const name = str(ctx.body.name ?? current.name, 'name');
      const description = ctx.body.description === undefined ? current.description
        : (str(ctx.body.description, 'description', { max: 2000, required: false }) ?? '');
      const type = str(ctx.body.bundle_type ?? current.bundle_type, 'bundle_type', { max: 30 });
      if (!BUNDLE_TYPES.includes(type)) throw bad(`bundle_type must be one of ${BUNDLE_TYPES.join(', ')}`);
      const savings = int(ctx.body.savings_percent ?? current.savings_percent, 'savings_percent', { min: 0 });
      if (savings > 100) throw bad('savings_percent cannot exceed 100');
      const serves = ctx.body.serves === undefined ? current.serves : int(ctx.body.serves, 'serves', { min: 0 });
      const active = ctx.body.active === undefined ? current.active : (ctx.body.active ? 1 : 0);
      run('UPDATE bundles SET sku=?, name=?, description=?, bundle_type=?, savings_percent=?, serves=?, active=? WHERE id=?',
        sku, name, description, type, savings, serves, active, current.id);
      if (ctx.body.items !== undefined) {
        run('DELETE FROM bundle_items WHERE bundle_id = ?', current.id);
        insertItems(current.id, fillItems(ctx.body.items));
      }
      return get('SELECT * FROM bundles WHERE id = ?', current.id);
    });
    return bundlePayload(db, bundle);
  });

  route('DELETE', '/api/bundles/:id', (ctx) => {
    requireStaff(ctx);
    if (!get('SELECT 1 FROM bundles WHERE id = ?', ctx.params.id)) throw notFound();
    transaction(db, () => {
      run('DELETE FROM bundle_items WHERE bundle_id = ?', ctx.params.id);
      run('DELETE FROM bundles WHERE id = ?', ctx.params.id);
    });
    return reply(204, '');
  });

  function fillItems(raw) {
    if (!Array.isArray(raw) || !raw.length || raw.length > 50) throw bad('items must be a non-empty array');
    const seen = new Set();
    const items = [];
    for (const it of raw) {
      const productId = int(it?.product_id, 'product_id', { min: 1 });
      const quantity = int(it?.quantity, 'quantity', { min: 1 });
      if (seen.has(productId)) throw bad('Each product may appear once per bundle');
      seen.add(productId);
      if (!get('SELECT 1 FROM products WHERE id = ?', productId)) throw bad(`Unknown product ${productId}`);
      items.push({ product_id: productId, quantity });
    }
    return items;
  }

  function insertItems(bundleId, items) {
    const stmt = db.prepare('INSERT INTO bundle_items (bundle_id, product_id, quantity) VALUES (?,?,?)');
    for (const item of items) stmt.run(bundleId, item.product_id, item.quantity);
  }
}