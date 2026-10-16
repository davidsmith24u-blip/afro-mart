// Guest checkout and the first-order welcome coupon.
// Guests order with just an email, can still track their parcel, and a
// first-order-only promo code is honoured once per shopper.
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

const login = async () => (await call('POST', '/api/auth/login', { email: 'boss@x.com', password: 'adminpass1' })).data.token;

async function product(admin, sku, price) {
  const category = (await call('POST', '/api/categories', { name: `Guest Cat ${sku}` }, admin)).data;
  const supplier = (await call('POST', '/api/suppliers', { name: `Guest Sup ${sku}` }, admin)).data;
  return (await call('POST', '/api/products', {
    sku, name: `Item ${sku}`, price_cents: price, cost_cents: Math.floor(price / 2), stock: 100,
    reorder_level: 1, reorder_quantity: 5, category_id: category.id, supplier_id: supplier.id,
  }, admin)).data;
}

const guestOrder = (body) => call('POST', '/api/orders', {
  fulfillment: 'delivery', shipping_address: 'Alexanderstrasse 1, 10178 Berlin',
  delivery_service: 'dhl', shipping_country: 'DE', payment_method: 'card', ...body,
});

test('guest: an order can be placed without an account, keyed by email', async () => {
  const admin = await login();
  const item = await product(admin, 'G-1', 2000);

  const placed = await guestOrder({
    guest_email: 'Guest@Example.com', guest_name: 'Ada',
    items: [{ product_id: item.id, quantity: 1 }],
  });
  assert.equal(placed.status, 201);
  assert.equal(placed.data.user_id, null);
  assert.equal(placed.data.guest_email, 'guest@example.com');
  assert.equal(placed.data.points_earned, 0, 'guests earn no loyalty points');
  assert.equal(placed.data.total_cents, 2000);

  // The guest can still follow the parcel with their order number and email.
  const track = await call('GET', `/api/track?order=${placed.data.id}&email=guest@example.com`);
  assert.equal(track.status, 200);
  assert.equal(track.data.id, placed.data.id);

  const wrong = await call('GET', `/api/track?order=${placed.data.id}&email=nope@example.com`);
  assert.equal(wrong.status, 404);

  // Staff see who ordered, even for a guest.
  const staffOrders = await call('GET', '/api/orders', undefined, admin);
  const seen = staffOrders.data.find((o) => o.id === placed.data.id);
  assert.equal(seen.customer_email, 'guest@example.com');
});

test('guest: an email is required, and it must be valid', async () => {
  const admin = await login();
  const item = await product(admin, 'G-2', 1500);

  const missing = await guestOrder({ items: [{ product_id: item.id, quantity: 1 }] });
  assert.equal(missing.status, 400);

  const bad = await guestOrder({ guest_email: 'not-an-email', items: [{ product_id: item.id, quantity: 1 }] });
  assert.equal(bad.status, 400);
});

test('coupon: a first-order code applies once, then is refused', async () => {
  const admin = await login();
  const item = await product(admin, 'G-3', 3000);
  await call('POST', '/api/marketing/promo-codes', {
    code: 'WELCOME10', discount_type: 'percent', value: 10, first_order_only: true,
  }, admin);

  const first = await guestOrder({
    guest_email: 'coupon@example.com', promo_code: 'WELCOME10',
    items: [{ product_id: item.id, quantity: 1 }],
  });
  assert.equal(first.status, 201);
  assert.equal(first.data.discount_cents, 300, '10% of 3000');

  const second = await guestOrder({
    guest_email: 'coupon@example.com', promo_code: 'WELCOME10',
    items: [{ product_id: item.id, quantity: 1 }],
  });
  assert.equal(second.status, 400);
  assert.match(second.data.error, /first order/i);
});

test('coupon: applies to a member’s first order, not their second', async () => {
  const admin = await login();
  const item = await product(admin, 'G-4', 4000);
  await call('POST', '/api/marketing/promo-codes', {
    code: 'HELLO5', discount_type: 'fixed', value: 500, first_order_only: true,
  }, admin);

  const member = (await call('POST', '/api/auth/register', { email: 'member@x.com', name: 'Mimi', password: 'password1' })).data.token;
  const order = (body, token) => call('POST', '/api/orders', {
    fulfillment: 'delivery', shipping_address: 'Alexanderstrasse 1, 10178 Berlin',
    delivery_service: 'dhl', shipping_country: 'DE', payment_method: 'card', ...body,
  }, token);

  const first = await order({ items: [{ product_id: item.id, quantity: 1 }], promo_code: 'HELLO5' }, member);
  assert.equal(first.status, 201);
  assert.equal(first.data.discount_cents, 500);
  assert.ok(first.data.points_earned > 0, 'members still earn points');

  const second = await order({ items: [{ product_id: item.id, quantity: 1 }], promo_code: 'HELLO5' }, member);
  assert.equal(second.status, 400);
  assert.match(second.data.error, /first order/i);
});

test('coupon: a plain code is not first-order limited', async () => {
  const admin = await login();
  const item = await product(admin, 'G-5', 1000);
  await call('POST', '/api/marketing/promo-codes', { code: 'ANYTIME', discount_type: 'percent', value: 5 }, admin);

  const one = await guestOrder({ guest_email: 'plain@example.com', promo_code: 'ANYTIME', items: [{ product_id: item.id, quantity: 1 }] });
  const two = await guestOrder({ guest_email: 'plain@example.com', promo_code: 'ANYTIME', items: [{ product_id: item.id, quantity: 1 }] });
  assert.equal(one.status, 201);
  assert.equal(two.status, 201);
  assert.equal(one.data.discount_cents, 50);
  assert.equal(two.data.discount_cents, 50);
});
