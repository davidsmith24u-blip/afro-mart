// Crawlable product pages + dynamic sitemap (src/seo.js): the storefront is a
// single-page app, so these server-rendered pages are what actually gives Google a
// URL with Product/Offer structured data to build rich results from.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { productPath, productIdFromSlug, productSlug, SITE_URL } from '../src/seo.js';

let server, base, db, admin;
let inStock, outOfStock, hidden, otherRegion;

async function call(method, path, body, token) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(base + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, headers: res.headers };
}

// Raw GET for HTML/XML, whose bodies are not JSON.
async function get(path) {
  const res = await fetch(base + path);
  return { status: res.status, body: await res.text(), headers: res.headers };
}

function jsonLdFrom(html) {
  const match = html.match(/<script type="application\/ld\+json" nonce="([^"]*)">([\s\S]*?)<\/script>/);
  assert.ok(match, 'expected a nonce-carrying JSON-LD block');
  return { nonce: match[1], data: JSON.parse(match[2]) };
}

const tag = (productId, kind, value) =>
  db.prepare('INSERT INTO product_tags (product_id, kind, value) VALUES (?,?,?)').run(productId, kind, value);

before(async () => {
  db = openDb();
  db.prepare("INSERT INTO users (email,name,password_hash,role) VALUES ('seo@x.com','Seo',?, 'admin')")
    .run(hashPassword('adminpass1'));
  server = createServer(createApp(db, { secret: 'test' }));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  admin = (await call('POST', '/api/auth/login', { email: 'seo@x.com', password: 'adminpass1' })).data.token;

  const dry = (await call('POST', '/api/categories', { name: 'Dry Goods' }, admin)).data;
  const oils = (await call('POST', '/api/categories', { name: 'Oils & Condiments' }, admin)).data;

  const make = async (sku, name, category_id, stock) =>
    (await call('POST', '/api/products', {
      sku, name, category_id, price_cents: 500, stock, description: `${name} straight from the market.`,
    }, admin)).data;

  inStock = await make('NG-1', 'Ijebu Garri', dry.id, 20);
  outOfStock = await make('NG-2', 'Egusi Seeds', dry.id, 0);
  hidden = await make('OIL-1', 'Red Palm Oil', oils.id, 10);
  otherRegion = await make('ZA-1', 'Biltong', dry.id, 10);

  tag(inStock.id, 'origin', 'NG');
  tag(outOfStock.id, 'origin', 'NG');
  tag(hidden.id, 'origin', 'NG');
  tag(otherRegion.id, 'origin', 'ZA');

  // A review so the page (and its structured data) carries a rating.
  db.prepare("INSERT INTO product_reviews (product_id, user_id, rating, status, body) VALUES (?,?,?,?,?)")
    .run(inStock.id, null, 5, 'approved', 'Tastes like home.');
});

after(() => server.close());

test('seo: slugs keep the id so a renamed product still resolves', () => {
  assert.equal(productSlug(inStock), `ijebu-garri-${inStock.id}`);
  assert.equal(productPath(inStock), `/product/ijebu-garri-${inStock.id}`);
  assert.equal(productIdFromSlug(productPath(inStock).split('/').pop()), inStock.id);
  assert.equal(productIdFromSlug('some-renamed-product-42'), 42);
  assert.equal(productIdFromSlug('no-digits-here'), null);
  assert.equal(productIdFromSlug(''), null);
});

test('seo: the API exposes the crawlable path for each product', async () => {
  const rows = (await call('GET', '/api/products')).data;
  const garri = rows.find((row) => row.sku === 'NG-1');
  assert.equal(garri.path, `/product/ijebu-garri-${inStock.id}`);
});

test('seo: a product page renders the name, price, stock and rating', async () => {
  const res = await get(productPath(inStock));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);

  const html = res.body;
  assert.match(html, /<title>Ijebu Garri — AFROMART<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/afromartz\.biz\/product\/ijebu-garri-\d+">/);
  assert.ok(html.includes('€5.00'), 'price is shown');
  assert.ok(html.includes('In stock'), 'availability is shown');
  assert.ok(html.includes('5.0'), 'the rating value is shown');
  assert.ok(html.includes(`/?add=${inStock.id}#shopping-cart`), 'the add-to-bag link deep-links into the shop');
  assert.ok(html.includes('Egusi Seeds'), 'related products link onwards');
});

test('seo: the page carries valid Product structured data', async () => {
  const { data } = jsonLdFrom((await get(productPath(inStock))).body);
  assert.equal(data['@context'], 'https://schema.org');

  const product = data['@graph'].find((node) => node['@type'] === 'Product');
  assert.ok(product, 'expected a Product node');
  assert.equal(product.name, 'Ijebu Garri');
  assert.equal(product.sku, 'NG-1');
  assert.deepEqual(product.image, [`${SITE_URL}/products/staples.jpg`]);
  assert.equal(product.offers['@type'], 'Offer');
  assert.equal(product.offers.price, '5.00');
  assert.equal(product.offers.priceCurrency, 'EUR');
  assert.equal(product.offers.availability, 'https://schema.org/InStock');
  assert.equal(product.offers.itemCondition, 'https://schema.org/NewCondition');
  assert.equal(product.aggregateRating.ratingValue, 5);
  assert.equal(product.aggregateRating.reviewCount, 1);

  const crumbs = data['@graph'].find((node) => node['@type'] === 'BreadcrumbList');
  assert.equal(crumbs.itemListElement.length, 3);
  assert.deepEqual(crumbs.itemListElement.map((c) => c.name), ['Home', 'Dry Goods', 'Ijebu Garri']);
});

test('seo: the JSON-LD nonce matches the CSP header, and no hash is needed', async () => {
  const res = await get(productPath(inStock));
  const { nonce } = jsonLdFrom(res.body);
  const csp = res.headers.get('content-security-policy');
  assert.ok(nonce.length > 10, 'expected a real nonce');
  assert.ok(csp.includes(`'nonce-${nonce}'`), 'CSP must allow exactly this nonce');
  assert.ok(!csp.includes('unsafe-inline'), 'CSP must stay strict');
  assert.ok(!/script-src[^;]*sha256-/.test(csp), 'dynamic pages use a nonce, not a fixed hash');
});

test('seo: out-of-stock products say so, in the page and in the markup', async () => {
  const res = await get(productPath(outOfStock));
  assert.equal(res.status, 200);
  assert.ok(res.body.includes('Currently out of stock'));
  assert.ok(res.body.includes('Out of stock'));
  assert.ok(!res.body.includes(`/?add=${outOfStock.id}`), 'no add-to-bag link when empty');

  const { data } = jsonLdFrom(res.body);
  const product = data['@graph'].find((node) => node['@type'] === 'Product');
  assert.equal(product.offers.availability, 'https://schema.org/OutOfStock');
  assert.ok(!product.aggregateRating, 'no rating node without reviews');
});

test('seo: hidden and out-of-scope products have no public page', async () => {
  assert.equal((await get(productPath(hidden))).status, 404);
  assert.equal((await get(productPath(otherRegion))).status, 404);
  assert.equal((await get('/product/nope-999999')).status, 404);
  assert.equal((await get('/product/not-a-slug')).status, 404);
});

test('seo: the sitemap lists in-scope product pages', async () => {
  const res = await get('/sitemap.xml');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/xml/);
  assert.ok(res.body.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(res.body.includes(`<loc>${SITE_URL}/</loc>`));
  assert.ok(res.body.includes(`<loc>${SITE_URL}${productPath(inStock)}</loc>`));
  assert.ok(res.body.includes(`<loc>${SITE_URL}${productPath(outOfStock)}</loc>`));
  assert.ok(!res.body.includes(productSlug(otherRegion)), 'out-of-scope products stay out');
  assert.ok(!res.body.includes(productSlug(hidden)), 'hidden departments stay out');
});

test('seo: the merchant feed lists in-scope products with prices and stock', async () => {
  const res = await get('/feed.xml');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/xml/);
  assert.ok(res.body.includes('xmlns:g="http://base.google.com/ns/1.0"'));

  assert.ok(res.body.includes('<g:id>NG-1</g:id>'), 'the SKU is the item id');
  assert.ok(res.body.includes('Ijebu Garri'));
  assert.ok(res.body.includes(`<g:link>${SITE_URL}/product/ijebu-garri-${inStock.id}</g:link>`));
  assert.ok(res.body.includes('<g:image_link>http'), 'image links are absolute');
  assert.ok(res.body.includes('<g:price>5.00 EUR</g:price>'));
  assert.ok(res.body.includes('<g:availability>in stock</g:availability>'));
  assert.ok(res.body.includes('<g:availability>out of stock</g:availability>'));
  assert.ok(res.body.includes('<g:condition>new</g:condition>'));
  assert.ok(res.body.includes('<g:google_product_category>Food, Beverages &amp; Tobacco &gt; Food Items</g:google_product_category>'));

  assert.ok(!res.body.includes('Biltong'), 'out-of-scope products stay out of the feed');
  assert.ok(!res.body.includes('Red Palm Oil'), 'hidden departments stay out of the feed');
});

test('seo: HTML escaping keeps a hostile product name inert', async () => {
  const nasty = (await call('POST', '/api/products', {
    sku: 'XSS-1',
    name: '<script>alert(1)</script> "Quoted" & Co',
    category_id: null,
    price_cents: 100,
    stock: 3,
  }, admin)).data;
  const res = await get(productPath(nasty));
  assert.equal(res.status, 200);
  assert.ok(!res.body.includes('<script>alert(1)</script>'), 'the name must be escaped');
  assert.ok(res.body.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!res.body.includes('</script><script>'), 'the JSON-LD must not be breakable');
});
