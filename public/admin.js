const $ = (id) => document.getElementById(id);
const money = (c) => `$${(c / 100).toFixed(2)}`;
let token = localStorage.getItem('token');
const el = (tag, text, attrs = {}) => Object.assign(Object.assign(document.createElement(tag), { textContent: text ?? '' }), attrs);
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function table(cols, rows, action) {
  const t = el('table');
  const h = el('tr');
  for (const c of cols) h.append(el('th', c));
  if (action) h.append(el('th', ''));
  t.append(h);
  for (const r of rows) {
    const tr = el('tr');
    for (const c of cols) tr.append(el('td', r[c]));
    if (action) { const td = el('td'); const a = action(r); if (a) td.append(a); tr.append(td); }
    t.append(tr);
  }
  return t;
}
const guard = (fn) => async () => { try { await fn(); $('msg').textContent = ''; } catch (e) { $('msg').textContent = e.message; } };

const load = guard(async () => {
  const s = await api('/api/reports/summary');
  $('login').hidden = true; $('dash').hidden = false;
  $('summary').replaceChildren(...Object.entries({
    Orders: s.orders, Revenue: money(s.revenue_cents), 'Est. profit': money(s.estimated_profit_cents),
    Customers: s.customers, 'Low stock items': s.low_stock_count, 'Inventory value': money(s.inventory_value_cents),
  }).map(([k, v]) => { const c = el('div', '', { className: 'card' }); c.append(el('small', k), el('h3', String(v))); return c; }));

  const orders = (await api('/api/orders')).map((o) => ({ ...o, total: money(o.total_cents) }));
  $('orders').replaceChildren(table(['id', 'created_at', 'status', 'total'], orders, (o) => {
    if (o.status === 'cancelled' || o.status === 'delivered') return null;
    const next = { pending: 'paid', paid: 'packed', packed: 'shipped', shipped: 'delivered' }[o.status];
    const b = el('button', `Mark ${next}`);
    b.onclick = guard(async () => { await api(`/api/orders/${o.id}/status`, { method: 'PATCH', body: { status: next } }); await load(); });
    return b;
  }));
  $('low').replaceChildren(table(['sku', 'name', 'stock', 'reorder_level', 'supplier'], await api('/api/inventory/low-stock')));
  const pos = (await api('/api/purchase-orders')).map((p) => ({ ...p, lines: p.items.map((i) => `${i.name}×${i.quantity}`).join(', ') }));
  $('pos').replaceChildren(table(['id', 'supplier_id', 'status', 'lines'], pos, (p) => {
    if (p.status !== 'ordered') return null;
    const b = el('button', 'Receive');
    b.onclick = guard(async () => { await api(`/api/purchase-orders/${p.id}/receive`, { method: 'POST' }); await load(); });
    return b;
  }));
  const prods = (await api('/api/products')).map((p) => ({ ...p, price: money(p.price_cents) }));
  $('inv').replaceChildren(table(['sku', 'name', 'category', 'price', 'stock'], prods));
  $('sups').replaceChildren(table(['id', 'name', 'country', 'contact_name', 'email', 'phone'], await api('/api/suppliers')));
});

$('go').onclick = guard(async () => {
  const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: $('email').value, password: $('pw').value }) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error);
  token = d.token; localStorage.setItem('token', token);
  await load();
});
$('reorder').onclick = guard(async () => { await api('/api/inventory/reorder', { method: 'POST' }); await load(); });
if (token) load();
