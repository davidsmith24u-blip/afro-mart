import { openDb } from './db.js';

const db = openDb(process.env.DB_PATH || 'afromart.db');
if (db.prepare('SELECT COUNT(*) AS n FROM products').get().n) {
  console.log('Database already has products; skipping seed.');
  process.exit(0);
}
const cat = db.prepare('INSERT INTO categories (name) VALUES (?)');
const cats = {};
for (const n of ['Dry Goods', 'Fresh Produce', 'Beverages', 'Spices', 'Frozen']) cats[n] = Number(cat.run(n).lastInsertRowid);
const sup = Number(db.prepare("INSERT INTO suppliers (name, country, contact_name) VALUES ('Lagos Wholesale Foods', 'Nigeria', 'Ade')").run().lastInsertRowid);
const ins = db.prepare(`INSERT INTO products (sku, name, description, category_id, supplier_id, price_cents, cost_cents, stock, reorder_level, reorder_quantity)
  VALUES (?,?,?,?,?,?,?,?,?,?)`);
[
  ['GAR-001', 'Garri (white) 2kg', 'Cassava granules', 'Dry Goods', 899, 600, 40, 10, 50],
  ['YAM-001', 'Yam flour (Elubo) 1kg', 'Ground yam flour', 'Dry Goods', 699, 450, 8, 10, 40],
  ['PLN-001', 'Plantain (bunch)', 'Fresh green plantain', 'Fresh Produce', 499, 300, 25, 8, 30],
  ['HIB-001', 'Hibiscus tea (Zobo) 250g', 'Dried hibiscus petals', 'Beverages', 599, 350, 30, 10, 40],
  ['SPC-001', 'Suya spice 100g', 'West African peanut spice mix', 'Spices', 449, 250, 60, 15, 60],
  ['PEP-001', 'Scotch bonnet peppers 200g', 'Fresh hot peppers', 'Fresh Produce', 399, 200, 5, 10, 30],
].forEach(([sku, name, d, c, price, cost, stock, lvl, qty]) => ins.run(sku, name, d, cats[c], sup, price, cost, stock, lvl, qty));
console.log('Seeded sample categories, supplier and products.');
