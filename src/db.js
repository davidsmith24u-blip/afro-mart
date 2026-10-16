import { DatabaseSync } from 'node:sqlite';
import { syncCatalogMeta } from './catalog-meta.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','staff','admin')),
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  account_type TEXT NOT NULL DEFAULT 'retail' CHECK (account_type IN ('retail','restaurant')),
  location_id INTEGER REFERENCES locations(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  country TEXT,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category_id INTEGER REFERENCES categories(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  reorder_level INTEGER NOT NULL DEFAULT 10,
  reorder_quantity INTEGER NOT NULL DEFAULT 50,
  expiry_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  spice_level INTEGER NOT NULL DEFAULT 0 CHECK (spice_level >= 0 AND spice_level <= 5),
  wholesale_price_cents INTEGER,
  image_url TEXT
);
CREATE TABLE IF NOT EXISTS product_tags (
  product_id INTEGER NOT NULL REFERENCES products(id),
  kind TEXT NOT NULL CHECK (kind IN ('origin','cuisine','diet')),
  value TEXT NOT NULL,
  PRIMARY KEY (product_id, kind, value)
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  guest_email TEXT,
  guest_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','packed','shipped','delivered','cancelled')),
  total_cents INTEGER NOT NULL,
  points_earned INTEGER NOT NULL DEFAULT 0,
  shipping_address TEXT NOT NULL,
  delivery_service TEXT NOT NULL DEFAULT 'dhl' CHECK (delivery_service IN ('dhl','dpd','hermes')),
  shipping_country TEXT NOT NULL DEFAULT 'DE' CHECK (shipping_country = 'DE'),
  location_id INTEGER REFERENCES locations(id),
  promo_code TEXT,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  status TEXT NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered','received','cancelled')),
  location_id INTEGER REFERENCES locations(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  received_at TEXT
);
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost_cents INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  postal_code TEXT,
  country TEXT NOT NULL DEFAULT 'DE',
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS inventory (
  product_id INTEGER NOT NULL REFERENCES products(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  reorder_level INTEGER NOT NULL DEFAULT 10,
  reorder_quantity INTEGER NOT NULL DEFAULT 50,
  PRIMARY KEY (product_id, location_id)
);
CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  source TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS promo_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  discount_type TEXT NOT NULL DEFAULT 'percent' CHECK (discount_type IN ('percent','fixed')),
  value INTEGER NOT NULL CHECK (value >= 0),
  min_total_cents INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  first_order_only INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  segment TEXT NOT NULL DEFAULT 'all',
  subject TEXT,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sent','cancelled')),
  scheduled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT
);
CREATE TABLE IF NOT EXISTS message_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL DEFAULT 'email',
  subject TEXT,
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS automations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  event TEXT NOT NULL,
  template_id INTEGER NOT NULL REFERENCES message_templates(id),
  channel TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL DEFAULT 'email',
  recipient TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  automation_id INTEGER REFERENCES automations(id),
  campaign_id INTEGER REFERENCES campaigns(id),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_inventory_location ON inventory(location_id);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
CREATE TABLE IF NOT EXISTS bundles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  bundle_type TEXT NOT NULL DEFAULT 'meal_pack'
    CHECK (bundle_type IN ('meal_pack','starter_pack','party_pack','gift_box','taste_box')),
  savings_percent INTEGER NOT NULL DEFAULT 10 CHECK (savings_percent >= 0 AND savings_percent <= 100),
  serves INTEGER NOT NULL DEFAULT 0 CHECK (serves >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS bundle_items (
  bundle_id INTEGER NOT NULL REFERENCES bundles(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (bundle_id, product_id)
);
CREATE TABLE IF NOT EXISTS delivery_areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  city TEXT,
  postal_prefixes TEXT NOT NULL DEFAULT '',
  fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  min_order_cents INTEGER NOT NULL DEFAULT 0 CHECK (min_order_cents >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  bundle_id INTEGER NOT NULL REFERENCES bundles(id),
  fulfillment TEXT NOT NULL DEFAULT 'delivery' CHECK (fulfillment IN ('delivery','pickup')),
  shipping_address TEXT,
  pickup_location_id INTEGER REFERENCES locations(id),
  pickup_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','cancelled')),
  next_run_on TEXT NOT NULL,
  last_run_on TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  steps TEXT NOT NULL DEFAULT '',
  prep_minutes INTEGER NOT NULL DEFAULT 30 CHECK (prep_minutes > 0),
  servings INTEGER NOT NULL DEFAULT 4 CHECK (servings > 0),
  emoji TEXT NOT NULL DEFAULT '🍽️',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS recipe_ingredients (
  recipe_id INTEGER NOT NULL REFERENCES recipes(id),
  product_id INTEGER REFERENCES products(id),
  bundle_id INTEGER REFERENCES bundles(id),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  note TEXT,
  CHECK ((product_id IS NOT NULL) OR (bundle_id IS NOT NULL)),
  PRIMARY KEY (recipe_id, product_id, bundle_id)
);
CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  event_date TEXT,
  guests INTEGER NOT NULL DEFAULT 0 CHECK (guests >= 0),
  fulfillment TEXT NOT NULL DEFAULT 'delivery' CHECK (fulfillment IN ('delivery','pickup')),
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','quoted','confirmed','declined')),
  quoted_cents INTEGER,
  staff_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_product_tags ON product_tags(kind, value);

-- Uploaded product/review imagery, stored inline so it survives the Netlify
-- Blobs snapshot without a separate object store.
CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mime TEXT NOT NULL,
  bytes BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Customer product reviews with star ratings and optional photo, moderated by staff.
CREATE TABLE IF NOT EXISTS product_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  user_id INTEGER REFERENCES users(id),
  order_id INTEGER REFERENCES orders(id),
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON product_reviews(product_id, status);

-- "Notify me when back in stock" requests, processed by a staff/cron endpoint.
CREATE TABLE IF NOT EXISTS stock_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notified_at TEXT,
  UNIQUE (product_id, email)
);

-- Server-side cart snapshots so lapsed carts can be recovered by email.
CREATE TABLE IF NOT EXISTS carts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  email TEXT,
  items TEXT NOT NULL DEFAULT '[]',
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reminded_at TEXT,
  recovered_at TEXT
);

-- Who changed what: a lightweight trail of privileged mutations for accountability.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  actor_email TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
`;

export function openDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  const orderColumns = db.prepare('PRAGMA table_info(orders)').all().map((column) => column.name);
  if (!orderColumns.includes('delivery_service')) {
    db.exec("ALTER TABLE orders ADD COLUMN delivery_service TEXT NOT NULL DEFAULT 'dhl' CHECK (delivery_service IN ('dhl','dpd','hermes'))");
  }
  if (!orderColumns.includes('shipping_country')) {
    db.exec("ALTER TABLE orders ADD COLUMN shipping_country TEXT NOT NULL DEFAULT 'DE' CHECK (shipping_country = 'DE')");
  }
  if (!orderColumns.includes('location_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN location_id INTEGER REFERENCES locations(id)');
  }
  if (!orderColumns.includes('promo_code')) {
    db.exec('ALTER TABLE orders ADD COLUMN promo_code TEXT');
  }
  if (!orderColumns.includes('discount_cents')) {
    db.exec('ALTER TABLE orders ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0');
  }
  if (!orderColumns.includes('fulfillment')) {
    db.exec("ALTER TABLE orders ADD COLUMN fulfillment TEXT NOT NULL DEFAULT 'delivery' CHECK (fulfillment IN ('delivery','pickup'))");
  }
  if (!orderColumns.includes('pickup_location_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN pickup_location_id INTEGER REFERENCES locations(id)');
  }
  if (!orderColumns.includes('pickup_at')) {
    db.exec('ALTER TABLE orders ADD COLUMN pickup_at TEXT');
  }
  if (!orderColumns.includes('delivery_fee_cents')) {
    db.exec('ALTER TABLE orders ADD COLUMN delivery_fee_cents INTEGER NOT NULL DEFAULT 0');
  }
  if (!orderColumns.includes('payment_status')) {
    db.exec("ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid','failed','refunded'))");
  }
  if (!orderColumns.includes('payment_method')) {
    db.exec("ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'manual' CHECK (payment_method IN ('card','paypal','klarna','invoice','manual'))");
  }
  if (!orderColumns.includes('payment_reference')) {
    db.exec('ALTER TABLE orders ADD COLUMN payment_reference TEXT');
  }
  // Guest checkout: an order can exist without an account, identified by the
  // email captured at checkout. SQLite cannot drop the NOT NULL on
  // orders.user_id in place, so a legacy database is rebuilt once, copying every
  // existing column across inside a transaction. Any failure rolls back and
  // leaves the original table untouched.
  const userIdColumn = db.prepare('PRAGMA table_info(orders)').all().find((column) => column.name === 'user_id');
  if (userIdColumn && userIdColumn.notnull === 1) {
    const originalSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'").get().sql;
    const rebuiltSql = originalSql
      .replace(/^CREATE TABLE\s+(IF NOT EXISTS\s+)?orders/i, 'CREATE TABLE orders_new')
      .replace('user_id INTEGER NOT NULL REFERENCES users(id)', 'user_id INTEGER REFERENCES users(id)')
      .replace(/\)\s*$/, ', guest_email TEXT, guest_name TEXT\n)');
    if (rebuiltSql.includes('user_id INTEGER NOT NULL')) {
      throw new Error('Could not relax orders.user_id NOT NULL while enabling guest checkout');
    }
    const copyColumns = db.prepare('PRAGMA table_info(orders)').all().map((column) => column.name);
    const columnList = copyColumns.map((name) => `"${name}"`).join(', ');
    const before = db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.exec('BEGIN');
      db.exec(rebuiltSql);
      db.exec(`INSERT INTO orders_new (${columnList}) SELECT ${columnList} FROM orders`);
      db.exec('DROP TABLE orders');
      db.exec('ALTER TABLE orders_new RENAME TO orders');
      const after = db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
      if (after !== before) throw new Error(`orders rebuild lost rows (${before} -> ${after})`);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* no transaction in progress */ }
      throw error;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
  const promoColumns = db.prepare('PRAGMA table_info(promo_codes)').all().map((column) => column.name);
  if (!promoColumns.includes('first_order_only')) {
    db.exec('ALTER TABLE promo_codes ADD COLUMN first_order_only INTEGER NOT NULL DEFAULT 0');
  }
  const productColumns = db.prepare('PRAGMA table_info(products)').all().map((column) => column.name);
  if (!productColumns.includes('spice_level')) {
    db.exec('ALTER TABLE products ADD COLUMN spice_level INTEGER NOT NULL DEFAULT 0');
  }
  if (!productColumns.includes('wholesale_price_cents')) {
    db.exec('ALTER TABLE products ADD COLUMN wholesale_price_cents INTEGER');
  }
  if (!productColumns.includes('image_url')) {
    db.exec('ALTER TABLE products ADD COLUMN image_url TEXT');
  }
  const bundleColumns = db.prepare('PRAGMA table_info(bundles)').all().map((column) => column.name);
  if (!bundleColumns.includes('serves')) {
    db.exec('ALTER TABLE bundles ADD COLUMN serves INTEGER NOT NULL DEFAULT 0');
  }
  const recipeColumns = db.prepare('PRAGMA table_info(recipes)').all().map((column) => column.name);
  if (!recipeColumns.includes('steps')) {
    db.exec("ALTER TABLE recipes ADD COLUMN steps TEXT NOT NULL DEFAULT ''");
  }
  const userColumns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
  if (!userColumns.includes('account_type')) {
    db.exec("ALTER TABLE users ADD COLUMN account_type TEXT NOT NULL DEFAULT 'retail' CHECK (account_type IN ('retail','restaurant'))");
  }
  if (!userColumns.includes('location_id')) {
    db.exec('ALTER TABLE users ADD COLUMN location_id INTEGER REFERENCES locations(id)');
  }
  if (!userColumns.includes('referral_code')) {
    db.exec('ALTER TABLE users ADD COLUMN referral_code TEXT');
  }
  if (!userColumns.includes('referred_by')) {
    db.exec('ALTER TABLE users ADD COLUMN referred_by TEXT');
  }
  const poColumns = db.prepare('PRAGMA table_info(purchase_orders)').all().map((column) => column.name);
  if (!poColumns.includes('location_id')) {
    db.exec('ALTER TABLE purchase_orders ADD COLUMN location_id INTEGER REFERENCES locations(id)');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_orders_location ON orders(location_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_subscriptions_next ON subscriptions(status, next_run_on)');
  try { syncCatalogMeta(db); } catch {}
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
