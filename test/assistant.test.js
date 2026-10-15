import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';

let server, base, db, admin;
let provider, providerBase;

before(async () => {
  delete process.env.AI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.AI_BASE_URL;
  delete process.env.AI_MODEL;
  delete process.env.AI_PROVIDER;

  db = openDb();
  db.prepare("INSERT INTO users (email,name,password_hash,role) VALUES ('boss@x.com','Boss',?, 'admin')").run(hashPassword('adminpass1'));
  server = createServer(createApp(db, { secret: 'test' }));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;

  admin = (await call('POST', '/api/auth/login', { email: 'boss@x.com', password: 'adminpass1' })).data.token;
  const garri = (await call('POST', '/api/products', { sku: 'GAR-1', name: 'Ijebu Garri', price_cents: 350, stock: 40 }, admin)).data;
  const spinach = (await call('POST', '/api/products', { sku: 'SPI-1', name: 'Frozen Spinach', price_cents: 250, stock: 40 }, admin)).data;
  const oil = (await call('POST', '/api/products', { sku: 'OIL-1', name: 'Palm Oil', price_cents: 500, stock: 40 }, admin)).data;
  await call('POST', '/api/recipes', {
    title: 'Eba & Efo Riro',
    description: 'Comforting garri swallow with a rich spinach stew.',
    emoji: '🥬',
    prep_minutes: 25,
    servings: 4,
    ingredients: [
      { product_id: garri.id, quantity: 1 },
      { product_id: spinach.id, quantity: 2 },
      { product_id: oil.id, quantity: 1 },
    ],
  }, admin);
});

after(() => {
  server.close();
  provider?.close();
});

async function call(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

test('assistant reports itself disabled when no provider key is configured', async () => {
  const { data } = await call('GET', '/api/config');
  assert.equal(data.ai.enabled, false);
});

test('cook matches pantry items to a recipe and lists only what is missing', async () => {
  const { status, data } = await call('POST', '/api/assistant/cook', { pantry: 'garri, spinach' });
  assert.equal(status, 200);
  assert.equal(data.ai, false);
  assert.deepEqual(data.pantry, ['garri', 'spinach']);
  assert.equal(data.matches.length, 1);
  const match = data.matches[0];
  assert.equal(match.title, 'Eba & Efo Riro');
  assert.equal(match.coverage, 67);
  assert.deepEqual(match.have.sort(), ['Frozen Spinach', 'Ijebu Garri']);
  assert.equal(match.missing.length, 1);
  assert.equal(match.missing[0].name, 'Palm Oil');
  assert.equal(match.missing[0].kind, 'product');
  // The shopping list only contains the missing line.
  assert.deepEqual(match.add_missing.map((item) => item.quantity), [1]);
  assert.equal(match.add_all.length, 3);
  assert.equal(match.missing_price_cents, 500);
});

test('cook understands local names and scales quantities for guests', async () => {
  const { data } = await call('POST', '/api/assistant/cook', { pantry: ['eba', 'ugu'], guests: 8 });
  assert.equal(data.matches.length, 1);
  const match = data.matches[0];
  assert.equal(match.scale_factor, 2); // recipe serves 4, cooking for 8
  assert.deepEqual(match.have.sort(), ['Frozen Spinach', 'Ijebu Garri']);
  assert.deepEqual(match.add_all.map((item) => item.quantity).sort((a, b) => a - b), [2, 2, 4]);
});

test('cook validates its input', async () => {
  assert.equal((await call('POST', '/api/assistant/cook', { pantry: '   ' })).status, 400);
  assert.equal((await call('POST', '/api/assistant/cook', { pantry: 'garri', guests: 500 })).status, 400);
  // Unrecognised pantry still returns something helpful rather than an empty list.
  const { data } = await call('POST', '/api/assistant/cook', { pantry: 'saffron truffle' });
  assert.equal(data.matches.length, 0);
  assert.equal(data.suggestions.length, 1);
});

test('chat answers with grounded catalogue matches and no LLM when disabled', async () => {
  const { status, data } = await call('POST', '/api/assistant/chat', { messages: [{ role: 'user', content: 'Do you sell garri?' }] });
  assert.equal(status, 200);
  assert.equal(data.ai, false);
  assert.match(data.reply, /garri/i);
  assert.ok(data.products.some((product) => product.name === 'Ijebu Garri'));
  // Suggestion cards carry the fields the storefront needs to add to the bag.
  assert.ok(data.products.every((product) => typeof product.id === 'number' && typeof product.price_cents === 'number'));
});

test('chat validates its input', async () => {
  assert.equal((await call('POST', '/api/assistant/chat', {})).status, 400);
  assert.equal((await call('POST', '/api/assistant/chat', { messages: [] })).status, 400);
  const many = Array.from({ length: 13 }, () => ({ role: 'user', content: 'hi' }));
  assert.equal((await call('POST', '/api/assistant/chat', { messages: many })).status, 400);
});

test('the copywriter is staff-only and refuses to run without a provider', async () => {
  assert.equal((await call('POST', '/api/assistant/product-copy', { product_id: 1 })).status, 401);
  const res = await call('POST', '/api/assistant/product-copy', { product_id: 1 }, admin);
  assert.equal(res.status, 503);
});

test('with a provider configured, the assistant parses, writes and translates', async () => {
  providerBase = await startProvider();
  process.env.AI_API_KEY = 'test-key';
  process.env.AI_BASE_URL = providerBase;
  process.env.AI_MODEL = 'test-model';

  assert.equal((await call('GET', '/api/config')).data.ai.enabled, true);

  // The model is used to normalise messy prose, then deterministic matching runs.
  const cook = await call('POST', '/api/assistant/cook', { pantry: "I've got a bit of garri and some spinach" });
  assert.equal(cook.data.ai, true);
  assert.deepEqual(cook.data.pantry, ['garri', 'spinach']);
  assert.match(cook.data.tip, /delicious/i);
  assert.equal(cook.data.matches[0].title, 'Eba & Efo Riro');

  const chat = await call('POST', '/api/assistant/chat', { messages: [{ role: 'user', content: 'Do you sell garri?' }] });
  assert.equal(chat.data.ai, true);
  assert.match(chat.data.reply, /assistant reply/i);
  assert.ok(chat.data.products.length);

  const product = db.prepare("SELECT id FROM products WHERE sku = 'GAR-1'").get();
  const copy = await call('POST', '/api/assistant/product-copy', { product_id: product.id, keywords: 'stone-free' }, admin);
  assert.equal(copy.status, 200);
  assert.equal(copy.data.descriptions.en.includes('Stone-free'), true);
  assert.equal(copy.data.descriptions.de.startsWith('DE:'), true);
  assert.equal(copy.data.descriptions.fr.startsWith('FR:'), true);

  // A malformed model answer must fail loudly rather than corrupt the catalogue.
  provider.replyWith('not json at all');
  const broken = await call('POST', '/api/assistant/product-copy', { product_id: product.id }, admin);
  assert.equal(broken.status, 502);

  delete process.env.AI_API_KEY;
  delete process.env.AI_BASE_URL;
  delete process.env.AI_MODEL;
});

// A tiny OpenAI-compatible server so the LLM path is exercised deterministically.
function startProvider() {
  return new Promise((resolve) => {
    let override = null;
    const respond = (prompt) => {
      if (override) return override;
      if (prompt.includes('Extract the ingredients')) {
        return JSON.stringify({ items: ['garri', 'spinach'], tip: 'A delicious pot of efo riro is minutes away.' });
      }
      if (prompt.includes('faithful translations')) {
        return JSON.stringify({
          en: 'Stone-free Ijebu garri, ground fine for smooth eba and drinking.',
          de: 'DE: Stein-freies Ijebu-Garri, fein gemahlen für glattes Eba.',
          fr: 'FR: Garri Ijebu sans cailloux, moulu fin pour un eba lisse.',
        });
      }
      return 'This is an assistant reply about garri.';
    };
    provider = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        const prompt = raw;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: respond(prompt) } }] }));
      });
    });
    provider.replyWith = (value) => { override = value; };
    provider.listen(0, () => resolve(`http://localhost:${provider.address().port}`));
  });
}
