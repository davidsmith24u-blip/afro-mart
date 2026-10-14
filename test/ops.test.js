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

async function call(method, path, body, token, extraHeaders = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

test('audit log captures privileged mutations and is staff-only', async () => {
  const admin = (await call('POST', '/api/auth/login', { email: 'boss@x.com', password: 'adminpass1' })).data.token;
  const cust = (await call('POST', '/api/auth/register', { email: 'audit@x.com', name: 'Aud', password: 'password1' })).data.token;

  const prod = (await call('POST', '/api/products', { sku: 'AUD-1', name: 'Audited Item', price_cents: 100, stock: 4 }, admin)).data;
  await call('PUT', `/api/products/${prod.id}`, { price_cents: 150 }, admin);

  const trail = await call('GET', '/api/audit', undefined, admin);
  assert.equal(trail.status, 200);
  const actions = trail.data.map((r) => r.action);
  assert.ok(actions.includes('product.create'));
  assert.ok(actions.includes('product.update'));
  assert.equal(trail.data[0].actor_email, 'boss@x.com');
  assert.ok(trail.data.some((r) => r.entity === 'product' && r.entity_id === prod.id));

  assert.equal((await call('GET', '/api/audit')).status, 401);
  assert.equal((await call('GET', '/api/audit', undefined, cust)).status, 403);
});

test('printable invoice: owner and staff can open it, others cannot', async () => {
  const admin = (await call('POST', '/api/auth/login', { email: 'boss@x.com', password: 'adminpass1' })).data.token;
  const prod = (await call('POST', '/api/products', { sku: 'INV-1', name: 'Invoice Yam', price_cents: 800, stock: 10 }, admin)).data;
  const owner = (await call('POST', '/api/auth/register', { email: 'owner@x.com', name: 'Owner', password: 'password1' })).data.token;
  const stranger = (await call('POST', '/api/auth/register', { email: 'stranger@x.com', name: 'Other', password: 'password1' })).data.token;

  const order = (await call('POST', '/api/orders', { shipping_address: '5 Market St', items: [{ product_id: prod.id, quantity: 2 }] }, owner)).data;
  await call('PATCH', `/api/orders/${order.id}/status`, { status: 'paid' }, admin);

  const asOwner = await call('GET', `/api/orders/${order.id}/invoice`, undefined, owner);
  assert.equal(asOwner.status, 200);
  assert.match(asOwner.headers.get('content-type') || '', /text\/html/);
  assert.match(asOwner.data, /AFROMART/);
  assert.match(asOwner.data, /Invoice #\d+/);
  assert.match(asOwner.data, /Invoice Yam/);
  assert.match(asOwner.data, /16,00/); // 2 × €8.00

  assert.equal((await call('GET', `/api/orders/${order.id}/invoice`, undefined, admin)).status, 200);
  assert.equal((await call('GET', `/api/orders/${order.id}/invoice`, undefined, stranger)).status, 404);
  assert.equal((await call('GET', `/api/orders/${order.id}/invoice`)).status, 401);

  // The status change and payment were recorded.
  const trail = await call('GET', '/api/audit?limit=200', undefined, admin);
  assert.ok(trail.data.some((r) => r.action === 'order.status'));
});

test('rate limiting throttles repeated login attempts', async () => {
  const ip = { 'x-forwarded-for': '203.0.113.7' };
  let last = 0;
  for (let i = 0; i < 31; i += 1) {
    last = (await call('POST', '/api/auth/login', { email: 'nobody@x.com', password: 'wrongpass' }, undefined, ip)).status;
  }
  assert.equal(last, 429);
  // A different client is unaffected by that client's burst.
  const other = await call('POST', '/api/auth/login', { email: 'boss@x.com', password: 'adminpass1' }, undefined, { 'x-forwarded-for': '203.0.113.99' });
  assert.equal(other.status, 200);
});
