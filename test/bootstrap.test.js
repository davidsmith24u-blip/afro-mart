// The first-run admin bootstrap used by both the server and the Netlify Function.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { ensureAdmin } from '../src/bootstrap.js';

test('ensureAdmin creates the configured admin once and is idempotent', () => {
  const db = openDb();

  // No configuration -> nothing happens.
  assert.equal(ensureAdmin(db, {}), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);

  // Missing one half of the credentials -> still nothing.
  assert.equal(ensureAdmin(db, { ADMIN_EMAIL: 'x@y.com' }), false);
  assert.equal(ensureAdmin(db, { ADMIN_PASSWORD: 'x' }), false);
  assert.equal(ensureAdmin(db, { ADMIN_EMAIL: '', ADMIN_PASSWORD: '' }), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);

  // Configured -> one admin, email normalised.
  assert.equal(ensureAdmin(db, { ADMIN_EMAIL: 'Boss@Example.com', ADMIN_PASSWORD: 'supersecret' }), true);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get('boss@example.com');
  assert.equal(user.role, 'admin');
  assert.equal(user.name, 'Administrator');

  // Second run does not duplicate or overwrite.
  assert.equal(ensureAdmin(db, { ADMIN_EMAIL: 'boss@example.com', ADMIN_PASSWORD: 'different' }), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);

  db.close();
});
