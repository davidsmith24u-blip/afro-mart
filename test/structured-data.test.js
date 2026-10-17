// Rich results need the inline JSON-LD in public/index.html to actually reach Google.
// The storefront runs under a strict CSP, so that one block is allow-listed by its
// sha256 hash. These tests keep the markup valid and the hash in sync with the CSP in
// netlify.toml and src/app.js — if the JSON-LD changes and a hash assertion fails, copy
// the hash printed in the failure message into both files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

function inlineJsonLd(source) {
  const blocks = [...source.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.equal(blocks.length, 1, 'expected exactly one inline JSON-LD block in public/index.html');
  return blocks[0][1];
}

const jsonLd = inlineJsonLd(read('../public/index.html'));

test('structured data: the inline JSON-LD is valid and describes the store', () => {
  const data = JSON.parse(jsonLd);
  assert.equal(data['@context'], 'https://schema.org');
  const types = data['@graph'].map((node) => node['@type']);
  assert.ok(types.includes('OnlineStore'), 'expected an OnlineStore node');
  assert.ok(types.includes('WebSite'), 'expected a WebSite node');

  const store = data['@graph'].find((node) => node['@type'] === 'OnlineStore');
  assert.equal(store.url, 'https://afromartz.biz/');
  assert.equal(store.logo.url, 'https://afromartz.biz/logo.png');
  assert.equal(store.logo.width, 512);
  assert.equal(store.logo.height, 512);
  assert.equal(store.areaServed.name, 'Germany');
});

test('structured data: the logo is a served raster image (Google rejects SVG logos)', () => {
  const png = readFileSync(new URL('../public/logo.png', import.meta.url));
  assert.ok(statSync(new URL('../public/logo.png', import.meta.url)).size > 1000, 'logo.png looks empty');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'logo.png must be a PNG');
  assert.equal(png.readUInt32BE(16), 512, 'logo.png width');
  assert.equal(png.readUInt32BE(20), 512, 'logo.png height');
});

test('structured data: the CSP allows the JSON-LD hash, and only that inline script', () => {
  const hash = `'sha256-${createHash('sha256').update(Buffer.from(jsonLd, 'utf8')).digest('base64')}'`;
  for (const file of ['../netlify.toml', '../src/app.js']) {
    const source = read(file);
    assert.ok(
      source.includes(`script-src 'self' ${hash}`),
      `${file} must allow the JSON-LD hash ${hash} in script-src`,
    );
  }
});

test('structured data: script-src stays strict (no unsafe-inline / unsafe-eval)', () => {
  const csp = read('../netlify.toml').match(/Content-Security-Policy = "([^"]+)"/)[1];
  assert.match(csp, /script-src 'self' 'sha256-[^']+'/, 'script-src should be self plus the JSON-LD hash');
  assert.ok(!csp.includes("'unsafe-inline'"), 'CSP must not enable unsafe-inline');
  assert.ok(!csp.includes("'unsafe-eval'"), 'CSP must not enable unsafe-eval');
});
