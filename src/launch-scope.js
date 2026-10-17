// Storefront "launch scope".
//
// While we build out the full range, the shop only sells Nigerian and Ghanaian
// goods. Products with no country tag stay in (the international soft drinks,
// energy drinks and nectars that every household here buys), and three
// departments are parked for now.
//
// This is a *read-time* filter: nothing is deleted, staff still see and manage
// the whole catalogue, and widening the range again is a one-line change here.

export const ACTIVE_ORIGIN_CODES = ['NG', 'GH'];
export const HIDDEN_CATEGORY_NAMES = ['Fresh Produce', 'Health & Beauty', 'Oils & Condiments'];

const sqlList = (values) => values.map((value) => `'${String(value).replace(/'/g, "''")}'`).join(', ');

// `p` is the products alias, `c` the (LEFT JOINed) categories alias.
export const ORIGIN_IN_SCOPE_SQL =
  `NOT EXISTS (SELECT 1 FROM product_tags scope_tag WHERE scope_tag.product_id = p.id ` +
  `AND scope_tag.kind = 'origin' AND scope_tag.value NOT IN (${sqlList(ACTIVE_ORIGIN_CODES)}))`;

export const CATEGORY_IN_SCOPE_SQL = `c.name NOT IN (${sqlList(HIDDEN_CATEGORY_NAMES)})`;

export const IN_SCOPE_SQL =
  `${ORIGIN_IN_SCOPE_SQL} AND (c.name IS NULL OR ${CATEGORY_IN_SCOPE_SQL})`;
