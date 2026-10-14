// Party, catering and wholesale features: scale a recipe to any number of
// guests, suggest party packs that cover a crowd, take catering quote requests
// and manage restaurant (B2B) accounts that see wholesale prices.
import { bundlePayload } from './bundles.js';
import { recipeWithStuff } from './recipes.js';

const QUOTE_STATUSES = ['requested', 'quoted', 'confirmed', 'declined'];

export function registerCateringRoutes(api) {
  const { db, route, all, get, run, reply, notFound, bad, str, int, requireStaff } = api;

  // Scale a recipe for a party of N guests — scaled quantities and a running total.
  route('GET', '/api/recipes/:id/scale', (ctx) => {
    const recipe = get('SELECT * FROM recipes WHERE id = ?', ctx.params.id);
    if (!recipe || (!recipe.active && !(ctx.user && ctx.user.role !== 'customer'))) throw notFound();
    const guests = Math.min(Math.max(Number(ctx.query.get('guests')) || 0, 1), 1000);
    const payload = recipeWithStuff(db, recipe);
    const multiplier = guests / recipe.servings;
    const ingredients = payload.ingredients.map((item) => {
      const quantity = Math.max(1, Math.ceil(item.quantity * multiplier));
      return { ...item, base_quantity: item.quantity, quantity, line_cents: item.price_cents * quantity };
    });
    const total = ingredients.reduce((sum, item) => sum + item.line_cents, 0);
    return {
      recipe: { id: recipe.id, title: recipe.title, emoji: recipe.emoji, servings: recipe.servings },
      guests,
      multiplier: Math.round(multiplier * 100) / 100,
      ingredients,
      total_cents: total,
      per_guest_cents: Math.round(total / guests),
    };
  });

  // Which party packs cover a given headcount, and how many of each are needed.
  route('GET', '/api/catering/party', (ctx) => {
    const guests = Math.min(Math.max(Number(ctx.query.get('guests')) || 20, 1), 1000);
    const bundles = all(
      'SELECT * FROM bundles WHERE active = 1 AND serves > 0 ORDER BY serves DESC, name');
    const suggestions = bundles.map((bundle) => {
      const payload = bundlePayload(db, bundle);
      const packs = Math.ceil(guests / bundle.serves);
      return {
        id: bundle.id, sku: bundle.sku, name: bundle.name, description: bundle.description,
        bundle_type: bundle.bundle_type, serves: bundle.serves, packs_needed: packs,
        unit_price_cents: payload.price_cents, total_price_cents: payload.price_cents * packs,
        savings_percent: payload.savings_percent,
      };
    });
    return { guests, suggestions };
  });

  // ----- Catering / event quote requests -----
  route('POST', '/api/quotes', (ctx) => {
    const name = str(ctx.body.name, 'name');
    const email = str(ctx.body.email, 'email', { max: 254 }).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('email is invalid');
    const phone = str(ctx.body.phone, 'phone', { max: 40, required: false });
    const eventDate = str(ctx.body.event_date, 'event_date', { max: 20, required: false });
    const message = str(ctx.body.message, 'message', { max: 2000, required: false }) ?? '';
    const guests = ctx.body.guests === undefined ? 0 : int(ctx.body.guests, 'guests', { min: 0 });
    const fulfillment = ctx.body.fulfillment === 'pickup' ? 'pickup' : 'delivery';
    const userId = ctx.user ? ctx.user.id : null;
    const { lastInsertRowid } = run(
      `INSERT INTO quotes (user_id, name, email, phone, event_date, guests, fulfillment, message)
       VALUES (?,?,?,?,?,?,?,?)`,
      userId, name, email, phone, eventDate, guests, fulfillment, message);
    return reply(201, get('SELECT * FROM quotes WHERE id = ?', lastInsertRowid));
  });

  route('GET', '/api/quotes', (ctx) => {
    requireStaff(ctx);
    const status = ctx.query.get('status');
    return status
      ? all('SELECT * FROM quotes WHERE status = ? ORDER BY id DESC', status)
      : all('SELECT * FROM quotes ORDER BY id DESC');
  });

  route('PATCH', '/api/quotes/:id', (ctx) => {
    requireStaff(ctx);
    const quote = get('SELECT * FROM quotes WHERE id = ?', ctx.params.id);
    if (!quote) throw notFound();
    const fields = {};
    if (ctx.body.status !== undefined) {
      const status = String(ctx.body.status);
      if (!QUOTE_STATUSES.includes(status)) throw bad(`status must be one of ${QUOTE_STATUSES.join(', ')}`);
      fields.status = status;
    }
    if (ctx.body.quoted_cents !== undefined) fields.quoted_cents = int(ctx.body.quoted_cents, 'quoted_cents', { min: 0 });
    if (ctx.body.staff_note !== undefined) fields.staff_note = str(ctx.body.staff_note, 'staff_note', { max: 2000, required: false }) ?? '';
    const keys = Object.keys(fields);
    if (!keys.length) throw bad('No fields to update');
    run(
      `UPDATE quotes SET ${keys.map((key) => `${key} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ...keys.map((key) => fields[key]), quote.id);
    return get('SELECT * FROM quotes WHERE id = ?', quote.id);
  });

  // ----- Wholesale / B2B accounts -----
  route('GET', '/api/customers', (ctx) => {
    requireStaff(ctx);
    const q = ctx.query.get('q');
    const base = 'SELECT id, email, name, role, account_type, loyalty_points, created_at FROM users';
    return q
      ? all(`${base} WHERE name LIKE ? OR email LIKE ? ORDER BY name LIMIT 100`, `%${q}%`, `%${q}%`)
      : all(`${base} ORDER BY name LIMIT 100`);
  });

  route('PATCH', '/api/customers/:id/account-type', (ctx) => {
    requireStaff(ctx);
    const user = get('SELECT * FROM users WHERE id = ?', ctx.params.id);
    if (!user) throw notFound();
    const type = ctx.body.account_type === 'restaurant' ? 'restaurant' : 'retail';
    run('UPDATE users SET account_type = ? WHERE id = ?', type, user.id);
    return { id: user.id, account_type: type };
  });
}
