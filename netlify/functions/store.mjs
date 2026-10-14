// Database lifecycle for the Netlify Function.
//
// Netlify Functions get an ephemeral filesystem, so the SQLite database is kept
// as a snapshot in Netlify Blobs: it is restored to /tmp on a cold start, seeded
// if this is the very first run, and written back after any request that changes
// data. This is fine for a small shop; Netlify itself notes that Blobs is not a
// relational database, so treat this as a pragmatic bridge, not a scale-out store.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../../src/db.js';

const DB_PATH = process.env.BLOBS_DB_PATH || join(tmpdir(), 'afromart.db');
const STORE_NAME = process.env.BLOBS_STORE || 'afromart';
const BLOB_KEY = 'afromart.db';

let storePromise;
let dbPromise;

async function blobStore() {
  if (storePromise === undefined) {
    storePromise = (async () => {
      try {
        const { getStore } = await import('@netlify/blobs');
        return getStore({ name: STORE_NAME, consistency: 'strong' });
      } catch {
        // No Blobs (local run or missing dependency): fall back to an ephemeral
        // database so the Function still works for a preview.
        return null;
      }
    })();
  }
  return storePromise;
}

async function seedDatabase() {
  const previous = process.env.DB_PATH;
  process.env.DB_PATH = DB_PATH;
  try {
    await import('../../src/seed.js');
  } finally {
    if (previous === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previous;
  }
}

// Resolved once per warm container.
export function getDatabase() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const store = await blobStore();
      let restored = false;
      if (store) {
        const snapshot = await store.get(BLOB_KEY, { type: 'arrayBuffer' });
        if (snapshot) {
          await writeFile(DB_PATH, Buffer.from(snapshot));
          restored = true;
        }
      }
      if (!restored) await seedDatabase();
      return openDb(DB_PATH);
    })();
  }
  return dbPromise;
}

// Called after requests that mutate data.
export async function persistDatabase() {
  const store = await blobStore();
  if (!store) return;
  const db = await dbPromise;
  if (!db) return;
  try {
    await store.set(BLOB_KEY, await readFile(DB_PATH));
  } catch {
    // A failed snapshot must not fail the customer's request.
  }
}

export const databasePath = DB_PATH;
