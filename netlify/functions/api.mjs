// Netlify Function entry point.
//
// Adapts the zero-dependency Node HTTP app (createApp) to Netlify's web-standard
// Request/Response handler, and snapshots the SQLite database to Netlify Blobs
// after every request that changes data.
import { Readable } from 'node:stream';
import { createApp } from '../../src/app.js';
import { getDatabase, persistDatabase } from './store.mjs';

let appPromise;
function app() {
  if (!appPromise) {
    appPromise = (async () => createApp(await getDatabase(), { secret: process.env.AUTH_SECRET || undefined }))();
  }
  return appPromise;
}

// Netlify rewrites /api/* to /.netlify/functions/api/*; depending on the runtime
// the Function sees either the original path or the rewritten one. Normalise to
// the /api/... shape the app expects.
function requestUrl(request) {
  const url = new URL(request.url);
  const marker = '/.netlify/functions/api';
  if (url.pathname === marker || url.pathname.startsWith(marker + '/')) {
    return new URL('/api' + url.pathname.slice(marker.length) + url.search, 'http://localhost');
  }
  return new URL(url.pathname + url.search, 'http://localhost');
}

function toNodeRequest(request, body) {
  const req = Readable.from(body && body.length ? [body] : []);
  req.method = request.method;
  req.url = requestUrl(request).pathname + requestUrl(request).search;
  req.headers = {};
  for (const [key, value] of request.headers) req.headers[key.toLowerCase()] = value;
  return req;
}

function captureResponse() {
  const state = { status: 200, headers: {}, chunks: [] };
  const res = {
    writeHead(status, headers) { state.status = status; Object.assign(state.headers, headers); },
    setHeader(key, value) { state.headers[key] = value; },
    removeHeader(key) { delete state.headers[key]; },
    flushHeaders() {},
    end(chunk) {
      if (chunk !== undefined && chunk !== null && chunk !== '') {
        state.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
    },
  };
  return { res, state };
}

export default async (request) => {
  const handler = await app();
  const method = request.method.toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? null : Buffer.from(await request.arrayBuffer());

  const { res, state } = captureResponse();
  await handler(toNodeRequest(request, body), res);

  if (method !== 'GET' && method !== 'HEAD') await persistDatabase();

  const headers = new Headers();
  for (const [key, value] of Object.entries(state.headers)) {
    if (key.toLowerCase() === 'content-length') continue;
    headers.set(key, String(value));
  }
  const payload = state.chunks.length ? Buffer.concat(state.chunks) : null;
  return new Response(payload, { status: state.status, headers });
};
