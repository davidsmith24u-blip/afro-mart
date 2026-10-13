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

test('multi-location: inventory, transfers, orders and per-location low stock', async () => {
  const admin = (await call('POST', '/api/auth/login', { email: 'boss@x.com', password: 'adminpass1' })).data.token;
  const cat = (await call('POST', '/api/categories', { name: 'Dry Goods' }, admin)).data;
  const sup = (await call('POST', '/api/suppliers', { name: 'Lagos Foods' }, admin)).data;
  const prod = (await call('POST', '/api/products', {
    sku: 'GAR-1', name: 'Garri', price_cents: 1000, cost_cents: 600, stock: 100,
    reorder_level: 5, reorder_quantity: 30, category_id: cat.id, supplier_id: sup.id,
  }, admin)).data;
  assert.equal(prod.stock, 100);

  const berlin = (await call('POST', '/api/locations', { name: 'Berlin Store' }, admin)).data;
  const hamburg = (await call('POST', '/api/locations', { name: 'Hamburg Store' }, admin)).data;
  assert.equal(berlin.is_primary, 1, 'first location becomes primary');
  assert.equal(hamburg.is_primary, 0);

  // Allocate 60 to Berlin (seeds from the product total) and 40 to Hamburg.
  await call('PUT', `/api/locations/${berlin.id}/inventory/${prod.id}`, { stock: 60 }, admin);
  const hamInv = (await call('PUT', `/api/locations/${hamburg.id}/inventory/${prod.id}`, { stock: 40 }, admin)).data;
  assert.equal(hamInv.stock, 40);
  assert.equal((await call('GET', '/api/products')).data[0].stock, 100, 'total stays in sync');

  // Transfer 10 units from Hamburg to Berlin.
  const transfer = (await call('POST', '/api/locations/transfer', {
    product_id: prod.id, from_location_id: hamburg.id, to_location_id: berlin.id, quantity: 10,
  }, admin)).data;
  assert.equal(transfer.find((i) => i.location_id === berlin.id).stock, 70);
  assert.equal(transfer.find((i) => i.location_id === hamburg.id).stock, 30);

  const reg = await call('POST', '/api/auth/register', { email: 'c1@x.com', name: 'Cleo', password: 'password1' });
  const cust = reg.data.token;
  const ord = await call('POST', '/api/orders', {
    shipping_address: '1 Main St', location_id: hamburg.id,
    items: [{ product_id: prod.id, quantity: 5 }],
  }, cust);
  assert.equal(ord.status, 201);
  assert.equal(ord.data.location_id, hamburg.id);
  assert.equal(ord.data.discount_cents, 0);
  assert.equal(ord.data.total_cents, 5000);

  const berlinInv = (await call('GET', `/api/locations/${berlin.id}/inventory`, null, admin)).data;
  const hamburgInv = (await call('GET', `/api/locations/${hamburg.id}/inventory`, null, admin)).data;
  assert.equal(berlinInv.find((i) => i.product_id === prod.id).stock, 70, 'Berlin allocation unchanged');
  assert.equal(hamburgInv.find((i) => i.product_id === prod.id).stock, 25, 'Hamburg allocation reduced');
  assert.equal((await call('GET', '/api/products')).data[0].stock, 95, 'total reduced in sync');

  // Per-location low stock sees inventory levels, not just the total.
  const berlinLow = (await call('GET', `/api/inventory/low-stock?location_id=${berlin.id}`, null, admin)).data;
  assert.equal(berlinLow.some((p) => p.id === prod.id), false);
  const hamburgLow = (await call('GET', `/api/inventory/low-stock?location_id=${hamburg.id}`, null, admin)).data;
  assert.ok(!hamburgLow.some((p) => p.id === prod.id));

  const overview = (await call('GET', '/api/analytics/overview', null, admin)).data;
  assert.equal(overview.orders, 1);
  assert.equal(overview.revenue_cents, 5000);
  assert.equal(overview.average_order_cents, 5000);
  const hamburgOverview = (await call('GET', `/api/analytics/overview?location_id=${hamburg.id}`, null, admin)).data;
  assert.equal(hamburgOverview.orders, 1);
  assert.equal((await call('GET', '/api/analytics/sales', null, admin)).data.length, 1);
  assert.equal((await call('GET', '/api/analytics/top-products', null, admin)).data[0].units_sold, 5);

  // Insufficient stock at a location is rejected even when the total looks fine.
  const over = await call('POST', '/api/orders', {
    shipping_address: 'x', location_id: hamburg.id, items: [{ product_id: prod.id, quantity: 30 }],
  }, cust);
  assert.equal(over.status, 409);
});

test('marketing: subscribers, segments, promo codes and campaigns', async () => {
  const admin = (await call('POST', '/api/auth/login', { email: 'boss@x.com', password: 'adminpass1' })).data.token;
  const sub = await call('POST', '/api/marketing/subscribe', { email: 'fan@x.com', name: 'Fan', source: 'landing' });
  assert.equal(sub.status, 201);

  assert.equal((await call('GET', '/api/marketing/subscribers', null, admin)).data[0].email, 'fan@x.com');
  assert.equal((await call('GET', '/api/marketing/segments')).status, 401);
  const segments = (await call('GET', '/api/marketing/segments', null, admin)).data;
  assert.ok(segments.map((s) => s.key).includes('all'));
  assert.ok(segments.find((s) => s.key === 'vip').count >= 0);

  const promo = (await call('POST', '/api/marketing/promo-codes', {
    code: 'save10', discount_type: 'percent', value: 10, min_total_cents: 1000, max_uses: 10,
  }, admin)).data;
  assert.equal(promo.code, 'SAVE10');
  assert.equal((await call('POST', '/api/marketing/promo-codes/validate', { code: 'save10', total_cents: 5000 })).data.discount_cents, 500);

  const reg = await call('POST', '/api/auth/register', { email: 'c2@x.com', name: 'Nia', password: 'password1' });
  const cust = reg.data.token;
  const ord = await call('POST', '/api/orders', {
    shipping_address: '2 Main St', promo_code: 'SAVE10', items: [{ product_id: 1, quantity: 1 }],
  }, cust);
  assert.equal(ord.status, 201);
  assert.equal(ord.data.promo_code, 'SAVE10');
  assert.equal(ord.data.discount_cents, 100);
  assert.equal(ord.data.total_cents, 900);

  const camp = (await call('POST', '/api/marketing/campaigns', {
    name: 'Weekend sale', segment: 'all', subject: 'Big sale {{name}}', body: 'Hi {{name}}, everything is on sale!',
  }, admin)).data;
  assert.equal(camp.status, 'draft');
  const sent = await call('POST', `/api/marketing/campaigns/${camp.id}/send`, null, admin);
  assert.equal(sent.status, 200);
  assert.equal(sent.data.recipients, 2, 'two customers match the all segment');
  assert.equal((await call('GET', '/api/marketing/campaigns', null, admin)).data[0].status, 'sent');
  const messages = (await call('GET', '/api/communications/messages', null, admin)).data;
  assert.ok(messages.some((m) => m.campaign_id === camp.id && /is on sale/.test(m.body)));
});

test('communications automation: templates, automations, outbox and dispatch', async () => {
  const admin = (await call('POST', '/api/auth/login', { email: 'boss@x.com', password: 'adminpass1' })).data.token;
  const tmpl = (await call('POST', '/api/communications/templates', {
    name: 'Order shipped', channel: 'sms', subject: 'Your order', body: 'Hi {{name}}, order {{order_id}} is on its way!',
  }, admin)).data;
  assert.equal(tmpl.channel, 'sms');
  const auto = (await call('POST', '/api/communications/automations', {
    name: 'Ship notice', event: 'order.status_changed', template_id: tmpl.id, channel: 'sms', active: true,
  }, admin)).data;
  assert.equal(auto.active, 1);

  const reg = await call('POST', '/api/auth/register', { email: 'c3@x.com', name: 'Lena', password: 'password1' });
  const cust = reg.data.token;
  const ord = await call('POST', '/api/orders', {
    shipping_address: '3 Main St', items: [{ product_id: 1, quantity: 1 }],
  }, cust);
  const shipped = await call('PATCH', `/api/orders/${ord.data.id}/status`, { status: 'shipped' }, admin);
  assert.equal(shipped.status, 200);

  const messages = (await call('GET', '/api/communications/messages', null, admin)).data;
  const notice = messages.find((m) => m.automation_id === auto.id);
  assert.ok(notice, 'status change enqueues an automation message');
  assert.match(notice.body, /order 3 is on its way/);
  assert.equal(notice.status, 'queued');

  const dispatch = await call('POST', '/api/communications/dispatch', null, admin);
  assert.equal(dispatch.status, 200);
  assert.ok(dispatch.data.delivered >= 1);
  assert.equal((await call('GET', '/api/communications/messages', null, admin)).data.find((m) => m.id === notice.id).status, 'sent');

  // Duplicate template name is rejected.
  assert.equal((await call('POST', '/api/communications/templates', { name: 'Order shipped' }, admin)).status, 409);
});

test('mobile-ready API: health, config, versioning, CORS and pagination', async () => {
  const health = await call('GET', '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.status, 'ok');

  const config = await call('GET', '/api/config');
  assert.equal(config.status, 200);
  assert.equal(config.data.currency, 'EUR');
  assert.ok(config.data.delivery_services.includes('dhl'));

  const products = await call('GET', '/api/products');
  const v1 = await call('GET', '/api/v1/products');
  assert.equal(v1.status, 200);
  assert.deepEqual(v1.data, products.data);

  const page = await call('GET', '/api/products?limit=1&offset=0');
  assert.equal(page.data.length, 1);

  const options = await fetch(base + '/api/products', { method: 'OPTIONS' });
  assert.equal(options.status, 204);
  assert.ok(options.headers.get('access-control-allow-origin'));

  assert.equal((await call('GET', '/api/analytics/overview')).status, 401);
  assert.equal((await call('DELETE', '/api/communications/automations/9999')).status, 401);
});

test('bundles: meal packs, pricing, order expansion and permissions', async () => {
  const admin = (await call('POST', '/api/auth/login', { email: 'boss@x.com', password: 'adminpass1' })).data.token;
  const cat = (await call('POST', '/api/categories', { name: 'Bundle Test Cat' }, admin)).data;
  const sup = (await call('POST', '/api/suppliers', { name: 'Bundle Supplier' }, admin)).data;
  const mk = async (sku, price, stock) => (await call('POST', '/api/products', {
    sku, name: sku, price_cents: price, cost_cents: Math.floor(price / 2), stock,
    reorder_level: 2, reorder_quantity: 10, category_id: cat.id, supplier_id: sup.id,
  }, admin)).data;

  const rice = await mk('B-RIC', 1000, 50);
  const base = await mk('B-BASE', 400, 50);

  // Staff only.
  assert.equal((await call('POST', '/api/bundles', { sku: 'B-X', name: 'x', items: [] })).status, 401);

  const bundle = (await call('POST', '/api/bundles', {
    sku: 'B-RICE-PACK', name: 'Jollof Pack', description: 'Rice plus base', bundle_type: 'meal_pack',
    savings_percent: 10, active: true, items: [{ product_id: rice.id, quantity: 2 }, { product_id: base.id, quantity: 1 }],
  }, admin)).data;
  assert.equal(bundle.subtotal_cents, 2400); // 1000*2 + 400
  assert.equal(bundle.savings_cents, 240);
  assert.equal(bundle.price_cents, 2160);
  assert.equal(bundle.item_count, 2);
  assert.equal(bundle.type_label, 'Meal pack');

  // Public list only shows active bundles.
  assert.ok((await call('GET', '/api/bundles')).data.some((b) => b.id === bundle.id));
  assert.equal((await call('GET', `/api/bundles/${bundle.id}`)).data.price_cents, 2160);

  // Duplicate bundle SKU and empty item lists are rejected.
  assert.equal((await call('POST', '/api/bundles', { sku: 'B-RICE-PACK', name: 'x', items: [{ product_id: rice.id, quantity: 1 }] }, admin)).status, 409);
  assert.equal((await call('POST', '/api/bundles', { sku: 'B-EMPTY', name: 'x', items: [] }, admin)).status, 400);

  // Ordering a bundle expands into its components and applies the bundle discount.
  const reg = await call('POST', '/api/auth/register', { email: 'c4@x.com', name: 'Tola', password: 'password1' });
  const cust = reg.data.token;
  const ord = await call('POST', '/api/orders', {
    shipping_address: '4 Main St', items: [{ bundle_id: bundle.id, quantity: 1 }],
  }, cust);
  assert.equal(ord.status, 201);
  assert.equal(ord.data.total_cents, 2160);
  assert.equal(ord.data.discount_cents, 240);
  assert.equal(ord.data.items.length, 2);
  assert.equal(ord.data.items.find((i) => i.product_id === rice.id).quantity, 2);
  assert.equal((await call('GET', '/api/products')).data.find((p) => p.id === rice.id).stock, 48, 'component stock decremented');

  // Insufficient component stock at the fulfilment location blocks a bundle order.
  const primary = (await call('GET', '/api/locations', null, admin)).data.find((l) => l.is_primary === 1);
  await call('PUT', `/api/locations/${primary.id}/inventory/${rice.id}`, { stock: 0 }, admin);
  assert.equal((await call('POST', '/api/orders', {
    shipping_address: 'x', items: [{ bundle_id: bundle.id, quantity: 1 }],
  }, cust)).status, 409);

  // Deactivating hides it from buyers but not staff.
  await call('PUT', `/api/bundles/${bundle.id}`, { active: false, savings_percent: 5 }, admin);
  assert.equal((await call('GET', '/api/bundles')).data.some((b) => b.id === bundle.id), false);
  assert.equal((await call('GET', `/api/bundles/${bundle.id}`)).status, 404);
  assert.equal((await call('GET', `/api/bundles/${bundle.id}`, null, admin)).status, 200);

  // Replacing the contents recalculates the bundle price (and reactivates it).
  const updated = (await call('PUT', `/api/bundles/${bundle.id}`, { active: true, items: [{ product_id: base.id, quantity: 4 }] }, admin)).data;
  assert.equal(updated.price_cents, 1600 - Math.floor((1600 * 5) / 100));

  // A bundle can be combined with plain products on the same order.
  const ord2 = await call('POST', '/api/orders', {
    shipping_address: 'x', items: [{ bundle_id: bundle.id, quantity: 1 }, { product_id: base.id, quantity: 1 }],
  }, cust);
  assert.equal(ord2.status, 201);
  assert.equal(ord2.data.total_cents, updated.price_cents + 400);

  assert.equal((await call('DELETE', `/api/bundles/${bundle.id}`, null, admin)).status, 204);
  assert.equal((await call('GET', `/api/bundles/${bundle.id}`)).status, 404);
});