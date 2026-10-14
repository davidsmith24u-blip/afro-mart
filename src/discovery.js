// Diaspora-aware discovery: local-name search aliases, faceted browsing
// (origin / cuisine / diet / heat) and tag hydration for product payloads.

import { ORIGIN_LABELS, CUISINE_LABELS, DIET_LABELS } from './catalog-meta.js';

export { ORIGIN_LABELS, CUISINE_LABELS, DIET_LABELS };

export const SPICE_LABELS = ['Mild', 'Gentle', 'Medium', 'Spicy', 'Hot', 'Fiery'];

// Local, regional and misspelled names mapped to a canonical catalogue term.
// e.g. "ata rodo" -> "scotch bonnet", "semo" -> "semovita", "bissap" -> hibiscus.
export const LOCAL_ALIASES = {
  // cassava & swallows
  gari: 'garri', garri: 'garri', eba: 'garri', ijebu: 'garri', tapioca: 'garri',
  semo: 'semovita', semolina: 'semovita', semovita: 'semovita',
  fufu: 'fufu', lafun: 'fufu', 'cassava fufu': 'fufu',
  amala: 'yam flour', elubo: 'yam flour', iyan: 'pounded yam', 'pounded yam': 'pounded yam',
  // egusi family & beans
  egusi: 'egusi', agusi: 'egusi', melon: 'egusi',
  ogbono: 'ogbono', apon: 'ogbono',
  ewa: 'beans', oloyin: 'honey beans', agoyin: 'beans', 'ewa agoyin': 'beans',
  'moi moi': 'moi moi', moimoi: 'moi moi', akara: 'akara', gbegiri: 'gbegiri',
  // peppers & grilled spice
  'ata rodo': 'scotch bonnet', atarodo: 'scotch bonnet', rodo: 'scotch bonnet', 'bonnet': 'scotch bonnet',
  shombo: 'tatashe', tatashe: 'tatashe', tatase: 'tatashe', kayanmiya: 'pepper',
  yaji: 'suya', suya: 'suya', tsire: 'suya', kilishi: 'kilishi', dambu: 'dambun nama', balangu: 'suya',
  // greens & herbs
  ugwu: 'spinach', ugu: 'spinach', efo: 'spinach', spinach: 'spinach',
  ewedu: 'ewedu', 'jute': 'ewedu', gbure: 'waterleaf', waterleaf: 'waterleaf', shoko: 'waterleaf',
  efinrin: 'scent leaf', nchanwu: 'scent leaf', 'scent leaf': 'scent leaf',
  afang: 'okazi', okazi: 'okazi', utazi: 'utazi', nsala: 'utazi',
  bitterleaf: 'bitterleaf', onugbu: 'bitterleaf', ndole: 'bitterleaf',
  oha: 'oha', uziza: 'uziza', okro: 'okra', okra: 'okra',
  // drinks & porridge
  zobo: 'hibiscus', sobolo: 'hibiscus', bissap: 'hibiscus', hibiscus: 'hibiscus',
  kunu: 'millet', kunun: 'millet', koko: 'pap', ogi: 'pap', akamu: 'pap', pap: 'pap', uji: 'pap',
  'tiger nut': 'tigernut', tigernut: 'tigernut', aya: 'tigernut', atadwe: 'tigernut', 'tiger nuts': 'tigernut',
  kola: 'kola', goro: 'kola', chapman: 'chapman', malt: 'malt',
  // East, West & Southern Africa
  injera: 'teff', teff: 'teff', shiro: 'shiro', berbere: 'berbere',
  pilau: 'pilau', sukuma: 'spinach', yassa: 'yassa', thieb: 'jollof', ceebu: 'jollof', jollof: 'jollof',
  waakye: 'waakye', kenkey: 'banku', banku: 'banku', komi: 'banku',
  ugali: 'maize', nsima: 'maize', sadza: 'maize', nshima: 'maize', 'maize meal': 'maize',
  chakalaka: 'chakalaka', rooibos: 'rooibos', braai: 'braai', biltong: 'biltong',
  shaah: 'tea', chai: 'tea',
  // pantry
  ponmo: 'ponmo', kpomo: 'ponmo', wele: 'ponmo', shaki: 'tripe',
  crayfish: 'crayfish', cray: 'crayfish', stockfish: 'stockfish', panla: 'stockfish', 'dry cod': 'stockfish',
  iru: 'iru', dawadawa: 'iru', ogiri: 'iru', 'locust bean': 'iru',
  'palm oil': 'palm oil', zomi: 'palm oil', banga: 'palm fruit', palmnut: 'palmnut',
  shea: 'shea', ori: 'shea', 'black soap': 'black soap', osu: 'black soap', 'shea butter': 'shea',
};

const MULTIWORD_ALIASES = Object.keys(LOCAL_ALIASES).filter((key) => key.includes(' '));

// Expand a user query into the raw phrase plus every canonical alias so that
// "ata rodo" and "scotch bonnet" reach the same products. Also recognises a
// country or cuisine name typed straight into the search box.
export function expandQuery(raw) {
  const q = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return { query: '', terms: [], origin: null, cuisines: [] };
  const terms = new Set([q]);
  for (const alias of MULTIWORD_ALIASES) if (q.includes(alias)) terms.add(LOCAL_ALIASES[alias]);
  for (const word of q.split(/[^a-z0-9]+/).filter(Boolean)) {
    if (LOCAL_ALIASES[word]) terms.add(LOCAL_ALIASES[word]);
  }
  const compact = q.replace(/[^a-z0-9]/g, '');
  let origin = null;
  const cuisines = [];
  for (const [code, label] of Object.entries(ORIGIN_LABELS)) {
    if (q === label.toLowerCase() || compact === label.toLowerCase().replace(/[^a-z0-9]/g, '')) origin = code;
  }
  for (const [key, label] of Object.entries(CUISINE_LABELS)) {
    if (q === label.toLowerCase() || compact === label.toLowerCase().replace(/[^a-z0-9]/g, '')) cuisines.push(key);
  }
  return { query: q, terms: [...terms], origin, cuisines };
}

// Attach origin / cuisine / diet tags to a list of product rows.
export function attachTags(db, rows) {
  if (!rows.length) return rows;
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(',');
  const tagRows = db
    .prepare(`SELECT product_id, kind, value FROM product_tags WHERE product_id IN (${placeholders})`)
    .all(...ids);
  const bucket = new Map(rows.map((row) => [row.id, { origin: null, cuisines: [], diets: [] }]));
  for (const tag of tagRows) {
    const entry = bucket.get(tag.product_id);
    if (!entry) continue;
    if (tag.kind === 'origin') entry.origin = tag.value;
    else if (tag.kind === 'cuisine') entry.cuisines.push(tag.value);
    else if (tag.kind === 'diet') entry.diets.push(tag.value);
  }
  for (const row of rows) {
    const entry = bucket.get(row.id);
    row.origin = entry.origin;
    row.origin_label = entry.origin ? ORIGIN_LABELS[entry.origin] || entry.origin : null;
    row.cuisines = entry.cuisines.sort();
    row.cuisine_labels = row.cuisines.map((value) => CUISINE_LABELS[value] || value);
    row.diets = entry.diets.sort();
  }
  return rows;
}

export function registerDiscoveryRoutes(api) {
  const { route, all } = api;

  route('GET', '/api/discovery/facets', () => {
    const facetList = (kind, labels) =>
      all(
        `SELECT t.value, COUNT(*) AS count
         FROM product_tags t JOIN products p ON p.id = t.product_id
         WHERE t.kind = ? AND p.active = 1
         GROUP BY t.value ORDER BY count DESC, t.value`,
        kind,
      ).map((row) => ({ value: row.value, label: labels[row.value] || row.value, count: row.count }));

    const spiceLevels = all(
      `SELECT spice_level AS level, COUNT(*) AS count FROM products WHERE active = 1
       GROUP BY spice_level ORDER BY spice_level`,
    ).map((row) => ({ level: row.level, label: SPICE_LABELS[row.level] || String(row.level), count: row.count }));

    return {
      origins: facetList('origin', ORIGIN_LABELS),
      cuisines: facetList('cuisine', CUISINE_LABELS),
      diets: facetList('diet', DIET_LABELS),
      spice_levels: spiceLevels,
    };
  });

  return api;
}
