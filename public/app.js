import { LOCALES, LOCALE_LABELS, translate } from '/i18n.js';

const $ = (id) => document.getElementById(id);

let locale = localStorage.getItem('locale') || 'en';
if (!LOCALES.includes(locale)) locale = 'en';
let displayCurrency = localStorage.getItem('currency') || 'EUR';
let currencies = [{ code: 'EUR', symbol: '€', rate: 1, locale: 'de-DE', label: 'Euro' }];
const t = (key, vars) => translate(locale, key, vars);
const currencyFor = (code) => currencies.find((c) => c.code === code) || currencies[0];
function money(cents) {
  const cur = currencyFor(displayCurrency);
  const value = (cents / 100) * cur.rate;
  const fraction = ['EUR', 'GBP', 'CHF', 'USD', 'CAD'].includes(cur.code) ? 2 : 0;
  try {
    return value.toLocaleString(cur.locale || 'de-DE', {
      style: 'currency', currency: cur.code,
      minimumFractionDigits: fraction, maximumFractionDigits: fraction,
    });
  } catch {
    return `${cur.symbol}${value.toFixed(2)}`;
  }
}

let token = localStorage.getItem('token');
let user = null;
let products = [];
const productCatalog = new Map();
let bundles = [];
const bundleCatalog = new Map();
let deliveryAreas = [];
let locations = [];
let settings = {};
let recipes = [];
const cart = JSON.parse(localStorage.getItem('cart') || '{}');

// Discovery filters (cuisine / country / diet / heat) + sort, mirrored to the API.
const filters = { cuisine: new Set(), origin: new Set(), diet: new Set(), maxSpice: '', sort: 'name' };
let facets = null;
const unitPrice = (product) => product.effective_price_cents ?? product.price_cents;

function el(tag, text, attrs = {}) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  Object.assign(e, attrs);
  return e;
}
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
const fail = (e) => { $('msg').textContent = e.message; };
const say = (message) => { $('msg').textContent = message; };

// ---------- Language & currency (global reach) ----------
function applyI18n() {
  document.documentElement.lang = locale;
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) node.placeholder = t(node.dataset.i18nPlaceholder);
  renderAccount();
  renderCart();
  renderSortOptions();
  if (facets) renderFilterChips();
}
function fillPreferenceSelectors() {
  const lang = $('lang');
  lang.replaceChildren(...LOCALES.map((code) => el('option', LOCALE_LABELS[code], { value: code })));
  lang.value = locale;
  const cur = $('currency');
  cur.replaceChildren(...currencies.map((c) => el('option', `${c.code} · ${c.symbol}`, { value: c.code })));
  cur.value = displayCurrency;
}
function setLocale(next) {
  if (!LOCALES.includes(next)) return;
  locale = next;
  localStorage.setItem('locale', locale);
  fillPreferenceSelectors();
  applyI18n();
}
function setDisplayCurrency(next) {
  if (!currencies.some((c) => c.code === next)) return;
  displayCurrency = next;
  localStorage.setItem('currency', displayCurrency);
  fillPreferenceSelectors();
  applyI18n();
}

// ---------- Discovery: facets, chips and sort ----------
const SORTS = ['name', 'price_asc', 'price_desc', 'spice'];
const SPICE_WORDS = ['', '🌶', '🌶🌶', '🌶🌶🌶', '🌶🌶🌶🌶', '🌶🌶🌶🌶🌶'];
const spiceLabel = (level) => `${t('discover.heat')} ${level}${level > 0 ? ' ' + SPICE_WORDS[level] : ''}`;

function renderSortOptions() {
  const select = $('sort');
  select.replaceChildren(...SORTS.map((value) => el('option', t(`sort.${value}`), { value })));
  select.value = filters.sort;
}
function chipRow(container, entries, isActive, onToggle) {
  container.replaceChildren(...entries.map((entry) => {
    const chip = el('button', `${entry.label}${entry.count != null ? ` (${entry.count})` : ''}`, {
      className: 'chip' + (isActive(entry.value) ? ' is-active' : ''),
      type: 'button',
      ariaPressed: isActive(entry.value) ? 'true' : 'false',
    });
    chip.onclick = () => { onToggle(entry.value); renderFilterChips(); loadProducts().catch(fail); };
    return chip;
  }));
}
function renderFilterChips() {
  if (!facets) return;
  const isActive = (group) => (value) => filters[group].has(value);
  const toggle = (group) => (value) => {
    if (filters[group].has(value)) filters[group].delete(value);
    else filters[group].add(value);
  };
  chipRow($('origin-chips'), facets.origins, isActive('origin'), toggle('origin'));
  chipRow($('cuisine-chips'), facets.cuisines, isActive('cuisine'), toggle('cuisine'));
  chipRow($('diet-chips'), facets.diets, isActive('diet'), toggle('diet'));
  const spiceEntries = facets.spice_levels
    .filter((s) => s.level > 0)
    .map((s) => ({ value: String(s.level), label: spiceLabel(s.level) }));
  chipRow($('spice-chips'), spiceEntries,
    (value) => filters.maxSpice === value,
    (value) => { filters.maxSpice = filters.maxSpice === value ? '' : value; });
}
async function loadFacets() {
  facets = await api('/api/discovery/facets').catch(() => null);
  if (facets) renderFilterChips();
}
const DIET_ICONS = { vegan: '🌱', vegetarian: '🥕', 'gluten-free': '🌾', halal: '☪' };
function discoveryBadges(product) {
  const wrap = el('div', undefined, { className: 'badge-row' });
  if (product.origin_label) wrap.append(el('span', product.origin_label, { className: 'badge badge-origin' }));
  const cuisine = (product.cuisine_labels || [])[0];
  if (cuisine) wrap.append(el('span', cuisine, { className: 'badge badge-cuisine' }));
  const diets = product.diets || [];
  const diet = diets.includes('vegan') ? 'vegan' : diets.includes('vegetarian') ? 'vegetarian' : diets[0];
  if (diet) wrap.append(el('span', `${DIET_ICONS[diet] || ''} ${diet}`.trim(), { className: 'badge badge-diet' }));
  if (product.spice_level > 0) {
    wrap.append(el('span', SPICE_WORDS[product.spice_level], { className: 'badge badge-spice', title: spiceLabel(product.spice_level) }));
  }
  return wrap.childElementCount ? wrap : null;
}


// ---------- Fulfilment: delivery fee, pickup stores and slots ----------
const currentFulfillment = () => document.querySelector('input[name="fulfillment"]:checked')?.value || 'delivery';

function applyFulfillment() {
  const fulfillment = currentFulfillment();
  $('delivery-fields').hidden = fulfillment !== 'delivery';
  $('pickup-fields').hidden = fulfillment !== 'pickup';
  renderTotals();
}

function basketSubtotal() {
  let subtotal = 0;
  for (const [key, qty] of Object.entries(cart)) {
    if (key.startsWith('b')) {
      const bundle = bundleCatalog.get(Number(key.slice(1)));
      if (bundle) subtotal += bundle.price_cents * qty;
    } else {
      const product = productCatalog.get(Number(key));
      if (product) subtotal += unitPrice(product) * qty;
    }
  }
  return subtotal;
}

// Mirrors src/delivery.js so shoppers see the same fee the server will charge.
function estimateDeliveryFee(subtotal) {
  const fallback = Number(settings.delivery_fee_default_cents) || 0;
  const postal = ($('addr').value.match(/(\d{5})/) || [])[1] || '';
  if (!postal) return fallback;
  let best = null;
  let bestPrefix = '';
  for (const area of deliveryAreas) {
    for (const prefix of String(area.postal_prefixes || '').split(',').map((p) => p.trim()).filter(Boolean)) {
      if (postal.startsWith(prefix) && prefix.length > bestPrefix.length) {
        best = area;
        bestPrefix = prefix;
      }
    }
  }
  if (!best) return fallback;
  let fee = best.fee_cents;
  if (subtotal < best.min_order_cents) fee += best.min_order_cents - subtotal;
  return fee;
}

function renderTotals() {
  const subtotal = basketSubtotal();
  $('total').textContent = money(subtotal);
  const fulfillment = currentFulfillment();
  const fee = fulfillment === 'delivery' ? estimateDeliveryFee(subtotal) : 0;
  const line = $('fee-line');
  line.hidden = false;
  line.textContent = fulfillment === 'pickup'
    ? 'Store pickup · collection is free'
    : fee > 0 ? `Delivery · ${money(fee)}` : 'Delivery · free for this address';
  $('payable').textContent = money(subtotal + fee);
  const note = $('delivery-fee-note');
  if (note) {
    note.textContent = fee > 0
      ? `Courier delivery within Germany · a ${money(fee)} delivery fee applies here.`
      : 'Courier delivery within Germany · free for this address.';
  }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

function pickupSlots() {
  const slots = [];
  const windows = ['10:00 – 12:00', '16:00 – 18:00'];
  const now = new Date();
  for (let day = 0; day < 4; day++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + day);
    for (const window of windows) {
      if (day === 0 && now.getHours() >= Number(window.slice(0, 2))) continue;
      const dayLabel = day === 0 ? 'Today' : day === 1 ? 'Tomorrow' : WEEKDAYS[d.getDay()];
      const value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${window}`;
      slots.push({ value, label: `${dayLabel} ${d.getDate()} ${MONTHS[d.getMonth()]} · ${window}` });
    }
  }
  return slots;
}

function fillFulfillmentOptions() {
  $('pickup-location').replaceChildren(
    ...locations.map((l) => el('option', `${l.name}${l.city ? ' · ' + l.city : ''}`, { value: String(l.id) })),
  );
  const slots = pickupSlots();
  $('pickup-at').replaceChildren(
    el('option', 'Choose a time…', { value: '' }),
    ...slots.map((s) => el('option', s.label, { value: s.value })),
  );
}

async function loadProducts() {
  const p = new URLSearchParams();
  if ($('q').value) p.set('q', $('q').value);
  if ($('cat').value) p.set('category', $('cat').value);
  if (filters.cuisine.size) p.set('cuisine', [...filters.cuisine].join(','));
  if (filters.origin.size) p.set('origin', [...filters.origin].join(','));
  if (filters.diet.size) p.set('diet', [...filters.diet].join(','));
  if (filters.maxSpice) p.set('max_spice', filters.maxSpice);
  if (filters.sort && filters.sort !== 'name') p.set('sort', filters.sort);
  products = await api(`/api/products?${p}`);
  products.forEach((product) => productCatalog.set(product.id, product));
  const glyphs = { 'dry goods': '🌾', 'fresh produce': '🥬', beverages: '🫖', spices: '🌶️', frozen: '❄️', snacks: '🥜', 'oils & condiments': '🫘', 'rice & grains': '🍚', 'meat & fish': '🍖', 'health & beauty': '🧴' };
  const productGlyph = (product) => {
    const name = product.name.toLowerCase();
    if (name.includes('wine')) return '🍷';
    if (name.includes('energy')) return '⚡';
    if (name.includes('drink') || name.includes('cola') || name.includes('pepsi') || name.includes('fanta') || name.includes('sprite') || name.includes('mirinda') || name.includes('nectar')) return '🥤';
    if (name.includes('catfish') || name.includes('crayfish')) return '🐟';
    if (name.includes('snail')) return '🐚';
    if (name.includes('ponmo')) return '🥘';
    if (name.includes('iru') || name.includes('groundnut')) return '🫘';
    if (name.includes('tigernut')) return '🥛';
    if (name.includes('stockfish') || name.includes('croaker') || name.includes('snapper') || name.includes('sardine') || name.includes('fish')) return '🐟';
    if (name.includes('prawn')) return '🦐';
    if (name.includes('goat') || name.includes('biltong') || name.includes('beef')) return '🍖';
    if (name.includes('rice') || name.includes('banku') || name.includes('millet') || name.includes('sorghum') || name.includes('pap')) return '🍚';
    if (name.includes('maize')) return '🌽';
    if (name.includes('ukwa') || name.includes('breadfruit')) return '🥥';
    if (name.includes('beans') || name.includes('oloyin')) return '🫘';
    if (name.includes('semovita') || name.includes('semolina')) return '🥣';
    if (name.includes('ugba') || name.includes('abacha')) return '🥗';
    if (name.includes('moi moi')) return '🥘';
    if (name.includes('akara')) return '🥞';
    if (name.includes('gbegiri')) return '🍲';
    if (name.includes('kilishi') || name.includes('dambun') || name.includes('cow foot') || name.includes('nkwobi')) return '🍖';
    if (name.includes('garden egg')) return '🍆';
    if (name.includes('okra')) return '🥒';
    if (name.includes('tatashe') || name.includes('pepper') || name.includes('uziza') || name.includes('ehuru') || name.includes('uda')) return '🌶️';
    if (name.includes('coconut') && !name.includes('oil')) return '🥥';
    if (name.includes('palm fruit') || name.includes('banga')) return '🌴';
    if (name.includes('utazi') || name.includes('scent leaf') || name.includes('okazi') || name.includes('waterleaf') || name.includes('ewedu')) return '🥬';
    if (name.includes('shea') || name.includes('soap') || name.includes('coconut oil') || name.includes('hair') || name.includes('butter')) return '🧴';
    return glyphs[(product.category || '').toLowerCase()] || '🧺';
  };
  const productPhoto = (product) => {
    const name = product.name.toLowerCase();
    if (name.includes('coca-cola')) return '/products/coca-cola.jpg';
    if (name.includes('pepsi')) return '/products/pepsi.jpg';
    if (name.includes('wine')) return '/products/wine.jpg';
    if ((product.category || '').toLowerCase() === 'fresh produce') return '/products/produce.jpg';
    if ((product.category || '').toLowerCase() === 'spices') return '/products/spices.jpg';
    if ((product.category || '').toLowerCase() === 'beverages') return '/products/african-drinks.jpg';
    return '/products/staples.jpg';
  };
  const toneFor = (category) => {
    const value = (category || '').toLowerCase();
    if (value.includes('spice')) return 'spices';
    if (value.includes('beverage') || value.includes('drink')) return 'beverages';
    if (value.includes('frozen')) return 'frozen';
    if (value.includes('fresh') || value.includes('produce')) return 'fresh';
    return 'pantry';
  };
  $('products').replaceChildren(...(products.length ? products.map((product, index) => {
    const card = el('article', undefined, { className: 'product-card' });
    const art = el('div', undefined, { className: 'product-art' });
    art.dataset.tone = toneFor(product.category);
    const photo = el('img', undefined, {
      className: 'product-photo',
      src: productPhoto(product),
      alt: `${product.name} product photo`,
      loading: index < 8 ? 'eager' : 'lazy',
      fetchPriority: index < 4 ? 'high' : 'auto',
      decoding: 'async',
    });
    photo.onerror = () => {
      photo.remove();
      art.append(el('span', productGlyph(product), { ariaHidden: 'true' }));
    };
    art.append(photo);
    const info = el('div', undefined, { className: 'product-info' });
    info.append(el('p', product.category || 'Market favorite', { className: 'product-category' }));
    info.append(el('h3', product.name));
    const badges = discoveryBadges(product);
    if (badges) info.append(badges);
    info.append(el('p', product.description || 'A favorite from our market.', { className: 'product-description' }));
    const buy = el('div', undefined, { className: 'product-buy' });
    const priceWrap = el('div', undefined, { className: 'price-wrap' });
    if (product.is_wholesale && product.wholesale_price_cents != null) {
      priceWrap.append(el('span', money(product.price_cents), { className: 'strike' }), ' ');
      priceWrap.append(el('strong', money(product.effective_price_cents), { className: 'product-price' }));
      priceWrap.append(el('span', 'Wholesale', { className: 'wholesale-tag' }));
    } else {
      priceWrap.append(el('strong', money(product.price_cents), { className: 'product-price' }));
    }
    const add = el('button', product.stock > 0 ? 'Add to bag +' : 'Sold out', { className: 'add-button', disabled: product.stock <= 0, type: 'button' });
    add.onclick = () => { cart[product.id] = Math.min((cart[product.id] || 0) + 1, product.stock); saveCart(); };
    buy.append(priceWrap, add);
    if (product.stock > 0 && product.stock <= 5) buy.append(el('span', 'Only a few left', { className: 'stock-label' }));
    info.append(buy);
    card.append(art, info);
    return card;
  }) : [el('p', 'No products match your search. Try another name or category.', { className: 'empty-state' })]));
  $('product-count').textContent = `${products.length} ${products.length === 1 ? 'product' : 'products'}`;
  renderCart();
}
async function loadBundles() {
  const data = await api('/api/bundles');
  bundles = data;
  bundles.forEach((bundle) => bundleCatalog.set(bundle.id, bundle));
  const glyph = { meal_pack: '🍲', starter_pack: '🥘', party_pack: '🎉', gift_box: '🎁', taste_box: '⚖️' };
  $('bundle-grid').replaceChildren(...(bundles.length ? bundles.map((bundle) => {
    const card = el('article', undefined, { className: 'product-card bundle-card' });
    const art = el('div', undefined, { className: 'product-art' });
    art.dataset.tone = 'pantry';
    art.append(el('span', glyph[bundle.bundle_type] || '🛍️', { ariaHidden: 'true' }));
    const info = el('div', undefined, { className: 'product-info' });
    info.append(el('p', bundle.type_label || 'Bundle', { className: 'product-category' }));
    info.append(el('h3', bundle.name));
    info.append(el('p', bundle.description, { className: 'product-description' }));
    info.append(el('p', `${bundle.item_count} items · you save ${bundle.savings_percent}%`, { className: 'bundle-items-line' }));
    const buy = el('div', undefined, { className: 'product-buy bundle-buy' });
    const price = el('strong', undefined, { className: 'product-price' });
    price.append(el('span', money(bundle.subtotal_cents), { className: 'strike' }), ' ', money(bundle.price_cents));
    const actions = el('div', undefined, { className: 'bundle-actions' });
    const add = el('button', 'Add to bag +', { className: 'add-button', type: 'button', title: 'Add ' + bundle.name + ' to bag' });
    add.onclick = () => { cart[`b${bundle.id}`] = Math.min((cart[`b${bundle.id}`] || 0) + 1, 10); saveCart(); };
    const monthly = el('button', 'Get it monthly', { className: 'subscribe-button', type: 'button', title: `Have ${bundle.name} delivered every 30 days` });
    monthly.onclick = () => subscribe(bundle.id).catch(fail);
    actions.append(add, monthly);
    buy.append(price, actions);
    info.append(buy);
    card.append(art, info);
    return card;
  }) : [el('p', 'Bundles are being assembled at our warehouse — check back soon.', { className: 'empty-state' })]));
}
async function loadRecipes() {
  recipes = await api('/api/recipes');
  const grid = $('recipe-grid');
  if (!recipes.length) {
    grid.replaceChildren(el('p', 'Recipes are simmering — check back soon.', { className: 'empty-state' }));
    return;
  }
  grid.replaceChildren(...recipes.map(recipeCard));
}
function recipeCard(recipe) {
  const card = el('article', undefined, { className: 'recipe-card' });
  const head = el('div', undefined, { className: 'recipe-head' });
  head.append(el('span', recipe.emoji || '🍽️', { className: 'recipe-emoji', ariaHidden: 'true' }));
  const titles = el('div');
  titles.append(el('h3', recipe.title));
  titles.append(el('p', `${recipe.prep_minutes} min · serves ${recipe.servings}`, { className: 'recipe-meta' }));
  head.append(titles);
  card.append(head);
  card.append(el('p', recipe.description, { className: 'recipe-description' }));
  const list = el('ul', undefined, { className: 'recipe-ingredients' });
  for (const ingredient of recipe.ingredients) {
    const li = el('li', undefined, { className: ingredient.in_stock ? '' : 'is-out' });
    li.append(el('span', ingredient.name));
    li.append(el('span', `${ingredient.quantity}×`, { className: 'recipe-qty' }));
    list.append(li);
  }
  card.append(list);
  const buy = el('div', undefined, { className: 'product-buy' });
  buy.append(el('strong', money(recipe.price_cents), { className: 'product-price' }));
  const add = el('button', 'Add all to bag +', { className: 'add-button', type: 'button' });
  add.disabled = !recipe.items_available;
  add.title = recipe.items_available ? `Add the ingredients for ${recipe.title}` : 'Some ingredients are out of stock';
  add.onclick = () => {
    for (const ingredient of recipe.ingredients) {
      if (!ingredient.in_stock) continue;
      if (ingredient.kind === 'bundle') {
        cart[`b${ingredient.id}`] = Math.min((cart[`b${ingredient.id}`] || 0) + ingredient.quantity, 10);
      } else {
        cart[ingredient.id] = (cart[ingredient.id] || 0) + ingredient.quantity;
      }
    }
    saveCart();
    say(`Added the ${recipe.title} ingredients to your bag.`);
  };
  buy.append(add);
  card.append(buy);
  return card;
}
function saveCart() { localStorage.setItem('cart', JSON.stringify(cart)); renderCart(); }
function clearCart() { for (const key of Object.keys(cart)) delete cart[key]; saveCart(); }
function renderCart() {
  let itemCount = 0;
  const rows = [];
  for (const [key, qty] of Object.entries(cart)) {
    if (key.startsWith('b')) {
      const b = bundleCatalog.get(Number(key.slice(1)));
      if (!b) continue;
      const tr = el('tr');
      tr.append(el('td', `${b.name} pack`));
      const quantityCell = el('td');
      const controls = el('div', undefined, { className: 'quantity-controls' });
      const decrease = el('button', '−', { type: 'button', title: 'Decrease quantity', ariaLabel: `Decrease ${b.name} quantity` });
      decrease.onclick = () => { if (cart[key] <= 1) delete cart[key]; else cart[key] -= 1; saveCart(); };
      const increase = el('button', '+', { type: 'button', title: 'Increase quantity', ariaLabel: `Increase ${b.name} quantity` });
      increase.disabled = qty >= 10;
      increase.onclick = () => { cart[key] = Math.min(cart[key] + 1, 10); saveCart(); };
      controls.append(decrease, el('span', String(qty)), increase);
      quantityCell.append(controls);
      tr.append(quantityCell, el('td', money(b.price_cents * qty)));
      const removeCell = el('td');
      const remove = el('button', 'Remove', { className: 'remove-item', type: 'button' });
      remove.onclick = () => { delete cart[key]; saveCart(); };
      removeCell.append(remove);
      tr.append(removeCell);
      rows.push(tr);
      itemCount += qty;
      continue;
    }
    const p = productCatalog.get(Number(key));
    if (!p) continue;
    const tr = el('tr');
    tr.append(el('td', p.name));
    const quantityCell = el('td');
    const controls = el('div', undefined, { className: 'quantity-controls' });
    const decrease = el('button', '−', { type: 'button', title: 'Decrease quantity', ariaLabel: `Decrease ${p.name} quantity` });
    decrease.onclick = () => { if (cart[key] <= 1) delete cart[key]; else cart[key] -= 1; saveCart(); };
    const increase = el('button', '+', { type: 'button', title: 'Increase quantity', ariaLabel: `Increase ${p.name} quantity` });
    increase.disabled = qty >= p.stock;
    increase.onclick = () => { cart[key] = Math.min(cart[key] + 1, p.stock); saveCart(); };
    controls.append(decrease, el('span', String(qty)), increase);
    quantityCell.append(controls);
    tr.append(quantityCell, el('td', money(unitPrice(p) * qty)));
    const removeCell = el('td');
    const remove = el('button', 'Remove', { className: 'remove-item', type: 'button' });
    remove.onclick = () => { delete cart[key]; saveCart(); };
    removeCell.append(remove);
    tr.append(removeCell);
    rows.push(tr);
    itemCount += qty;
  }
  const table = $('cart');
  const caption = table.querySelector('caption');
  const head = el('thead');
  const headingRow = el('tr');
  for (const title of [t('cart.th.item'), t('cart.th.qty'), t('cart.th.subtotal'), '']) headingRow.append(el('th', title));
  head.append(headingRow);
  const body = el('tbody');
  if (rows.length) body.append(...rows);
  else {
    const emptyRow = el('tr');
    emptyRow.append(el('td', t('cart.empty'), { className: 'empty-cart', colSpan: 4 }));
    body.append(emptyRow);
  }
  table.replaceChildren(caption, head, body);
  $('cart-count').textContent = String(itemCount);
  $('cart-summary').textContent = itemCount ? t(itemCount === 1 ? 'cart.item' : 'cart.items', { n: itemCount }) : t('cart.ready');
  renderTotals();
}
function renderAccount() {
  const a = $('acct');
  a.replaceChildren();
  $('auth').hidden = !!user;
  $('member').hidden = !user;
  if (!user) return;
  a.append(`${user.name} · ${user.tier_label} · ${user.loyalty_points} pts `);
  if (user.role !== 'customer') a.append(el('a', 'Dashboard', { href: '/admin' }), ' ');
  const out = el('button', 'Log out');
  out.onclick = logout;
  a.append(out);
}
function logout() {
  localStorage.removeItem('token');
  token = null;
  user = null;
  renderAccount();
  $('orders').replaceChildren();
  loadMember();
}
async function loadMember() {
  const member = $('member');
  member.hidden = !user;
  if (!user) {
    $('member-referral').replaceChildren();
    $('member-subs').replaceChildren();
    return;
  }
  const [referral, subs] = await Promise.all([api('/api/me/referral'), api('/api/subscriptions')]);
  const box = $('member-referral');
  box.replaceChildren();
  box.append(el('p', `You are a ${user.tier_label} member — earning ${user.points_multiplier}× points on every order.`, { className: 'referral-lead' }));
  const codeRow = el('div', undefined, { className: 'referral-code-row' });
  codeRow.append(el('code', referral.code, { className: 'referral-code' }));
  const link = new URL(referral.link, location.origin).href;
  const copy = el('button', 'Copy link', { className: 'secondary-button', type: 'button' });
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(link); say('Referral link copied — share the love.'); }
    catch { say(link); }
  };
  codeRow.append(copy);
  box.append(codeRow);
  box.append(el('p', `Share your code and your friend is welcomed home — you collect ${referral.points_per_friend} points.`, { className: 'referral-hint' }));
  const subsBox = $('member-subs');
  subsBox.replaceChildren();
  if (!subs.length) {
    subsBox.append(el('p', 'No monthly packs yet — choose a bundle and tap “Get it monthly”.', { className: 'empty-state' }));
    return;
  }
  for (const sub of subs) {
    const row = el('div', undefined, { className: 'sub-row' });
    const details = el('div', undefined, { className: 'sub-details' });
    details.append(el('strong', sub.bundle ? sub.bundle.name : `Bundle ${sub.bundle_id}`));
    details.append(el('span', `${sub.fulfillment === 'pickup' ? 'Pickup' : 'Delivery'} · next on ${sub.next_run_on}`, { className: 'sub-meta' }));
    row.append(details);
    row.append(el('span', sub.status, { className: `sub-status sub-${sub.status}` }));
    const toggle = el('button', sub.status === 'active' ? 'Pause' : sub.status === 'paused' ? 'Resume' : 'Cancelled', { className: 'text-button', type: 'button' });
    toggle.disabled = sub.status === 'cancelled';
    toggle.onclick = async () => {
      try {
        await api(`/api/subscriptions/${sub.id}`, { method: 'PUT', body: { status: sub.status === 'active' ? 'paused' : 'active' } });
        await loadMember();
      } catch (e) { fail(e); }
    };
    row.append(toggle);
    subsBox.append(row);
  }
}
const TRACK_STAGES = ['pending', 'paid', 'packed', 'shipped', 'delivered'];
async function loadOrders() {
  if (!user) return;
  const orders = await api('/api/orders');
  const table = el('table');
  const head = el('thead');
  const headingRow = el('tr');
  for (const label of [t('orders.th.order'), t('orders.th.placed'), t('orders.th.status'), t('orders.th.payment'), t('orders.th.how'), t('orders.th.total'), t('orders.th.track')]) {
    headingRow.append(el('th', label));
  }
  head.append(headingRow);
  const body = el('tbody');
  for (const o of orders) {
    const tr = el('tr');
    const paymentLabel = t(`payment.status.${o.payment_status}`);
    const methodLabel = t(`payment.method.${o.payment_method}`) === `payment.method.${o.payment_method}` ? (o.payment_method || '') : t(`payment.method.${o.payment_method}`);
    for (const value of [
      `#${o.id}`, o.created_at, t(`orders.status.${o.status}`), `${paymentLabel} · ${methodLabel}`,
      o.fulfillment === 'pickup' ? t('orders.pickup') : t('orders.delivery'), money(o.total_cents),
    ]) {
      tr.append(el('td', value));
    }
    const trackTd = el('td');
    const trackBtn = el('button', t('orders.track'), { className: 'text-button', type: 'button' });
    trackTd.append(trackBtn);
    tr.append(trackTd);
    const detail = el('tr', undefined, { className: 'track-row', hidden: true });
    const detailTd = el('td', undefined, { colSpan: 7 });
    detailTd.append(buildTracker(o));
    detail.append(detailTd);
    trackBtn.onclick = () => { detail.hidden = !detail.hidden; };
    body.append(tr, detail);
  }
  table.append(head, body);
  $('orders').replaceChildren(el('h2', t('orders.title')), table);
}
function buildTracker(o) {
  const box = el('div', undefined, { className: 'tracker' });
  if (o.status === 'cancelled') {
    box.append(el('p', t('orders.cancelled'), { className: 'tracker-cancelled' }));
    return box;
  }
  const current = Math.max(0, TRACK_STAGES.indexOf(o.status));
  const stages = el('ol', undefined, { className: 'tracker-stages' });
  for (const [i, stage] of TRACK_STAGES.entries()) {
    const li = el('li', t(`orders.status.${stage}`), { className: i <= current ? 'is-done' : '' });
    stages.append(li);
  }
  box.append(stages);
  const eta = new Date(new Date(o.created_at).getTime() + 3 * 86400000).toLocaleDateString(currencyFor(displayCurrency).locale || 'de-DE');
  box.append(el('p', t('orders.eta', { date: eta }), { className: 'tracker-eta' }));
  if (o.delivery_service) box.append(el('p', t('orders.courier', { courier: o.delivery_service.toUpperCase() }), { className: 'tracker-courier' }));
  if (o.payment_reference) box.append(el('p', t('orders.reference', { ref: o.payment_reference }), { className: 'tracker-reference' }));
  return box;
}
async function subscribe(bundleId) {
  if (!user) throw new Error('Please log in to start a monthly pack');
  const fulfillment = currentFulfillment();
  const body = { bundle_id: bundleId, fulfillment };
  if (fulfillment === 'pickup') {
    body.pickup_location_id = Number($('pickup-location').value) || undefined;
    if ($('pickup-at').value) body.pickup_at = $('pickup-at').value;
  } else {
    body.shipping_address = $('addr').value;
  }
  await api('/api/subscriptions', { method: 'POST', body });
  say('Monthly pack saved — we will prepare it every 30 days.');
  await loadMember();
}
async function session(fn) {
  try {
    const r = await fn();
    token = r.token; user = r.user;
    localStorage.setItem('token', token);
    say('');
    renderAccount();
    await Promise.all([loadOrders(), loadMember()]);
  } catch (e) { fail(e); }
}
$('login').onclick = () => session(() => api('/api/auth/login', { method: 'POST', body: { email: $('email').value, password: $('pw').value } }));
$('register').onclick = () => session(() => api('/api/auth/register', { method: 'POST', body: { name: $('name').value, email: $('email').value, password: $('pw').value, ref: $('ref').value || undefined } }));
$('logout').onclick = logout;
$('category-links').addEventListener('click', (event) => {
  const button = event.target.closest('[data-category]');
  if (!button) return;
  $('cat').value = button.dataset.category;
  document.querySelectorAll('.category-shortcut').forEach((item) => item.classList.toggle('is-active', item === button));
  loadProducts().catch(fail);
});
$('checkout').onclick = async () => {
  try {
    if (!user) throw new Error('Please log in to check out');
    const fulfillment = currentFulfillment();
    const items = Object.entries(cart).map(([key, quantity]) => key.startsWith('b')
      ? { bundle_id: Number(key.slice(1)), quantity }
      : { product_id: Number(key), quantity });
    const body = {
      items,
      fulfillment,
      delivery_service: document.querySelector('input[name="delivery_service"]:checked').value,
      payment_method: document.querySelector('input[name="payment_method"]:checked')?.value ?? 'card',
      shipping_country: 'DE',
    };
    if (fulfillment === 'pickup') {
      body.pickup_location_id = Number($('pickup-location').value) || undefined;
      if ($('pickup-at').value) body.pickup_at = $('pickup-at').value;
    } else {
      body.shipping_address = $('addr').value;
    }
    const order = await api('/api/orders', { method: 'POST', body });
    clearCart();
    say(fulfillment === 'pickup'
      ? `Order #${order.id} placed — we will have it packed for collection.`
      : `Order #${order.id} placed — thank you!`);
    user = await api('/api/me'); renderAccount();
    await Promise.all([loadProducts(), loadOrders(), loadMember()]);
  } catch (e) { fail(e); }
};
$('q').oninput = () => loadProducts().catch(fail);
$('cat').onchange = () => loadProducts().catch(fail);
document.querySelectorAll('input[name="fulfillment"]').forEach((radio) => radio.addEventListener('change', applyFulfillment));
$('addr').addEventListener('input', renderTotals);

// ---------- Catering: party planner & quote request ----------
async function planParty() {
  const spot = $('party-results');
  const guests = Math.min(Math.max(Number($('party-guests').value) || 20, 1), 1000);
  $('party-guests').value = String(guests);
  try {
    const plan = await api(`/api/catering/party?guests=${guests}`);
    const top = plan.suggestions.slice(0, 4);
    if (!top.length) {
      spot.replaceChildren(el('p', 'Ask us for a custom plan for your event.', { className: 'empty-state' }));
      return;
    }
    spot.replaceChildren(...top.map((s) => {
      const row = el('div', undefined, { className: 'party-result' });
      const details = el('div', undefined, { className: 'party-details' });
      details.append(el('strong', s.name));
      details.append(el('span', `${money(s.unit_price_cents)} · ${t('catering.covers', { n: s.serves })}`, { className: 'party-meta' }));
      row.append(details);
      row.append(el('span', t('catering.packs', { n: s.packs_needed }), { className: 'party-packs' }));
      row.append(el('strong', money(s.total_price_cents), { className: 'party-total' }));
      const add = el('button', 'Add to bag +', { className: 'add-button', type: 'button' });
      add.onclick = () => {
        cart[`b${s.id}`] = Math.min((cart[`b${s.id}`] || 0) + s.packs_needed, 10);
        saveCart();
        say(`Added ${s.packs_needed} × ${s.name} to your bag.`);
      };
      row.append(add);
      return row;
    }));
  } catch (e) { fail(e); }
}
$('plan-party').onclick = () => planParty();
$('quote-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/quotes', { method: 'POST', body: {
      name: $('quote-name').value,
      email: $('quote-email').value,
      phone: $('quote-phone').value || undefined,
      event_date: $('quote-date').value || undefined,
      guests: Number($('quote-guests').value) || 0,
      message: $('quote-message').value || undefined,
      fulfillment: currentFulfillment(),
    } });
    $('quote-form').reset();
    say(t('catering.sent'));
  } catch (e) { fail(e); }
});

// ---------- Language, currency and discovery controls ----------
$('lang').onchange = (event) => setLocale(event.target.value);
$('currency').onchange = (event) => setDisplayCurrency(event.target.value);
$('sort').onchange = (event) => { filters.sort = event.target.value; loadProducts().catch(fail); };
$('clear-filters').onclick = () => {
  filters.cuisine.clear();
  filters.origin.clear();
  filters.diet.clear();
  filters.maxSpice = '';
  filters.sort = 'name';
  renderFilterChips();
  renderSortOptions();
  loadProducts().catch(fail);
};

let deferredInstallPrompt;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  $('install-app').hidden = false;
});
$('install-app').onclick = async () => {
  if (!deferredInstallPrompt) return;
  await deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  if (outcome === 'accepted') $('install-app').hidden = true;
  deferredInstallPrompt = null;
};
window.addEventListener('appinstalled', () => {
  $('install-app').hidden = true;
  deferredInstallPrompt = null;
});
if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloadingForUpdate = false;
  if (hadController) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadingForUpdate) return;
      reloadingForUpdate = true;
      window.location.reload();
    });
  }
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => registration.update())
      .catch(() => {});
  });
}

(async () => {
  try {
    const [categories, config, areas, stores] = await Promise.all([
      api('/api/categories'),
      api('/api/config').catch(() => ({})),
      api('/api/delivery-areas').catch(() => []),
      api('/api/locations').catch(() => []),
    ]);
    settings = config;
    currencies = Array.isArray(config.currencies) && config.currencies.length ? config.currencies : currencies;
    if (!currencies.some((c) => c.code === displayCurrency)) displayCurrency = currencies[0].code;
    deliveryAreas = areas;
    locations = stores;
    for (const category of categories) {
      $('cat').append(el('option', category.name, { value: category.id }));
      const shortcut = el('button', category.name, { className: 'category-shortcut' });
      shortcut.dataset.category = String(category.id);
      $('category-links').append(shortcut);
    }
    fillFulfillmentOptions();
    fillPreferenceSelectors();
    applyI18n();
    const invite = new URLSearchParams(location.search).get('ref');
    if (invite) $('ref').value = invite.toUpperCase();
    if (token) { try { user = await api('/api/me'); } catch { token = null; } }
    renderAccount();
    renderCart();
    applyFulfillment();
    await loadFacets();
    await loadBundles();
    await Promise.all([loadProducts(), loadRecipes(), loadOrders(), loadMember()]);
    planParty().catch(() => {});
  } catch (e) { fail(e); }
})();
