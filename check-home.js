import { readFileSync } from 'node:fs';

const s = readFileSync('public/index.html', 'utf8');
const checks = {
  mojibake: s.includes('\uFFFD'),
  'hero-home': s.includes('hero hero-home'),
  'local hero image': s.includes('src="hero-market.jpg"'),
  'benefits-bar': s.includes('benefits-bar'),
  'packs section': s.includes('id="packs"'),
  'bundle-grid': s.includes('id="bundle-grid"'),
  'emsg count': (s.match(/id="msg"/g) || []).length,
};
for (const id of ['discover', 'assistant', 'shop', 'shopping-cart', 'track', 'contact', 'catering', 'departments']) {
  checks['section ' + id] = s.includes('id="' + id + '"');
}
checks['emoji running'] = s.includes('\uFE0F') || /\p{Emoji}/u.test(s);
for (const [k, v] of Object.entries(checks)) console.log(k + ':', v);
