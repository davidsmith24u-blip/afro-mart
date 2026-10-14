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

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQAY3Y2wAAAAAElFTkSuQmCC';

test('images: staff upload, public serve, permissions and validation', async () => {
  const admin = (await call('POST', '/api/auth/login', { email: 'boss@x.com', password: 'adminpass1' })).data.token;
  const cust = (await call('POST', '/api/auth/register', { email: 'shopper@x.com', name: 'Shopper', password: 'password1' })).data.token;

  assert.equal((await call('POST', '/api/images', { content_type: 'image/png', data: PNG })).status, 401);
  assert.equal((await call('POST', '/api/images', { content_type: 'text/plain', data: PNG }, admin)).status, 400);
  assert.equal((await call('POST', '/api/images', { content_type: 'image/png', data: 'not base64!!' }, admin)).status, 400);

  // Any signed-in customer may upload (they need it to attach a review photo).
  assert.equal((await call('POST', '/api/images', { content_type: 'image/png', data: PNG }, cust)).status, 201);

  const up = await call('POST', '/api/images', { content_type: 'image/png', data: `data:image/png;base64,${PNG}` }, admin);
  assert.equal(up.status, 201);
  assert.match(up.data.url, /^\/api\/images\/\d+$/);

  const img = await fetch(base + up.data.url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.match(img.headers.get('cache-control') || '', /immutable/);
  const bytes = Buffer.from(await img.arrayBuffer());
  assert.ok(bytes.length > 0);
  assert.equal(bytes.toString('base64'), PNG);

  assert.equal((await call('GET', '/api/images/999999')).status, 404);
  assert.equal((await call('DELETE', up.data.url, undefined, cust)).status, 403);
  assert.equal((await call('DELETE', up.data.url, undefined, admin)).status, 204);
  assert.equal((await call('GET', up.data.url)).status, 404);
});

test('reviews: pending queue, aggregation, verification and moderation', async () => {
  const admin = (await call('POST', '/api/auth/login', { email: 'boss@x.com', password: 'adminpass1' })).data.token;
  const prod = (await call('POST', '/api/products', { sku: 'REV-1', name: 'Suya Spice', price_cents: 500, stock: 10 }, admin)).data;

  const reg = await call('POST', '/api/auth/register', { email: 'rater@x.com', name: 'Ada', password: 'password1' });
  const cust = reg.data.token;
  const custId = reg.data.user.id;

  // Anonymous reviews are rejected.
  assert.equal((await call('POST', `/api/products/${prod.id}/reviews`, { rating: 5 })).status, 401);
  assert.equal((await call('POST', `/api/products/${prod.id}/reviews`, { rating: 9 }, cust)).status, 400);

  const made = await call('POST', `/api/products/${prod.id}/reviews`, { rating: 5, title: 'Just like home', body: 'Perfect heat.' }, cust);
  assert.equal(made.status, 201);
  assert.equal(made.data.status, 'pending');
  assert.equal(made.data.verified, false);
  assert.equal(made.data.author, 'Ada');

  // Pending reviews are hidden from the public and don't affect the average.
  const publicBefore = await call('GET', `/api/products/${prod.id}/reviews`);
  assert.equal(publicBefore.data.count, 0);
  assert.equal((await call('GET', `/api/products/${prod.id}`)).data.rating_count, 0);

  // Staff moderation queue sees it, then approves.
  const queue = await call('GET', '/api/reviews?status=pending', undefined, admin);
  assert.equal(queue.status, 200);
  assert.ok(queue.data.some((r) => r.id === made.data.id && r.product_name === 'Suya Spice'));
  assert.equal((await call('PATCH', `/api/reviews/${made.data.id}`, { status: 'nope' }, admin)).status, 400);
  assert.equal((await call('PATCH', `/api/reviews/${made.data.id}`, { status: 'approved' }, admin)).data.status, 'approved');
  assert.equal((await call('PATCH', `/api/reviews/${made.data.id}`, { status: 'approved' }, cust)).status, 403);

  const publicAfter = await call('GET', `/api/products/${prod.id}/reviews`);
  assert.equal(publicAfter.data.count, 1);
  assert.equal(publicAfter.data.average, 5);
  const single = (await call('GET', `/api/products/${prod.id}`)).data;
  assert.equal(single.rating_average, 5);
  assert.equal(single.rating_count, 1);

  // Buying (and paying for) the product makes the next review a verified one.
  const order = await call('POST', '/api/orders', { shipping_address: '1 Main St', items: [{ product_id: prod.id, quantity: 1 }] }, cust);
  db.prepare("UPDATE orders SET status = 'paid' WHERE id = ?").run(order.data.id);
  const again = await call('POST', `/api/products/${prod.id}/reviews`, { rating: 4, title: 'Still great', body: 'Second thoughts.' }, cust);
  assert.equal(again.status, 201);
  assert.equal(again.data.verified, true);
  // One review per customer per product: the second write updates the first.
  assert.equal(again.data.id, made.data.id);
  assert.equal((await call('GET', `/api/products/${prod.id}/reviews`)).data.count, 0); // back to pending

  assert.equal((await call('DELETE', `/api/reviews/${made.data.id}`, undefined, cust)).status, 403);
  assert.equal((await call('DELETE', `/api/reviews/${made.data.id}`, undefined, admin)).status, 204);
});

test('products: image_url round-trips through staff writes', async () => {
  const admin = (await call('POST', '/api/auth/login', { email: 'boss@x.com', password: 'adminpass1' })).data.token;
  const prod = (await call('POST', '/api/products', { sku: 'IMG-1', name: 'Palm Oil', price_cents: 900, stock: 5 }, admin)).data;
  assert.equal(prod.image_url, null);

  const put = await call('PUT', `/api/products/${prod.id}`, { image_url: '/api/images/1' }, admin);
  assert.equal(put.status, 200);
  assert.equal(put.data.image_url, '/api/images/1');
  assert.equal((await call('GET', `/api/products/${prod.id}`)).data.image_url, '/api/images/1');

  const cleared = await call('PUT', `/api/products/${prod.id}`, { image_url: null }, admin);
  assert.equal(cleared.data.image_url, null);
});
