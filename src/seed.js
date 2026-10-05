import { openDb } from './db.js';

const db = openDb(process.env.DB_PATH || 'afromart.db');
const categoryNames = ['Dry Goods', 'Fresh Produce', 'Beverages', 'Spices', 'Frozen', 'Snacks', 'Oils & Condiments'];
const insertCategory = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');
const cats = {};
for (const name of categoryNames) {
  insertCategory.run(name);
  cats[name] = db.prepare('SELECT id FROM categories WHERE name = ?').get(name).id;
}
let supplier = db.prepare('SELECT id FROM suppliers WHERE name = ?').get('Lagos Wholesale Foods');
if (!supplier) {
  const result = db.prepare("INSERT INTO suppliers (name, country, contact_name) VALUES ('Lagos Wholesale Foods', 'Nigeria', 'Ade')").run();
  supplier = { id: Number(result.lastInsertRowid) };
}
const ins = db.prepare(`INSERT INTO products (sku, name, description, category_id, supplier_id, price_cents, cost_cents, stock, reorder_level, reorder_quantity)
  VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(sku) DO NOTHING`);
const products = [
  ['GAR-001', 'Garri (white) 2kg', 'Cassava granules', 'Dry Goods', 899, 600, 40, 10, 50],
  ['YAM-001', 'Yam flour (Elubo) 1kg', 'Ground yam flour', 'Dry Goods', 699, 450, 8, 10, 40],
  ['PLN-001', 'Plantain (bunch)', 'Fresh green plantain', 'Fresh Produce', 499, 300, 25, 8, 30],
  ['HIB-001', 'Hibiscus tea (Zobo) 250g', 'Dried hibiscus petals', 'Beverages', 599, 350, 30, 10, 40],
  ['SPC-001', 'Suya spice 100g', 'West African peanut spice mix', 'Spices', 449, 250, 60, 15, 60],
  ['PEP-001', 'Scotch bonnet peppers 200g', 'Fresh hot peppers', 'Fresh Produce', 399, 200, 5, 10, 30],
  ['EGU-001', 'Egusi seeds 500g', 'Ground melon seeds for rich West African soups', 'Dry Goods', 899, 550, 24, 8, 30],
  ['OGB-001', 'Ogbono seeds 250g', 'Wild mango seeds for a classic draw soup', 'Dry Goods', 799, 480, 18, 7, 25],
  ['GAR-002', 'Ijebu garri 1kg', 'Fine, tangy cassava granules from southwest Nigeria', 'Dry Goods', 649, 420, 28, 8, 35],
  ['FUF-001', 'Cassava fufu flour 1kg', 'Easy-to-prepare cassava flour for a smooth swallow', 'Dry Goods', 749, 470, 22, 8, 30],
  ['YAM-002', 'Pounded yam flour 1.5kg', 'Quick-cooking yam flour for soft pounded yam', 'Dry Goods', 1199, 780, 16, 6, 24],
  ['MAI-001', 'White maize meal 2kg', 'A Southern African staple for nshima, sadza, or pap', 'Dry Goods', 999, 650, 20, 7, 28],
  ['TEF-001', 'Teff flour 1kg', 'Fine teff flour for homemade Ethiopian injera', 'Dry Goods', 1499, 1000, 14, 5, 20],
  ['CRY-001', 'Ground crayfish 150g', 'Dried ground crayfish to deepen soups and stews', 'Spices', 699, 430, 20, 7, 25],
  ['PSP-001', 'Pepper soup spice 100g', 'Fragrant West African blend with grains of selim', 'Spices', 499, 300, 25, 8, 35],
  ['JOL-001', 'Jollof rice seasoning 100g', 'Tomato, pepper, and warming spices for party rice', 'Spices', 449, 260, 35, 10, 45],
  ['BER-001', 'Berbere spice blend 100g', 'Ethiopian-inspired chili and aromatic spice blend', 'Spices', 599, 350, 18, 6, 25],
  ['PAL-001', 'Red palm oil 1L', 'Rich, unrefined palm oil for soups and stews', 'Oils & Condiments', 1299, 850, 20, 7, 28],
  ['GNP-001', 'Roasted groundnut paste 500g', 'Creamy roasted peanut paste for sauces and snacks', 'Oils & Condiments', 899, 580, 18, 6, 24],
  ['CHI-001', 'Chin chin 300g', 'Crunchy, lightly sweet West African snack bites', 'Snacks', 699, 420, 30, 10, 40],
  ['PLC-001', 'Plantain chips 150g', 'Crisp golden plantain slices with a gentle salt finish', 'Snacks', 399, 220, 32, 10, 45],
  ['PUF-001', 'Puff puff mix 500g', 'Simply add water for soft, golden celebration doughnuts', 'Snacks', 599, 360, 24, 8, 32],
  ['CAS-001', 'Frozen cassava leaves 500g', 'Chopped cassava leaves, ready for African stews', 'Frozen', 799, 500, 15, 5, 22],
  ['TAM-001', 'Tamarind drink concentrate 500ml', 'Sweet-tart concentrate for a refreshing chilled drink', 'Beverages', 899, 560, 18, 6, 24],
  ['BAO-001', 'Baobab fruit powder 150g', 'Bright, tangy baobab powder for drinks and porridge', 'Dry Goods', 999, 650, 12, 4, 18],
  ['SNL-001', 'Dried snail 100g', 'Smoky dried snails for richly flavored soups and stews', 'Dry Goods', 1299, 850, 12, 4, 18],
  ['CAT-001', 'Dried catfish cuts 200g', 'Smoked catfish pieces, cleaned and ready for cooking', 'Dry Goods', 1099, 720, 16, 5, 22],
  ['CAT-002', 'Whole dried catfish 1 piece', 'Whole smoked catfish for traditional soups and sauces', 'Dry Goods', 1499, 980, 10, 4, 16],
  ['PON-001', 'Dried ponmo 100g', 'Dried cow skin pieces for soups, stews, and sauces', 'Dry Goods', 599, 360, 20, 7, 28],
  ['CRY-002', 'Dried crayfish 100g', 'Aromatic dried crayfish for seasoning West African dishes', 'Dry Goods', 699, 430, 20, 7, 28],
  ['IRU-001', 'Iru (locust beans) 100g', 'Traditional fermented locust beans for deep savory flavor', 'Oils & Condiments', 499, 300, 18, 6, 24],
  ['KNR-001', 'Knorr chicken cubes 8-pack', 'Chicken-flavored seasoning cubes for everyday cooking', 'Oils & Condiments', 249, 140, 40, 12, 55],
  ['GND-001', 'Roasted groundnuts 250g', 'Crunchy roasted peanuts for snacking or sharing', 'Snacks', 499, 290, 28, 9, 38],
  ['TIG-001', 'Tigernut powder 250g', 'Fine tigernut powder for drinks, smoothies, and porridge', 'Dry Goods', 899, 570, 16, 5, 22],
  ['OFA-001', 'Dry Ayamashe / Ofada mix 100g', 'Pepper and spice blend for Ayamashe or Ofada sauce', 'Spices', 599, 360, 20, 7, 28],
  ['JOL-002', 'Dry jollof base mix 100g', 'Tomato, pepper, and spice blend for quick jollof rice', 'Spices', 549, 330, 24, 8, 32],
  ['EGM-001', 'Dry egusi mix 200g', 'Ground melon seeds with classic soup spices, ready to cook', 'Spices', 849, 530, 18, 6, 24],
  ['ZOB-001', 'Zobo hibiscus drink 500ml', 'Chilled-style West African hibiscus drink with ginger', 'Beverages', 399, 230, 24, 8, 32],
  ['CHP-001', 'Chapman fruit drink 330ml', 'Nigerian-inspired sparkling citrus and fruit soft drink', 'Beverages', 349, 200, 24, 8, 32],
  ['MAL-001', 'Malt drink 330ml', 'Rich, non-alcoholic African malt beverage', 'Beverages', 299, 170, 30, 10, 40],
  ['AMT-001', 'Amstel Malta 330ml', 'Non-alcoholic malt drink with a smooth, malty taste', 'Beverages', 299, 170, 24, 8, 32],
  ['GING-001', 'Ginger drink 330ml', 'Bright, gently spiced non-alcoholic ginger drink', 'Beverages', 349, 200, 18, 6, 24],
  ['COL-001', 'Coca-Cola 330ml', 'Classic cola soft drink', 'Beverages', 199, 110, 48, 16, 60],
  ['PEP-001B', 'Pepsi 330ml', 'Cola soft drink with a crisp, refreshing finish', 'Beverages', 199, 110, 48, 16, 60],
  ['FAN-001', 'Fanta Orange 330ml', 'Sparkling orange soft drink', 'Beverages', 199, 110, 36, 12, 48],
  ['SPR-001', 'Sprite Lemon-Lime 330ml', 'Lemon-lime sparkling soft drink', 'Beverages', 199, 110, 36, 12, 48],
  ['MIR-001', 'Mirinda Orange 330ml', 'Bright, bubbly orange soft drink', 'Beverages', 199, 110, 30, 10, 42],
  ['RED-001', 'Red Bull Energy Drink 250ml', 'Carbonated energy drink, single can', 'Beverages', 299, 180, 24, 8, 32],
  ['MON-001', 'Monster Energy Original 500ml', 'Classic energy drink, 500ml can', 'Beverages', 399, 240, 20, 7, 28],
  ['POW-001', 'Power Horse Energy Drink 250ml', 'Popular energy drink in a handy single-serve can', 'Beverages', 249, 145, 24, 8, 32],
  ['PIN-001', 'South African Pinotage 750ml', 'Dry red wine with dark berry notes from South Africa', 'Beverages', 1199, 800, 12, 4, 18],
  ['CHW-001', 'South African Chenin Blanc 750ml', 'Crisp South African white wine with fresh fruit notes', 'Beverages', 1099, 730, 12, 4, 18],
  ['SHI-001', 'South African Shiraz 750ml', 'Full-bodied South African red wine', 'Beverages', 1299, 870, 10, 4, 16],
  ['MAN-001', 'Mango nectar 1L', 'Smooth tropical mango fruit drink', 'Beverages', 399, 240, 20, 7, 28],
  ['KOL-001', 'Kola nut soft drink 330ml', 'African-inspired sparkling kola nut beverage', 'Beverages', 349, 210, 18, 6, 24],
];
let added = 0;
for (const [sku, name, description, category, price, cost, stock, level, quantity] of products) {
  added += ins.run(sku, name, description, cats[category], supplier.id, price, cost, stock, level, quantity).changes;
}
console.log(`Seeded ${added} new products (${products.length - added} existing SKUs left unchanged).`);
