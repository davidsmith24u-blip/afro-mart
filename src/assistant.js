// Afro Mart kitchen assistant.
//
// Two customer-facing helpers and one staff tool:
//   POST /api/assistant/cook          "what can I cook with what I have?"
//   POST /api/assistant/chat          a catalogue-grounded shopping assistant
//   POST /api/assistant/product-copy  staff copywriter (EN/DE/FR)
//
// Matching is always done against the real catalogue (products, bundles and
// recipes) so the answers stay factual. The LLM — when one is configured — is
// used to parse messy input and to phrase a reply, never to invent products.
import { expandQuery } from './discovery.js';
import { recipeWithStuff } from './recipes.js';
import { bundlePayload } from './bundles.js';
import { aiConfig, aiChat, aiJson } from './ai.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const MAX_PANTRY_ITEMS = 40;
const MAX_MESSAGE_CHARS = 1000;

// Canonical terms for a phrase, via the same diaspora-aware alias table the
// search box uses ("ata rodo" -> "scotch bonnet", "semo" -> "semovita").
function termsFor(text) {
  const terms = expandQuery(text).terms.map((term) => term.toLowerCase());
  return new Set(terms.filter((term) => term.length >= 3));
}

function normalizePantry(input) {
  const list = Array.isArray(input)
    ? input
    : String(input ?? '').split(/[\n,;]|\band\b|\+/i);
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const item = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= MAX_PANTRY_ITEMS) break;
  }
  return out;
}

// Does an ingredient/product name correspond to anything the cook already has?
function matchesTerms(pantryTerms, name) {
  const hay = String(name).toLowerCase();
  for (const term of pantryTerms) if (hay.includes(term)) return true;
  for (const term of termsFor(name)) if (pantryTerms.has(term)) return true;
  return false;
}

function ingredientLine(ingredient) {
  return { name: ingredient.name, kind: ingredient.kind, in_stock: ingredient.in_stock, price_cents: ingredient.price_cents };
}

function addItem(ingredient, quantity) {
  return ingredient.kind === 'bundle'
    ? { bundle_id: ingredient.id, quantity }
    : { product_id: ingredient.id, quantity };
}

function matchRecipes(db, pantryTerms, { limit = 6, guests = null } = {}) {
  const recipes = db.prepare('SELECT * FROM recipes WHERE active = 1 ORDER BY id').all().map((r) => recipeWithStuff(db, r));
  const scored = recipes.map((recipe) => {
    const have = [];
    const missing = [];
    for (const ingredient of recipe.ingredients) {
      if (matchesTerms(pantryTerms, ingredient.name)) have.push(ingredient);
      else missing.push(ingredient);
    }
    const total = recipe.ingredients.length || 1;
    return { recipe, have, missing, coverage: have.length / total };
  });

  const ranked = scored
    .filter((entry) => entry.have.length)
    .sort((a, b) => b.coverage - a.coverage || a.missing.length - b.missing.length || a.recipe.title.localeCompare(b.recipe.title));
  const chosen = ranked.length ? ranked.slice(0, limit) : [];

  return chosen.map(({ recipe, have, missing, coverage }) => {
    // Scale every line when the cook tells us how many they are feeding.
    const factor = guests && recipe.servings ? Math.max(1, Math.ceil(guests / recipe.servings)) : 1;
    const scale = (ingredient) => Math.max(1, ingredient.quantity * factor);
    const missingPrice = missing.reduce((sum, ingredient) => sum + ingredient.price_cents * scale(ingredient), 0);
    return {
      recipe_id: recipe.id,
      title: recipe.title,
      emoji: recipe.emoji || '🍽️',
      description: recipe.description,
      prep_minutes: recipe.prep_minutes,
      servings: recipe.servings,
      scale_factor: factor,
      coverage: Math.round(coverage * 100),
      have: have.map((ingredient) => ingredient.name),
      missing: missing.map(ingredientLine),
      price_cents: recipe.price_cents,
      missing_price_cents: missingPrice,
      items_available: missing.every((ingredient) => ingredient.in_stock),
      add_all: recipe.ingredients.map((ingredient) => addItem(ingredient, scale(ingredient))),
      add_missing: missing.map((ingredient) => addItem(ingredient, scale(ingredient))),
    };
  });
}

function searchProducts(db, text, limit = 6) {
  const terms = [...termsFor(text)];
  if (!terms.length) return [];
  const rows = db.prepare(
    `SELECT p.id, p.sku, p.name, p.description, p.price_cents, p.stock, p.image_url, c.name AS category
     FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.active = 1`,
  ).all();
  const scored = [];
  for (const row of rows) {
    const hay = `${row.name} ${row.category || ''} ${row.description || ''}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (hay.includes(term)) score += term.includes(' ') ? 3 : term.length >= 5 ? 2 : 1;
    }
    if (score) scored.push({ row, score });
  }
  scored.sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name));
  return scored.slice(0, limit).map((entry) => ({ ...entry.row, in_stock: entry.row.stock > 0 }));
}

// When nothing in the pantry overlaps our recipes we still want to be useful.
function popularRecipes(db, limit = 3) {
  return db.prepare('SELECT * FROM recipes WHERE active = 1 ORDER BY id LIMIT ?').all(limit)
    .map((recipe) => recipeWithStuff(db, recipe));
}

function searchRecipes(db, text, limit = 3) {
  const terms = [...termsFor(text)];
  if (!terms.length) return [];
  const rows = db.prepare('SELECT * FROM recipes WHERE active = 1 ORDER BY id').all();
  const scored = [];
  for (const row of rows) {
    const hay = `${row.title} ${row.description || ''}`.toLowerCase();
    let score = 0;
    for (const term of terms) if (hay.includes(term)) score += term.includes(' ') ? 3 : 1;
    if (score) scored.push({ row, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((entry) => recipeWithStuff(db, entry.row));
}

function searchBundles(db, text, limit = 3) {
  const terms = [...termsFor(text)];
  if (!terms.length) return [];
  const rows = db.prepare('SELECT * FROM bundles WHERE active = 1').all();
  const scored = [];
  for (const row of rows) {
    const hay = `${row.name} ${row.bundle_type || ''} ${row.description || ''}`.toLowerCase();
    let score = 0;
    for (const term of terms) if (hay.includes(term)) score += term.includes(' ') ? 3 : 1;
    if (score) scored.push({ row, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ row }) => {
    const payload = bundlePayload(db, row);
    return {
      id: row.id, sku: row.sku, name: row.name, description: row.description,
      type: row.bundle_type, price_cents: payload.price_cents, savings_percent: payload.savings_percent,
      in_stock: payload.items.every((item) => item.active && item.stock > 0),
    };
  });
}

export function registerAssistantRoutes(api) {
  const { db, route, get, bad, int, requireStaff, audit } = api;

  // --- "What can I cook?" -------------------------------------------------
  route('POST', '/api/assistant/cook', async (ctx) => {
    const rawPantry = ctx.body?.pantry ?? ctx.body?.ingredients ?? '';
    let pantry = normalizePantry(rawPantry);
    if (!pantry.length) throw bad('Tell me at least one ingredient you have');
    const guests = ctx.body?.guests == null ? null : int(ctx.body.guests, 'guests', { min: 1 });
    if (guests && guests > 100) throw bad('guests must be 100 or fewer');

    let tip = null;
    let usedAi = false;
    if (aiConfig().enabled) {
      try {
        const parsed = await aiJson([
          {
            role: 'user',
            content: `A shopper describes their kitchen in plain language. Extract the ingredients they already have.\n\n` +
              `Kitchen: "${String(Array.isArray(rawPantry) ? rawPantry.join(', ') : rawPantry).slice(0, 800)}"\n\n` +
              'Return JSON: {"items": ["ingredient", ...], "tip": "one warm sentence of cooking advice"}. ' +
              'Keep items short and in English. Never invent items that were not mentioned.',
          },
        ], { maxTokens: 400, temperature: 0.3 });
        const items = normalizePantry(parsed.items);
        if (items.length) pantry = items;
        if (typeof parsed.tip === 'string' && parsed.tip.trim()) tip = parsed.tip.trim().slice(0, 400);
        usedAi = true;
      } catch {
        // Fall back to the raw tokens; the deterministic matcher still works.
      }
    }

    const pantryTerms = new Set();
    for (const item of pantry) for (const term of termsFor(item)) pantryTerms.add(term);

    const matches = matchRecipes(db, pantryTerms, { guests });
    return {
      ai: usedAi,
      tip,
      pantry,
      guests,
      matches,
      suggestions: matches.length ? [] : popularRecipes(db, 3).map((recipe) => ({
        recipe_id: recipe.id, title: recipe.title, emoji: recipe.emoji, description: recipe.description,
      })),
    };
  });

  // --- Grounded shopping chat --------------------------------------------
  route('POST', '/api/assistant/chat', async (ctx) => {
    const messages = Array.isArray(ctx.body?.messages) ? ctx.body.messages : null;
    if (!messages || !messages.length || messages.length > 12) throw bad('messages must be an array of 1–12 items');
    const history = [];
    for (const message of messages) {
      const role = message?.role === 'assistant' ? 'assistant' : 'user';
      const content = String(message?.content ?? '').trim().slice(0, MAX_MESSAGE_CHARS);
      if (content) history.push({ role, content });
    }
    if (!history.length) throw bad('messages must contain text');
    const question = [...history].reverse().find((message) => message.role === 'user')?.content ?? '';

    const products = searchProducts(db, question, 6);
    const recipes = searchRecipes(db, question, 2);
    const bundles = searchBundles(db, question, 2);

    let reply;
    let usedAi = false;
    if (aiConfig().enabled) {
      try {
        const catalogue = products
          .map((p) => `- ${p.name} (${p.category || 'grocery'}) — €${(p.price_cents / 100).toFixed(2)}${p.in_stock ? '' : ', out of stock'}`)
          .join('\n');
        const context = [
          products.length ? `Matching products:\n${catalogue}` : 'No products matched the question.',
          bundles.length ? `Matching packs: ${bundles.map((b) => b.name).join(', ')}` : '',
          recipes.length ? `Matching recipes: ${recipes.map((r) => r.title).join(', ')}` : '',
        ].filter(Boolean).join('\n\n');
        reply = (await aiChat(history, {
          system:
            'You are the friendly shopping assistant for Afro Mart, an African grocery in Bochum, Germany, ' +
            'delivering across Germany. Answer in the language the customer used (English, German or French). ' +
            'Be warm and concise (under 90 words). Use only the products listed below; never invent items or prices. ' +
            'All prices are in euros. If nothing matches, say so and suggest browsing the shop.\n\n' + context,
          maxTokens: 400,
          temperature: 0.5,
        })).slice(0, 1200);
        usedAi = true;
      } catch {
        // fall through to the deterministic reply
      }
    }

    if (!reply) {
      reply = products.length
        ? `Here ${products.length === 1 ? 'is' : 'are'} ${products.length} item${products.length === 1 ? '' : 's'} that match “${question}”.`
        : `I couldn't find a direct match for “${question}” — take a look at the shop or ask about a specific dish.`;
    }

    return { ai: usedAi, reply, products, recipes, bundles };
  });

  // --- Staff copywriter ---------------------------------------------------
  route('POST', '/api/assistant/product-copy', async (ctx) => {
    requireStaff(ctx);
    if (!aiConfig().enabled) throw fail(503, 'Set AI_API_KEY to enable the AI copywriter');
    const productId = int(ctx.body?.product_id, 'product_id', { min: 1 });
    const product = get(
      `SELECT p.name, p.description, p.price_cents, c.name AS category FROM products p
       LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`, productId);
    if (!product) throw Object.assign(new Error('Not found'), { status: 404 });
    const keywords = ctx.body?.keywords ? String(ctx.body.keywords).slice(0, 300) : '';

    const parsed = await aiJson([
      {
        role: 'user',
        content:
          `Write a mouth-watering but honest product description for an African grocery store.\n` +
          `Product: ${product.name}\nCategory: ${product.category || 'grocery'}\n` +
          `Current description: ${product.description || '(none)'}\n` +
          (keywords ? `Must mention: ${keywords}\n` : '') +
          'Each description must be 2–3 sentences, under 320 characters, and free of hype that cannot be verified.\n' +
          'Return JSON: {"en": "...", "de": "...", "fr": "..."} where de and fr are faithful translations.',
      },
    ], { maxTokens: 700, temperature: 0.6 });

    const clean = (value) => (typeof value === 'string' ? value.trim().slice(0, 400) : '');
    const descriptions = { en: clean(parsed.en), de: clean(parsed.de), fr: clean(parsed.fr) };
    if (!descriptions.en) throw fail(502, 'The AI provider did not return a usable description');
    audit(ctx, 'ai.product_copy', 'product', productId, keywords || null);
    return { product_id: productId, name: product.name, descriptions };
  });
}
