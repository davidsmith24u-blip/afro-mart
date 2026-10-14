import { createServer } from 'node:http';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { ensureAdmin } from './bootstrap.js';

const db = openDb(process.env.DB_PATH || 'afromart.db');

if (ensureAdmin(db)) console.log(`Created admin user ${process.env.ADMIN_EMAIL.toLowerCase()}`);

if (!process.env.AUTH_SECRET) {
  console.warn('AUTH_SECRET not set: using a random secret; sessions will not survive restarts.');
}

const port = Number(process.env.PORT) || 3000;
createServer(createApp(db, { secret: process.env.AUTH_SECRET || undefined }))
  .listen(port, () => console.log(`Afro Mart listening on http://localhost:${port}`));
