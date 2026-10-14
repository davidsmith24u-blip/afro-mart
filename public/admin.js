const $ = (id) => document.getElementById(id);
const money = (c) => (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
let token = localStorage.getItem('token');
const el = (tag, text, attrs = {}) => Object.assign(Object.assign(document.createElement(tag), { textContent: text ?? '' }), attrs);
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || 'Request failed');
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
const guard = (fn) => async () => { try { const note = await fn(); $('msg').textContent = typeof note === 'string' ? note : ''; } catch (e) { $('msg').textContent = e.message; } };

const load = guard(async () => {
  const s = await api('/api/reports/summary');
  $('login').hidden = true; $('dash').hidden = false;
  $('summary').replaceChildren(...Object.entries({
    Orders: s.orders, Revenue: money(s.revenue_cents), 'Est. profit': money(s.estimated_profit_cents),
    Customers: s.customers, 'Low stock items': s.low_stock_count, 'Inventory value': money(s.inventory_value_cents),
  }).map(([k, v]) => { const c = el('div', '', { className: 'card' }); c.append(el('small', k), el('h3', String(v))); return c; }));

  const orders = (await api('/api/orders')).map((o) => ({
    ...o, how: o.fulfillment === 'pickup' ? 'Pickup' : 'Delivery',
    delivery_service: String(o.delivery_service || '').toUpperCase(),
    payment: o.payment_status, total: money(o.total_cents), raw: o,
  }));
  $('orders').replaceChildren(table(['id', 'created_at', 'status', 'payment', 'how', 'delivery_service', 'total'], orders, (o) => {
    const wrap = el('div', '', { className: 'row-actions' });
    const raw = o.raw;
    if (raw.status !== 'cancelled' && raw.status !== 'delivered') {
      const next = { pending: 'paid', paid: 'packed', packed: 'shipped', shipped: 'delivered' }[raw.status];
      const b = el('button', `Mark ${next}`);
      b.onclick = guard(async () => { await api(`/api/orders/${raw.id}/status`, { method: 'PATCH', body: { status: next } }); await load(); });
      wrap.append(b);
    }
    if (raw.payment_status !== 'paid' && raw.payment_status !== 'refunded') {
      const p = el('button', 'Mark paid');
      p.onclick = guard(async () => { await api(`/api/orders/${raw.id}/payment`, { method: 'PATCH', body: { status: 'paid', method: 'manual' } }); await load(); });
      wrap.append(p);
    }
    const invoice = el('button', 'Invoice');
    invoice.onclick = async () => {
      try {
        const res = await fetch(`/api/orders/${raw.id}/invoice`, { headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) throw new Error('Could not load that invoice');
        const win = window.open('', '_blank');
        if (win) { win.document.write(await res.text()); win.document.close(); }
      } catch (e) { $('msg').textContent = e.message; }
    };
    wrap.append(invoice);
    return wrap.children.length ? wrap : null;
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
  const rawBundles = await api('/api/bundles?all=1');
  const bundleRows = rawBundles.map((b) => ({
    id: b.id, sku: b.sku, name: b.name, type: b.type_label, items: `${b.item_count} items`,
    price: money(b.price_cents), savings: `save ${b.savings_percent}%`, state: b.active ? 'Active' : 'Hidden',
  }));
  $('bundles').replaceChildren(table(['sku', 'name', 'type', 'items', 'price', 'savings', 'state'], bundleRows, (r) => {
    const real = rawBundles.find((b) => b.id === r.id);
    const btn = el('button', real.active ? 'Hide' : 'Show');
    btn.onclick = guard(async () => { await api(`/api/bundles/${real.id}`, { method: 'PUT', body: { active: real.active ? false : true } }); await load(); });
    return btn;
  }));

  const rawSubs = await api('/api/subscriptions');
  const subRows = rawSubs.map((s) => ({
    id: s.id, user_id: s.user_id, bundle: s.bundle ? s.bundle.name : `#${s.bundle_id}`,
    fulfillment: s.fulfillment === 'pickup' ? 'Pickup' : 'Delivery', status: s.status,
    next_run_on: s.next_run_on, raw: s,
  }));
  $('subs').replaceChildren(table(['id', 'user_id', 'bundle', 'fulfillment', 'status', 'next_run_on'], subRows, (r) => {
    if (r.raw.status === 'cancelled') return null;
    const btn = el('button', r.raw.status === 'active' ? 'Pause' : 'Resume');
    btn.onclick = guard(async () => {
      await api(`/api/subscriptions/${r.raw.id}`, { method: 'PUT', body: { status: r.raw.status === 'active' ? 'paused' : 'active' } });
      await load();
    });
    return btn;
  }));

  const rawAreas = await api('/api/delivery-areas?all=1');
  const areaRows = rawAreas.map((a) => ({
    id: a.id, name: a.name, city: a.city || '—', postal_prefixes: a.postal_prefixes || '—',
    fee: money(a.fee_cents), minimum: money(a.min_order_cents), state: a.active ? 'Active' : 'Hidden', raw: a,
  }));
  $('delivery').replaceChildren(table(['id', 'name', 'city', 'postal_prefixes', 'fee', 'minimum', 'state'], areaRows, (r) => {
    const btn = el('button', r.raw.active ? 'Hide' : 'Show');
    btn.onclick = guard(async () => { await api(`/api/delivery-areas/${r.raw.id}`, { method: 'PUT', body: { active: !r.raw.active } }); await load(); });
    return btn;
  }));

  const rawRecipes = await api('/api/recipes?all=1');
  const recipeRows = rawRecipes.map((r) => ({
    emoji: r.emoji, title: r.title, prep: `${r.prep_minutes} min`, servings: r.servings,
    ingredients: r.ingredients.length, price: money(r.price_cents),
    available: r.items_available ? 'Ready' : 'Missing stock', state: r.active ? 'Active' : 'Hidden', raw: r,
  }));
  $('recipes').replaceChildren(table(['emoji', 'title', 'prep', 'servings', 'ingredients', 'price', 'available', 'state'], recipeRows, (r) => {
    const btn = el('button', r.raw.active ? 'Hide' : 'Show');
    btn.onclick = guard(async () => { await api(`/api/recipes/${r.raw.id}`, { method: 'PUT', body: { active: !r.raw.active } }); await load(); });
    return btn;
  }));

  const rawQuotes = await api('/api/quotes');
  const quoteRows = rawQuotes.map((q) => ({
    id: q.id, name: q.name, email: q.email, guests: q.guests || '—',
    event_date: q.event_date || '—', status: q.status,
    quoted: q.quoted_cents != null ? money(q.quoted_cents) : '—', raw: q,
  }));
  $('quotes').replaceChildren(table(['id', 'name', 'email', 'guests', 'event_date', 'status', 'quoted'], quoteRows, (r) => {
    if (r.raw.status === 'confirmed' || r.raw.status === 'declined') return null;
    const wrap = el('div', '', { className: 'row-actions' });
    const quote = el('button', 'Mark quoted');
    quote.onclick = guard(async () => {
      const current = r.raw.quoted_cents != null ? (r.raw.quoted_cents / 100).toFixed(2) : '';
      const entered = window.prompt(`Quote amount in EUR for ${r.raw.name}:`, current);
      if (entered == null) return '';
      const cents = Math.round(Number(entered) * 100);
      if (!Number.isFinite(cents) || cents < 0) throw new Error('Enter a valid amount');
      await api(`/api/quotes/${r.raw.id}`, { method: 'PATCH', body: { status: 'quoted', quoted_cents: cents } });
      await load();
      return `Quote #${r.raw.id} marked as quoted.`;
    });
    wrap.append(quote);
    const accept = el('button', 'Confirm');
    accept.onclick = guard(async () => {
      await api(`/api/quotes/${r.raw.id}`, { method: 'PATCH', body: { status: 'confirmed' } });
      await load();
      return `Quote #${r.raw.id} confirmed.`;
    });
    wrap.append(accept);
    return wrap;
  }));

  const rawCustomers = await api('/api/customers');
  const customerRows = rawCustomers.map((c) => ({
    id: c.id, name: c.name, email: c.email, account: c.account_type, points: c.loyalty_points, raw: c,
  }));
  $('customers').replaceChildren(table(['id', 'name', 'email', 'account', 'points'], customerRows, (r) => {
    const btn = el('button', r.raw.account_type === 'restaurant' ? 'Make retail' : 'Make restaurant');
    btn.onclick = guard(async () => {
      const next = r.raw.account_type === 'restaurant' ? 'retail' : 'restaurant';
      await api(`/api/customers/${r.raw.id}/account-type`, { method: 'PATCH', body: { account_type: next } });
      await load();
      return `${r.raw.name} is now a ${next === 'restaurant' ? 'wholesale' : 'retail'} account.`;
    });
    return btn;
  }));

  const rawReviews = await api('/api/reviews?status=all');
  const reviewRows = rawReviews.map((r) => ({
    id: r.id, product: r.product_name, author: r.author, rating: '★'.repeat(r.rating),
    status: r.status, title: r.title || '—', verified: r.verified ? 'Yes' : '', raw: r,
  }));
  $('reviews').replaceChildren(table(['id', 'product', 'author', 'rating', 'status', 'title', 'verified'], reviewRows, (r) => {
    const wrap = el('div', '', { className: 'row-actions' });
    if (r.raw.status !== 'approved') {
      const ok = el('button', 'Approve');
      ok.onclick = guard(async () => { await api(`/api/reviews/${r.raw.id}`, { method: 'PATCH', body: { status: 'approved' } }); await load(); return `Review #${r.raw.id} approved.`; });
      wrap.append(ok);
    }
    if (r.raw.status !== 'rejected') {
      const no = el('button', 'Reject');
      no.onclick = guard(async () => { await api(`/api/reviews/${r.raw.id}`, { method: 'PATCH', body: { status: 'rejected' } }); await load(); return `Review #${r.raw.id} rejected.`; });
      wrap.append(no);
    }
    const del = el('button', 'Delete');
    del.onclick = guard(async () => { await api(`/api/reviews/${r.raw.id}`, { method: 'DELETE' }); await load(); return `Review #${r.raw.id} deleted.`; });
    wrap.append(del);
    return wrap;
  }));

  const imageProducts = await api('/api/products?limit=200');
  const manager = el('div', '', { className: 'image-manager' });
  for (const p of imageProducts) {
    const row = el('div', '', { className: 'image-row' });
    const thumb = el('img', '', { src: p.image_url || '/products/staples.jpg', alt: p.name, className: 'image-thumb' });
    const meta = el('div', '', { className: 'image-meta' });
    meta.append(el('strong', p.name), el('small', p.sku));
    const input = el('input', '', { className: 'image-url', value: p.image_url || '' });
    input.placeholder = '/api/images/12 or https://…';
    const file = el('input', '', { type: 'file', className: 'image-file' });
    file.accept = 'image/*';
    const save = el('button', 'Save URL');
    save.dataset.id = String(p.id);
    save.onclick = guard(async () => {
      await api(`/api/products/${p.id}`, { method: 'PUT', body: { image_url: input.value.trim() || null } });
      await load();
      return `${p.name} image updated.`;
    });
    file.onchange = guard(async () => {
      const chosen = file.files && file.files[0];
      if (!chosen) return '';
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read image'));
        reader.readAsDataURL(chosen);
      });
      const up = await api('/api/images', { method: 'POST', body: { content_type: chosen.type, data: dataUrl } });
      await api(`/api/products/${p.id}`, { method: 'PUT', body: { image_url: up.url } });
      await load();
      return `${p.name} image uploaded.`;
    });
    row.append(thumb, meta, input, file, save);
    manager.append(row);
  }
  $('images').replaceChildren(manager);

  $('stock-alerts').replaceChildren(table(['id', 'product', 'email', 'created_at'], await api('/api/stock-alerts')));
  const cartRows = (await api('/api/carts')).map((c) => ({
    id: c.id, email: c.email, items: c.item_count, subtotal: money(c.subtotal_cents), updated_at: c.updated_at,
    reminded: c.reminded_at ? 'Yes' : '—', recovered: c.recovered_at ? 'Yes' : '—',
  }));
  $('carts').replaceChildren(table(['id', 'email', 'items', 'subtotal', 'updated_at', 'reminded', 'recovered'], cartRows));

  $('audit').replaceChildren(table(['id', 'created_at', 'actor_email', 'action', 'entity', 'entity_id', 'detail'], await api('/api/audit?limit=100')));
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
$('process-subs').onclick = guard(async () => {
  const r = await api('/api/subscriptions/process', { method: 'POST' });
  await load();
  return `Processed ${r.processed} due subscription${r.processed === 1 ? '' : 's'}.`;
});
$('notify-restock').onclick = guard(async () => {
  const r = await api('/api/automations/back-in-stock', { method: 'POST' });
  await load();
  return `Notified ${r.notified} waiting customer${r.notified === 1 ? '' : 's'}.`;
});
$('remind-carts').onclick = guard(async () => {
  const r = await api('/api/automations/abandoned-carts', { method: 'POST', body: {} });
  await load();
  return `Sent ${r.reminded} reminder${r.reminded === 1 ? '' : 's'}.`;
});
if (token) load();
