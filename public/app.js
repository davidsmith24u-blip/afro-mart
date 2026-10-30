import { LOCALES, LOCALE_LABELS, translate } from '/i18n.js';

const $ = (id) => document.getElementById(id);

// Safety net: if a script error stops the storefront from booting (for example a
// stale cached bundle served against fresh HTML right after a deploy), show a
// one-tap recovery instead of leaving the market silently blank.
window.addEventListener('error', () => {
  const message = document.getElementById('msg');
  const market = document.getElementById('products');
  if (!message || !market || market.querySelector('.product-card') || message.dataset.bootFailed) return;
  message.dataset.bootFailed = '1';
  message.textContent = 'This page could not finish loading. Please reload to get the latest version. ';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Reload';
  retry.addEventListener('click', () => window.location.reload());
  message.appendChild(retry);
});

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
let activeCategory = '';
let categoryList = [];
const productCatalog = new Map();
let bundles = [];
const bundleCatalog = new Map();
let deliveryAreas = [];
let locations = [];
let settings = {};
let recipes = [];
const cart = JSON.parse(localStorage.getItem('cart') || '{}');
// Promo code the shopper applied at checkout (validated by the server).
let appliedPromo = null;

// Discovery filters (cuisine / country / diet / heat) + sort, mirrored to the API.
const filters = { cuisine: new Set(), origin: new Set(), diet: new Set(), maxSpice: '', sort: 'name' };
let facets = null;
const unitPrice = (product) => product.effective_price_cents ?? product.price_cents;

// Prefer a real product image; fall back to a category/name-appropriate placeholder.
const productPhoto = (product) => {
  if (product.image_url) return product.image_url;
  const name = product.name.toLowerCase();
  if (name.includes('coca-cola')) return '/products/coca-cola.jpg';
  if (name.includes('pepsi')) return '/products/pepsi.jpg';
  if (name.includes('wine')) return '/products/wine.jpg';
  if ((product.category || '').toLowerCase() === 'fresh produce') return '/products/produce.jpg';
  if ((product.category || '').toLowerCase() === 'spices') return '/products/spices.jpg';
  if ((product.category || '').toLowerCase() === 'beverages') return '/products/african-drinks.jpg';
  return '/products/staples.jpg';
};

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

function promoDiscount(subtotal) {
  if (!appliedPromo) return 0;
  if (subtotal < (appliedPromo.min_total_cents || 0)) return 0;
  const raw = appliedPromo.discount_type === 'fixed'
    ? appliedPromo.value
    : Math.floor((subtotal * appliedPromo.value) / 100);
  return Math.max(0, Math.min(raw, subtotal));
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
  const discount = promoDiscount(subtotal);
  const promoLine = $('promo-line');
  promoLine.hidden = discount <= 0;
  if (discount > 0) promoLine.textContent = `${t('cart.discount')} · −${money(discount)}`;
  $('payable').textContent = money(subtotal - discount + fee);
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
  if (activeCategory) p.set('category', activeCategory);
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
  const toneFor = (category) => {
    const value = (category || '').toLowerCase();
    if (value.includes('spice')) return 'spices';
    if (value.includes('beverage') || value.includes('drink')) return 'beverages';
    if (value.includes('frozen')) return 'frozen';
    if (value.includes('fresh') || value.includes('produce')) return 'fresh';
    return 'pantry';
  };
  $('products').replaceChildren(...(products.length ? products.map((product, index) => {
    // Rendered as a link so crawlers can follow every product to its own indexable
    // page (src/seo.js). Clicking still opens the quick-view modal instead of leaving.
    const card = el('a', undefined, { className: 'product-card', href: product.path || '#' });
    card.onclick = (event) => { event.preventDefault(); openProduct(product); };
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
    if (product.rating_count) info.append(ratingStars(product.rating_average, product.rating_count));
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
    // preventDefault matters now the card is a link: without it the browser would
    // follow the href as well as adding to the bag.
    add.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      cart[product.id] = Math.min((cart[product.id] || 0) + 1, product.stock);
      saveCart();
    };
    buy.append(priceWrap, add);
    if (product.stock > 0 && product.stock <= 5) buy.append(el('span', 'Only a few left', { className: 'stock-label' }));
    info.append(buy);
    card.append(art, info);
    return card;
  }) : [el('p', 'No products match your search. Try another name or category.', { className: 'empty-state' })]));
  $('product-count').textContent = `${products.length} ${products.length === 1 ? 'product' : 'products'}`;
  renderCart();
}
// ---------- Product detail modal: imagery, reviews and stock alerts ----------
let modalEl = null;
const onModalKey = (event) => { if (event.key === 'Escape') closeModal(); };
function closeModal() {
  if (modalEl) { modalEl.remove(); modalEl = null; document.removeEventListener('keydown', onModalKey); }
}

function ratingStars(average, count) {
  const wrap = el('span', undefined, { className: 'rating-stars' });
  const rounded = Math.round(Number(average) || 0);
  wrap.append(el('span', '★'.repeat(rounded) + '☆'.repeat(5 - rounded), { className: 'stars-glyphs', ariaHidden: 'true' }));
  wrap.append(el('span', ` ${Number(average).toFixed(1)} (${count})`, { className: 'rating-count' }));
  wrap.setAttribute('aria-label', `${average} out of 5 from ${count} reviews`);
  return wrap;
}

function openProduct(product) {
  closeModal();
  const overlay = el('div', undefined, { className: 'modal-overlay' });
  overlay.onclick = (event) => { if (event.target === overlay) closeModal(); };
  const modal = el('div', undefined, { className: 'product-modal' });
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', product.name);

  const close = el('button', '×', { className: 'modal-close', type: 'button' });
  close.setAttribute('aria-label', t('reviews.close'));
  close.onclick = closeModal;
  modal.append(close);

  const art = el('div', undefined, { className: 'modal-art' });
  const photo = el('img', undefined, { className: 'modal-photo', src: productPhoto(product), alt: `${product.name} product photo`, decoding: 'async' });
  photo.onerror = () => photo.remove();
  art.append(photo);

  const body = el('div', undefined, { className: 'modal-body' });
  body.append(el('p', product.category || 'Market favorite', { className: 'product-category' }));
  body.append(el('h2', product.name));
  if (product.rating_count) body.append(ratingStars(product.rating_average, product.rating_count));
  body.append(el('p', product.description || 'A favorite from our market.', { className: 'modal-description' }));
  body.append(el('p', money(unitPrice(product)), { className: 'modal-price' }));

  const add = el('button', product.stock > 0 ? 'Add to bag +' : 'Sold out', { className: 'add-button', type: 'button', disabled: product.stock <= 0 });
  add.onclick = () => { cart[product.id] = Math.min((cart[product.id] || 0) + 1, product.stock); saveCart(); say(`Added ${product.name} to your bag.`); };
  body.append(add);
  if (product.stock <= 0) body.append(stockAlertForm(product));

  const reviews = el('section', undefined, { className: 'modal-reviews' });
  reviews.append(el('h3', t('reviews.title')));
  const list = el('div', undefined, { className: 'review-list' });
  const formHost = el('div', undefined, { className: 'review-form-host' });
  reviews.append(list, formHost);
  body.append(reviews);
  modal.append(art, body);
  overlay.append(modal);
  document.body.append(overlay);
  modalEl = overlay;
  document.addEventListener('keydown', onModalKey);
  loadProductReviews(product.id, list, formHost);
}

async function loadProductReviews(productId, list, formHost) {
  list.replaceChildren(el('p', t('reviews.loading'), { className: 'empty-state' }));
  let data;
  try {
    data = await api(`/api/products/${productId}/reviews`);
  } catch (error) {
    list.textContent = error.message;
    return;
  }
  if (!data.count) list.replaceChildren(el('p', t('reviews.none'), { className: 'empty-state' }));
  else list.replaceChildren(...data.reviews.map(reviewCard));
  renderReviewForm(productId, formHost, () => loadProductReviews(productId, list, formHost));
}

function reviewCard(review) {
  const card = el('article', undefined, { className: 'review-card' });
  const head = el('div', undefined, { className: 'review-head' });
  head.append(el('span', '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating), { className: 'stars-glyphs', ariaHidden: 'true' }));
  head.append(el('strong', review.author));
  if (review.verified) head.append(el('span', t('reviews.verified'), { className: 'verified-badge' }));
  card.append(head);
  if (review.title) card.append(el('p', review.title, { className: 'review-title' }));
  if (review.body) card.append(el('p', review.body, { className: 'review-body' }));
  if (review.image_url) card.append(el('img', undefined, { className: 'review-photo', src: review.image_url, alt: `${review.author} review photo`, loading: 'lazy' }));
  return card;
}

function renderReviewForm(productId, host, onDone) {
  host.replaceChildren();
  if (!user) {
    host.append(el('p', t('reviews.signin'), { className: 'empty-state' }));
    return;
  }
  const form = el('form', undefined, { className: 'review-form' });
  form.append(el('h4', t('reviews.write')));
  const rating = el('select', undefined, { className: 'review-rating' });
  rating.setAttribute('aria-label', t('reviews.rating'));
  for (const n of [5, 4, 3, 2, 1]) {
    const option = el('option', `${'★'.repeat(n)} (${n})`);
    option.value = String(n);
    rating.append(option);
  }
  const title = el('input', undefined, { className: 'review-title-input', maxLength: 120 });
  title.placeholder = t('reviews.titlePlaceholder');
  const text = el('textarea', undefined, { className: 'review-body-input', maxLength: 2000, rows: 3 });
  text.placeholder = t('reviews.bodyPlaceholder');
  const file = el('input', undefined, { className: 'review-photo-input', type: 'file' });
  file.accept = 'image/*';
  const submit = el('button', t('reviews.submit'), { className: 'add-button', type: 'submit' });
  form.append(rating, title, text, file, submit);
  form.onsubmit = async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      let imageUrl = null;
      const chosen = file.files && file.files[0];
      if (chosen) {
        const data = await readFileAsBase64(chosen);
        const uploaded = await api('/api/images', { method: 'POST', body: { content_type: chosen.type, data } });
        imageUrl = uploaded.url;
      }
      await api(`/api/products/${productId}/reviews`, {
        method: 'POST',
        body: { rating: Number(rating.value), title: title.value, body: text.value, image_url: imageUrl },
      });
      say(t('reviews.thanks'));
      onDone();
    } catch (error) {
      fail(error);
    } finally {
      submit.disabled = false;
    }
  };
  host.append(form);
}

function stockAlertForm(product) {
  const form = el('form', undefined, { className: 'stock-alert-form' });
  form.append(el('p', t('stock.out'), { className: 'stock-alert-note' }));
  const email = el('input', undefined, { className: 'stock-alert-email', type: 'email' });
  email.placeholder = t('stock.emailPlaceholder');
  email.required = true;
  email.value = (user && user.email) || '';
  const button = el('button', t('stock.notifyMe'), { className: 'add-button', type: 'submit' });
  form.append(email, button);
  form.onsubmit = async (event) => {
    event.preventDefault();
    button.disabled = true;
    try {
      await api('/api/stock-alerts', { method: 'POST', body: { product_id: product.id, email: email.value } });
      say(t('stock.thanks'));
      form.reset();
    } catch (error) {
      fail(error);
    } finally {
      button.disabled = false;
    }
  };
  return form;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that image'));
    reader.readAsDataURL(file);
  });
}

async function loadBundles() {
  const data = await api('/api/bundles');
  bundles = data;
  bundleCatalog.clear();
  bundles.forEach((bundle) => bundleCatalog.set(bundle.id, bundle));
  // Packs now surface through recipes (and the kitchen assistant) rather than a
  // dedicated section, so only render when the grid is on the page.
  const grid = $('bundle-grid');
  if (!grid) return;
  if (!bundles.length) {
    const section = $('packs');
    if (section) section.hidden = true;
    return;
  }
  const glyph = { meal_pack: '🍲', starter_pack: '🥘', party_pack: '🎉', gift_box: '🎁', taste_box: '⚖️' };
  grid.replaceChildren(...bundles.slice(0, 6).map((bundle) => {
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
  }));
}
async function loadRecipes() {
  recipes = await api('/api/recipes');
  const grid = $('recipe-grid');
  if (!grid) return; // recipes section removed from the storefront; data still feeds the kitchen helper
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
  if (recipe.steps) {
    const details = el('details', undefined, { className: 'recipe-method' });
    details.append(el('summary', t('recipe.method')));
    const steps = el('ol', undefined, { className: 'recipe-steps' });
    for (const step of recipe.steps.split('\n').map((line) => line.trim()).filter(Boolean)) {
      steps.append(el('li', step.replace(/^\d+[.)]\s*/, '')));
    }
    details.append(steps);
    card.append(details);
  }
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

// ---------- AI kitchen assistant ----------
// Talks to /api/assistant/*. The matching is done on the server against the
// real catalogue; the browser only renders results and fills the bag.
const assistantHistory = [];
let assistantBusy = false;

function addAssistantItems(items) {
  let lines = 0;
  for (const item of items || []) {
    if (item.bundle_id != null) {
      const key = `b${item.bundle_id}`;
      cart[key] = Math.min((cart[key] || 0) + (item.quantity || 1), 10);
    } else if (item.product_id != null) {
      cart[item.product_id] = (cart[item.product_id] || 0) + (item.quantity || 1);
    } else {
      continue;
    }
    lines += 1;
  }
  if (lines) saveCart();
  return lines;
}

function recipeAddItems(recipe, onlyAvailable) {
  return (recipe.ingredients || [])
    .filter((ingredient) => !onlyAvailable || ingredient.in_stock)
    .map((ingredient) => (ingredient.kind === 'bundle'
      ? { bundle_id: ingredient.id, quantity: ingredient.quantity }
      : { product_id: ingredient.id, quantity: ingredient.quantity }));
}

function assistantSuggestionCard(item, isBundle = false) {
  const card = el('article', undefined, { className: 'assistant-suggestion' });
  card.append(el('img', undefined, { src: productPhoto(item), alt: '', className: 'assistant-suggestion-photo', loading: 'lazy' }));
  const body = el('div', undefined, { className: 'assistant-suggestion-body' });
  body.append(el('strong', item.name));
  if (item.price_cents != null) body.append(el('span', money(item.price_cents), { className: 'product-price' }));
  const add = el('button', '+', { className: 'add-button', type: 'button' });
  add.title = t('assistant.addAll');
  add.disabled = !(item.in_stock ?? item.stock > 0);
  add.onclick = () => say(t('assistant.added', {
    count: addAssistantItems([isBundle ? { bundle_id: item.id, quantity: 1 } : { product_id: item.id, quantity: 1 }]),
  }));
  card.append(body, add);
  return card;
}

function assistantRecipeRow(recipe) {
  const card = el('article', undefined, { className: 'assistant-suggestion' });
  card.append(el('span', recipe.emoji || '🍽️', { className: 'recipe-emoji', ariaHidden: 'true' }));
  const body = el('div', undefined, { className: 'assistant-suggestion-body' });
  body.append(el('strong', recipe.title));
  body.append(el('span', money(recipe.price_cents), { className: 'product-price' }));
  const items = recipeAddItems(recipe, true);
  const add = el('button', '+', { className: 'add-button', type: 'button' });
  add.title = t('assistant.addAll');
  add.disabled = !items.length || !recipe.items_available;
  add.onclick = () => say(t('assistant.added', { count: addAssistantItems(items) }));
  card.append(body, add);
  return card;
}

function assistantMatchCard(match) {
  const card = el('article', undefined, { className: 'assistant-match' });
  const head = el('div', undefined, { className: 'assistant-match-head' });
  head.append(el('span', match.emoji || '🍽️', { className: 'recipe-emoji', ariaHidden: 'true' }));
  const titles = el('div', undefined, { className: 'assistant-match-titles' });
  titles.append(el('h3', match.title));
  titles.append(el('p', `${match.prep_minutes} min · ${money(match.price_cents)}`, { className: 'recipe-meta' }));
  head.append(titles);
  head.append(el('span', `${match.coverage}% ${t('assistant.match')}`, { className: 'assistant-coverage' }));
  card.append(head);
  if (match.have && match.have.length) card.append(el('p', `${t('assistant.youHave')}: ${match.have.join(', ')}`, { className: 'assistant-have' }));
  if (match.missing && match.missing.length) {
    card.append(el('p', t('assistant.missing'), { className: 'assistant-subhead' }));
    const list = el('ul', undefined, { className: 'assistant-missing' });
    for (const item of match.missing) {
      const li = el('li');
      if (!item.in_stock) li.className = 'out';
      li.append(el('span', item.name));
      li.append(el('span', item.in_stock ? money(item.price_cents) : `${money(item.price_cents)} · ${t('assistant.outOfStock')}`, { className: 'recipe-qty' }));
      list.append(li);
    }
    card.append(list);
  } else {
    card.append(el('p', t('assistant.haveEverything'), { className: 'assistant-have' }));
  }
  const buy = el('div', undefined, { className: 'product-buy' });
  if (match.add_missing && match.add_missing.length) {
    const missing = el('button', `${t('assistant.addMissing')} +`, { className: 'add-button', type: 'button' });
    missing.disabled = !match.items_available;
    missing.onclick = () => say(t('assistant.added', { count: addAssistantItems(match.add_missing) }));
    buy.append(missing);
  }
  const all = el('button', `${t('assistant.addAll')} +`, { className: 'secondary-button', type: 'button' });
  all.onclick = () => say(t('assistant.added', { count: addAssistantItems(match.add_all) }));
  buy.append(all);
  card.append(buy);
  return card;
}

async function cookFromPantry() {
  if (assistantBusy) return;
  const pantry = $('assistant-pantry').value.trim();
  const status = $('assistant-status');
  const results = $('assistant-results');
  if (!pantry) { status.textContent = t('assistant.needPantry'); return; }
  assistantBusy = true;
  status.textContent = t('assistant.thinking');
  results.replaceChildren();
  try {
    const guests = Math.max(1, Math.min(100, Number($('assistant-guests').value) || 4));
    const data = await api('/api/assistant/cook', { method: 'POST', body: { pantry, guests } });
    const cards = [];
    if (data.tip) cards.push(el('p', `💡 ${data.tip}`, { className: 'assistant-tip' }));
    for (const match of data.matches) cards.push(assistantMatchCard(match));
    if (!data.matches.length) {
      cards.push(el('p', t('assistant.noMatch'), { className: 'assistant-status' }));
      for (const suggestion of data.suggestions) {
        const recipe = recipes.find((item) => item.id === suggestion.recipe_id);
        if (recipe) cards.push(recipeCard(recipe));
      }
    }
    results.replaceChildren(...cards);
    status.textContent = '';
  } catch (e) {
    status.textContent = e.message;
  } finally {
    assistantBusy = false;
  }
}

function assistantBubble(role, text) {
  return el('div', text, { className: `assistant-bubble ${role === 'user' ? 'from-user' : 'from-shop'}` });
}

function renderAssistantChat() {
  const box = $('assistant-chat');
  box.replaceChildren(...assistantHistory.map((message) => assistantBubble(message.role, message.content)));
  box.scrollTop = box.scrollHeight;
}

async function askAssistant(question) {
  if (assistantBusy) return;
  assistantBusy = true;
  assistantHistory.push({ role: 'user', content: question });
  renderAssistantChat();
  const host = $('assistant-chat');
  const thinking = el('div', t('assistant.askThinking'), { className: 'assistant-bubble from-shop thinking' });
  host.append(thinking);
  host.scrollTop = host.scrollHeight;
  try {
    const data = await api('/api/assistant/chat', { method: 'POST', body: { messages: assistantHistory.slice(-8) } });
    assistantHistory.push({ role: 'assistant', content: data.reply });
    renderAssistantChat();
    const cards = [
      ...data.products.map((product) => assistantSuggestionCard(product)),
      ...data.bundles.map((bundle) => assistantSuggestionCard(bundle, true)),
      ...data.recipes.map(assistantRecipeRow),
    ];
    if (cards.length) {
      const wrap = el('div', undefined, { className: 'assistant-suggestions' });
      wrap.append(...cards);
      host.append(wrap);
      host.scrollTop = host.scrollHeight;
    }
  } catch (e) {
    assistantHistory.push({ role: 'assistant', content: e.message });
    renderAssistantChat();
  } finally {
    assistantBusy = false;
  }
}

// Contact card — only shown when a real channel is configured, so the
// storefront never advertises a phone number or address we do not have.
function initContact() {
  const section = $('contact');
  if (!section) return;
  const host = $('contact-actions');
  const wa = settings.whatsapp_number ? String(settings.whatsapp_number).replace(/[^\d]/g, '') : '';
  const email = settings.support_email;
  const links = [];
  if (wa) {
    const a = el('a', `💬 ${t('contact.whatsapp')}`, { className: 'contact-button', href: `https://wa.me/${wa}` });
    a.target = '_blank';
    a.rel = 'noopener';
    links.push(a);
  }
  if (email) links.push(el('a', `✉️ ${t('contact.email')}`, { className: 'contact-button ghost', href: `mailto:${email}` }));
  links.push(el('a', `📦 ${t('contact.track')}`, { className: 'contact-button ghost', href: '#track' }));
  host.replaceChildren(...links, el('p', 'Store pickup in Bochum • We deliver throughout Germany • Free delivery over €50 within Bochum', { className: 'contact-note' }), el('p', t('contact.reply'), { className: 'contact-note' }));
  section.hidden = false;
}

// Product pages link back with `/?add=<id>#shopping-cart` so a visitor arriving from
// Google can drop the item straight into the bag. The id is consumed, then removed
// from the address bar so a refresh or a shared link does not re-add it.
function applyAddParam() {
  const params = new URLSearchParams(location.search);
  const id = Number(params.get('add'));
  if (!id) return;
  params.delete('add');
  const query = params.toString();
  history.replaceState(null, '', location.pathname + (query ? `?${query}` : '') + location.hash);
  const product = productCatalog.get(id);
  if (!product || product.stock <= 0) return;
  cart[id] = Math.min((cart[id] || 0) + 1, product.stock);
  saveCart();
  say(`${product.name} added to your bag.`);
}

function initAssistant() {  const badge = $('assistant-badge');
  if (badge) {
    const powered = Boolean(settings.ai?.enabled);
    badge.dataset.i18n = powered ? 'assistant.poweredOn' : 'assistant.poweredOff';
    badge.textContent = t(badge.dataset.i18n);
    badge.classList.toggle('on', powered);
    badge.hidden = false;
  }
  $('assistant-cook').onclick = () => { cookFromPantry(); };
  $('assistant-pantry').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); cookFromPantry(); }
  });
  $('assistant-chat-form').onsubmit = (event) => {
    event.preventDefault();
    const input = $('assistant-chat-input');
    const question = input.value.trim();
    if (!question) return;
    input.value = '';
    askAssistant(question);
  };
}

function saveCart() { localStorage.setItem('cart', JSON.stringify(cart)); renderCart(); queueCartSnapshot(); }
function clearCart() { for (const key of Object.keys(cart)) delete cart[key]; saveCart(); }

// Mirror the signed-in customer's bag to the server (debounced) so lapsed carts
// can be recovered by the abandoned-cart automation.
let cartSnapshotTimer = null;
function queueCartSnapshot() {
  if (!user) return;
  clearTimeout(cartSnapshotTimer);
  cartSnapshotTimer = setTimeout(snapshotCart, 1500);
}
function snapshotCart() {
  if (!user) return;
  const items = [];
  for (const [key, qty] of Object.entries(cart)) {
    if (key.startsWith('b')) items.push({ bundle_id: Number(key.slice(1)), quantity: qty });
    else items.push({ product_id: Number(key), quantity: qty });
  }
  api('/api/cart', { method: 'PUT', body: { items, subtotal_cents: basketSubtotal() } }).catch(() => {});
}
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
  // Guests check out with just an email, so ask for it only when signed out.
  $('guest-fields').hidden = !!user;
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
    const invoiceBtn = el('button', t('orders.invoice'), { className: 'text-button', type: 'button' });
    invoiceBtn.onclick = async () => {
      try {
        const res = await fetch(`/api/orders/${o.id}/invoice`, { headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) throw new Error('Could not load that invoice');
        const win = window.open('', '_blank');
        if (win) { win.document.write(await res.text()); win.document.close(); }
      } catch (error) { fail(error); }
    };
    trackTd.append(trackBtn, ' ', invoiceBtn);
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
// ---------- Departments: a parallel grid of category tiles ----------
const departmentEmoji = {
  'dry goods': '🌾', 'fresh produce': '🥬', beverages: '🥤', spices: '🌶️', frozen: '❄️',
  snacks: '🥜', 'oils & condiments': '🫙', 'rice & grains': '🍚', 'meat & fish': '🐟',
  'health & beauty': '🧴',
};
const departmentGlyph = (name) => departmentEmoji[(name || '').toLowerCase()] || '🧺';

// Friendlier storefront labels + one-line subtitles for the "Shop your favourites"
// cards. Missing entries fall back to the catalogue category name.
const departmentDisplay = {
  'dry goods': 'departments.catStaples',
  spices: 'departments.catSpices',
};
const departmentSubs = {
  'dry goods': 'departments.subStaples',
  spices: 'departments.subSpices',
  'rice & grains': 'departments.subRice',
  snacks: 'departments.subSnacks',
  beverages: 'departments.subDrinks',
};

function selectDepartment(id) {
  activeCategory = id || '';
  document.querySelectorAll('.department-tile').forEach((tile) => {
    tile.classList.toggle('is-active', (tile.dataset.category || '') === activeCategory);
  });
  loadProducts()
    .then(() => $('shop')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    .catch(fail);
}

const departmentPhoto = (name) => {
  const key = (name || '').toLowerCase();
  if (key.includes('spice') || key.includes('oil') || key.includes('season')) return '/products/spices.jpg';
  if (key.includes('rice') || key.includes('grain') || key.includes('dry') || key.includes('flour')) return '/products/staples.jpg';
  if (key.includes('drink') || key.includes('beverage') || key.includes('juice')) return '/products/african-drinks.jpg';
  if (key.includes('produce') || key.includes('fresh') || key.includes('veg') || key.includes('fruit')) return '/products/produce.jpg';
  if (key.includes('wine')) return '/products/wine.jpg';
  return '';
};

function departmentTile(id, name, count, options = {}) {
  const tile = el('button', undefined, { className: 'department-tile', type: 'button' });
  tile.dataset.category = id ? String(id) : '';
  if (options.pack) tile.dataset.pack = '1';
  if (!id && !options.pack) tile.classList.add('is-active');
  const art = el('span', undefined, { className: 'department-art' });
  const photo = !options.pack && id ? departmentPhoto(name) : '';
  if (photo) {
    art.append(el('img', undefined, { src: photo, alt: '', loading: 'lazy', decoding: 'async' }));
  } else {
    art.append(el('span', options.glyph || departmentGlyph(name), { className: 'department-emoji' }));
  }
  const label = options.pack ? t('departments.catPacks') : (id && departmentDisplay[name.toLowerCase()] ? t(departmentDisplay[name.toLowerCase()]) : name);
  art.append(el('span', '→', { className: 'department-arrow' }));
  const text = el('span', undefined, { className: 'department-text' });
  text.append(el('span', label, { className: 'department-name' }));
  const subKey = options.pack ? 'departments.subPacks' : (id ? departmentSubs[name.toLowerCase()] : '');
  if (subKey) text.append(el('span', t(subKey), { className: 'department-sub' }));
  const meta = count ? `${count} ${t(count === 1 ? 'departments.item' : 'departments.items')}` : t('departments.all');
  text.append(el('span', meta, { className: 'department-meta' }));
  tile.append(art, text);
  return tile;
}

function renderDepartments() {
  const grid = $('department-grid');
  if (!grid) return;
  const counts = new Map();
  for (const product of products) counts.set(product.category, (counts.get(product.category) || 0) + 1);
  grid.replaceChildren(
    departmentTile('', t('nav.everything'), 0),
    ...categoryList.map((category) => departmentTile(category.id, category.name, counts.get(category.name) || 0)),
  );
}

$('department-grid')?.addEventListener('click', (event) => {
  const tile = event.target.closest('.department-tile');
  if (!tile) return;
  selectDepartment(tile.dataset.category);
});

$('apply-promo').onclick = async () => {
  const note = $('promo-note');
  const code = $('promo').value.trim().toUpperCase();
  if (!code) {
    appliedPromo = null;
    note.textContent = t('cart.promoHint');
    renderTotals();
    return;
  }
  try {
    const email = ($('guest-email').value || (user ? user.email : '')).trim() || undefined;
    const res = await api('/api/marketing/promo-codes/validate', {
      method: 'POST', body: { code, total_cents: basketSubtotal(), email },
    });
    appliedPromo = {
      code: res.code, discount_type: res.discount_type,
      value: res.value, min_total_cents: res.min_total_cents,
    };
    note.textContent = t('cart.promoApplied', { code: res.code, amount: money(res.discount_cents) });
  } catch (e) {
    appliedPromo = null;
    note.textContent = e.message;
  }
  renderTotals();
};

$('checkout').onclick = async () => {
  try {
    const guestEmail = ($('guest-email').value || '').trim();
    if (!user && !guestEmail) throw new Error(t('guest.emailLabel'));
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
    if (!user) {
      body.guest_email = guestEmail;
      if ($('guest-name').value.trim()) body.guest_name = $('guest-name').value.trim();
    }
    if (appliedPromo) body.promo_code = appliedPromo.code;
    if (fulfillment === 'pickup') {
      body.pickup_location_id = Number($('pickup-location').value) || undefined;
      if ($('pickup-at').value) body.pickup_at = $('pickup-at').value;
    } else {
      body.shipping_address = $('addr').value;
    }
    const order = await api('/api/orders', { method: 'POST', body });
    clearCart();
    appliedPromo = null;
    $('promo').value = '';
    $('promo-note').textContent = t('cart.promoHint');
    say(fulfillment === 'pickup'
      ? `Order #${order.id} placed — we will have it packed for collection.`
      : `Order #${order.id} placed — thank you!`);
    if (user) {
      user = await api('/api/me'); renderAccount();
      await Promise.all([loadProducts(), loadOrders(), loadMember()]);
    } else {
      // Help the guest follow their parcel right away.
      $('track-order').value = String(order.id);
      $('track-email').value = guestEmail;
      await loadProducts();
    }
  } catch (e) { fail(e); }
};
let searchTimer;
$('q').oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadProducts().catch(fail), 250);
};
$('search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  clearTimeout(searchTimer);
  loadProducts()
    .then(() => $('shop')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    .catch(fail);
});
document.querySelectorAll('input[name="fulfillment"]').forEach((radio) => radio.addEventListener('change', applyFulfillment));
$('addr').addEventListener('input', renderTotals);
$('track-form').onsubmit = async (event) => {
  event.preventDefault();
  const spot = $('track-result');
  const id = String($('track-order').value).replace(/[^0-9]/g, '');
  const email = $('track-email').value.trim();
  if (!id || !email) {
    spot.replaceChildren(el('p', t('track.missing'), { className: 'empty-state' }));
    return;
  }
  spot.replaceChildren(el('p', t('track.loading'), { className: 'tracker-loading' }));
  try {
    const order = await api(`/api/track?order=${encodeURIComponent(id)}&email=${encodeURIComponent(email)}`);
    const box = el('div', undefined, { className: 'track-box' });
    box.append(el('h3', `#${order.id}`, { className: 'tracker-order' }));
    box.append(buildTracker(order));
    if (order.items?.length) {
      const list = el('ul', undefined, { className: 'tracker-items' });
      for (const item of order.items) {
        list.append(el('li', `${item.quantity} × ${item.name ?? 'Item'}`));
      }
      box.append(list);
    }
    spot.replaceChildren(box);
  } catch {
    spot.replaceChildren(el('p', t('track.notFound'), { className: 'empty-state' }));
  }
};

// ---------- Catering: quote request ----------
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

// Mobile menu toggle
$('mobile-menu-btn')?.addEventListener('click', () => {
  document.querySelector('.service-nav')?.classList.toggle('open');
});

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
    categoryList = categories;
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
    // Pricing/render data for lines that recipes and the assistant add to the
    // bag even when the shop grid (launch scope) is not showing them.
    await api('/api/products?catalog=all')
      .then((everything) => everything.forEach((product) => productCatalog.set(product.id, product)))
      .catch(() => {});
    await Promise.all([loadProducts(), loadRecipes(), loadOrders(), loadMember()]);
    renderDepartments();
    applyAddParam();
    initAssistant();
    initContact();
  } catch (e) { fail(e); }
})();
