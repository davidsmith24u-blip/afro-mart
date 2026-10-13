// Multi-location support: store/warehouse locations, per-location inventory and transfers.
//
// `products.stock` stays the authoritative total. The `inventory` table holds an optional
// per-location allocation of that total. The first allocation created for a product is seeded
// with the product's current stock, so the sum of allocations always matches the total.
import { transaction } from './db.js';

const fail = (status, message) => Object.assign(new Error(message), { status });

export function primaryLocation(db) {
  return db.prepare('SELECT * FROM locations WHERE is_primary = 1 ORDER BY id LIMIT 1').get()
    ?? db.prepare('SELECT * FROM locations WHERE active = 1 ORDER BY id LIMIT 1').get()
    ?? null;
}

// Resolve a requested location id, defaulting to the primary location when omitted.
export function resolveLocationId(db, requested) {
  if (requested === undefined || requested === null) {
    const primary = primaryLocation(db);
    return primary ? primary.id : null;
  }
  const location = db.prepare('SELECT * FROM locations WHERE id = ?').get(requested);
  if (!location) throw fail(400, 'Unknown location');
  if (!location.active) throw fail(409, 'Location is not active');
  return location.id;
}

export function ensureInventory(db, productId, locationId) {
  let inv = db.prepare('SELECT * FROM inventory WHERE product_id = ? AND location_id = ?').get(productId, locationId);
  if (inv) return inv;
  const product = db.prepare('SELECT stock, reorder_level, reorder_quantity FROM products WHERE id = ?').get(productId);
  if (!product) throw fail(400, 'Unknown product');
  const allocations = db.prepare('SELECT COUNT(*) AS n FROM inventory WHERE product_id = ?').get(productId).n;
  const seed = allocations === 0 ? product.stock : 0;
  db.prepare('INSERT INTO inventory (product_id, location_id, stock, reorder_level, reorder_quantity) VALUES (?,?,?,?,?)')
    .run(productId, locationId, seed, product.reorder_level, product.reorder_quantity);
  return db.prepare('SELECT * FROM inventory WHERE product_id = ? AND location_id = ?').get(productId, locationId);
}

// Stock available at a location. Without a location, the product total is returned. When a
// product has allocations but none for the requested location, that location has none.
export function stockAt(db, productId, locationId) {
  if (locationId != null) {
    const inv = db.prepare('SELECT stock FROM inventory WHERE product_id = ? AND location_id = ?').get(productId, locationId);
    if (inv) return inv.stock;
    const allocations = db.prepare('SELECT COUNT(*) AS n FROM inventory WHERE product_id = ?').get(productId)?.n ?? 0;
    if (allocations > 0) return 0;
  }
  return db.prepare('SELECT stock FROM products WHERE id = ?').get(productId)?.stock ?? 0;
}

// Apply a stock delta to a location allocation and keep the product total in sync.
export function adjustStock(db, productId, locationId, delta) {
  if (locationId == null) {
    db.prepare('UPDATE products SET stock = MAX(0, stock + ?) WHERE id = ?').run(delta, productId);
    return;
  }
  const inv = ensureInventory(db, productId, locationId);
  if (inv.stock + delta < 0) throw fail(409, 'Insufficient stock at location');
  db.prepare('UPDATE inventory SET stock = stock + ? WHERE product_id = ? AND location_id = ?')
    .run(delta, productId, locationId);
  db.prepare('UPDATE products SET stock = MAX(0, stock + ?) WHERE id = ?').run(delta, productId);
}

export function transferStock(db, { productId, fromLocationId, toLocationId, quantity }) {
  if (fromLocationId === toLocationId) throw fail(400, 'from and to locations must differ');
  if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(productId)) throw fail(400, 'Unknown product');
  for (const id of [fromLocationId, toLocationId]) {
    if (!db.prepare('SELECT 1 FROM locations WHERE id = ?').get(id)) throw fail(400, 'Unknown location');
  }
  return transaction(db, () => {
    const from = ensureInventory(db, productId, fromLocationId);
    ensureInventory(db, productId, toLocationId);
    if (from.stock < quantity) throw fail(409, `Only ${from.stock} units available at source location`);
    db.prepare('UPDATE inventory SET stock = stock - ? WHERE product_id = ? AND location_id = ?')
      .run(quantity, productId, fromLocationId);
    db.prepare('UPDATE inventory SET stock = stock + ? WHERE product_id = ? AND location_id = ?')
      .run(quantity, productId, toLocationId);
    return db.prepare('SELECT * FROM inventory WHERE product_id = ? ORDER BY location_id').all(productId);
  });
}

// Effective stock expression that falls back to the product total when nothing is allocated.
const EFFECTIVE_STOCK = `COALESCE(i.stock,
  CASE WHEN (SELECT COUNT(*) FROM inventory i2 WHERE i2.product_id = p.id) = 0 THEN p.stock ELSE 0 END)`;

export function lowStockAt(db, locationId = null) {
  const select = `SELECT p.id, p.sku, p.name, ${EFFECTIVE_STOCK} AS stock,
      COALESCE(i.reorder_level, p.reorder_level) AS reorder_level,
      COALESCE(i.reorder_quantity, p.reorder_quantity) AS reorder_quantity,
      p.cost_cents, p.supplier_id, s.name AS supplier
    FROM products p
    LEFT JOIN inventory i ON i.product_id = p.id AND i.location_id = ?
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE p.active = 1 AND ${EFFECTIVE_STOCK} <= COALESCE(i.reorder_level, p.reorder_level)
    ORDER BY ${EFFECTIVE_STOCK} - COALESCE(i.reorder_level, p.reorder_level), p.name`;
  return db.prepare(select).all(locationId ?? -1);
}

export function registerLocationRoutes(api) {
  const { db, route, all, get, run, requireStaff, reply, bad, notFound, str, int, HttpError } = api;

  const fields = (b) => ({
    name: str(b.name, 'name', { max: 160 }),
    address: str(b.address, 'address', { max: 300, required: false }),
    city: str(b.city, 'city', { max: 120, required: false }),
    postal_code: str(b.postal_code, 'postal_code', { max: 20, required: false }),
    country: str(b.country ?? 'DE', 'country', { max: 2, required: false })?.toUpperCase() ?? 'DE',
    phone: str(b.phone, 'phone', { max: 50, required: false }),
    active: b.active === undefined ? 1 : (b.active ? 1 : 0),
    is_primary: b.is_primary ? 1 : 0,
  });

  route('GET', '/api/locations', (ctx) => {
    const staff = ctx.user && ctx.user.role !== 'customer';
    const wantsAll = ctx.query.get('all') === '1';
    return staff && wantsAll
      ? all('SELECT * FROM locations ORDER BY is_primary DESC, name')
      : all('SELECT * FROM locations WHERE active = 1 ORDER BY is_primary DESC, name');
  });

  route('POST', '/api/locations', (ctx) => {
    requireStaff(ctx);
    const f = fields(ctx.body);
    return transaction(api.db, () => {
      const existing = get('SELECT COUNT(*) AS n FROM locations').n;
      if (existing === 0) f.is_primary = 1;
      if (f.is_primary) run('UPDATE locations SET is_primary = 0');
      const { lastInsertRowid } = run(
        'INSERT INTO locations (name, address, city, postal_code, country, phone, active, is_primary) VALUES (?,?,?,?,?,?,?,?)',
        f.name, f.address, f.city, f.postal_code, f.country, f.phone, f.active, f.is_primary);
      return reply(201, get('SELECT * FROM locations WHERE id = ?', lastInsertRowid));
    });
  });

  route('PUT', '/api/locations/:id', (ctx) => {
    requireStaff(ctx);
    const current = get('SELECT * FROM locations WHERE id = ?', ctx.params.id);
    if (!current) throw notFound();
    const f = fields({ ...current, ...ctx.body });
    return transaction(api.db, () => {
      if (f.is_primary) run('UPDATE locations SET is_primary = 0');
      run('UPDATE locations SET name=?, address=?, city=?, postal_code=?, country=?, phone=?, active=?, is_primary=? WHERE id=?',
        f.name, f.address, f.city, f.postal_code, f.country, f.phone, f.active, f.is_primary, current.id);
      return get('SELECT * FROM locations WHERE id = ?', current.id);
    });
  });

  route('GET', '/api/locations/:id/inventory', (ctx) => {
    requireStaff(ctx);
    if (!get('SELECT 1 FROM locations WHERE id = ?', ctx.params.id)) throw notFound();
    return all(
      `SELECT p.id AS product_id, p.sku, p.name,
              COALESCE(i.stock, CASE WHEN (SELECT COUNT(*) FROM inventory i2 WHERE i2.product_id = p.id) = 0 THEN p.stock ELSE 0 END) AS stock,
              COALESCE(i.reorder_level, p.reorder_level) AS reorder_level,
              COALESCE(i.reorder_quantity, p.reorder_quantity) AS reorder_quantity
       FROM products p LEFT JOIN inventory i ON i.product_id = p.id AND i.location_id = ?
       WHERE p.active = 1 ORDER BY p.name`, ctx.params.id);
  });

  route('PUT', '/api/locations/:id/inventory/:productId', (ctx) => {
    requireStaff(ctx);
    if (!get('SELECT 1 FROM locations WHERE id = ?', ctx.params.id)) throw notFound();
    const productId = ctx.params.productId;
    if (!get('SELECT 1 FROM products WHERE id = ?', productId)) throw bad('Unknown product');
    const stock = int(ctx.body.stock, 'stock');
    return transaction(api.db, () => {
      const inv = ensureInventory(api.db, productId, ctx.params.id);
      const delta = stock - inv.stock;
      run('UPDATE inventory SET stock = ? WHERE product_id = ? AND location_id = ?', stock, productId, ctx.params.id);
      run('UPDATE products SET stock = MAX(0, stock + ?) WHERE id = ?', delta, productId);
      if (ctx.body.reorder_level !== undefined) {
        run('UPDATE inventory SET reorder_level = ? WHERE product_id = ? AND location_id = ?',
          int(ctx.body.reorder_level, 'reorder_level'), productId, ctx.params.id);
      }
      if (ctx.body.reorder_quantity !== undefined) {
        run('UPDATE inventory SET reorder_quantity = ? WHERE product_id = ? AND location_id = ?',
          int(ctx.body.reorder_quantity, 'reorder_quantity', { min: 1 }), productId, ctx.params.id);
      }
      return get('SELECT * FROM inventory WHERE product_id = ? AND location_id = ?', productId, ctx.params.id);
    });
  });

  route('POST', '/api/locations/transfer', (ctx) => {
    requireStaff(ctx);
    return transferStock(api.db, {
      productId: int(ctx.body.product_id, 'product_id', { min: 1 }),
      fromLocationId: int(ctx.body.from_location_id, 'from_location_id', { min: 1 }),
      toLocationId: int(ctx.body.to_location_id, 'to_location_id', { min: 1 }),
      quantity: int(ctx.body.quantity, 'quantity', { min: 1 }),
    });
  });
}
