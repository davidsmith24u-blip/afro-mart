// Customer product reviews: star ratings, optional written feedback and photo,
// with a verified-purchase badge derived from the customer's order history and
// staff moderation before a review becomes visible on the storefront.
const REVIEW_STATUSES = ['pending', 'approved', 'rejected'];
const VERIFIED_ORDER_STATUSES = ['paid', 'packed', 'shipped', 'delivered'];

function reviewPayload(db, row) {
  const author = row.author
    || (row.user_id ? db.prepare('SELECT name FROM users WHERE id = ?').get(row.user_id)?.name : null)
    || 'Afro Mart customer';
  return {
    id: row.id,
    product_id: row.product_id,
    rating: row.rating,
    title: row.title,
    body: row.body,
    image_url: row.image_url ?? null,
    verified: Boolean(row.verified),
    status: row.status,
    created_at: row.created_at,
    author,
  };
}

export function registerReviewRoutes(api) {
  const { db, route, all, get, run, transaction, reply, bad, notFound, str, int, requireUser, requireStaff, audit } = api;

  // Public: approved reviews for a product, with an average and count.
  route('GET', '/api/products/:id/reviews', (ctx) => {
    const product = get('SELECT id FROM products WHERE id = ?', ctx.params.id);
    if (!product) throw notFound();
    const rows = all(
      "SELECT * FROM product_reviews WHERE product_id = ? AND status = 'approved' ORDER BY created_at DESC, id DESC",
      ctx.params.id);
    const reviews = rows.map((row) => reviewPayload(db, row));
    const count = reviews.length;
    const average = count ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / count) * 10) / 10 : null;
    return { product_id: ctx.params.id, count, average, reviews };
  });

  // Signed-in customers write (or update) their review; it waits for moderation.
  route('POST', '/api/products/:id/reviews', (ctx) => {
    const user = requireUser(ctx);
    const product = get('SELECT id FROM products WHERE id = ? AND active = 1', ctx.params.id);
    if (!product) throw notFound();
    const rating = int(ctx.body.rating, 'rating', { min: 1 });
    if (rating > 5) throw bad('rating must be between 1 and 5');
    const title = str(ctx.body.title, 'title', { max: 120, required: false }) ?? '';
    const body = str(ctx.body.body, 'body', { max: 2000, required: false }) ?? '';
    const imageUrl = ctx.body.image_url ? str(ctx.body.image_url, 'image_url', { max: 500, required: false }) : null;
    const verified = get(
      `SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.user_id = ? AND oi.product_id = ? AND o.status IN (${VERIFIED_ORDER_STATUSES.map(() => '?').join(',')}) LIMIT 1`,
      user.id, product.id, ...VERIFIED_ORDER_STATUSES) ? 1 : 0;
    const existing = get('SELECT id FROM product_reviews WHERE product_id = ? AND user_id = ?', product.id, user.id);
    const id = transaction(db, () => {
      if (existing) {
        run("UPDATE product_reviews SET rating = ?, title = ?, body = ?, image_url = ?, verified = ?, status = 'pending' WHERE id = ?",
          rating, title, body, imageUrl, verified, existing.id);
        return existing.id;
      }
      const { lastInsertRowid } = run(
        'INSERT INTO product_reviews (product_id, user_id, rating, title, body, image_url, verified, status) VALUES (?,?,?,?,?,?,?,?)',
        product.id, user.id, rating, title, body, imageUrl, verified, 'pending');
      return Number(lastInsertRowid);
    });
    return reply(201, reviewPayload(db, get('SELECT * FROM product_reviews WHERE id = ?', id)));
  });

  // Staff: moderation queue (optionally filtered by ?status=).
  route('GET', '/api/reviews', (ctx) => {
    requireStaff(ctx);
    const status = ctx.query.get('status');
    const filtered = status && status !== 'all';
    const rows = all(
      `SELECT r.*, p.name AS product_name, u.email AS author_email
       FROM product_reviews r JOIN products p ON p.id = r.product_id
       LEFT JOIN users u ON u.id = r.user_id ${filtered ? 'WHERE r.status = ?' : ''} ORDER BY r.id DESC`,
      ...(filtered ? [status] : []));
    return rows.map((row) => ({ ...reviewPayload(db, row), product_name: row.product_name, author_email: row.author_email ?? null }));
  });

  route('PATCH', '/api/reviews/:id', (ctx) => {
    requireStaff(ctx);
    const row = get('SELECT * FROM product_reviews WHERE id = ?', ctx.params.id);
    if (!row) throw notFound();
    const status = str(ctx.body.status, 'status', { max: 20 });
    if (!REVIEW_STATUSES.includes(status)) throw bad(`status must be one of: ${REVIEW_STATUSES.join(', ')}`);
    run('UPDATE product_reviews SET status = ? WHERE id = ?', status, row.id);
    audit(ctx, 'review.moderate', 'review', row.id, status);
    return reviewPayload(db, get('SELECT * FROM product_reviews WHERE id = ?', row.id));
  });

  route('DELETE', '/api/reviews/:id', (ctx) => {
    requireStaff(ctx);
    if (!get('SELECT 1 FROM product_reviews WHERE id = ?', ctx.params.id)) throw notFound();
    run('DELETE FROM product_reviews WHERE id = ?', ctx.params.id);
    audit(ctx, 'review.delete', 'review', ctx.params.id);
    return reply(204, '');
  });
}
