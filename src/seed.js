import { openDb } from './db.js';

const db = openDb(process.env.DB_PATH || 'afromart.db');
const categoryNames = ['Dry Goods', 'Fresh Produce', 'Beverages', 'Spices', 'Frozen', 'Snacks', 'Oils & Condiments', 'Rice & Grains', 'Meat & Fish', 'Health & Beauty'];
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
  // ---- Rice & Grains ----
  ['RIC-001', 'Perfumed long-grain rice 5kg', 'Aromatic long-grain rice, the base of party-size jollof', 'Rice & Grains', 1599, 1100, 24, 8, 30],
  ['RIC-002', 'Long-grain rice 2kg', 'Versatile everyday long-grain rice', 'Rice & Grains', 799, 540, 30, 10, 40],
  ['MLP-001', 'Millet & sorghum pap mix 1kg', 'Soft porridge mix for Ghanaian-style koko', 'Rice & Grains', 699, 450, 16, 6, 24],
  ['BNK-001', 'Banku corn & cassava mix 1kg', 'Fermented Ghanaian banku and kenkey blend', 'Rice & Grains', 799, 520, 15, 5, 22],
  // ---- Meat & Fish ----
  ['STK-001', 'Stockfish (dry cod) 250g', 'Dried cod for deeply savory soups and stews', 'Meat & Fish', 1599, 1000, 10, 4, 16],
  ['CRO-001', 'Smoked croaker 300g', 'Whole smoked croaker, ready for soups and stews', 'Meat & Fish', 999, 650, 12, 4, 18],
  ['SHR-001', 'Dried prawns 100g', 'Dried prawns to lift soups, rice and stews', 'Meat & Fish', 799, 500, 14, 5, 20],
  ['GOA-001', 'Frozen goat meat 1kg', 'Cubed goat meat for pepper soup and rich stews', 'Meat & Fish', 1899, 1400, 12, 4, 18],
  ['SNA-001', 'Frozen red snapper 800g', 'Whole frozen red snapper for grilling or soup', 'Meat & Fish', 1499, 1050, 10, 4, 16],
  ['BIL-001', 'Biltong (spiced dried beef) 100g', 'South African-style spiced air-dried beef', 'Meat & Fish', 699, 450, 15, 5, 20],
  ['SARD-001', 'Sardines in tomato sauce 125g', 'Canned sardines, a pantry staple for snacks and jollof', 'Meat & Fish', 399, 230, 30, 10, 40],
  // ---- Soup bases & greens ----
  ['PNC-001', 'Palmnut cream 800g', 'Palm soup base for Ghanaian palmnut and banga-style soups', 'Oils & Condiments', 649, 420, 18, 6, 24],
  ['OHA-001', 'Dried oha leaves 100g', 'Local leaves for oha soup', 'Dry Goods', 599, 380, 14, 5, 20],
  ['UZI-001', 'Dried uziza leaves 100g', 'Peppery herb leaves for soups and stews', 'Dry Goods', 599, 380, 14, 5, 20],
  ['BTL-001', 'Dried bitterleaf 100g', 'Bitterleaf for ofe onugbu and rich stews', 'Dry Goods', 549, 350, 16, 6, 22],
  ['DSP-001', 'Dehydrated spinach (ugu / efo) 100g', 'Rehydrates into fresh-tasting leaves for soups', 'Dry Goods', 499, 310, 20, 7, 26],
  ['ACH-001', 'Achi thickener 100g', 'Natural soup thickener for a silky draw', 'Dry Goods', 399, 250, 18, 6, 24],
  // ---- Seasonings ----
  ['ONG-001', 'Seasoning cubes (beef) 8-pack', 'Beef-flavored seasoning cubes for everyday cooking', 'Spices', 249, 140, 36, 12, 48],
  ['DPP-001', 'Ground dried pepper (hot) 100g', 'Fiery ground dried pepper for soups and rice', 'Spices', 399, 240, 20, 7, 28],
  ['PPR-002', 'Jollof pepper mix 100g', 'Five-pepper blend for party-style jollof rice', 'Spices', 499, 300, 18, 6, 24],
  // ---- More drinks & snacks ----
  ['CHP-002', 'Chapman syrup 750ml', 'Sweet-tart cocktail syrup for a showstopping pitcher of Chapman', 'Beverages', 699, 450, 15, 5, 22],
  ['CHM-001', 'Chocolate malt drink 330ml', 'Chocolate-flavored malt beverage', 'Beverages', 349, 220, 18, 6, 24],
  ['RMC-001', 'Roasted maize (corn) 200g', 'Golden roasted corn kernels for snacking', 'Snacks', 349, 200, 20, 7, 28],
  // ---- Health & Beauty ----
  ['SHE-001', 'Raw shea butter 250g', 'Unrefined shea butter for skin and hair', 'Health & Beauty', 899, 550, 20, 7, 28],
  ['BSO-001', 'African black soap 300g', 'Traditional black soap bar for face and body', 'Health & Beauty', 599, 380, 15, 5, 22],
  ['COC-001', 'Virgin coconut oil 250ml', 'Cold-pressed virgin coconut oil for hair and skin', 'Health & Beauty', 799, 520, 14, 5, 20],
  ['HAI-001', 'Hair & edge growth butter 200g', 'Nourishing butter for natural hair and edges', 'Health & Beauty', 999, 640, 12, 4, 18],
  ['BTR-001', 'Shea & cocoa body butter 200g', 'Whipped shea and cocoa body butter for dry skin', 'Health & Beauty', 899, 580, 15, 5, 22],
];
let added = 0;
for (const [sku, name, description, category, price, cost, stock, level, quantity] of products) {
  added += ins.run(sku, name, description, cats[category], supplier.id, price, cost, stock, level, quantity).changes;
}

// Phase 3 demo data: a primary store location, a welcome automation and a promo code.
if (!db.prepare('SELECT 1 FROM locations WHERE is_primary = 1').get()) {
  db.prepare("INSERT INTO locations (name, address, city, postal_code, country, phone, active, is_primary) VALUES ('Berlin Store', 'Ohlauer Straße 12', 'Berlin', '10999', 'DE', '+49 30 12345678', 1, 1)").run();
}
const welcomeTemplate = db.prepare(
  "INSERT INTO message_templates (name, channel, subject, body) VALUES ('Welcome', 'email', 'Welcome to Afro Mart, {{name}} 🧡', 'Hi {{name}},\\n\\nWelcome to Afro Mart — your neighborhood source for African groceries. Start shopping and get 10% off your first order with code WELCOME10.') ON CONFLICT(name) DO NOTHING").run();
if (welcomeTemplate.changes) {
  const templateId = db.prepare("SELECT id FROM message_templates WHERE name = 'Welcome'").get().id;
  db.prepare("INSERT INTO automations (name, event, template_id, channel, active) VALUES ('Welcome email', 'customer.registered', ?, 'email', 1)").run(templateId);
}
db.prepare("INSERT OR IGNORE INTO promo_codes (code, discount_type, value, min_total_cents, max_uses, active) VALUES ('WELCOME10', 'percent', 10, 2000, 500, 1)").run();

// Phase 3.5: curated meal packs & gift boxes backed by the catalog above.
const skuId = {};
for (const row of db.prepare('SELECT id, sku FROM products').all()) skuId[row.sku] = row.id;
const bundles = [
  {
    sku: 'EGS-BND', name: 'Egusi Soup Starter Kit', type: 'starter_pack', savings: 12,
    description: 'Everything for a rich egusi soup — ground egusi, red palm oil, stockfish, crayfish, spinach and seasonings.',
    items: [['EGU-001', 2], ['PAL-001', 1], ['CRY-001', 1], ['DSP-001', 1], ['DPP-001', 1], ['ONG-001', 1], ['STK-001', 1], ['IRU-001', 1]],
  },
  {
    sku: 'JOL-BND', name: 'Jollof Rice Party Pack', type: 'party_pack', savings: 10,
    description: 'Stock up for the party: perfumed rice, jollof seasoning, pepper mix, crayfish, cubes, palm oil and groundnuts.',
    items: [['RIC-001', 1], ['JOL-001', 2], ['PPR-002', 1], ['CRY-001', 1], ['ONG-001', 2], ['PAL-001', 1], ['GND-001', 1]],
  },
  {
    sku: 'FUF-BND', name: 'Fufu & Ogbono Night In', type: 'meal_pack', savings: 12,
    description: 'A classic draw-soup night: cassava fufu, ogbono, crayfish, pepper, palm oil and stockfish.',
    items: [['FUF-001', 2], ['OGB-001', 1], ['CRY-001', 1], ['DPP-001', 1], ['PAL-001', 1], ['STK-001', 1]],
  },
  {
    sku: 'YAM-BND', name: 'Pounded Yam & Vegetable Pot', type: 'meal_pack', savings: 12,
    description: 'Pounded yam flour with dried oha leaves, iru, crayfish, stockfish and spinach for a hearty vegetable pot.',
    items: [['YAM-002', 2], ['OHA-001', 1], ['IRU-001', 1], ['CRY-001', 1], ['STK-001', 1], ['DSP-001', 1]],
  },
  {
    sku: 'BRK-BND', name: 'Afro Breakfast Box', type: 'gift_box', savings: 10,
    description: 'A cheerful morning box: malt drink, Chapman, chin chin, groundnuts, plantain chips and zobo tea.',
    items: [['MAL-001', 1], ['CHP-001', 1], ['CHI-001', 1], ['GND-001', 1], ['PLC-001', 1], ['HIB-001', 1]],
  },
  {
    sku: 'BRA-BND', name: 'South African Braai & Wine Box', type: 'gift_box', savings: 10,
    description: 'A taste of the garden route: Pinotage, Chenin Blanc, biltong, suya spice and roasted groundnuts.',
    items: [['PIN-001', 1], ['BIL-001', 1], ['SPC-001', 1], ['CHW-001', 1], ['GND-001', 1]],
  },
  {
    sku: 'GHA-BND', name: 'Ghana Banku & Pepper Box', type: 'meal_pack', savings: 12,
    description: 'Banku mix, ground pepper sauce staples, stockfish, dried prawns, crayfish and palm oil.',
    items: [['BNK-001', 2], ['PSP-001', 1], ['STK-001', 1], ['CRY-001', 1], ['SHR-001', 1], ['PAL-001', 1]],
  },
  {
    sku: 'JWAR-BND', name: 'Jollof Rice Wars Box (NG vs GH)', type: 'taste_box', savings: 15,
    description: 'Settle the debate at home: Nigerian-style jollof base, Ghanaian-style jollof base, two rices, pepper and dried prawns.',
    items: [['RIC-001', 1], ['RIC-002', 1], ['JOL-001', 1], ['JOL-002', 1], ['PPR-002', 1], ['SHR-001', 1], ['KNR-001', 1]],
  },
  {
    sku: 'VEG-BND', name: 'Vegan Soups & Stews Box', type: 'meal_pack', savings: 12,
    description: '100% plant-based comfort: egusi, palmnut cream, oha, uziza, dehydrated spinach, palm oil, jollof base and plantain.',
    items: [['EGU-001', 1], ['PNC-001', 1], ['OHA-001', 1], ['UZI-001', 1], ['DSP-001', 1], ['PAL-001', 1], ['JOL-001', 1], ['PLN-001', 1]],
  },
  {
    sku: 'GLW-BND', name: 'Glow Up: Shea & Hair Care Kit', type: 'gift_box', savings: 10,
    description: 'Self-care from the village to your vanity: raw shea, black soap, hair butter, coconut oil and body butter.',
    items: [['SHE-001', 1], ['BSO-001', 1], ['HAI-001', 1], ['COC-001', 1], ['BTR-001', 1]],
  },
];
const insertBundle = db.prepare('INSERT OR IGNORE INTO bundles (sku, name, description, bundle_type, savings_percent, active) VALUES (?,?,?,?,?,1)');
const insertBundleItem = db.prepare('INSERT OR IGNORE INTO bundle_items (bundle_id, product_id, quantity) VALUES (?,?,?)');
let addedBundles = 0;
const skippedBundles = [];
for (const b of bundles) {
  const missing = b.items.filter(([sku]) => !skuId[sku]).map(([sku]) => sku);
  if (missing.length) {
    skippedBundles.push(`${b.sku} (missing: ${missing.join(', ')})`);
    continue;
  }
  let id = db.prepare('SELECT id FROM bundles WHERE sku = ?').get(b.sku)?.id;
  if (!id) {
    id = Number(insertBundle.run(b.sku, b.name, b.description, b.type, b.savings).lastInsertRowid);
    addedBundles++;
  }
  for (const [sku, qty] of b.items) insertBundleItem.run(id, skuId[sku], qty);
}

console.log(`Seeded ${added} new products (${products.length - added} existing SKUs left unchanged).`);
console.log(`Bundles: ${addedBundles} created.${skippedBundles.length ? ` Skipped ${skippedBundles.length} due to missing SKUs: ${skippedBundles.join('; ')}` : ''}`);
