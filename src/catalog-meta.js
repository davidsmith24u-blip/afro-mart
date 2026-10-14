// Discovery metadata for the catalog: origin country, cuisine, dietary tags
// and a 0-5 spice level. Kept as explicit data plus a couple of small rules so
// the storefront can offer "shop by country / cuisine", dietary filters and a
// heat dial that generic grocery stores simply do not have.

export const ORIGIN_LABELS = {
  NG: 'Nigeria',
  GH: 'Ghana',
  SN: 'Senegal',
  CM: 'Cameroon',
  CD: 'DR Congo',
  ET: 'Ethiopia',
  KE: 'Kenya',
  SO: 'Somalia',
  ZA: 'South Africa',
};

export const CUISINE_LABELS = {
  nigerian: 'Nigerian',
  ghanaian: 'Ghanaian',
  senegalese: 'Senegalese',
  cameroonian: 'Cameroonian',
  congolese: 'Congolese',
  ethiopian: 'Ethiopian',
  kenyan: 'Kenyan',
  somali: 'Somali',
  'south-african': 'South African',
  'west-african': 'West African',
  'east-african': 'East African',
  'central-african': 'Central African',
  'southern-african': 'Southern African',
};

export const DIET_LABELS = {
  vegan: 'Vegan',
  vegetarian: 'Vegetarian',
  'gluten-free': 'Gluten-free',
  halal: 'Halal',
};

const CUISINES_BY_ORIGIN = {
  NG: ['nigerian', 'west-african'],
  GH: ['ghanaian', 'west-african'],
  SN: ['senegalese', 'west-african'],
  CM: ['cameroonian', 'central-african'],
  CD: ['congolese', 'central-african'],
  ET: ['ethiopian', 'east-african'],
  KE: ['kenyan', 'east-african'],
  SO: ['somali', 'east-african'],
  ZA: ['south-african', 'southern-african'],
};

// Non-regional brands (big international sodas/energy drinks) carry no
// country or cuisine so they do not distort the "shop by country" facets.
const GLOBAL_SKUS = new Set([
  'COL-001', 'PEP-001B', 'FAN-001', 'SPR-001', 'MIR-001',
  'RED-001', 'MON-001', 'POW-001', 'MAN-001', 'CHM-001',
]);

// Products whose home kitchen differs from the West African default.
const ORIGIN_BY_SKU = {
  'MAI-001': 'ZA', 'BIL-001': 'ZA', 'PIN-001': 'ZA', 'CHW-001': 'ZA', 'SHI-001': 'ZA',
  'CHA-001': 'ZA', 'ROO-001': 'ZA',
  'TEF-001': 'ET', 'BER-001': 'ET', 'SHR-002': 'ET',
  'MLP-001': 'GH', 'BNK-001': 'GH', 'KOL-001': 'GH',
  'CAS-001': 'CD',
  'TAM-001': 'SN', 'YAS-001': 'SN',
  'PIL-001': 'KE', 'KEN-001': 'KE',
  'SHH-001': 'SO',
  'NDL-001': 'CM',
};

// 0 (mild) to 5 (fiery). Anything not listed falls back to the category
// default below so mild staples stay at 0.
const SPICE_OVERRIDES = {
  'PEP-001': 5, 'DPP-001': 5, 'AGR-001': 5, 'NGM-001': 5, 'ATA-001': 5,
  'SUY-001': 4,
  'SPC-001': 4, 'PSP-001': 4, 'BER-001': 4, 'UDA-001': 4, 'EHX-001': 4,
  'NZS-001': 4, 'OFA-001': 4, 'PPR-002': 4, 'PIL-001': 4, 'KEN-001': 4, 'YAS-001': 4,
  'JOL-001': 3, 'JOL-002': 3, 'EGM-001': 3, 'CRY-001': 3, 'CRY-002': 3,
  'UZI-001': 3, 'UTZ-001': 3, 'CHA-001': 3,
  'SHR-002': 2, 'NDL-001': 2, 'GING-001': 2,
  'OHA-001': 1, 'BTL-001': 1, 'WTL-001': 1, 'OKP-001': 1, 'SCL-001': 1,
  'TTS-001': 1, 'OKR-001': 1, 'GG-001': 1, 'KOL-001': 1, 'ZOB-001': 1,
};

const SPICE_BY_CATEGORY = { Spices: 3, 'Fresh Produce': 1 };

// Animal products are not vegan/vegetarian (keyword match on the product name).
const ANIMAL_RE = /crayfish|prawn|catfish|croaker|stockfish|snail|ponmo|cow foot|nkwobi|goat|snapper|sardine|biltong|kilishi|dambun|nama|chicken|beef|pork|fish|meat|shrimp|turkey|lamb|cheese|wara/i;

// Wheat/malt products are not gluten-free.
const GLUTEN_RE = /semovita|semolina|wheat|chin chin|puff puff|malt|barley|\bbread\b|pasta|noodle/i;

// Alcohol is the only thing we exclude from the broad "halal-friendly" tag.
const ALCOHOL_SKUS = new Set(['PIN-001', 'CHW-001', 'SHI-001']);

export function classifyProduct(product) {
  const sku = product.sku;
  const origin = GLOBAL_SKUS.has(sku) ? null : (ORIGIN_BY_SKU[sku] || 'NG');
  const cuisines = origin ? (CUISINES_BY_ORIGIN[origin] || []) : [];
  const diet = [];
  if (!ANIMAL_RE.test(product.name)) diet.push('vegan', 'vegetarian');
  if (!GLUTEN_RE.test(product.name)) diet.push('gluten-free');
  if (!ALCOHOL_SKUS.has(sku)) diet.push('halal');
  const spice = SPICE_OVERRIDES[sku] ?? SPICE_BY_CATEGORY[product.category] ?? 0;
  return { origin, cuisines, diet, spice };
}

// A wholesale (restaurant / B2B) price: comfortably above cost, below retail,
// rounded to a tidy five cents.
export function wholesalePriceCents(priceCents, costCents) {
  const cost = costCents ?? 0;
  const target = Math.max(Math.round(cost * 1.12), Math.round(priceCents * 0.82));
  const capped = Math.min(priceCents - 5, target);
  return Math.max(0, Math.round(capped / 5) * 5);
}

export const BUNDLE_SERVES = {
  'EGS-BND': 4, 'JOL-BND': 12, 'FUF-BND': 4, 'YAM-BND': 4, 'BRK-BND': 2,
  'BRA-BND': 4, 'GHA-BND': 6, 'JWAR-BND': 8, 'VEG-BND': 4, 'GLW-BND': 1,
  'STU-BND': 2, 'FAM-BND': 8, 'XMS-BND': 6, 'HMP-BND': 4, 'NYC-BND': 6,
};
export const DEFAULT_SERVES_BY_TYPE = { party_pack: 10, meal_pack: 4, starter_pack: 4, gift_box: 2, taste_box: 6 };
export function servesForBundle(sku, type) {
  return BUNDLE_SERVES[sku] ?? DEFAULT_SERVES_BY_TYPE[type] ?? 0;
}

export function applyProductMeta(db, product, opts = {}) {
  const preserve = opts.preserve ?? false;
  const meta = classifyProduct({ sku: product.sku, name: product.name, category: product.category ?? product.category_name });
  const prod = db.prepare('SELECT spice_level, wholesale_price_cents FROM products WHERE id = ?').get(product.id);
  if (!preserve || prod.spice_level === 0) {
    db.prepare('UPDATE products SET spice_level = ? WHERE id = ?').run(meta.spice, product.id);
  }
  if (!preserve || prod.wholesale_price_cents == null) {
    db.prepare('UPDATE products SET wholesale_price_cents = ? WHERE id = ?')
      .run(wholesalePriceCents(product.price_cents, product.cost_cents ?? 0), product.id);
  }
  if (preserve) {
    return meta;
  }
  const del = db.prepare('DELETE FROM product_tags WHERE product_id = ?');
  const ins = db.prepare('INSERT OR IGNORE INTO product_tags (product_id, kind, value) VALUES (?,?,?)');
  del.run(product.id);
  for (const c of meta.cuisines) ins.run(product.id, 'cuisine', c);
  for (const d of meta.diet) ins.run(product.id, 'diet', d);
  if (meta.origin) ins.run(product.id, 'origin', meta.origin);
  return meta;
}

export function syncCatalogMeta(db) {
  const products = db.prepare(
    `SELECT p.id, p.sku, p.name, p.price_cents, p.cost_cents, c.name AS category
     FROM products p LEFT JOIN categories c ON c.id = p.category_id
     WHERE NOT EXISTS (SELECT 1 FROM product_tags t WHERE t.product_id = p.id)`).all();
  for (const p of products) applyProductMeta(db, p, { preserve: false });
  const bundles = db.prepare('SELECT id, sku, bundle_type FROM bundles WHERE serves = 0').all();
  const upd = db.prepare('UPDATE bundles SET serves = ? WHERE id = ?');
  for (const b of bundles) upd.run(servesForBundle(b.sku, b.bundle_type), b.id);
  return { products: products.length, bundles: bundles.length };
}
