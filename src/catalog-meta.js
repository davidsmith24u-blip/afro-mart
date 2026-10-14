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
  'PEP-001': 5, 'DPP-001': 5, 'AGR-001': 5, 'NGM-001': 5,
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
const ANIMAL_RE = /crayfish|prawn|catfish|croaker|stockfish|snail|ponmo|cow foot|nkwobi|goat|snapper|sardine|biltong|kilishi|dambun|nama|chicken|beef|pork|fish|meat|shrimp|turkey|lamb/i;

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
  const target = Math.max(Math.round(costCents * 1.12), Math.round(priceCents * 0.82));
  const capped = Math.min(priceCents - 5, target);
  return Math.max(0, Math.round(capped / 5) * 5);
}
