// Recipe-driven shopping: dishes that link directly to the products and packs
// needed to cook them, so customers can add every ingredient to their bag.
import { transaction } from './db.js';
import { bundlePayload } from './bundles.js';

const ingredientPayload = (db, ingredient) => {
  if (ingredient.product_id != null) {
    const p = db.prepare('SELECT id, name, price_cents, stock, active FROM products WHERE id = ?').get(ingredient.product_id);
    if (!p) return null;
    return {
      id: p.id, kind: 'product', name: p.name, price_cents: p.price_cents, in_stock: p.active === 1 && p.stock > 0,
      quantity: ingredient.quantity, note: ingredient.note,
    };
  }
  const b = db.prepare('SELECT * FROM bundles WHERE id = ?').get(ingredient.bundle_id);
  if (!b) return null;
  const payload = bundlePayload(db, b);
  return {
    id: b.id, kind: 'bundle', name: b.name, price_cents: payload.price_cents,
    savings_percent: payload.savings_percent, in_stock: payload.items.every((i) => i.active && i.stock > 0),
    quantity: ingredient.quantity, note: ingredient.note,
  };
};

export const recipeWithStuff = (db, recipe) => {
  const ingredients = db.prepare(
    'SELECT product_id, bundle_id, quantity, note FROM recipe_ingredients WHERE recipe_id = ? ORDER BY rowid',
  ).all(recipe.id).map((row) => ingredientPayload(db, row)).filter(Boolean);
  return {
    ...recipe,
    ingredients,
    price_cents: ingredients.reduce((sum, item) => sum + item.price_cents * item.quantity, 0),
    items_available: ingredients.every((item) => item.in_stock),
  };
};

function fillIngredients(db, raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 30) {
    throw Object.assign(new Error('ingredients must be a non-empty array'), { status: 400 });
  }
  const seen = new Set();
  const rows = [];
  for (const item of raw) {
    const quantity = Number.isInteger(item?.quantity) && item.quantity > 0 ? item.quantity : 1;
    if (item?.product_id != null) {
      const pid = Number(item.product_id);
      if (!Number.isInteger(pid) || pid < 1) throw Object.assign(new Error('Invalid product_id'), { status: 400 });
      if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(pid)) {
        throw Object.assign(new Error(`Unknown product ${pid}`), { status: 400 });
      }
      const key = `p${pid}`;
      if (seen.has(key)) throw Object.assign(new Error('Each ingredient may appear once'), { status: 400 });
      seen.add(key);
      rows.push({ product_id: pid, bundle_id: null, quantity, note: item.note ?? null });
    } else if (item?.bundle_id != null) {
      const bid = Number(item.bundle_id);
      if (!Number.isInteger(bid) || bid < 1) throw Object.assign(new Error('Invalid bundle_id'), { status: 400 });
      if (!db.prepare('SELECT 1 FROM bundles WHERE id = ?').get(bid)) {
        throw Object.assign(new Error(`Unknown bundle ${bid}`), { status: 400 });
      }
      const key = `b${bid}`;
      if (seen.has(key)) throw Object.assign(new Error('Each ingredient may appear once'), { status: 400 });
      seen.add(key);
      rows.push({ product_id: null, bundle_id: bid, quantity, note: item.note ?? null });
    } else {
      throw Object.assign(new Error('Each ingredient needs a product_id or bundle_id'), { status: 400 });
    }
  }
  return rows;
}

export function registerRecipeRoutes(api) {
  const { db, route, all, get, run, reply, notFound, str, int, requireStaff } = api;

  const recipeFields = (b, partial = false) => {
    const out = {};
    const set = (k, v) => { if (v !== undefined && !(partial && b[k] === undefined)) out[k] = v; };
    if (partial ? b.title !== undefined : true) set('title', str(b.title, 'title'));
    if (b.description !== undefined) set('description', str(b.description, 'description', { max: 2000, required: false }) ?? '');
    if (b.prep_minutes !== undefined) set('prep_minutes', int(b.prep_minutes, 'prep_minutes', { min: 1 }));
    if (b.servings !== undefined) set('servings', int(b.servings, 'servings', { min: 1 }));
    if (b.emoji !== undefined) set('emoji', str(b.emoji, 'emoji', { max: 8, required: false }) ?? '🍽️');
    if (b.active !== undefined) set('active', b.active ? 1 : 0);
    return out;
  };

  const list = (ctx, withInactive) => {
    const staff = ctx.user && ctx.user.role !== 'customer';
    const rows = withInactive && staff
      ? all('SELECT * FROM recipes ORDER BY id')
      : all('SELECT * FROM recipes WHERE active = 1 ORDER BY id');
    return rows.map((r) => recipeWithStuff(db, r));
  };

  route('GET', '/api/recipes', (ctx) => list(ctx, ctx.query.get('all') === '1'));
  route('GET', '/api/recipes/:id', (ctx) => {
    const recipe = get('SELECT * FROM recipes WHERE id = ?', ctx.params.id);
    if (!recipe || (!recipe.active && !(ctx.user && ctx.user.role !== 'customer'))) throw notFound();
    return recipeWithStuff(db, recipe);
  });

  route('POST', '/api/recipes', (ctx) => {
    requireStaff(ctx);
    const f = recipeFields(ctx.body);
    const ingredients = fillIngredients(db, ctx.body.ingredients);
    const recipe = transaction(db, () => {
      const { lastInsertRowid } = run(
        'INSERT INTO recipes (title, description, prep_minutes, servings, emoji, active) VALUES (?,?,?,?,?,?)',
        f.title, f.description ?? '', f.prep_minutes ?? 30, f.servings ?? 4, f.emoji ?? '🍽️', f.active ?? 1);
      insertIngredients(lastInsertRowid, ingredients);
      return get('SELECT * FROM recipes WHERE id = ?', lastInsertRowid);
    });
    return reply(201, recipeWithStuff(db, recipe));
  });

  route('PUT', '/api/recipes/:id', (ctx) => {
    requireStaff(ctx);
    const current = get('SELECT * FROM recipes WHERE id = ?', ctx.params.id);
    if (!current) throw notFound();
    const f = recipeFields(ctx.body, true);
    if (Object.keys(f).length) {
      run(`UPDATE recipes SET ${Object.keys(f).map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
        ...Object.keys(f).map((c) => f[c]), current.id);
    }
    if (ctx.body.ingredients !== undefined) {
      transaction(db, () => {
        run('DELETE FROM recipe_ingredients WHERE recipe_id = ?', current.id);
        insertIngredients(current.id, fillIngredients(db, ctx.body.ingredients));
      });
    }
    return recipeWithStuff(db, get('SELECT * FROM recipes WHERE id = ?', current.id));
  });

  route('DELETE', '/api/recipes/:id', (ctx) => {
    requireStaff(ctx);
    if (!get('SELECT 1 FROM recipes WHERE id = ?', ctx.params.id)) throw notFound();
    transaction(db, () => {
      run('DELETE FROM recipe_ingredients WHERE recipe_id = ?', ctx.params.id);
      run('DELETE FROM recipes WHERE id = ?', ctx.params.id);
    });
    return reply(204, '');
  });

  function insertIngredients(recipeId, rows) {
    const stmt = db.prepare(
      'INSERT INTO recipe_ingredients (recipe_id, product_id, bundle_id, quantity, note) VALUES (?,?,?,?,?)');
    for (const row of rows) stmt.run(recipeId, row.product_id, row.bundle_id, row.quantity, row.note);
  }
}