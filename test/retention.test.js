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

test('back-in-stock alerts: subscribe, list, and notify once restocked', async () => {
  const admin = (await call('POST', '/api/auth/login', { email: 'boss@x.com', password: 'adminpass1' })).data.token;
  const prod = (await call('POST', '/api/products', { sku: 'OOS-1', name: 'Egusi Seeds', price_cents: 700, stock: 0 }, admin)).data;

  assert.equal((await call('POST', '/api/stock-alerts', { product_id: prod.id, email: 'nope' })).status, 400);
  assert.equal((await call('POST', '/api/stock-alerts', { product_id: 99999, email: 'a@b.com' })).status, 404);
  assert.equal((await call('POST', '/api/stock-alerts', { product_id: prod.id, email: 'Fan@Example.com' })).status, 201);
  // Duplicate subscription is ignored, not an error.
  assert.equal((await call('POST', '/api/stock-alerts', { product_id: prod.id, email: 'fan@example.com' })).status, 201);

  const queue = await call('GET', '/api/stock-alerts', undefined, admin);
  assert.equal(queue.data.length, 1);
  assert.equal(queue.data[0].email, 'fan@example.com');
  assert.equal((await call('GET', '/api/stock-alerts')).status, 401);

  // Nothing to notify while the product is still out of stock.
  assert.equal((await call('POST', '/api/automations/back-in-stock', {}, admin)).data.notified, 0);

  await call('PUT', `/api/products/${prod.id}`, { stock: 12 }, admin);
  const run = await call('POST', '/api/automations/back-in-stock', {}, admin);
  assert.equal(run.data.notified, 1);
  assert.deepEqual(run.data.products, ['Egusi Seeds']);
  // Processed alerts leave the queue and are not re-notified.
  assert.equal((await call('GET', '/api/stock-alerts', undefined, admin)).data.length, 0);
  assert.equal((await call('POST', '/api/automations/back-in-stock', {}, admin)).data.notified, 0);
});

test('abandoned carts: saved snapshot, recovery reminder, then cleared by an order', async () => {
  const admin = (await call('POST', '/api/auth/login', { email: 'boss@x.com', password: 'adminpass1' })).data.token;
  const prod = (await call('POST', '/api/products', { sku: 'CART-1', name: 'Plantain Chips', price_cents: 400, stock: 20 }, admin)).data;
  const reg = await call('POST', '/api/auth/register', { email: 'cart@x.com', name: 'Cart Fan', password: 'password1' });
  const cust = reg.data.token;

  assert.equal((await call('PUT', '/api/cart', { items: [{ product_id: prod.id, quantity: 2 }], subtotal_cents: 800 })).status, 401);

  const saved = await call('PUT', '/api/cart', { items: [{ product_id: prod.id, quantity: 2 }, { quantity: 1 }], subtotal_cents: 800 }, cust);
  assert.equal(saved.status, 201);
  assert.equal(saved.data.items, 1); // the empty line is dropped
  // Saving again updates the same cart.
  assert.equal((await call('PUT', '/api/cart', { items: [{ product_id: prod.id, quantity: 3 }], subtotal_cents: 1200 }, cust)).data.id, saved.data.id);

  const carts = await call('GET', '/api/carts', undefined, admin);
  assert.equal(carts.data.length, 1);
  assert.equal(carts.data[0].item_count, 1);
  assert.equal(carts.data[0].subtotal_cents, 1200);

  // A freshly saved cart is not abandoned yet.
  assert.equal((await call('POST', '/api/automations/abandoned-carts', {}, admin)).data.reminded, 0);
  db.prepare("UPDATE carts SET updated_at = datetime('now', '-2 hours')").run();
  const reminded = await call('POST', '/api/automations/abandoned-carts', { minutes: 60 }, admin);
  assert.equal(reminded.data.reminded, 1);
  assert.equal(reminded.data.after_minutes, 60);
  // Reminders are sent once.
  assert.equal((await call('POST', '/api/automations/abandoned-carts', { minutes: 60 }, admin)).data.reminded, 0);

  // Placing an order marks the cart recovered so it is never reminded again.
  await call('POST', '/api/orders', { shipping_address: '1 Main St', items: [{ product_id: prod.id, quantity: 1 }] }, cust);
  db.prepare("UPDATE carts SET updated_at = datetime('now', '-3 hours'), reminded_at = NULL").run();
  assert.equal((await call('POST', '/api/automations/abandoned-carts', { minutes: 60 }, admin)).data.reminded, 0);
});
