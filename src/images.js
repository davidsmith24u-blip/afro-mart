// Uploaded imagery (product photos, review photos). Stored inline in SQLite as a
// BLOB so it travels with the Netlify Blobs database snapshot — no separate
// object store, no extra dependency.
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const MAX_IMAGE_BYTES = 3_000_000;

// Accepts either a bare base64 string or a full `data:<mime>;base64,...` URL.
function decodeBase64(data) {
  const value = String(data ?? '');
  const comma = value.indexOf(',');
  const raw = value.startsWith('data:') && comma !== -1 ? value.slice(comma + 1) : value;
  if (!raw) return null;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(raw)) return null;
  const buffer = Buffer.from(raw, 'base64');
  return buffer.length ? buffer : null;
}

export function registerImageRoutes(api) {
  const { route, get, run, reply, bad, notFound, str, requireUser, requireStaff } = api;

  // Upload an image (product photo by staff, review photo by any signed-in customer);
  // returns a URL that can be stored on a product or review.
  route('POST', '/api/images', (ctx) => {
    requireUser(ctx);
    const mime = str(ctx.body.content_type ?? ctx.body.mime, 'content_type', { max: 60 }).toLowerCase();
    if (!ALLOWED_MIME.has(mime)) throw bad('Unsupported image type (use JPEG, PNG, WebP, GIF or AVIF)');
    const bytes = decodeBase64(ctx.body.data);
    if (!bytes) throw bad('data must be a base64-encoded image');
    if (bytes.length > MAX_IMAGE_BYTES) throw bad('Image must be 3MB or smaller');
    const { lastInsertRowid } = run('INSERT INTO images (mime, bytes) VALUES (?, ?)', mime, bytes);
    const id = Number(lastInsertRowid);
    return reply(201, { id, url: `/api/images/${id}`, mime, bytes: bytes.length });
  });

  // Serve the stored bytes. Immutable so browsers and the CDN cache aggressively.
  route('GET', '/api/images/:id', (ctx) => {
    const img = get('SELECT id, mime, bytes FROM images WHERE id = ?', ctx.params.id);
    if (!img) throw notFound();
    const buffer = Buffer.isBuffer(img.bytes) ? img.bytes : Buffer.from(img.bytes);
    return reply(200, buffer, {
      'Content-Type': img.mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
  });

  route('DELETE', '/api/images/:id', (ctx) => {
    requireStaff(ctx);
    if (!get('SELECT 1 FROM images WHERE id = ?', ctx.params.id)) throw notFound();
    run('DELETE FROM images WHERE id = ?', ctx.params.id);
    return reply(204, '');
  });
}
