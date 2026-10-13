import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transaction } from './db.js';
import { hashPassword, verifyPassword, signToken, verifyToken } from './auth.js';
import { createCommunications, registerCommunicationsRoutes } from './communications.js';
import { registerMarketingRoutes, validatePromo, computeDiscount } from './marketing.js';
import { registerAnalyticsRoutes } from './analytics.js';
import { registerLocationRoutes, adjustStock, stockAt, resolveLocationId, lowStockAt } from './locations.js';

const PUBLIC_DIR = resolve(fileURLToPath(new URL('../public', import.meta.url)));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json',
};
const MAX_BODY = 1_000_000;
const ORDER_STATUSES = ['pending', 'paid', 'packed', 'shipped', 'delivered', 'cancelled'];
const DELIVERY_SERVICES = ['dhl', 'dpd', 'hermes'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (m) => new HttpError(400, m);
class Reply {
  constructor(status, data) {
    this.status = status;
    this.data = data;
  }
}
const reply = (status, data) => new Reply(status, data);

const str = (v, name, { max = 200, required = true } = {}) => {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${name} is required`);
    return null;
  }
  if (typeof v !== 'string' || v.length > max) throw bad(`${name} must be a string up to ${max} chars`);
  return v.trim();
};
const int = (v, name, { min = 0, required = true } = {}) => {
  if (v === undefined || v === null) {
    if (required) throw bad(`${name} is required`);
    return null;
  }
  if (!Number.isInteger(v) || v < min) throw bad(`${name} must be an integer >= ${min}`);
  return v;
};

export function createApp(db, { secret = randomBytes(32).toString('hex') } = {}) {
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);

  const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, loyalty_points: u.loyalty_points });
  const tokenFor = (u) => signToken({ sub: u.id, role: u.role }, secret);

  const requireUser = (ctx) => {
    if (!ctx.user) throw new HttpError(401, 'Authentication required');
    return ctx.user;
  };
  const requireStaff = (ctx) => {
    const u = requireUser(ctx);
    if (u.role !== 'staff' && u.role !== 'admin') throw new HttpError(403, 'Staff access required');
    return u;
  };
  const requireAdmin = (ctx) => {
    const u = requireUser(ctx);
    if (u.role !== 'admin') throw new HttpError(403, 'Admin access required');
    return u;
  };

  const notFound = () => new HttpError(404, 'Not found');

  const productFields = (b, partial = false) => {
    const req = !partial;
    const out = {};
    const set = (k, v) => { if (v !== undefined && !(partial && b[k] === undefined)) out[k] = v; };
    if (req || b.sku !== undefined) set('sku', str(b.sku, 'sku', { max: 64 }));
    if (req || b.name !== undefined) set('name', str(b.name, 'name'));
    if (b.description !== undefined) set('description', str(b.description, 'description', { max: 2000, required: false }) ?? '');
    if (b.category_id !== undefined) set('category_id', b.category_id === null ? null : int(b.category_id, 'category_id', { min: 1 }));
    if (b.supplier_id !== undefined) set('supplier_id', b.supplier_id === null ? null : int(b.supplier_id, 'supplier_id', { min: 1 }));
    if (req || b.price_cents !== undefined) set('price_cents', int(b.price_cents, 'price_cents'));
    if (b.cost_cents !== undefined) set('cost_cents', int(b.cost_cents, 'cost_cents'));
    if (b.stock !== undefined) set('stock', int(b.stock, 'stock'));
    if (b.reorder_level !== undefined) set('reorder_level', int(b.reorder_level, 'reorder_level'));
    if (b.reorder_quantity !== undefined) set('reorder_quantity', int(b.reorder_quantity, 'reorder_quantity', { min: 1 }));
    if (b.expiry_date !== undefined) set('expiry_date', str(b.expiry_date, 'expiry_date', { max: 10, required: false }));
    if (b.active !== undefined) set('active', b.active ? 1 : 0);
    return out;
  };

  const orderWithItems = (o) => {
    const order = { ...o };
    delete order.payment_method;
    delete order.payment_status;
    delete order.payment_reference;
    return {
      ...order,
      items: all(
      `SELECT oi.product_id, p.name, oi.quantity, oi.unit_price_cents
       FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?`, o.id),
    };
  };

  const routes = [];
  const route = (method, path, handler) => {
    const keys = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '(\\d+)')) + '$');
    routes.push({ method, re, keys, handler });
  };

  // Mobile-ready public endpoints and Phase 3 feature modules.
  route('GET', '/api/health', () => ({ status: 'ok', time: new Date().toISOString(), version: '3.0.0' }));
  route('GET', '/api/config', () => ({
    app: 'Afro Mart',
    currency: 'EUR',
    country: 'DE',
    delivery_services: DELIVERY_SERVICES,
    order_statuses: ORDER_STATUSES,
    loyalty_points_per_euro: 1,
  }));

  const comms = createCommunications(db);
  const api = { db, route, all, get, run, transaction, reply, bad, notFound, HttpError, str, int, requireUser, requireStaff, requireAdmin, publicUser, comms };
  registerAnalyticsRoutes(api);
  registerMarketingRoutes(api);
  registerCommunicationsRoutes(api);
  registerLocationRoutes(api);

  // ---- Auth ----
  route('POST', '/api/auth/register', (ctx) => {
    const email = str(ctx.body.email, 'email', { max: 254 }).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('email is invalid');
    const name = str(ctx.body.name, 'name');
    const password = str(ctx.body.password, 'password', { max: 200 });
    if (password.length < 8) throw bad('password must be at least 8 characters');
    if (get('SELECT 1 FROM users WHERE email = ?', email)) throw new HttpError(409, 'Email already registered');
    const { lastInsertRowid } = run('INSERT INTO users (email, name, password_hash) VALUES (?,?,?)', email, name, hashPassword(password));
    const user = get('SELECT * FROM users WHERE id = ?', lastInsertRowid);
    comms.emit('customer.registered', { email: user.email, name: user.name, user_id: user.id });
    return reply(201, { token: tokenFor(user), user: publicUser(user) });
  });

  route('POST', '/api/auth/login', (ctx) => {
    const email = str(ctx.body.email, 'email', { max: 254 }).toLowerCase();
    const password = str(ctx.body.password, 'password', { max: 200 });
    const user = get('SELECT * FROM users WHERE email = ?', email);
    if (!user || !verifyPassword(password, user.password_hash)) throw new HttpError(401, 'Invalid credentials');
    return { token: tokenFor(user), user: publicUser(user) };
  });

  route('GET', '/api/me', (ctx) => publicUser(requireUser(ctx)));

  route('POST', '/api/staff', (ctx) => {
    requireAdmin(ctx);
    const email = str(ctx.body.email, 'email', { max: 254 }).toLowerCase();
    const name = str(ctx.body.name, 'name');
    const password = str(ctx.body.password, 'password', { max: 200 });
    if (password.length < 8) throw bad('password must be at least 8 characters');
    const role = ctx.body.role === 'admin' ? 'admin' : 'staff';
    if (get('SELECT 1 FROM users WHERE email = ?', email)) throw new HttpError(409, 'Email already registered');
    const { lastInsertRowid } = run('INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?,?)', email, name, hashPassword(password), role);
    return reply(201, publicUser(get('SELECT * FROM users WHERE id = ?', lastInsertRowid)));
  });

  // ---- Categories ----
  route('GET', '/api/categories', () => all('SELECT * FROM categories ORDER BY name'));
  route('POST', '/api/categories', (ctx) => {
    requireStaff(ctx);
    const name = str(ctx.body.name, 'name', { max: 100 });
    if (get('SELECT 1 FROM categories WHERE name = ?', name)) throw new HttpError(409, 'Category exists');
    const { lastInsertRowid } = run('INSERT INTO categories (name) VALUES (?)', name);
    return reply(201, get('SELECT * FROM categories WHERE id = ?', lastInsertRowid));
  });

  // ---- Products ----
  route('GET', '/api/products', (ctx) => {
    const staff = ctx.user && ctx.user.role !== 'customer';
    const where = [];
    const params = [];
    if (!staff) where.push('p.active = 1');
    const cat = ctx.query.get('category');
    if (cat) { where.push('p.category_id = ?'); params.push(Number(cat) || 0); }
    const q = ctx.query.get('q');
    if (q) { where.push('(p.name LIKE ? OR p.description LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
    const limit = ctx.query.get('limit') ? Math.min(Math.max(Number(ctx.query.get('limit')) || 50, 1), 200) : null;
    const offset = ctx.query.get('offset') ? Math.max(Number(ctx.query.get('offset')) || 0, 0) : 0;
    return all(
      `SELECT p.id, p.sku, p.name, p.description, p.category_id, c.name AS category, p.price_cents, p.stock,
              p.expiry_date, p.active${staff ? ', p.cost_cents, p.reorder_level, p.reorder_quantity, p.supplier_id' : ''}
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.name${limit ? ' LIMIT ? OFFSET ?' : ''}`,
      ...params, ...(limit ? [limit, offset] : []));
  });

  route('GET', '/api/products/:id', (ctx) => {
    const p = get(
      `SELECT p.id, p.sku, p.name, p.description, p.category_id, c.name AS category, p.price_cents, p.stock, p.expiry_date, p.active
       FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`, ctx.params.id);
    if (!p || (!p.active && !(ctx.user && ctx.user.role !== 'customer'))) throw notFound();
    return p;
  });

  route('POST', '/api/products', (ctx) => {
    requireStaff(ctx);
    const f = productFields(ctx.body);
    if (get('SELECT 1 FROM products WHERE sku = ?', f.sku)) throw new HttpError(409, 'SKU exists');
    const cols = Object.keys(f);
    try {
      const { lastInsertRowid } = run(`INSERT INTO products (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map((c) => f[c]));
      return reply(201, get('SELECT * FROM products WHERE id = ?', lastInsertRowid));
    } catch (e) {
      if (/FOREIGN KEY/.test(e.message)) throw bad('Unknown category or supplier');
      throw e;
    }
  });

  route('PUT', '/api/products/:id', (ctx) => {
    requireStaff(ctx);
    if (!get('SELECT 1 FROM products WHERE id = ?', ctx.params.id)) throw notFound();
    const f = productFields(ctx.body, true);
    const cols = Object.keys(f);
    if (!cols.length) throw bad('No fields to update');
    try {
      run(`UPDATE products SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...cols.map((c) => f[c]), ctx.params.id);
    } catch (e) {
      if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'SKU exists');
      if (/FOREIGN KEY/.test(e.message)) throw bad('Unknown category or supplier');
      throw e;
    }
    return get('SELECT * FROM products WHERE id = ?', ctx.params.id);
  });

  // ---- Orders ----
  route('POST', '/api/orders', (ctx) => {
    const user = requireUser(ctx);
    const address = str(ctx.body.shipping_address, 'shipping_address', { max: 500 });
    const deliveryService = str(ctx.body.delivery_service ?? 'dhl', 'delivery_service', { max: 16 }).toLowerCase();
    if (!DELIVERY_SERVICES.includes(deliveryService)) throw bad(`delivery_service must be one of ${DELIVERY_SERVICES.join(', ')}`);
    const country = str(ctx.body.shipping_country ?? 'DE', 'shipping_country', { max: 2 }).toUpperCase();
    if (country !== 'DE') throw bad('Courier services are currently available within Germany only');
    const locationId = resolveLocationId(db, ctx.body.location_id);
    const promoCode = ctx.body.promo_code ? String(ctx.body.promo_code).toUpperCase() : null;
    const items = ctx.body.items;
    if (!Array.isArray(items) || !items.length || items.length > 100) throw bad('items must be a non-empty array');
    const wanted = new Map();
    for (const it of items) {
      const pid = int(it?.product_id, 'product_id', { min: 1 });
      const qty = int(it?.quantity, 'quantity', { min: 1 });
      wanted.set(pid, (wanted.get(pid) ?? 0) + qty);
    }
    const order = transaction(db, () => {
      let total = 0;
      const lines = [];
      for (const [pid, qty] of wanted) {
        const p = get('SELECT * FROM products WHERE id = ? AND active = 1', pid);
        if (!p) throw bad(`Product ${pid} not available`);
        if (stockAt(db, p.id, locationId) < qty) throw new HttpError(409, `Insufficient stock for ${p.name}`);
        total += p.price_cents * qty;
        lines.push({ p, qty });
      }
      const promo = promoCode ? validatePromo(db, promoCode, total) : null;
      const discount = promo ? computeDiscount(promo, total) : 0;
      const payable = total - discount;
      if (promo) run('UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?', promo.id);
      const points = Math.floor(payable / 100);
      const { lastInsertRowid: oid } = run(
        'INSERT INTO orders (user_id, total_cents, discount_cents, promo_code, location_id, points_earned, shipping_address, delivery_service, shipping_country) VALUES (?,?,?,?,?,?,?,?,?)',
        user.id, payable, discount, promoCode, locationId, points, address, deliveryService, country);
      for (const { p, qty } of lines) {
        run('INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents) VALUES (?,?,?,?)', oid, p.id, qty, p.price_cents);
        adjustStock(db, p.id, locationId, -qty);
      }
      run('UPDATE users SET loyalty_points = loyalty_points + ? WHERE id = ?', points, user.id);
      return get('SELECT * FROM orders WHERE id = ?', oid);
    });

    comms.emit('order.placed', {
      email: user.email, name: user.name, order_id: order.id,
      total_cents: order.total_cents, location_id: order.location_id,
    });
    const lowSelling = all(
      'SELECT id, name, stock, reorder_level FROM products WHERE id IN (SELECT product_id FROM order_items WHERE order_id = ?) AND stock <= reorder_level',
      order.id);
    if (lowSelling.length) {
      const adminEmail = get("SELECT email FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")?.email;
      if (adminEmail) {
        comms.emit('inventory.low_stock', {
          email: adminEmail, order_id: order.id,
          items: lowSelling.map((p) => `${p.name} (${p.stock} left)`).join(', '),
        });
      }
    }
    return reply(201, orderWithItems(order));
  });

  route('GET', '/api/orders', (ctx) => {
    const user = requireUser(ctx);
    const rows = user.role === 'customer'
      ? all('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC', user.id)
      : all(`SELECT * FROM orders ORDER BY id DESC
              LIMIT ${Math.min(Math.max(Number(ctx.query.get('limit')) || 500, 1), 2000)}
              OFFSET ${Math.max(Number(ctx.query.get('offset')) || 0, 0)}`);
    return rows.map(orderWithItems);
  });

  route('GET', '/api/orders/:id', (ctx) => {
    const user = requireUser(ctx);
    const o = get('SELECT * FROM orders WHERE id = ?', ctx.params.id);
    if (!o || (user.role === 'customer' && o.user_id !== user.id)) throw notFound();
    return orderWithItems(o);
  });

  route('PATCH', '/api/orders/:id/status', (ctx) => {
    requireStaff(ctx);
    const status = ctx.body.status;
    if (!ORDER_STATUSES.includes(status)) throw bad(`status must be one of ${ORDER_STATUSES.join(', ')}`);
    const id = ctx.params.id;
    const order = transaction(db, () => {
      const o = get('SELECT * FROM orders WHERE id = ?', id);
      if (!o) throw notFound();
      if (o.status === 'cancelled') throw new HttpError(409, 'Order is already cancelled');
      if (status === 'cancelled') {
        for (const it of all('SELECT * FROM order_items WHERE order_id = ?', id)) {
          adjustStock(db, it.product_id, o.location_id, +it.quantity);
        }
        run('UPDATE users SET loyalty_points = MAX(0, loyalty_points - ?) WHERE id = ?', o.points_earned, o.user_id);
      }
      run('UPDATE orders SET status = ? WHERE id = ?', status, id);
      return orderWithItems(get('SELECT * FROM orders WHERE id = ?', id));
    });
    const customer = get('SELECT email, name FROM users WHERE id = ?', order.user_id);
    if (customer) {
      comms.emit('order.status_changed', {
        email: customer.email, name: customer.name,
        order_id: order.id, status: order.status, total_cents: order.total_cents,
      });
    }
    return order;
  });

  // ---- Suppliers ----
  const supplierFields = (b) => ({
    name: str(b.name, 'name'),
    contact_name: str(b.contact_name, 'contact_name', { required: false }),
    email: str(b.email, 'email', { max: 254, required: false }),
    phone: str(b.phone, 'phone', { max: 50, required: false }),
    country: str(b.country, 'country', { max: 100, required: false }),
    notes: str(b.notes, 'notes', { max: 2000, required: false }),
  });
  route('GET', '/api/suppliers', (ctx) => { requireStaff(ctx); return all('SELECT * FROM suppliers ORDER BY name'); });
  route('POST', '/api/suppliers', (ctx) => {
    requireStaff(ctx);
    const f = supplierFields(ctx.body);
    const { lastInsertRowid } = run('INSERT INTO suppliers (name, contact_name, email, phone, country, notes) VALUES (?,?,?,?,?,?)',
      f.name, f.contact_name, f.email, f.phone, f.country, f.notes);
    return reply(201, get('SELECT * FROM suppliers WHERE id = ?', lastInsertRowid));
  });
  route('PUT', '/api/suppliers/:id', (ctx) => {
    requireStaff(ctx);
    if (!get('SELECT 1 FROM suppliers WHERE id = ?', ctx.params.id)) throw notFound();
    const f = supplierFields(ctx.body);
    run('UPDATE suppliers SET name=?, contact_name=?, email=?, phone=?, country=?, notes=? WHERE id=?',
      f.name, f.contact_name, f.email, f.phone, f.country, f.notes, ctx.params.id);
    return get('SELECT * FROM suppliers WHERE id = ?', ctx.params.id);
  });

  // ---- Inventory & reorders ----
  const lowStock = () => all(
    `SELECT p.id, p.sku, p.name, p.stock, p.reorder_level, p.reorder_quantity, p.cost_cents, p.supplier_id, s.name AS supplier
     FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.active = 1 AND p.stock <= p.reorder_level ORDER BY p.stock - p.reorder_level, p.name`);

  route('GET', '/api/inventory/low-stock', (ctx) => {
    requireStaff(ctx);
    const locationId = ctx.query.get('location_id') ? Number(ctx.query.get('location_id')) : null;
    return locationId ? lowStockAt(db, locationId) : lowStock();
  });

  route('POST', '/api/inventory/reorder', (ctx) => {
    requireStaff(ctx);
    const created = transaction(db, () => {
      const bySupplier = new Map();
      for (const p of lowStock()) {
        if (!p.supplier_id) continue;
        if (!bySupplier.has(p.supplier_id)) bySupplier.set(p.supplier_id, []);
        bySupplier.get(p.supplier_id).push(p);
      }
      const ids = [];
      for (const [sid, prods] of bySupplier) {
        const pending = new Set(all(
          `SELECT poi.product_id FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.purchase_order_id
           WHERE po.status = 'ordered'`).map((r) => r.product_id));
        const todo = prods.filter((p) => !pending.has(p.id));
        if (!todo.length) continue;
        const { lastInsertRowid: poid } = run('INSERT INTO purchase_orders (supplier_id) VALUES (?)', sid);
        for (const p of todo) {
          run('INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity, unit_cost_cents) VALUES (?,?,?,?)',
            poid, p.id, p.reorder_quantity, p.cost_cents);
        }
        ids.push(poid);
      }
      return ids;
    });
    return reply(201, { purchase_order_ids: created });
  });

  const poWithItems = (po) => ({
    ...po,
    items: all(
      `SELECT poi.product_id, p.name, poi.quantity, poi.unit_cost_cents
       FROM purchase_order_items poi JOIN products p ON p.id = poi.product_id WHERE poi.purchase_order_id = ?`, po.id),
  });

  route('GET', '/api/purchase-orders', (ctx) => {
    requireStaff(ctx);
    return all('SELECT * FROM purchase_orders ORDER BY id DESC').map(poWithItems);
  });

  route('POST', '/api/purchase-orders', (ctx) => {
    requireStaff(ctx);
    const sid = int(ctx.body.supplier_id, 'supplier_id', { min: 1 });
    if (!get('SELECT 1 FROM suppliers WHERE id = ?', sid)) throw bad('Unknown supplier');
    const locationId = resolveLocationId(db, ctx.body.location_id);
    const items = ctx.body.items;
    if (!Array.isArray(items) || !items.length || items.length > 200) throw bad('items must be a non-empty array');
    const po = transaction(db, () => {
      const { lastInsertRowid: poid } = run('INSERT INTO purchase_orders (supplier_id, location_id) VALUES (?,?)', sid, locationId);
      for (const it of items) {
        const pid = int(it?.product_id, 'product_id', { min: 1 });
        const p = get('SELECT cost_cents FROM products WHERE id = ?', pid);
        if (!p) throw bad(`Unknown product ${pid}`);
        const cost = it.unit_cost_cents === undefined ? p.cost_cents : int(it.unit_cost_cents, 'unit_cost_cents');
        run('INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity, unit_cost_cents) VALUES (?,?,?,?)',
          poid, pid, int(it.quantity, 'quantity', { min: 1 }), cost);
      }
      return get('SELECT * FROM purchase_orders WHERE id = ?', poid);
    });
    return reply(201, poWithItems(po));
  });

  route('POST', '/api/purchase-orders/:id/receive', (ctx) => {
    requireStaff(ctx);
    return transaction(db, () => {
      const po = get('SELECT * FROM purchase_orders WHERE id = ?', ctx.params.id);
      if (!po) throw notFound();
      if (po.status !== 'ordered') throw new HttpError(409, `Purchase order is already ${po.status}`);
      for (const it of all('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?', po.id)) {
        adjustStock(db, it.product_id, po.location_id, +it.quantity);
      }
      run("UPDATE purchase_orders SET status = 'received', received_at = CURRENT_TIMESTAMP WHERE id = ?", po.id);
      return poWithItems(get('SELECT * FROM purchase_orders WHERE id = ?', po.id));
    });
  });

  // ---- Reports ----
  route('GET', '/api/reports/summary', (ctx) => {
    requireStaff(ctx);
    const sales = get(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(total_cents),0) AS revenue_cents
       FROM orders WHERE status != 'cancelled'`);
    const cogs = get(
      `SELECT COALESCE(SUM(oi.quantity * p.cost_cents),0) AS cents
       FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
       WHERE o.status != 'cancelled'`).cents;
    return {
      orders: sales.orders,
      revenue_cents: sales.revenue_cents,
      estimated_cost_cents: cogs,
      estimated_profit_cents: sales.revenue_cents - cogs,
      customers: get("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'").n,
      low_stock_count: lowStock().length,
      inventory_value_cents: get('SELECT COALESCE(SUM(stock * cost_cents),0) AS v FROM products').v,
      top_products: all(
        `SELECT p.id, p.name, SUM(oi.quantity) AS units_sold
         FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
         WHERE o.status != 'cancelled' GROUP BY p.id ORDER BY units_sold DESC LIMIT 5`),
    };
  });

  // ---- HTTP plumbing ----
  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) throw new HttpError(413, 'Request body too large');
      chunks.push(c);
    }
    if (!size) return {};
    try {
      const v = JSON.parse(Buffer.concat(chunks).toString());
      if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error();
      return v;
    } catch {
      throw bad('Invalid JSON body');
    }
  }

  const cors = () => {
    const origin = process.env.CORS_ORIGIN || '*';
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    };
  };

  const send = (res, status, data, headers = {}) => {
    const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
    res.writeHead(status, {
      'Content-Type': typeof data === 'string' || Buffer.isBuffer(data)
        ? (headers['Content-Type'] ?? 'text/plain; charset=utf-8')
        : 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'X-API-Version': '1',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' https://images.unsplash.com; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com",
      'Referrer-Policy': 'same-origin',
      ...cors(),
      ...headers,
    });
    res.end(body);
  };

  async function serveStatic(pathname, res) {
    const rel = pathname === '/' ? 'index.html' : pathname === '/admin' ? 'admin.html' : pathname.slice(1);
    const file = normalize(join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + sep) || !MIME[extname(file)]) throw notFound();
    try {
      send(res, 200, await readFile(file), { 'Content-Type': MIME[extname(file)] });
    } catch {
      throw notFound();
    }
  }

  return async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'OPTIONS') {
        send(res, 204, '', cors());
        return;
      }
      let pathname = url.pathname;
      if (pathname === '/api/v1' || pathname.startsWith('/api/v1/')) {
        pathname = pathname.replace(/^\/api\/v1/, '/api');
      }
      if (!pathname.startsWith('/api/')) {
        if (req.method !== 'GET') throw notFound();
        return await serveStatic(url.pathname, res);
      }
      let matched = null;
      let pathMatched = false;
      for (const r of routes) {
        const m = r.re.exec(pathname);
        if (!m) continue;
        pathMatched = true;
        if (r.method === req.method) {
          matched = { r, params: Object.fromEntries(r.keys.map((k, i) => [k, Number(m[i + 1])])) };
          break;
        }
      }
      if (!matched) throw pathMatched ? new HttpError(405, 'Method not allowed') : notFound();

      const ctx = { params: matched.params, query: url.searchParams, body: {}, user: null };
      const auth = req.headers.authorization;
      if (auth?.startsWith('Bearer ')) {
        const payload = verifyToken(auth.slice(7), secret);
        if (payload) ctx.user = get('SELECT * FROM users WHERE id = ?', payload.sub) ?? null;
      }
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) ctx.body = await readBody(req);

      const out = await matched.r.handler(ctx);
      if (out instanceof Reply) send(res, out.status, out.data);
      else send(res, 200, out);
    } catch (e) {
      if (e instanceof HttpError || typeof e?.status === 'number') return send(res, e.status, { error: e.message });
      console.error(e);
      send(res, 500, { error: 'Internal server error' });
    }
  };
}
