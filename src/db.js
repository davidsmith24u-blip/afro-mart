import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','staff','admin')),
  loyalty_points INTEGER NOT NULL DEFAULT 0,
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
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
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
  const userColumns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
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
