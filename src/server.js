import { createServer } from 'node:http';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { hashPassword } from './auth.js';

const db = openDb(process.env.DB_PATH || 'afromart.db');

if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  const email = process.env.ADMIN_EMAIL.toLowerCase();
  if (!db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    db.prepare("INSERT INTO users (email, name, password_hash, role) VALUES (?, 'Administrator', ?, 'admin')")
      .run(email, hashPassword(process.env.ADMIN_PASSWORD));
    console.log(`Created admin user ${email}`);
  }
}

if (!process.env.AUTH_SECRET) {
  console.warn('AUTH_SECRET not set: using a random secret; sessions will not survive restarts.');
}

const port = Number(process.env.PORT) || 3000;
createServer(createApp(db, { secret: process.env.AUTH_SECRET || undefined }))
  .listen(port, () => console.log(`Afro Mart listening on http://localhost:${port}`));
