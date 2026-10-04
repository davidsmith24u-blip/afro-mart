import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';

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

test('full shop flow: catalog, order, stock, loyalty, reorder, reports', async () => {
  const admin = (await call('POST', '/api/auth/login', { email: 'boss@x.com', password: 'adminpass1' })).data.token;
  const cat = (await call('POST', '/api/categories', { name: 'Dry Goods' }, admin)).data;
  const sup = (await call('POST', '/api/suppliers', { name: 'Lagos Foods' }, admin)).data;
  const prod = (await call('POST', '/api/products', {
    sku: 'GAR-1', name: 'Garri', price_cents: 1000, cost_cents: 600, stock: 12,
    reorder_level: 5, reorder_quantity: 30, category_id: cat.id, supplier_id: sup.id,
  }, admin)).data;
  assert.equal(prod.stock, 12);

  const reg = await call('POST', '/api/auth/register', { email: 'a@b.com', name: 'Ama', password: 'password1' });
  assert.equal(reg.status, 201);
  const cust = reg.data.token;
  assert.equal(reg.data.user.role, 'customer');
  assert.equal((await call('POST', '/api/auth/register', { email: 'a@b.com', name: 'Ama', password: 'password1' })).status, 409);

  assert.equal((await call('GET', '/api/products')).data.length, 1);
  assert.equal((await call('GET', '/api/products')).data[0].cost_cents, undefined);

  const over = await call('POST', '/api/orders', { shipping_address: 'x', items: [{ product_id: prod.id, quantity: 99 }] }, cust);
  assert.equal(over.status, 409);

  const ord = await call('POST', '/api/orders', { shipping_address: '1 Main St', items: [{ product_id: prod.id, quantity: 8 }] }, cust);
  assert.equal(ord.status, 201);
  assert.equal(ord.data.total_cents, 8000);
  assert.equal((await call('GET', '/api/me', null, cust)).data.loyalty_points, 80);

  assert.equal((await call('GET', '/api/inventory/low-stock', null, cust)).status, 403);
  assert.equal((await call('GET', '/api/inventory/low-stock', null, admin)).data.length, 1);

  const re = await call('POST', '/api/inventory/reorder', null, admin);
  assert.equal(re.data.purchase_order_ids.length, 1);
  assert.deepEqual((await call('POST', '/api/inventory/reorder', null, admin)).data.purchase_order_ids, []);
  const rec = await call('POST', `/api/purchase-orders/${re.data.purchase_order_ids[0]}/receive`, null, admin);
  assert.equal(rec.data.status, 'received');
  assert.equal((await call('POST', `/api/purchase-orders/${rec.data.id}/receive`, null, admin)).status, 409);
  assert.equal((await call('GET', `/api/products/${prod.id}`)).data.stock, 34);

  const rep = (await call('GET', '/api/reports/summary', null, admin)).data;
  assert.equal(rep.revenue_cents, 8000);
  assert.equal(rep.estimated_profit_cents, 3200);

  await call('PATCH', `/api/orders/${ord.data.id}/status`, { status: 'cancelled' }, admin);
  assert.equal((await call('GET', `/api/products/${prod.id}`)).data.stock, 42);
  assert.equal((await call('GET', '/api/me', null, cust)).data.loyalty_points, 0);
});

test('auth and validation', async () => {
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { email: 'boss@x.com', password: 'nope' })).status, 401);
  assert.equal((await call('POST', '/api/auth/register', { email: 'bad', name: 'x', password: 'password1' })).status, 400);
  assert.equal((await call('POST', '/api/products', { sku: 'x' })).status, 401);
  assert.equal((await call('GET', '/api/nothing')).status, 404);
  const res = await fetch(base + '/../etc/passwd');
  assert.notEqual(res.status, 200);
});

test('serves storefront', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Afro Mart/);
});
