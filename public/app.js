const $ = (id) => document.getElementById(id);
const money = (c) => `$${(c / 100).toFixed(2)}`;
let token = localStorage.getItem('token');
let user = null;
let products = [];
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
  $('products').replaceChildren(...products.map((x) => {
    const c = el('div', undefined, { className: 'card' });
    c.append(el('h3', x.name), el('p', x.description), el('p', `${x.category ?? ''} · ${money(x.price_cents)}`));
    const b = el('button', x.stock > 0 ? 'Add to cart' : 'Out of stock', { disabled: x.stock <= 0 });
    b.onclick = () => { cart[x.id] = Math.min((cart[x.id] || 0) + 1, x.stock); saveCart(); };
    c.append(b);
    return c;
  }));
  renderCart();
}
function saveCart() { localStorage.setItem('cart', JSON.stringify(cart)); renderCart(); }
function renderCart() {
  let total = 0;
  const rows = [];
  for (const [id, qty] of Object.entries(cart)) {
    const p = products.find((x) => x.id === Number(id));
    if (!p) continue;
    total += p.price_cents * qty;
    const rm = el('button', 'Remove');
    rm.onclick = () => { delete cart[id]; saveCart(); };
    const tr = el('tr');
    for (const t of [p.name, `× ${qty}`, money(p.price_cents * qty)]) tr.append(el('td', t));
    const td = el('td'); td.append(rm); tr.append(td);
    rows.push(tr);
  }
  $('cart').replaceChildren(...rows);
  $('total').textContent = money(total);
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
  for (const o of orders) {
    const tr = el('tr');
    for (const v of [`#${o.id}`, o.created_at, o.status, money(o.total_cents)]) tr.append(el('td', v));
    t.append(tr);
  }
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
$('checkout').onclick = async () => {
  try {
    if (!user) throw new Error('Please log in to check out');
    const items = Object.entries(cart).map(([id, quantity]) => ({ product_id: Number(id), quantity }));
    await api('/api/orders', { method: 'POST', body: { items, shipping_address: $('addr').value } });
    for (const k of Object.keys(cart)) delete cart[k];
    saveCart(); $('msg').textContent = '';
    user = await api('/api/me'); renderAccount();
    await Promise.all([loadProducts(), loadOrders()]);
  } catch (e) { fail(e); }
};
$('q').oninput = () => loadProducts().catch(fail);
$('cat').onchange = () => loadProducts().catch(fail);

(async () => {
  try {
    for (const c of await api('/api/categories')) $('cat').append(el('option', c.name, { value: c.id }));
    if (token) { try { user = await api('/api/me'); } catch { token = null; } }
    renderAccount();
    await loadProducts();
    await loadOrders();
  } catch (e) { fail(e); }
})();
