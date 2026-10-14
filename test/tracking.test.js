// Public delivery tracking: a customer can track an order with its number and
// the email used to place it, and nobody else can.
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

test('track: order number + email reveals status, wrong email does not', async () => {
  const admin = (await call('POST', '/api/auth/login', { email: 'boss@x.com', password: 'adminpass1' })).data.token;
  const cat = (await call('POST', '/api/categories', { name: 'Dry Goods' }, admin)).data;
  const sup = (await call('POST', '/api/suppliers', { name: 'Lagos Foods' }, admin)).data;
  const prod = (await call('POST', '/api/products', {
    sku: 'TRK-1', name: 'Garri', price_cents: 1000, cost_cents: 600, stock: 12,
    reorder_level: 5, reorder_quantity: 30, category_id: cat.id, supplier_id: sup.id,
  }, admin)).data;

  const reg = await call('POST', '/api/auth/register', { email: 'track@x.com', name: 'Tunde', password: 'password1' });
  const cust = reg.data.token;
  const order = (await call('POST', '/api/orders', {
    items: [{ product_id: prod.id, quantity: 2 }],
    fulfillment: 'delivery', shipping_address: 'Alexanderstrasse 1, 10178 Berlin',
    delivery_service: 'dhl', shipping_country: 'DE', payment_method: 'card',
  }, cust)).data;
  assert.ok(order.id);

  const ok = await call('GET', `/api/track?order=${order.id}&email=track@x.com`);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.id, order.id);
  assert.equal(ok.data.status, 'pending');
  assert.equal(ok.data.items.length, 1);
  assert.equal(ok.data.items[0].quantity, 2);

  const wrong = await call('GET', `/api/track?order=${order.id}&email=someone@else.com`);
  assert.equal(wrong.status, 404);

  const missing = await call('GET', '/api/track?order=9999&email=track@x.com');
  assert.equal(missing.status, 404);
});
