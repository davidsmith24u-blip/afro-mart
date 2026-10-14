// Tests for the "stand out" round: diaspora discovery & search, party/catering
// and wholesale, and the global-reach config (currencies).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { expandQuery } from '../src/discovery.js';
import { classifyProduct, wholesalePriceCents } from '../src/catalog-meta.js';
import { currencyList, BASE_CURRENCY } from '../src/currencies.js';

let server, base, db;
before(async () => {
  db = openDb();
  db.prepare("INSERT INTO users (email,name,password_hash,role) VALUES ('boss@x.com','Boss',?, 'admin')").run(hashPassword('adminpass1'));
  server = createServer(createApp(db, { secret: 'test' }));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

async function call(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const login = async () => (await call('POST', '/api/auth/login', { email: 'boss@x.com', password: 'adminpass1' })).data.token;

async function makeProduct(admin, sku, name, price, extra = {}) {
  const category = (await call('POST', '/api/categories', { name: `C-${sku}` }, admin)).data;
  return (await call('POST', '/api/products', {
    sku, name, price_cents: price, cost_cents: Math.floor(price / 2), stock: 100,
    category_id: category.id, ...extra,
  }, admin)).data;
}

const tag = (id, kind, value) => db.prepare('INSERT INTO product_tags (product_id, kind, value) VALUES (?,?,?)').run(id, kind, value);
const setSpice = (id, level) => db.prepare('UPDATE products SET spice_level = ? WHERE id = ?').run(level, id);
const setWholesale = (id, cents) => db.prepare('UPDATE products SET wholesale_price_cents = ? WHERE id = ?').run(cents, id);

test('discovery: local-name aliases expand to catalogue terms', () => {
  const rodo = expandQuery('ata rodo');
  assert.ok(rodo.terms.includes('scotch bonnet'));
  assert.ok(expandQuery('semo').terms.includes('semovita'));
  assert.ok(expandQuery('bissap').terms.includes('hibiscus'));
  assert.ok(expandQuery('ugwu').terms.includes('spinach'));
  assert.ok(expandQuery('ndole').terms.includes('bitterleaf'));
  // A country or cuisine typed into search is recognised as a facet.
  assert.equal(expandQuery('Kenya').origin, 'KE');
  assert.ok(expandQuery('Ghanaian').cuisines.includes('ghanaian'));
  // Unknown queries still search their own text.
  assert.deepEqual(expandQuery('jollof').terms, ['jollof']);
});

test('catalog-meta: classification and wholesale pricing', () => {
  const pepper = classifyProduct({ sku: 'PEP-001', name: 'Scotch bonnet peppers 200g', category: 'Fresh Produce' });
  assert.equal(pepper.origin, 'NG');
  assert.ok(pepper.cuisines.includes('nigerian'));
  assert.equal(pepper.spice, 5);
  assert.ok(pepper.diet.includes('vegan') && pepper.diet.includes('halal'));

  const goat = classifyProduct({ sku: 'GOA-001', name: 'Frozen goat meat 1kg', category: 'Meat & Fish' });
  assert.equal(goat.diet.includes('vegan'), false);
  assert.ok(goat.diet.includes('halal'));

  const wine = classifyProduct({ sku: 'PIN-001', name: 'South African Pinotage 750ml', category: 'Beverages' });
  assert.equal(wine.origin, 'ZA');
  assert.equal(wine.diet.includes('halal'), false);

  assert.equal(classifyProduct({ sku: 'COL-001', name: 'Coca-Cola 330ml', category: 'Beverages' }).origin, null);
  // Dried breadfruit must not be caught by the "bread" keyword.
  assert.ok(classifyProduct({ sku: 'UKW-001', name: 'Dried ukwa (African breadfruit) 500g', category: 'Dry Goods' }).diet.includes('gluten-free'));

  const wholesale = wholesalePriceCents(1000, 500);
  assert.ok(wholesale < 1000 && wholesale >= 500);
});

test('discovery: search finds products by local name and by cuisine', async () => {
  const admin = await login();
  const pepper = await makeProduct(admin, 'DSC-PEP', 'Scotch bonnet peppers 200g', 400);
  const semo = await makeProduct(admin, 'DSC-SEM', 'Semovita (wheat swallow) 2kg', 800);
  const jollofGhana = await makeProduct(admin, 'DSC-GHA', 'Ghanaian jollof base 100g', 500);
  tag(pepper.id, 'cuisine', 'nigerian');
  tag(semo.id, 'cuisine', 'nigerian');
  tag(jollofGhana.id, 'cuisine', 'ghanaian');

  const byAlias = (await call('GET', '/api/products?q=ata%20rodo')).data;
  assert.ok(byAlias.some((p) => p.id === pepper.id));
  assert.equal(byAlias.some((p) => p.id === semo.id), false);

  const bySemo = (await call('GET', '/api/products?q=semo')).data;
  assert.ok(bySemo.some((p) => p.id === semo.id));

  const byCuisineWord = (await call('GET', '/api/products?q=Ghanaian')).data;
  assert.ok(byCuisineWord.some((p) => p.id === jollofGhana.id));
  assert.equal(byCuisineWord.some((p) => p.id === pepper.id), false);
});

test('discovery: facet filters and facets endpoint', async () => {
  const admin = await login();
  const veganMild = await makeProduct(admin, 'FAC-1', 'Mild vegan item', 300);
  const veganHot = await makeProduct(admin, 'FAC-2', 'Hot vegan item', 300);
  const meat = await makeProduct(admin, 'FAC-3', 'Meaty item', 300);
  for (const p of [veganMild, veganHot, meat]) tag(p.id, 'origin', 'NG');
  tag(veganMild.id, 'diet', 'vegan');
  tag(veganHot.id, 'diet', 'vegan');
  tag(veganHot.id, 'diet', 'gluten-free');
  tag(meat.id, 'diet', 'halal');
  setSpice(veganMild.id, 1);
  setSpice(veganHot.id, 5);
  setSpice(meat.id, 2);

  const vegan = (await call('GET', '/api/products?diet=vegan')).data;
  assert.ok(vegan.some((p) => p.id === veganMild.id) && vegan.some((p) => p.id === veganHot.id));
  assert.equal(vegan.some((p) => p.id === meat.id), false);

  // Multiple diets are ANDed: vegan AND gluten-free leaves only the hot item.
  const both = (await call('GET', '/api/products?diet=vegan,gluten-free')).data;
  assert.deepEqual(both.filter((p) => [veganMild.id, veganHot.id, meat.id].includes(p.id)).map((p) => p.id), [veganHot.id]);

  const mild = (await call('GET', '/api/products?max_spice=1')).data;
  assert.ok(mild.some((p) => p.id === veganMild.id));
  assert.equal(mild.some((p) => p.id === veganHot.id), false);

  const spicyFirst = (await call('GET', '/api/products?sort=spice')).data;
  assert.ok(spicyFirst.findIndex((p) => p.id === veganHot.id) < spicyFirst.findIndex((p) => p.id === meat.id));

  const facets = (await call('GET', '/api/discovery/facets')).data;
  assert.ok(facets.origins.find((o) => o.value === 'NG').count >= 3);
  assert.ok(facets.diets.find((d) => d.value === 'vegan').count >= 2);
  assert.ok(facets.spice_levels.some((s) => s.level === 5 && s.count >= 1));
});

test('discovery: product payload carries tags and spice level', async () => {
  const admin = await login();
  const p = await makeProduct(admin, 'PAYLOAD-1', 'Tagged item', 500);
  tag(p.id, 'origin', 'ET');
  tag(p.id, 'cuisine', 'ethiopian');
  tag(p.id, 'diet', 'vegan');
  setSpice(p.id, 4);
  const fetched = (await call('GET', `/api/products/${p.id}`)).data;
  assert.equal(fetched.spice_level, 4);
  assert.equal(fetched.origin, 'ET');
  assert.equal(fetched.origin_label, 'Ethiopia');
  assert.deepEqual(fetched.cuisines, ['ethiopian']);
  assert.deepEqual(fetched.cuisine_labels, ['Ethiopian']);
  assert.ok(fetched.diets.includes('vegan'));
});

test('catering: scale a recipe to any number of guests', async () => {
  const admin = await login();
  const spice = await makeProduct(admin, 'SC-SPICE', 'Spice', 400);
  const rice = await makeProduct(admin, 'SC-RICE', 'Rice', 250);
  const recipe = (await call('POST', '/api/recipes', {
    title: 'Scalable jollof', servings: 6, prep_minutes: 45,
    ingredients: [{ product_id: spice.id, quantity: 2 }, { product_id: rice.id, quantity: 3 }],
  }, admin)).data;
  // base: 400*2 + 250*3 = 1550
  const scaled = (await call('GET', `/api/recipes/${recipe.id}/scale?guests=18`)).data;
  assert.equal(scaled.guests, 18);
  assert.equal(scaled.multiplier, 3);
  const spiceLine = scaled.ingredients.find((i) => i.id === spice.id);
  assert.equal(spiceLine.quantity, 6);
  assert.equal(scaled.total_cents, 400 * 6 + 250 * 9);
  assert.equal(scaled.per_guest_cents, Math.round(scaled.total_cents / 18));
  // A fractional multiplier rounds the line quantity up.
  const small = (await call('GET', `/api/recipes/${recipe.id}/scale?guests=4`)).data;
  assert.equal(small.ingredients.find((i) => i.id === rice.id).quantity, 2);
  assert.equal((await call('GET', '/api/recipes/99999/scale?guests=10')).status, 404);
});

test('catering: party packs cover a headcount', async () => {
  const admin = await login();
  const rice = await makeProduct(admin, 'PP-RICE', 'Party rice', 1000);
  const pack = (await call('POST', '/api/bundles', {
    sku: 'PP-PACK', name: 'Party pack of 10', bundle_type: 'party_pack', savings_percent: 10, serves: 10,
    items: [{ product_id: rice.id, quantity: 5 }],
  }, admin)).data;
  assert.equal(pack.serves, 10);

  const party = (await call('GET', '/api/catering/party?guests=25')).data;
  assert.equal(party.guests, 25);
  const suggestion = party.suggestions.find((s) => s.id === pack.id);
  assert.equal(suggestion.packs_needed, 3);
  assert.equal(suggestion.total_price_cents, pack.price_cents * 3);
});

test('catering: quote requests are public to file and staff-only to manage', async () => {
  const admin = await login();
  const created = await call('POST', '/api/quotes', {
    name: 'Ada', email: 'ada@x.com', phone: '+49 30 1', guests: 120,
    event_date: '2026-06-01', fulfillment: 'delivery', message: 'Wedding jollof for 120',
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.status, 'requested');
  assert.equal(created.data.guests, 120);

  assert.equal((await call('GET', '/api/quotes')).status, 401);
  const list = (await call('GET', '/api/quotes', null, admin)).data;
  assert.ok(list.some((q) => q.id === created.data.id));

  const updated = (await call('PATCH', `/api/quotes/${created.data.id}`, {
    status: 'quoted', quoted_cents: 45000, staff_note: 'Includes delivery',
  }, admin)).data;
  assert.equal(updated.status, 'quoted');
  assert.equal(updated.quoted_cents, 45000);

  assert.equal((await call('PATCH', `/api/quotes/${created.data.id}`, { status: 'nope' }, admin)).status, 400);
  assert.equal((await call('PATCH', `/api/quotes/${created.data.id}`, { status: 'quoted' })).status, 401);
});

test('wholesale: restaurant accounts see and are charged wholesale prices', async () => {
  const admin = await login();
  const product = await makeProduct(admin, 'WS-1', 'Bulk rice', 1000);
  setWholesale(product.id, 800);

  const registered = await call('POST', '/api/auth/register', { email: 'chef@x.com', name: 'Chef', password: 'password1' });
  const chef = registered.data.token;
  assert.equal(registered.data.user.account_type, 'retail');
  const chefId = registered.data.user.id;

  // A retail shopper sees the retail price only.
  const retail = (await call('GET', `/api/products/${product.id}`, null, chef)).data;
  assert.equal(retail.is_wholesale, undefined);
  assert.equal(retail.wholesale_price_cents, undefined);

  // Promote to a restaurant account (staff action).
  assert.equal((await call('PATCH', `/api/customers/${chefId}/account-type`, { account_type: 'restaurant' })).status, 401);
  assert.equal((await call('PATCH', `/api/customers/${chefId}/account-type`, { account_type: 'restaurant' }, admin)).data.account_type, 'restaurant');

  const wholesale = (await call('GET', `/api/products/${product.id}`, null, chef)).data;
  assert.equal(wholesale.is_wholesale, true);
  assert.equal(wholesale.effective_price_cents, 800);

  // The order is charged the wholesale unit price.
  const order = (await call('POST', '/api/orders', {
    fulfillment: 'pickup', items: [{ product_id: product.id, quantity: 2 }],
  }, chef)).data;
  assert.equal(order.total_cents, 1600);
  assert.equal(order.items[0].unit_price_cents, 800);
});

test('global reach: config exposes base currency and display currencies', async () => {
  const config = (await call('GET', '/api/config')).data;
  assert.equal(config.base_currency, BASE_CURRENCY);
  assert.equal(config.currency, 'EUR');
  const eur = config.currencies.find((c) => c.code === 'EUR');
  assert.equal(eur.rate, 1);
  assert.ok(config.currencies.find((c) => c.code === 'GBP'));
  assert.equal(currencyList().length, config.currencies.length);
  assert.deepEqual(config.facets.cuisines.nigerian, 'Nigerian');
});
