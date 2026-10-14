// First-run bootstrap shared by the local server and the Netlify Function.
//
// The admin account is created from ADMIN_EMAIL/ADMIN_PASSWORD when configured and
// not already present. Keeping this in one place means a fresh deploy can be
// administered without shell access to the database.
import { hashPassword } from './auth.js';

export function ensureAdmin(db, env = process.env) {
  const email = String(env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = String(env.ADMIN_PASSWORD ?? '');
  if (!email || !password) return false;
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return false;
  db.prepare("INSERT INTO users (email, name, password_hash, role) VALUES (?, 'Administrator', ?, 'admin')")
    .run(email, hashPassword(password));
  return true;
}
