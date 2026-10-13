// Delivery areas & fulfilment fee calculation.
// Free by default; set DELIVERY_FEE_DEFAULT_CENTS to charge a flat fee outside
// configured areas.
const DEFAULT_FEE_CENTS = () => Math.max(0, Number(process.env.DELIVERY_FEE_DEFAULT_CENTS) || 0);

// Match a German postal code (or area prefix) to a delivery area and compute the
// fee for a goods subtotal. The longest matching postal prefix wins; if no area
// matches, a default surcharge applies. Orders under an area's minimum get a
// shortfall surcharge on top.
export function deliveryFeeFor(db, address, subtotalCents) {
  const postal = String(address || '').match(/(\d{5})/)?.[1] ?? '';
  if (!postal) return DEFAULT_FEE_CENTS();
  const areas = db.prepare('SELECT * FROM delivery_areas WHERE active = 1').all();
  let best = null;
  let bestPrefix = '';
  for (const area of areas) {
    for (const prefix of String(area.postal_prefixes || '').split(',').map((p) => p.trim()).filter(Boolean)) {
      if (postal.startsWith(prefix) && prefix.length > bestPrefix.length) {
        best = area;
        bestPrefix = prefix;
      }
    }
  }
  if (!best) return DEFAULT_FEE_CENTS();
  let fee = best.fee_cents;
  if (subtotalCents < best.min_order_cents) fee += best.min_order_cents - subtotalCents;
  return fee;
}

export function registerDeliveryRoutes(api) {
  const { route, all, get, run, requireStaff, reply, bad, notFound, str, int } = api;

  const fields = (b, partial = false) => {
    const out = {};
    const set = (k, v) => { if (v !== undefined && !(partial && b[k] === undefined)) out[k] = v; };
    if (partial ? b.name !== undefined : true) set('name', str(b.name, 'name'));
    if (b.city !== undefined) set('city', str(b.city, 'city', { max: 120, required: false }));
    if (b.postal_prefixes !== undefined) set('postal_prefixes', str(b.postal_prefixes, 'postal_prefixes', { max: 500, required: false }) ?? '');
    if (b.fee_cents !== undefined) set('fee_cents', int(b.fee_cents, 'fee_cents'));
    if (b.min_order_cents !== undefined) set('min_order_cents', int(b.min_order_cents, 'min_order_cents'));
    if (b.active !== undefined) set('active', b.active ? 1 : 0);
    return out;
  };

  route('GET', '/api/delivery-areas', (ctx) => {
    const staff = ctx.user && ctx.user.role !== 'customer';
    return staff && ctx.query.get('all') === '1'
      ? all('SELECT * FROM delivery_areas ORDER BY name')
      : all('SELECT * FROM delivery_areas WHERE active = 1 ORDER BY name');
  });

  route('POST', '/api/delivery-areas', (ctx) => {
    requireStaff(ctx);
    const f = fields(ctx.body);
    const { lastInsertRowid } = run(
      'INSERT INTO delivery_areas (name, city, postal_prefixes, fee_cents, min_order_cents, active) VALUES (?,?,?,?,?,?)',
      f.name, f.city ?? null, f.postal_prefixes ?? '', f.fee_cents ?? 0, f.min_order_cents ?? 0, f.active ?? 1);
    return reply(201, get('SELECT * FROM delivery_areas WHERE id = ?', lastInsertRowid));
  });

  route('PUT', '/api/delivery-areas/:id', (ctx) => {
    requireStaff(ctx);
    if (!get('SELECT 1 FROM delivery_areas WHERE id = ?', ctx.params.id)) throw notFound();
    const f = fields(ctx.body, true);
    const cols = Object.keys(f);
    if (!cols.length) throw bad('No fields to update');
    run(`UPDATE delivery_areas SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      ...cols.map((c) => f[c]), ctx.params.id);
    return get('SELECT * FROM delivery_areas WHERE id = ?', ctx.params.id);
  });

  route('DELETE', '/api/delivery-areas/:id', (ctx) => {
    requireStaff(ctx);
    if (!get('SELECT 1 FROM delivery_areas WHERE id = ?', ctx.params.id)) throw notFound();
    run('DELETE FROM delivery_areas WHERE id = ?', ctx.params.id);
    return reply(204, '');
  });
}