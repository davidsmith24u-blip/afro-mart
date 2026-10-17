// The launch scope (src/launch-scope.js): the public shop is limited to
// Nigeria/Ghana products, three departments stay hidden, staff still see the
// whole catalogue, and ?catalog=all keeps the storefront able to price items
// pulled in through recipes and the assistant.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';

let server, base, db, admin;

async function call(method, path, body, token) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(base + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

const tag = (productId, kind, value) =>
  db.prepare("INSERT INTO product_tags (product_id, kind, value) VALUES (?,?,?)").run(productId, kind, value);

before(async () => {
  db = openDb();
  db.prepare("INSERT INTO users (email,name,password_hash,role) VALUES ('boss@x.com','Boss',?, 'admin')")
    .run(hashPassword('adminpass1'));
  server = createServer(createApp(db, { secret: 'test' }));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  admin = (await call('POST', '/api/auth/login', { email: 'boss@x.com', password: 'adminpass1' })).data.token;

  const dry = (await call('POST', '/api/categories', { name: 'Dry Goods' }, admin)).data;
  const oils = (await call('POST', '/api/categories', { name: 'Oils & Condiments' }, admin)).data;

  const make = async (sku, name, category_id) =>
    (await call('POST', '/api/products', { sku, name, category_id, price_cents: 500, stock: 20 }, admin)).data;

  const ngGarri = await make('NG-1', 'Ijebu Garri', dry.id);
  const ghShito = await make('GH-1', 'Shito Sauce', dry.id);
  const zaBiltong = await make('ZA-1', 'Biltong', dry.id);
  const noOrigin = await make('XX-1', 'Cola', dry.id);
  const ngOil = await make('OIL-1', 'Red Palm Oil', oils.id);

  tag(ngGarri.id, 'origin', 'NG');
  tag(ghShito.id, 'origin', 'GH');
  tag(zaBiltong.id, 'origin', 'ZA');
  tag(ngOil.id, 'origin', 'NG');
});

after(() => server.close());

test('launch scope: shop grid only shows in-scope products', async () => {
  const shop = (await call('GET', '/api/products')).data.map((p) => p.sku).sort();
  assert.deepEqual(shop, ['GH-1', 'NG-1', 'XX-1']);

  // Staff keep the whole catalogue.
  const staff = (await call('GET', '/api/products', undefined, admin)).data.map((p) => p.sku).sort();
  assert.deepEqual(staff, ['GH-1', 'NG-1', 'OIL-1', 'XX-1', 'ZA-1']);
});

test('launch scope: ?catalog=all returns the full active catalogue', async () => {
  const all = (await call('GET', '/api/products?catalog=all')).data.map((p) => p.sku).sort();
  assert.deepEqual(all, ['GH-1', 'NG-1', 'OIL-1', 'XX-1', 'ZA-1']);
});

test('launch scope: hidden department is absent from the public list', async () => {
  const publicCats = (await call('GET', '/api/categories')).data.map((c) => c.name).sort();
  assert.deepEqual(publicCats, ['Dry Goods']);

  const staffCats = (await call('GET', '/api/categories', undefined, admin)).data.map((c) => c.name).sort();
  assert.deepEqual(staffCats, ['Dry Goods', 'Oils & Condiments']);
});

test('launch scope: an explicit origin filter cannot leak other regions', async () => {
  const za = (await call('GET', '/api/products?origin=ZA')).data;
  assert.equal(za.length, 0);
});

test('launch scope: discovery facet counts respect the scope', async () => {
  const facets = (await call('GET', '/api/discovery/facets')).data;
  const origins = Object.fromEntries(facets.origins.map((o) => [o.value, o.count]));
  assert.equal(origins.NG, 1); // the GH product has no facet overlap issue
  assert.equal(origins.GH, 1);
  assert.equal(origins.ZA, undefined);

  const staffFacets = (await call('GET', '/api/discovery/facets', undefined, admin)).data;
  assert.ok(staffFacets.origins.find((o) => o.value === 'ZA'));
});
