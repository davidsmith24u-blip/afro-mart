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
import { registerBundleRoutes, expandBundle } from './bundles.js';
import { registerDeliveryRoutes, deliveryFeeFor } from './delivery.js';
import { registerSubscriptionRoutes } from './subscriptions.js';
import { registerRecipeRoutes } from './recipes.js';
import { applyReferral, referralCode, tierFor, lifetimeSpendCents, pointsFor } from './loyalty.js';
import { registerDiscoveryRoutes, expandQuery, attachTags, ORIGIN_LABELS, CUISINE_LABELS, DIET_LABELS } from './discovery.js';
import { IN_SCOPE_SQL, CATEGORY_IN_SCOPE_SQL } from './launch-scope.js';
import { BASE_CURRENCY, currencyList } from './currencies.js';
import { registerCateringRoutes } from './catering.js';
import { registerReviewRoutes } from './reviews.js';
import { registerImageRoutes } from './images.js';
import { registerRetentionRoutes } from './retention.js';
import { registerAssistantRoutes } from './assistant.js';
import { aiStatus } from './ai.js';
import { applyProductMeta } from './catalog-meta.js';
import {
  productPath, productIdFromSlug, renderProductPage, renderSitemap, renderProductFeed,
  newNonce, cspWithNonce,
} from './seo.js';

const PUBLIC_DIR = resolve(fileURLToPath(new URL('../public', import.meta.url)));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};
const MAX_BODY = 4_000_000;
const ORDER_STATUSES = ['pending', 'paid', 'packed', 'shipped', 'delivered', 'cancelled'];
const DELIVERY_SERVICES = ['dhl', 'dpd', 'hermes'];
const FULFILLMENT_OPTIONS = ['delivery', 'pickup'];
const PAYMENT_METHODS = ['card', 'paypal', 'klarna', 'manual'];
const PAYMENT_STATUSES = ['unpaid', 'paid', 'failed', 'refunded'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (m) => new HttpError(400, m);
class Reply {
  constructor(status, data, headers = {}) {
    this.status = status;
    this.data = data;
    this.headers = headers;
  }
}
const reply = (status, data, headers) => new Reply(status, data, headers);

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

  const publicUser = (u) => {
    const tier = tierFor(lifetimeSpendCents(db, u.id));
    return {
      id: u.id, email: u.email, name: u.name, role: u.role, loyalty_points: u.loyalty_points,
      account_type: u.account_type ?? 'retail',
      referral_code: referralCode(db, u.id),
      tier: tier.key, tier_label: tier.label, points_multiplier: tier.multiplier,
    };
  };
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
    if (b.image_url !== undefined) set('image_url', b.image_url === null ? null : str(b.image_url, 'image_url', { max: 500, required: false }));
    if (b.active !== undefined) set('active', b.active ? 1 : 0);
    return out;
  };

  const orderWithItems = (o) => ({
    ...o,
    items: all(
      `SELECT oi.product_id, p.name, oi.quantity, oi.unit_price_cents
       FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?`, o.id),
  });

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
    base_currency: BASE_CURRENCY,
    currencies: currencyList(),
    country: 'DE',
    delivery_services: DELIVERY_SERVICES,
    order_statuses: ORDER_STATUSES,
    fulfillment_options: FULFILLMENT_OPTIONS,
    payment_methods: PAYMENT_METHODS,
    loyalty_points_per_euro: 1,
    delivery_fee_default_cents: Math.max(0, Number(process.env.DELIVERY_FEE_DEFAULT_CENTS) || 0),
    has_payment_gateway: Boolean(process.env.PAYMENTS_WEBHOOK_SECRET),
    whatsapp_number: process.env.WHATSAPP_NUMBER || null,
    support_email: process.env.SUPPORT_EMAIL || null,
    ai: aiStatus(),
    facets: {
      origins: ORIGIN_LABELS,
      cuisines: CUISINE_LABELS,
      diets: DIET_LABELS,
    },
  }));

  const comms = createCommunications(db);
  // Accountability trail for privileged mutations; never let it break a request.
  const auditLog = (ctx, action, entity = null, entityId = null, detail = null) => {
    try {
      run(
        'INSERT INTO audit_log (user_id, actor_email, action, entity, entity_id, detail) VALUES (?,?,?,?,?,?)',
        ctx.user?.id ?? null, ctx.user?.email ?? null, action, entity, entityId, detail);
    } catch { /* auditing is best-effort */ }
  };
  const api = { db, route, all, get, run, transaction, reply, bad, notFound, HttpError, str, int, requireUser, requireStaff, requireAdmin, publicUser, comms, audit: auditLog };
  registerAnalyticsRoutes(api);
  registerMarketingRoutes(api);
  registerCommunicationsRoutes(api);
  registerLocationRoutes(api);
  registerBundleRoutes(api);
  registerDeliveryRoutes(api);
  registerSubscriptionRoutes(api);
  registerRecipeRoutes(api);
  registerDiscoveryRoutes(api);
  registerCateringRoutes(api);
  registerReviewRoutes(api);
  registerImageRoutes(api);
  registerRetentionRoutes(api);
  registerAssistantRoutes(api);

  // ---- Auth ----
  route('POST', '/api/auth/register', (ctx) => {
    const email = str(ctx.body.email, 'email', { max: 254 }).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('email is invalid');
    const name = str(ctx.body.name, 'name');
    const password = str(ctx.body.password, 'password', { max: 200 });
    if (password.length < 8) throw bad('password must be at least 8 characters');
    if (get('SELECT 1 FROM users WHERE email = ?', email)) throw new HttpError(409, 'Email already registered');
    const inserted = transaction(db, () => {
      const { lastInsertRowid } = run('INSERT INTO users (email, name, password_hash) VALUES (?,?,?)', email, name, hashPassword(password));
      applyReferral(db, ctx.body.ref, lastInsertRowid);
      return lastInsertRowid;
    });
    const user = get('SELECT * FROM users WHERE id = ?', inserted);
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

  route('GET', '/api/me/referral', (ctx) => {
    const user = requireUser(ctx);
    const code = referralCode(db, user.id);
    return {
      code,
      points_per_friend: 200,
      link: `/?ref=${code}`,
      referred_by: user.referred_by ?? null,
      tier: tierFor(lifetimeSpendCents(db, user.id)).key,
    };
  });

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
  route('GET', '/api/categories', (ctx) => {
    const staff = ctx.user && ctx.user.role !== 'customer';
    return staff
      ? all('SELECT * FROM categories ORDER BY name')
      : all(`SELECT * FROM categories c WHERE ${CATEGORY_IN_SCOPE_SQL} ORDER BY c.name`);
  });
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
    const wholesale = ctx.user && ctx.user.account_type === 'restaurant';
    // The public shop shows the current launch scope (see launch-scope.js).
    // `?catalog=all` returns the full active catalogue so the storefront can
    // price and render items reached through recipes and the kitchen assistant.
    const fullCatalog = ctx.query.get('catalog') === 'all';
    const where = [];
    const params = [];
    if (!staff) {
      where.push('p.active = 1');
      if (!fullCatalog) where.push(IN_SCOPE_SQL);
    }
    const cat = ctx.query.get('category');
    if (cat) { where.push('p.category_id = ?'); params.push(Number(cat) || 0); }

    const multi = (name) => ctx.query.getAll(name).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);

    const q = ctx.query.get('q');
    if (q) {
      const facets = expandQuery(q);
      const or = [];
      for (const term of facets.terms) {
        or.push('(p.name LIKE ? OR p.description LIKE ? OR p.sku LIKE ?)');
        params.push(`%${term}%`, `%${term}%`, `%${term}%`);
      }
      if (facets.origin) {
        or.push("EXISTS (SELECT 1 FROM product_tags t WHERE t.product_id = p.id AND t.kind = 'origin' AND t.value = ?)");
        params.push(facets.origin);
      }
      for (const cuisine of facets.cuisines) {
        or.push("EXISTS (SELECT 1 FROM product_tags t WHERE t.product_id = p.id AND t.kind = 'cuisine' AND t.value = ?)");
        params.push(cuisine);
      }
      where.push('(' + or.join(' OR ') + ')');
    }

    const cuisines = multi('cuisine');
    if (cuisines.length) {
      where.push(`EXISTS (SELECT 1 FROM product_tags t WHERE t.product_id = p.id AND t.kind = 'cuisine' AND t.value IN (${cuisines.map(() => '?').join(',')}))`);
      params.push(...cuisines);
    }
    const origins = multi('origin');
    if (origins.length) {
      where.push(`EXISTS (SELECT 1 FROM product_tags t WHERE t.product_id = p.id AND t.kind = 'origin' AND t.value IN (${origins.map(() => '?').join(',')}))`);
      params.push(...origins);
    }
    for (const diet of multi('diet')) {
      where.push("EXISTS (SELECT 1 FROM product_tags t WHERE t.product_id = p.id AND t.kind = 'diet' AND t.value = ?)");
      params.push(diet);
    }
    if (ctx.query.get('max_spice')) {
      where.push('p.spice_level <= ?');
      params.push(Math.min(Math.max(Number(ctx.query.get('max_spice')) || 0, 0), 5));
    }
    if (ctx.query.get('min_spice')) {
      where.push('p.spice_level >= ?');
      params.push(Math.min(Math.max(Number(ctx.query.get('min_spice')) || 0, 0), 5));
    }

    const sortMap = { price_asc: 'p.price_cents ASC, p.name', price_desc: 'p.price_cents DESC, p.name', spice: 'p.spice_level DESC, p.name', name: 'p.name' };
    const orderBy = sortMap[ctx.query.get('sort')] || 'p.name';

    const limit = ctx.query.get('limit') ? Math.min(Math.max(Number(ctx.query.get('limit')) || 50, 1), 200) : null;
    const offset = ctx.query.get('offset') ? Math.max(Number(ctx.query.get('offset')) || 0, 0) : 0;
    const rows = all(
      `SELECT p.id, p.sku, p.name, p.description, p.category_id, c.name AS category, p.price_cents, p.stock,
              p.expiry_date, p.active, p.spice_level, p.image_url${wholesale ? ', p.wholesale_price_cents' : ''}${staff ? ', p.cost_cents, p.reorder_level, p.reorder_quantity, p.supplier_id' : ''},
              (SELECT ROUND(AVG(r.rating), 1) FROM product_reviews r WHERE r.product_id = p.id AND r.status = 'approved') AS rating_average,
              (SELECT COUNT(*) FROM product_reviews r WHERE r.product_id = p.id AND r.status = 'approved') AS rating_count
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${orderBy}${limit ? ' LIMIT ? OFFSET ?' : ''}`,
      ...params, ...(limit ? [limit, offset] : []));
    attachTags(db, rows);
    for (const row of rows) {
      // The crawlable product page (see src/seo.js) — the storefront links to it.
      row.path = productPath(row);
      if (wholesale) {
        row.is_wholesale = true;
        row.effective_price_cents = row.wholesale_price_cents ?? row.price_cents;
      }
    }
    return rows;
  });

  route('GET', '/api/products/:id', (ctx) => {
    const staff = ctx.user && ctx.user.role !== 'customer';
    const wholesale = ctx.user && ctx.user.account_type === 'restaurant';
    const p = get(
      `SELECT p.id, p.sku, p.name, p.description, p.category_id, c.name AS category, p.price_cents, p.stock,
              p.expiry_date, p.active, p.spice_level, p.image_url${wholesale ? ', p.wholesale_price_cents' : ''},
              (SELECT ROUND(AVG(r.rating), 1) FROM product_reviews r WHERE r.product_id = p.id AND r.status = 'approved') AS rating_average,
              (SELECT COUNT(*) FROM product_reviews r WHERE r.product_id = p.id AND r.status = 'approved') AS rating_count
       FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`, ctx.params.id);
    if (!p || (!p.active && !staff)) throw notFound();
    const [row] = attachTags(db, [p]);
    row.path = productPath(row);
    if (wholesale) {
      row.is_wholesale = true;
      row.effective_price_cents = row.wholesale_price_cents ?? row.price_cents;
    }
    return row;
  });

  route('POST', '/api/products', (ctx) => {
    requireStaff(ctx);
    const f = productFields(ctx.body);
    if (get('SELECT 1 FROM products WHERE sku = ?', f.sku)) throw new HttpError(409, 'SKU exists');
    const cols = Object.keys(f);
    try {
      const { lastInsertRowid } = run(`INSERT INTO products (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map((c) => f[c]));
      const created = get('SELECT * FROM products WHERE id = ?', lastInsertRowid);
      try { const row = get(`SELECT p.*, c.name AS category FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`, created.id); applyProductMeta(db, row, { preserve: true }); } catch {}
      auditLog(ctx, 'product.create', 'product', lastInsertRowid, f.sku);
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
      try { const row = get(`SELECT p.*, c.name AS category FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`, ctx.params.id); applyProductMeta(db, row, { preserve: true }); } catch {}
      auditLog(ctx, 'product.update', 'product', ctx.params.id, cols.join(','));
    } catch (e) {
      if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'SKU exists');
      if (/FOREIGN KEY/.test(e.message)) throw bad('Unknown category or supplier');
      throw e;
    }
    return get('SELECT * FROM products WHERE id = ?', ctx.params.id);
  });

  // ---- Orders ----
  route('POST', '/api/orders', (ctx) => {
    // Guests can check out with just an email; an account is optional. Signed-in
    // shoppers keep their order history and earn loyalty points.
    const user = ctx.user || null;
    let guestEmail = null;
    let guestName = null;
    if (!user) {
      guestEmail = str(ctx.body.guest_email ?? ctx.body.email, 'guest_email', { max: 254 }).toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(guestEmail)) throw bad('guest_email is invalid');
      guestName = str(ctx.body.guest_name, 'guest_name', { max: 120, required: false }) ?? null;
    }
    const fulfillment = ctx.body.fulfillment === 'pickup' ? 'pickup' : 'delivery';
    const address = str(ctx.body.shipping_address ?? '', 'shipping_address', { max: 500, required: fulfillment === 'delivery' }) ?? '';
    const deliveryService = str(ctx.body.delivery_service ?? 'dhl', 'delivery_service', { max: 16 }).toLowerCase();
    if (!DELIVERY_SERVICES.includes(deliveryService)) throw bad(`delivery_service must be one of ${DELIVERY_SERVICES.join(', ')}`);
    const country = str(ctx.body.shipping_country ?? 'DE', 'shipping_country', { max: 2 }).toUpperCase();
    if (country !== 'DE') throw bad('Courier services are currently available within Germany only');
    let locationId;
    let pickupLocationId = null;
    let pickupAt = null;
    if (fulfillment === 'pickup') {
      pickupLocationId = ctx.body.pickup_location_id != null ? int(ctx.body.pickup_location_id, 'pickup_location_id', { min: 1 }) : null;
      locationId = resolveLocationId(db, pickupLocationId ?? ctx.body.location_id);
      pickupAt = ctx.body.pickup_at ? str(ctx.body.pickup_at, 'pickup_at', { max: 40 }) : null;
    } else {
      locationId = resolveLocationId(db, ctx.body.location_id);
    }
    const promoCode = ctx.body.promo_code ? String(ctx.body.promo_code).toUpperCase() : null;
    const paymentMethod = str(ctx.body.payment_method ?? 'manual', 'payment_method', { max: 12 }).toLowerCase();
    if (!PAYMENT_METHODS.includes(paymentMethod)) throw bad(`payment_method must be one of ${PAYMENT_METHODS.join(', ')}`);
    const items = ctx.body.items;
    if (!Array.isArray(items) || !items.length || items.length > 100) throw bad('items must be a non-empty array');
    const wanted = new Map();
    let bundleDiscount = 0;
    for (const it of items) {
      const qty = int(it?.quantity, 'quantity', { min: 1 });
      if (it?.bundle_id != null) {
        const bundleId = int(it.bundle_id, 'bundle_id', { min: 1 });
        const bundle = get('SELECT * FROM bundles WHERE id = ? AND active = 1', bundleId);
        if (!bundle) throw bad(`Bundle ${bundleId} is not available`);
        const { lines, discount_cents } = expandBundle(db, bundle, qty);
        for (const line of lines) {
          wanted.set(line.product_id, (wanted.get(line.product_id) ?? 0) + line.quantity);
        }
        bundleDiscount += discount_cents;
      } else {
        const pid = int(it?.product_id, 'product_id', { min: 1 });
        wanted.set(pid, (wanted.get(pid) ?? 0) + qty);
      }
    }
    const order = transaction(db, () => {
      let total = 0;
      const lines = [];
      for (const [pid, qty] of wanted) {
        const p = get('SELECT * FROM products WHERE id = ? AND active = 1', pid);
        if (!p) throw bad(`Product ${pid} not available`);
        if (stockAt(db, p.id, locationId) < qty) throw new HttpError(409, `Insufficient stock for ${p.name}`);
        const unit = user && user.account_type === 'restaurant' && p.wholesale_price_cents != null
          ? p.wholesale_price_cents : p.price_cents;
        total += unit * qty;
        lines.push({ p, qty, unit });
      }
      const promo = promoCode
        ? validatePromo(db, promoCode, total, { userId: user ? user.id : undefined, email: guestEmail || undefined })
        : null;
      const discount = Math.min(total, (promo ? computeDiscount(promo, total) : 0) + bundleDiscount);
      const deliveryFee = fulfillment === 'delivery' ? deliveryFeeFor(db, address, total) : 0;
      const payable = total - discount + deliveryFee;
      if (promo) run('UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?', promo.id);
      // Guests have no account to credit, so loyalty points are reserved for members.
      const points = user ? pointsFor(payable, tierFor(lifetimeSpendCents(db, user.id))) : 0;
      const paymentReference = `pay_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
      const { lastInsertRowid: oid } = run(
        `INSERT INTO orders (user_id, guest_email, guest_name, total_cents, discount_cents, promo_code, location_id, points_earned, shipping_address, delivery_service, shipping_country,
           fulfillment, pickup_location_id, pickup_at, delivery_fee_cents, payment_status, payment_method, payment_reference)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        user ? user.id : null, guestEmail, guestName, payable, discount, promoCode, locationId, points, address, deliveryService, country,
        fulfillment, pickupLocationId, pickupAt, deliveryFee, 'unpaid', paymentMethod, paymentReference);
      for (const { p, qty, unit } of lines) {
        run('INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents) VALUES (?,?,?,?)', oid, p.id, qty, unit);
        adjustStock(db, p.id, locationId, -qty);
      }
      if (user) run('UPDATE users SET loyalty_points = loyalty_points + ? WHERE id = ?', points, user.id);
      return get('SELECT * FROM orders WHERE id = ?', oid);
    });

    // Placing an order converts any saved cart, so recovery emails stop.
    if (user) run('UPDATE carts SET recovered_at = CURRENT_TIMESTAMP WHERE user_id = ? AND recovered_at IS NULL', user.id);
    comms.emit('order.placed', {
      email: user ? user.email : guestEmail, name: user ? user.name : (guestName || 'Guest'),
      order_id: order.id,
      total_cents: order.total_cents, location_id: order.location_id, fulfillment: order.fulfillment,
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
      : all(`SELECT o.*, COALESCE(u.email, o.guest_email) AS customer_email
              FROM orders o LEFT JOIN users u ON u.id = o.user_id ORDER BY o.id DESC
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

  // Printable invoice — visible to the order's owner or any staff member.
  route('GET', '/api/orders/:id/invoice', (ctx) => {
    const user = requireUser(ctx);
    const o = get('SELECT * FROM orders WHERE id = ?', ctx.params.id);
    if (!o || (user.role === 'customer' && o.user_id !== user.id)) throw notFound();
    const order = orderWithItems(o);
    const buyer = o.user_id
      ? get('SELECT name, email FROM users WHERE id = ?', o.user_id)
      : { name: o.guest_name || 'Guest', email: o.guest_email || '' };
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const eur = (cents) => (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
    const rows = order.items
      .map((it) => `<tr><td>${esc(it.name)}</td><td>${it.quantity}</td><td>${eur(it.unit_price_cents)}</td><td>${eur(it.unit_price_cents * it.quantity)}</td></tr>`)
      .join('');
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Afro Mart invoice #${o.id}</title>
<link rel="stylesheet" href="/invoice.css">
</head><body>
<h1>AFROMART</h1><p class="muted">Authentic African Foods — Right to Your Door</p>
<h2>Invoice #${o.id}</h2>
<p class="muted">Placed ${esc(o.created_at)} • Status: ${esc(o.status)} • Payment: ${esc(o.payment_status)}</p>
<p><strong>Billed to:</strong> ${esc(buyer?.name)}<br>${esc(buyer?.email)}<br>${esc(o.shipping_address || 'In-store pickup')}</p>
<table><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Line</th></tr></thead><tbody>${rows}</tbody></table>
<div class="totals">
<div>Discount: −${eur(o.discount_cents)}</div>
<div>Delivery: ${eur(o.delivery_fee_cents)}</div>
<div class="grand">Total: ${eur(o.total_cents)}</div>
</div>
<p class="muted">Afro Mart Bochum • Thank you for shopping with us.</p>
</body></html>`;
    return reply(200, html, { 'Content-Type': 'text/html; charset=utf-8' });
  });

  // Staff: recent privileged actions (newest first).
  route('GET', '/api/audit', (ctx) => {
    requireStaff(ctx);
    const limit = Math.min(Math.max(Number(ctx.query.get('limit')) || 100, 1), 500);
    return all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', limit);
  });

  // Public delivery tracking: an order number plus the email used to place it.
  route('GET', '/api/track', (ctx) => {
    const rawOrder = String(ctx.query.get('order') ?? '').trim();
    if (!/^\d+$/.test(rawOrder)) throw bad('order must be a number');
    const orderId = Number(rawOrder);
    const email = str(ctx.query.get('email'), 'email', { max: 200 }).toLowerCase();
    const o = get('SELECT * FROM orders WHERE id = ?', orderId);
    if (!o) throw notFound();
    // Members are matched on their account email; guest orders on the email used
    // at checkout, so a guest can still follow their parcel.
    const owner = o.user_id ? get('SELECT email FROM users WHERE id = ?', o.user_id) : null;
    const ownerEmail = owner ? owner.email : o.guest_email;
    if (!ownerEmail || String(ownerEmail).toLowerCase() !== email) throw notFound();
    const items = all(
      `SELECT oi.quantity, oi.unit_price_cents, p.name
       FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ?`, o.id);
    return {
      id: o.id,
      status: o.status,
      fulfillment: o.fulfillment,
      delivery_service: o.delivery_service,
      created_at: o.created_at,
      total_cents: o.total_cents,
      payment_status: o.payment_status,
      shipping_address: o.shipping_address,
      pickup_at: o.pickup_at,
      items,
    };
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
    auditLog(ctx, 'order.status', 'order', order.id, status);
    if (customer) {
      comms.emit('order.status_changed', {
        email: customer.email, name: customer.name,
        order_id: order.id, status: order.status, total_cents: order.total_cents,
      });
    }
    return order;
  });

  // ---- Payments (integration-ready) ----
  route('PATCH', '/api/orders/:id/payment', (ctx) => {
    requireStaff(ctx);
    const status = str(ctx.body.status, 'status', { max: 12 });
    if (!PAYMENT_STATUSES.includes(status)) throw bad(`payment status must be one of ${PAYMENT_STATUSES.join(', ')}`);
    const method = ctx.body.method === undefined ? null : str(ctx.body.method, 'method', { max: 12 });
    if (method && !PAYMENT_METHODS.includes(method.toLowerCase())) throw bad('Unknown payment method');
    const result = transaction(db, () => {
      const order = get('SELECT * FROM orders WHERE id = ?', ctx.params.id);
      if (!order) throw notFound();
      const set = ['payment_status = ?'];
      const params = [status];
      if (method) { set.push('payment_method = ?'); params.push(method.toLowerCase()); }
      if (ctx.body.reference) { set.push('payment_reference = ?'); params.push(str(ctx.body.reference, 'reference', { max: 200 })); }
      run(`UPDATE orders SET ${set.join(', ')} WHERE id = ?`, ...params, order.id);
      if (status === 'paid' && order.status === 'pending') run("UPDATE orders SET status = 'paid' WHERE id = ?", order.id);
      return orderWithItems(get('SELECT * FROM orders WHERE id = ?', order.id));
    });
    auditLog(ctx, 'order.payment', 'order', ctx.params.id, method ? `${status}:${method.toLowerCase()}` : status);
    return result;
  });

  route('POST', '/api/payments/webhook', (ctx) => {
    const secret = process.env.PAYMENTS_WEBHOOK_SECRET;
    if (!secret) throw new HttpError(503, 'Payment gateway not configured');
    const provided = String(ctx.headers['x-webhook-secret'] ?? '');
    if (!provided || provided !== secret) throw new HttpError(401, 'Invalid webhook secret');
    const reference = str(ctx.body.reference, 'reference', { max: 200 });
    const status = str(ctx.body.status ?? 'paid', 'status', { max: 12 });
    if (!PAYMENT_STATUSES.includes(status)) throw bad('Unknown payment status');
    const method = str(ctx.body.method ?? 'card', 'method', { max: 12 }).toLowerCase();
    if (!PAYMENT_METHODS.includes(method)) throw bad('Unknown payment method');
    return transaction(db, () => {
      const order = get('SELECT * FROM orders WHERE payment_reference = ?', reference);
      if (!order) throw new HttpError(404, 'Unknown payment reference');
      run('UPDATE orders SET payment_status = ?, payment_method = ? WHERE id = ?', status, method, order.id);
      if (status === 'paid' && order.status === 'pending') run("UPDATE orders SET status = 'paid' WHERE id = ?", order.id);
      return { ok: true, order_id: order.id, payment_status: status };
    });
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
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'sha256-6/SCuzi3l368PQt/BgOUJQCNrkXnrnQkDMSj6CdRhEI='; img-src 'self' https: data:; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
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

  // ---- Crawlable product pages + sitemap (see src/seo.js) ----
  // The storefront is a single-page app, so products have no URL of their own. These
  // server-rendered pages give each one a real address with Product structured data,
  // which is what product rich results are built from. Public scope only: hidden or
  // out-of-scope products 404 here just as they are hidden in the shop.
  const PRODUCT_COLUMNS = `p.id, p.sku, p.name, p.description, p.category_id, c.name AS category,
      p.price_cents, p.stock, p.spice_level, p.image_url,
      (SELECT ROUND(AVG(r.rating), 1) FROM product_reviews r WHERE r.product_id = p.id AND r.status = 'approved') AS rating_average,
      (SELECT COUNT(*) FROM product_reviews r WHERE r.product_id = p.id AND r.status = 'approved') AS rating_count`;

  function serveProductPage(slug, res) {
    const id = productIdFromSlug(slug);
    if (!id) throw notFound();
    const product = get(
      `SELECT ${PRODUCT_COLUMNS}
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.id = ? AND p.active = 1 AND ${IN_SCOPE_SQL}`, id);
    if (!product) throw notFound();
    attachTags(db, [product]);

    const related = all(
      `SELECT p.id, p.name, p.price_cents, p.image_url, c.name AS category
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.active = 1 AND p.id != ? AND ${IN_SCOPE_SQL}
       ${product.category_id ? 'AND p.category_id = ?' : ''}
       ORDER BY p.name LIMIT 4`,
      ...(product.category_id ? [product.id, product.category_id] : [product.id]));

    const nonce = newNonce();
    send(res, 200, renderProductPage(product, { related, nonce }), {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': cspWithNonce(nonce),
      'Cache-Control': 'public, max-age=0, must-revalidate',
    });
  }

  function serveSitemap(res) {
    const rows = all(
      `SELECT p.id, p.name FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.active = 1 AND ${IN_SCOPE_SQL} ORDER BY p.name`);
    send(res, 200, renderSitemap(rows), {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    });
  }

  // Google Merchant Center product feed (free Shopping listings), generated from the
  // same in-scope catalogue as the sitemap. See renderProductFeed in src/seo.js.
  function serveFeed(res) {
    const rows = all(
      `SELECT p.id, p.sku, p.name, p.description, p.category_id, c.name AS category,
         p.price_cents, p.stock, p.image_url
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.active = 1 AND ${IN_SCOPE_SQL} ORDER BY p.name`);
    send(res, 200, renderProductFeed(rows), {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    });
  }

  // ---- Rate limiting (best-effort, in-memory, per client IP) ----
  const hits = new Map();
  const allow = (key, limit, windowMs) => {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.start >= windowMs) { hits.set(key, { start: now, count: 1 }); return true; }
    entry.count += 1;
    return entry.count <= limit;
  };
  const clientIp = (req) =>
    String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'local').split(',')[0].trim();

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
        const page = /^\/product\/([A-Za-z0-9._~-]+)$/.exec(pathname);
        if (page) return serveProductPage(page[1], res);
        if (pathname === '/sitemap.xml') return serveSitemap(res);
        if (pathname === '/feed.xml') return serveFeed(res);
        return await serveStatic(url.pathname, res);
      }
      const ip = clientIp(req);
      const isAuthWrite = req.method === 'POST' && (pathname === '/api/auth/login' || pathname === '/api/auth/register');
      // LLM calls cost money and time, so they get their own much tighter bucket.
      const isAiWrite = req.method === 'POST' && pathname.startsWith('/api/assistant/');
      const withinLimit = isAuthWrite
        ? allow(`auth:${ip}`, 30, 5 * 60_000)
        : isAiWrite
          ? allow(`ai:${ip}`, 30, 60_000)
          : allow(`api:${ip}`, 900, 60_000);
      if (!withinLimit) {
        send(res, 429, { error: 'Too many requests — please slow down and try again shortly' }, { 'Retry-After': '60' });
        return;
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

      const ctx = { params: matched.params, query: url.searchParams, headers: req.headers, body: {}, user: null };
      const auth = req.headers.authorization;
      if (auth?.startsWith('Bearer ')) {
        const payload = verifyToken(auth.slice(7), secret);
        if (payload) ctx.user = get('SELECT * FROM users WHERE id = ?', payload.sub) ?? null;
      }
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) ctx.body = await readBody(req);

      const out = await matched.r.handler(ctx);
      if (out instanceof Reply) send(res, out.status, out.data, out.headers);
      else send(res, 200, out);
    } catch (e) {
      if (e instanceof HttpError || typeof e?.status === 'number') return send(res, e.status, { error: e.message });
      console.error(e);
      send(res, 500, { error: 'Internal server error' });
    }
  };
}
