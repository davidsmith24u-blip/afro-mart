const $ = (id) => document.getElementById(id);
const money = (c) => `$${(c / 100).toFixed(2)}`;
let token = localStorage.getItem('token');
let user = null;
let products = [];
const productCatalog = new Map();
const cart = JSON.parse(localStorage.getItem('cart') || '{}');

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

async function loadProducts() {
  const p = new URLSearchParams();
  if ($('q').value) p.set('q', $('q').value);
  if ($('cat').value) p.set('category', $('cat').value);
  products = await api(`/api/products?${p}`);
  products.forEach((product) => productCatalog.set(product.id, product));
  const glyphs = { 'dry goods': '🌾', 'fresh produce': '🥬', beverages: '🫖', spices: '🌶️', frozen: '❄️', snacks: '🥜', 'oils & condiments': '🫘' };
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
    info.append(el('p', product.description || 'A favorite from our market.', { className: 'product-description' }));
    const buy = el('div', undefined, { className: 'product-buy' });
    const price = el('strong', money(product.price_cents), { className: 'product-price' });
    const add = el('button', product.stock > 0 ? 'Add to bag +' : 'Sold out', { className: 'add-button', disabled: product.stock <= 0, type: 'button' });
    add.onclick = () => { cart[product.id] = Math.min((cart[product.id] || 0) + 1, product.stock); saveCart(); };
    buy.append(price, add);
    if (product.stock > 0 && product.stock <= 5) buy.append(el('span', 'Only a few left', { className: 'stock-label' }));
    info.append(buy);
    card.append(art, info);
    return card;
  }) : [el('p', 'No products match your search. Try another name or category.', { className: 'empty-state' })]));
  $('product-count').textContent = `${products.length} ${products.length === 1 ? 'product' : 'products'}`;
  renderCart();
}
function saveCart() { localStorage.setItem('cart', JSON.stringify(cart)); renderCart(); }
function clearCart() { for (const key of Object.keys(cart)) delete cart[key]; saveCart(); }
function renderCart() {
  let total = 0;
  let itemCount = 0;
  const rows = [];
  for (const [id, qty] of Object.entries(cart)) {
    const p = productCatalog.get(Number(id));
    if (!p) continue;
    total += p.price_cents * qty;
    const tr = el('tr');
    tr.append(el('td', p.name));
    const quantityCell = el('td');
    const controls = el('div', undefined, { className: 'quantity-controls' });
    const decrease = el('button', '−', { type: 'button', title: 'Decrease quantity', ariaLabel: `Decrease ${p.name} quantity` });
    decrease.onclick = () => { if (cart[id] <= 1) delete cart[id]; else cart[id] -= 1; saveCart(); };
    const increase = el('button', '+', { type: 'button', title: 'Increase quantity', ariaLabel: `Increase ${p.name} quantity` });
    increase.disabled = qty >= p.stock;
    increase.onclick = () => { cart[id] = Math.min(cart[id] + 1, p.stock); saveCart(); };
    controls.append(decrease, el('span', String(qty)), increase);
    quantityCell.append(controls);
    tr.append(quantityCell, el('td', money(p.price_cents * qty)));
    const removeCell = el('td');
    const remove = el('button', 'Remove', { className: 'remove-item', type: 'button' });
    remove.onclick = () => { delete cart[id]; saveCart(); };
    removeCell.append(remove);
    tr.append(removeCell);
    rows.push(tr);
    itemCount += qty;
  }
  const table = $('cart');
  const caption = table.querySelector('caption');
  const head = el('thead');
  const headingRow = el('tr');
  for (const title of ['Item', 'Qty', 'Subtotal', '']) headingRow.append(el('th', title));
  head.append(headingRow);
  const body = el('tbody');
  if (rows.length) body.append(...rows);
  else {
    const emptyRow = el('tr');
    emptyRow.append(el('td', 'Your bag is waiting for something good.', { className: 'empty-cart', colSpan: 4 }));
    body.append(emptyRow);
  }
  table.replaceChildren(caption, head, body);
  $('total').textContent = money(total);
  $('cart-count').textContent = String(itemCount);
  $('cart-summary').textContent = itemCount ? `${itemCount} ${itemCount === 1 ? 'item' : 'items'} in your bag` : 'Ready when you are';
}
function renderAccount() {
  const a = $('acct');
  a.replaceChildren();
  $('auth').hidden = !!user;
  if (!user) return;
  a.append(`${user.name} · ${user.loyalty_points} pts `);
  if (user.role !== 'customer') a.append(el('a', 'Dashboard', { href: '/admin' }), ' ');
  const out = el('button', 'Log out');
  out.onclick = () => { localStorage.removeItem('token'); token = null; user = null; renderAccount(); $('orders').replaceChildren(); };
  a.append(out);
}
async function loadOrders() {
  if (!user) return;
  const orders = await api('/api/orders');
  const t = el('table');
  const head = el('thead');
  const headingRow = el('tr');
  for (const label of ['Order', 'Placed', 'Status', 'Courier', 'Total']) headingRow.append(el('th', label));
  head.append(headingRow);
  const body = el('tbody');
  for (const o of orders) {
    const tr = el('tr');
    for (const value of [
      `#${o.id}`, o.created_at, o.status, o.delivery_service.toUpperCase(), money(o.total_cents),
    ]) {
      tr.append(el('td', value));
    }
    body.append(tr);
  }
  t.append(head, body);
  $('orders').replaceChildren(el('h2', 'Your orders'), t);
}
async function session(fn) {
  try {
    const r = await fn();
    token = r.token; user = r.user;
    localStorage.setItem('token', token);
    $('msg').textContent = '';
    renderAccount(); await loadOrders();
  } catch (e) { fail(e); }
}
$('login').onclick = () => session(() => api('/api/auth/login', { method: 'POST', body: { email: $('email').value, password: $('pw').value } }));
$('register').onclick = () => session(() => api('/api/auth/register', { method: 'POST', body: { name: $('name').value, email: $('email').value, password: $('pw').value } }));
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
    const items = Object.entries(cart).map(([id, quantity]) => ({ product_id: Number(id), quantity }));
    await api('/api/orders', {
      method: 'POST',
      body: {
        items,
        shipping_address: $('addr').value,
        delivery_service: document.querySelector('input[name="delivery_service"]:checked').value,
        shipping_country: 'DE',
      },
    });
    clearCart(); $('msg').textContent = 'Your order has been placed.';
    user = await api('/api/me'); renderAccount();
    await Promise.all([loadProducts(), loadOrders()]);
  } catch (e) { fail(e); }
};
$('q').oninput = () => loadProducts().catch(fail);
$('cat').onchange = () => loadProducts().catch(fail);

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
    for (const category of await api('/api/categories')) {
      $('cat').append(el('option', category.name, { value: category.id }));
      const shortcut = el('button', category.name, { className: 'category-shortcut' });
      shortcut.dataset.category = String(category.id);
      $('category-links').append(shortcut);
    }
    if (token) { try { user = await api('/api/me'); } catch { token = null; } }
    renderAccount();
    renderCart();
    await loadProducts();
    await loadOrders();
  } catch (e) { fail(e); }
})();
