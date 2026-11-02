// First-run administrator setup and password changes for the staff dashboard.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

let server, base;

before(async () => {
  server = createServer(createApp(openDb(), { secret: 'test' }));
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

async function call(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

test('first-run setup creates the administrator, then closes and allows sign-in', async () => {
  assert.equal((await call('GET', '/api/auth/setup')).data.needed, true);

  // A customer account is not staff, so setup must stay open.
  await call('POST', '/api/auth/register', { email: 'shopper@x.com', name: 'Shopper', password: 'password1' });
  assert.equal((await call('GET', '/api/auth/setup')).data.needed, true);

  // Short passwords and missing fields are rejected without creating an account.
  assert.equal((await call('POST', '/api/auth/setup', { email: 'owner@x.com', name: 'Owner', password: 'short' })).status, 400);
  assert.equal((await call('POST', '/api/auth/setup', { email: 'owner@x.com', name: 'Owner' })).status, 400);

  const created = await call('POST', '/api/auth/setup', { email: 'Owner@X.com', name: 'Owner', password: 'strongpass1' });
  assert.equal(created.status, 201);
  assert.equal(created.data.user.email, 'owner@x.com');
  assert.equal(created.data.user.role, 'admin');
  assert.ok(created.data.token);

  assert.equal((await call('GET', '/api/auth/setup')).data.needed, false);
  assert.equal((await call('POST', '/api/auth/setup', { email: 'other@x.com', name: 'Other', password: 'strongpass2' })).status, 403);

  const login = await call('POST', '/api/auth/login', { email: 'owner@x.com', password: 'strongpass1' });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.role, 'admin');

  // The new administrator can change their own password and sign in with it.
  const wrong = await call('PATCH', '/api/me/password', { current_password: 'nope', new_password: 'newpass123' }, created.data.token);
  assert.equal(wrong.status, 403);
  const changed = await call('PATCH', '/api/me/password', { current_password: 'strongpass1', new_password: 'newpass123' }, created.data.token);
  assert.equal(changed.status, 200);
  assert.equal((await call('POST', '/api/auth/login', { email: 'owner@x.com', password: 'strongpass1' })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { email: 'owner@x.com', password: 'newpass123' })).status, 200);
});
