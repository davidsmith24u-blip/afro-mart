// Feature tests for the fulfilment, loyalty, subscription, recipe and payment rounds.
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

async function catalog(admin, tag) {
  const category = (await call('POST', '/api/categories', { name: `Cat ${tag}` }, admin)).data;
  const supplier = (await call('POST', '/api/suppliers', { name: `Sup ${tag}` }, admin)).data;
  const product = async (sku, price, stock = 100) => (await call('POST', '/api/products', {
    sku, name: `Item ${sku}`, price_cents: price, cost_cents: Math.floor(price / 2), stock,
    reorder_level: 1, reorder_quantity: 5, category_id: category.id, supplier_id: supplier.id,
  }, admin)).data;
  return { product, category, supplier };
}

test('fulfilment: area fees, minimum-order surcharge, fallback and required address', async () => {
  const admin = await login();
  const { product } = await catalog(admin, 'delivery');
  const cheap = await product('D-CHEAP', 1000, 100);
  const pricy = await product('D-PRICE', 6000, 100);

  const area = (await call('POST', '/api/delivery-areas', {
    name: 'Berlin', city: 'Berlin', postal_prefixes: '10, 12', fee_cents: 490, min_order_cents: 3000,
  }, admin)).data;
  assert.equal(area.fee_cents, 490);
  assert.ok((await call('GET', '/api/delivery-areas')).data.some((a) => a.id === area.id));

  const cust = (await call('POST', '/api/auth/register', { email: 'd1@x.com', name: 'Dee', password: 'password1' })).data.token;

  // Below the area minimum: the fee plus the shortfall (3000 - 1000) is charged.
  const small = (await call('POST', '/api/orders', {
    fulfillment: 'delivery', shipping_address: 'Str 1, 10999 Berlin', items: [{ product_id: cheap.id, quantity: 1 }],
  }, cust)).data;
  assert.equal(small.delivery_fee_cents, 2490);
  assert.equal(small.total_cents, 1000 + 2490);

  // At or above the minimum: the flat area fee.
  const big = (await call('POST', '/api/orders', {
    fulfillment: 'delivery', shipping_address: 'Str 1, 10999 Berlin', items: [{ product_id: pricy.id, quantity: 1 }],
  }, cust)).data;
  assert.equal(big.delivery_fee_cents, 490);
  assert.equal(big.total_cents, 6000 + 490);
  assert.equal(big.fulfillment, 'delivery');

  // Outside every area: free until a default is configured.
  const free = (await call('POST', '/api/orders', {
    fulfillment: 'delivery', shipping_address: 'Str 1, 99999 Nowhere', items: [{ product_id: pricy.id, quantity: 1 }],
  }, cust)).data;
  assert.equal(free.delivery_fee_cents, 0);

  process.env.DELIVERY_FEE_DEFAULT_CENTS = '250';
  try {
    const fallback = (await call('POST', '/api/orders', {
      fulfillment: 'delivery', shipping_address: 'Str 1, 99999 Nowhere', items: [{ product_id: pricy.id, quantity: 1 }],
    }, cust)).data;
    assert.equal(fallback.delivery_fee_cents, 250);
  } finally {
    delete process.env.DELIVERY_FEE_DEFAULT_CENTS;
  }

  // Delivery needs an address; courier is Germany-only.
  assert.equal((await call('POST', '/api/orders', { fulfillment: 'delivery', items: [{ product_id: cheap.id, quantity: 1 }] }, cust)).status, 400);
  assert.equal((await call('POST', '/api/orders', {
    fulfillment: 'delivery', shipping_address: 'x', shipping_country: 'NG', items: [{ product_id: cheap.id, quantity: 1 }],
  }, cust)).status, 400);
});

test('pickup: no address, no fee, and stock is drawn from the chosen store', async () => {
  const admin = await login();
  const { product } = await catalog(admin, 'pickup');
  const rice = await product('P-RICE', 800, 50);
  const store = (await call('POST', '/api/locations', { name: 'Pickup Store', city: 'Berlin', is_primary: true }, admin)).data;
  const cust = (await call('POST', '/api/auth/register', { email: 'p1@x.com', name: 'Pia', password: 'password1' })).data.token;

  const order = (await call('POST', '/api/orders', {
    fulfillment: 'pickup', pickup_location_id: store.id, pickup_at: '2026-12-01 10:00-12:00',
    items: [{ product_id: rice.id, quantity: 2 }],
  }, cust)).data;
  assert.equal(order.fulfillment, 'pickup');
  assert.equal(order.delivery_fee_cents, 0);
  assert.equal(order.total_cents, 1600);
  assert.equal(order.pickup_location_id, store.id);
  assert.equal(order.pickup_at, '2026-12-01 10:00-12:00');

  const inventory = (await call('GET', `/api/locations/${store.id}/inventory`, null, admin)).data;
  assert.equal(inventory.find((i) => i.product_id === rice.id).stock, 48);

  // An unknown pickup store is rejected.
  assert.equal((await call('POST', '/api/orders', {
    fulfillment: 'pickup', pickup_location_id: 9999, items: [{ product_id: rice.id, quantity: 1 }],
  }, cust)).status, 400);
});

test('loyalty: spend raises the tier, which multiplies points; referrals reward the referrer', async () => {
  const admin = await login();
  const { product } = await catalog(admin, 'loyalty');
  const pack = await product('L-PACK', 5000, 100);

  const registered = await call('POST', '/api/auth/register', { email: 'l1@x.com', name: 'Loyal', password: 'password1' });
  assert.equal(registered.data.user.tier, 'bronze');
  assert.equal(registered.data.user.points_multiplier, 1);
  const cust = registered.data.token;

  // First order: pre-order spend is 0, so it earns at the bronze rate.
  const first = (await call('POST', '/api/orders', { fulfillment: 'pickup', items: [{ product_id: pack.id, quantity: 1 }] }, cust)).data;
  assert.equal(first.total_cents, 5000);
  assert.equal(first.points_earned, 50);
  const me = (await call('GET', '/api/me', null, cust)).data;
  assert.equal(me.tier, 'silver');
  assert.equal(me.points_multiplier, 1.1);
  assert.equal(me.loyalty_points, 50);

  // Second order now benefits from the silver multiplier: floor(50 * 1.1) = 55.
  const second = (await call('POST', '/api/orders', { fulfillment: 'pickup', items: [{ product_id: pack.id, quantity: 1 }] }, cust)).data;
  assert.equal(second.points_earned, 55);
  assert.equal((await call('GET', '/api/me', null, cust)).data.loyalty_points, 105);

  // Referral: the friend's signup awards the referrer 200 points.
  const referral = (await call('GET', '/api/me/referral', null, cust)).data;
  assert.ok(referral.code && referral.link.includes(referral.code));
  assert.equal(referral.points_per_friend, 200);
  const friend = await call('POST', '/api/auth/register', { email: 'l2@x.com', name: 'Friend', password: 'password1', ref: referral.code });
  assert.equal(friend.status, 201);
  assert.equal((await call('GET', '/api/me', null, cust)).data.loyalty_points, 305);

  // An unknown code is rejected.
  assert.equal((await call('POST', '/api/auth/register', { email: 'l3@x.com', name: 'Nope', password: 'password1', ref: 'BADCODE1' })).status, 400);
});

test('subscriptions: create, pause, then process a due plan into a real order', async () => {
  const admin = await login();
  const { product } = await catalog(admin, 'subs');
  const rice = await product('S-RICE', 700, 50);
  const beans = await product('S-BEANS', 300, 50);
  const store = (await call('GET', '/api/locations', null, admin)).data[0];
  const bundle = (await call('POST', '/api/bundles', {
    sku: 'S-PACK', name: 'Monthly pack', bundle_type: 'starter_pack', savings_percent: 10,
    items: [{ product_id: rice.id, quantity: 2 }, { product_id: beans.id, quantity: 1 }],
  }, admin)).data;

  const cust = (await call('POST', '/api/auth/register', { email: 's1@x.com', name: 'Sub', password: 'password1' })).data.token;

  // Delivery needs an address; pickup does not.
  assert.equal((await call('POST', '/api/subscriptions', { bundle_id: bundle.id, fulfillment: 'delivery' }, cust)).status, 400);

  const sub = (await call('POST', '/api/subscriptions', {
    bundle_id: bundle.id, fulfillment: 'pickup', pickup_location_id: store.id,
  }, cust)).data;
  assert.equal(sub.status, 'active');
  assert.equal(sub.bundle.id, bundle.id);
  assert.ok(sub.next_run_on > new Date().toISOString().slice(0, 10));

  assert.equal((await call('PUT', `/api/subscriptions/${sub.id}`, { status: 'paused' }, cust)).data.status, 'paused');
  assert.equal((await call('POST', '/api/subscriptions/process', null, admin)).data.processed, 0);

  await call('PUT', `/api/subscriptions/${sub.id}`, { status: 'active', next_run_on: '2000-01-01' }, cust);
  const processed = (await call('POST', '/api/subscriptions/process', null, admin)).data;
  assert.equal(processed.processed, 1);
  const made = processed.results[0];
  assert.ok(made.order_id);
  // Bundle price: (700 * 2 + 300) less 10% = 1530.
  assert.equal(made.total_cents, 1530);

  const order = (await call('GET', `/api/orders/${made.order_id}`, null, cust)).data;
  assert.equal(order.fulfillment, 'pickup');
  assert.equal(order.payment_status, 'unpaid');
  assert.equal(order.total_cents, 1530);
  assert.equal((await call('GET', '/api/products')).data.find((p) => p.id === rice.id).stock, 48);
});

test('recipes: priced ingredients from products and bundles; writes are staff-only', async () => {
  const admin = await login();
  const { product } = await catalog(admin, 'recipes');
  const spice = await product('R-SPICE', 400, 50);
  const tomato = await product('R-TOMATO', 250, 50);
  const bundle = (await call('POST', '/api/bundles', {
    sku: 'R-PACK', name: 'Base pack', bundle_type: 'meal_pack', savings_percent: 0,
    items: [{ product_id: spice.id, quantity: 2 }],
  }, admin)).data;

  assert.equal((await call('POST', '/api/recipes', { title: 'Nope', ingredients: [{ product_id: spice.id, quantity: 1 }] })).status, 401);

  const recipe = (await call('POST', '/api/recipes', {
    title: 'Jollof rice', description: 'Party rice', prep_minutes: 45, servings: 6, emoji: '🍲',
    ingredients: [
      { product_id: tomato.id, quantity: 3 },
      { product_id: spice.id, quantity: 1 },
      { bundle_id: bundle.id, quantity: 1 },
    ],
  }, admin)).data;
  assert.equal(recipe.ingredients.length, 3);
  // 250*3 + 400*1 + 800*1
  assert.equal(recipe.price_cents, 1950);
  assert.equal(recipe.items_available, true);
  assert.ok((await call('GET', '/api/recipes')).data.some((r) => r.id === recipe.id));
  assert.equal((await call('GET', `/api/recipes/${recipe.id}`)).data.title, 'Jollof rice');

  const updated = (await call('PUT', `/api/recipes/${recipe.id}`, {
    servings: 4, ingredients: [{ product_id: spice.id, quantity: 2 }],
  }, admin)).data;
  assert.equal(updated.servings, 4);
  assert.equal(updated.ingredients.length, 1);
  assert.equal(updated.price_cents, 800);

  assert.equal((await call('POST', '/api/recipes', { title: 'Bad', ingredients: [{ product_id: 99999, quantity: 1 }] }, admin)).status, 400);
  assert.equal((await call('POST', '/api/recipes', { title: 'Empty', ingredients: [] }, admin)).status, 400);

  await call('PUT', `/api/recipes/${recipe.id}`, { active: false }, admin);
  assert.equal((await call('GET', '/api/recipes')).data.some((r) => r.id === recipe.id), false);
  assert.ok((await call('GET', '/api/recipes?all=1', null, admin)).data.some((r) => r.id === recipe.id));

  assert.equal((await call('DELETE', `/api/recipes/${recipe.id}`, null, admin)).status, 204);
  assert.equal((await call('GET', `/api/recipes/${recipe.id}`)).status, 404);
});

test('payments: staff settlement, auto-advance, and the gateway webhook', async () => {
  const admin = await login();
  const { product } = await catalog(admin, 'payments');
  const goods = await product('PAY-1', 1200, 50);
  const cust = (await call('POST', '/api/auth/register', { email: 'pay@x.com', name: 'Pay', password: 'password1' })).data.token;

  const order = (await call('POST', '/api/orders', { fulfillment: 'pickup', items: [{ product_id: goods.id, quantity: 1 }] }, cust)).data;
  assert.equal(order.payment_status, 'unpaid');
  assert.equal(order.status, 'pending');
  assert.ok(order.payment_reference);

  const paid = (await call('PATCH', `/api/orders/${order.id}/payment`, { status: 'paid', method: 'card' }, admin)).data;
  assert.equal(paid.payment_status, 'paid');
  assert.equal(paid.status, 'paid');

  process.env.PAYMENTS_WEBHOOK_SECRET = 'hook-secret';
  try {
    // A buyer cannot call the gateway endpoint.
    const unauthorized = await fetch(`${base}/api/payments/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': 'wrong' },
      body: JSON.stringify({ reference: order.payment_reference, status: 'paid' }),
    });
    assert.equal(unauthorized.status, 401);

    // The gateway settles a different order by reference and advances its status.
    const second = (await call('POST', '/api/orders', { fulfillment: 'pickup', items: [{ product_id: goods.id, quantity: 1 }] }, cust)).data;
    const settled = await fetch(`${base}/api/payments/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': 'hook-secret' },
      body: JSON.stringify({ reference: second.payment_reference, status: 'paid', method: 'card' }),
    });
    assert.equal(settled.status, 200);
    assert.equal((await settled.json()).payment_status, 'paid');
    assert.equal((await call('GET', `/api/orders/${second.id}`, null, cust)).data.payment_status, 'paid');

    // An unknown reference is a 404.
    const missing = await fetch(`${base}/api/payments/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': 'hook-secret' },
      body: JSON.stringify({ reference: 'pay_nope', status: 'paid' }),
    });
    assert.equal(missing.status, 404);
  } finally {
    delete process.env.PAYMENTS_WEBHOOK_SECRET;
  }

  // Without a configured secret the gateway is disabled.
  const disabled = await fetch(`${base}/api/payments/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': 'hook-secret' },
    body: JSON.stringify({ reference: order.payment_reference }),
  });
  assert.equal(disabled.status, 503);
});
