// Create an administrator or reset an existing account's password.
//
// Usage:
//   npm run admin:password -- owner@example.com 'new-strong-password'
//
// This is the recovery path when nobody can sign in any more (forgotten
// password, or a deploy where ADMIN_EMAIL/ADMIN_PASSWORD were never set).
// It writes to the same database the server uses (DB_PATH, default afromart.db).
import { openDb } from './db.js';
import { hashPassword } from './auth.js';

const [emailArg, password] = process.argv.slice(2);
const email = String(emailArg ?? '').trim().toLowerCase();

if (!email || !password) {
  console.error("Usage: npm run admin:password -- owner@example.com 'new-strong-password'");
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const db = openDb(process.env.DB_PATH || 'afromart.db');
const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);

if (existing) {
  db.prepare("UPDATE users SET password_hash = ?, role = 'admin' WHERE id = ?").run(hashPassword(password), existing.id);
  console.log(`Password updated. ${email} can now sign in at /admin.`);
} else {
  db.prepare("INSERT INTO users (email, name, password_hash, role) VALUES (?, 'Administrator', ?, 'admin')")
    .run(email, hashPassword(password));
  console.log(`Administrator created. ${email} can now sign in at /admin.`);
}

db.close();
