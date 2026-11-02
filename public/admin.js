const $ = (id) => document.getElementById(id);
const money = (c) => (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
let token = localStorage.getItem('token');
// Kept outside load() so a save/upload round-trip doesn't reset the worklist filter.
let onlyMissingPhotos = false;
// Product availability worklist state.
let productSearch = '';
let productFilter = 'all';
let allProducts = [];
const el = (tag, text, attrs = {}) => Object.assign(Object.assign(document.createElement(tag), { textContent: text ?? '' }), attrs);
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const error = new Error((data && data.error) || 'Request failed');
    error.status = res.status;
    throw error;
  }
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
    for (const c of cols) {
      const td = el('td');
      const value = r[c];
      if (value instanceof Node) td.append(value);
      else td.textContent = value ?? '';
      tr.append(td);
    }
    if (action) { const td = el('td'); const a = action(r); if (a) td.append(a); tr.append(td); }
    t.append(tr);
  }
  return t;
}
const guard = (fn) => async () => { try { const note = await fn(); $('msg').textContent = typeof note === 'string' ? note : ''; } catch (e) { $('msg').textContent = e.message; } };

// Which products the availability panel should show for the current search/filter.
function productMatches(p) {
  const q = productSearch.trim().toLowerCase();
  if (q && !`${p.name} ${p.sku} ${p.category || ''}`.toLowerCase().includes(q)) return false;
  if (productFilter === 'visible') return !!p.active;
  if (productFilter === 'hidden') return !p.active;
  if (productFilter === 'out') return p.stock <= 0;
  return true;
}

function renderProductTable() {
  const shown = allProducts.filter(productMatches);
  const outOfStock = allProducts.filter((p) => p.active && p.stock <= 0);
  const hidden = allProducts.filter((p) => !p.active).length;
  const status = $('product-status');
  status.textContent = allProducts.length
    ? `Showing ${shown.length} of ${allProducts.length} products · ${hidden} hidden · ${outOfStock.length} visible but out of stock.`
    : 'No products yet.';
  const bulk = $('hide-out-of-stock');
  bulk.disabled = outOfStock.length === 0;
  bulk.textContent = outOfStock.length ? `Hide ${outOfStock.length} out-of-stock` : 'No out-of-stock items';

  if (!shown.length) {
    $('product-list').replaceChildren(el('p', 'No products match this search or filter.', { className: 'muted' }));
    return;
  }
  const rows = shown.map((p) => ({
    sku: p.sku,
    name: p.name,
    category: p.category || '—',
    price: p.price,
    stock: el('span', String(p.stock), { className: p.stock <= 0 ? 'state-pill is-out' : '' }),
    state: el('span', p.active ? 'Visible' : 'Hidden', { className: p.active ? 'state-pill is-visible' : 'state-pill is-hidden' }),
    raw: p,
  }));
  $('product-list').replaceChildren(table(['sku', 'name', 'category', 'price', 'stock', 'state'], rows, (r) => {
    const btn = el('button', r.raw.active ? 'Hide from store' : 'Show on store', { type: 'button' });
    btn.className = r.raw.active ? 'danger-button' : 'secondary-button';
    btn.onclick = guard(async () => {
      await api(`/api/products/${r.raw.id}`, { method: 'PUT', body: { active: !r.raw.active } });
      await load();
      return r.raw.active ? `${r.raw.name} is now hidden from the storefront.` : `${r.raw.name} is visible on the store again.`;
    });
    return btn;
  }));
}

function showPanel(id, { updateHash = true } = {}) {
  const target = document.getElementById(id) ? id : 'overview';
  for (const btn of document.querySelectorAll('.admin-nav [data-panel]')) {
    const on = btn.dataset.panel === target;
    btn.classList.toggle('is-active', on);
    if (on) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
  for (const panel of document.querySelectorAll('.admin-panel')) panel.classList.toggle('is-active', panel.id === target);
  if (updateHash && location.hash.slice(1) !== target) history.replaceState(null, '', `#${target}`);
  if (window.innerWidth <= 900) document.querySelector('.admin-content')?.scrollIntoView({ block: 'start' });
}

async function load() {
  const s = await api('/api/reports/summary');
  $('login').hidden = true; $('setup').hidden = true; $('dash').hidden = false;
  try {
    const me = await api('/api/me');
    $('admin-user').textContent = me.email;
    $('account-email').textContent = me.email;
  } catch { $('admin-user').textContent = ''; }
  $('summary').replaceChildren(...Object.entries({
    Orders: s.orders, Revenue: money(s.revenue_cents), 'Est. profit': money(s.estimated_profit_cents),
    Customers: s.customers, 'Low stock items': s.low_stock_count, 'Inventory value': money(s.inventory_value_cents),
  }).map(([k, v]) => { const c = el('div', '', { className: 'card' }); c.append(el('small', k), el('h3', String(v))); return c; }));

  const orders = (await api('/api/orders')).map((o) => ({
    ...o, how: o.fulfillment === 'pickup' ? 'Pickup' : 'Delivery',
    customer: o.customer_email || (o.user_id ? `member #${o.user_id}` : '—'),
    delivery_service: String(o.delivery_service || '').toUpperCase(),
    payment: o.payment_status, total: money(o.total_cents), raw: o,
  }));
  $('orders').replaceChildren(table(['id', 'created_at', 'customer', 'status', 'payment', 'how', 'delivery_service', 'total'], orders, (o) => {
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
  allProducts = (await api('/api/products')).map((p) => ({ ...p, price: money(p.price_cents) }));
  renderProductTable();
  const prods = allProducts;
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
  const missingPhoto = imageProducts.filter((p) => !p.image_url);
  const photoCard = el('div', '', { className: 'card' });
  photoCard.append(el('small', 'Products needing a photo'), el('h3', String(missingPhoto.length)));
  $('summary').append(photoCard);

  const tools = el('div', '', { className: 'image-tools' });
  const onlyMissing = el('input', '', { type: 'checkbox' });
  onlyMissing.id = 'only-missing';
  onlyMissing.checked = onlyMissingPhotos;
  onlyMissing.disabled = missingPhoto.length === 0;
  const toggle = el('label', '', { htmlFor: 'only-missing' });
  toggle.append(onlyMissing, document.createTextNode(
    ` Only products without a photo (${missingPhoto.length} of ${imageProducts.length})`,
  ));
  const copyList = el('button', 'Copy list for sourcing');
  copyList.onclick = guard(async () => {
    if (!missingPhoto.length) return 'Every product already has a photo.';
    const list = missingPhoto.map((p) => `${p.name} · ${p.sku}`).join('\n');
    try { await navigator.clipboard.writeText(list); } catch { return 'Could not reach the clipboard — copy from the list instead.'; }
    return `${missingPhoto.length} products copied to the clipboard.`;
  });
  tools.append(toggle, copyList);

  const manager = el('div', '', { className: 'image-manager' });
  const buildRow = (p) => {
    const row = el('div', '', { className: p.image_url ? 'image-row' : 'image-row needs-photo' });
    const thumb = el('img', '', { src: p.image_url || '/products/staples.jpg', alt: p.name, className: 'image-thumb' });
    const meta = el('div', '', { className: 'image-meta' });
    meta.append(el('strong', p.name), el('small', p.image_url ? p.sku : `${p.sku} · needs a photo`));
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
    return row;
  };
  const renderManager = () => {
    onlyMissingPhotos = onlyMissing.checked;
    const shown = onlyMissingPhotos ? missingPhoto : imageProducts;
    manager.replaceChildren(...(shown.length
      ? shown.map(buildRow)
      : [el('p', 'Nothing to show here — every product already has a photo.', { className: 'muted' })]));
  };
  onlyMissing.onchange = renderManager;
  renderManager();
  $('images').replaceChildren(tools, manager);

  const aiSelect = $('ai-product');
  aiSelect.replaceChildren(el('option', 'Choose a product…', { value: '' }),
    ...prods.map((p) => el('option', `${p.name} · ${p.sku}`, { value: String(p.id) })));

  $('stock-alerts').replaceChildren(table(['id', 'product', 'email', 'created_at'], await api('/api/stock-alerts')));
  const cartRows = (await api('/api/carts')).map((c) => ({
    id: c.id, email: c.email, items: c.item_count, subtotal: money(c.subtotal_cents), updated_at: c.updated_at,
    reminded: c.reminded_at ? 'Yes' : '—', recovered: c.recovered_at ? 'Yes' : '—',
  }));
  $('carts').replaceChildren(table(['id', 'email', 'items', 'subtotal', 'updated_at', 'reminded', 'recovered'], cartRows));

  $('audit').replaceChildren(table(['id', 'created_at', 'actor_email', 'action', 'entity', 'entity_id', 'detail'], await api('/api/audit?limit=100')));
}

// Show the sign-in form, or the first-run setup form when nobody can sign in yet.
async function showAuth() {
  try {
    const res = await fetch('/api/auth/setup');
    const data = await res.json();
    const needed = Boolean(data.needed);
    $('setup').hidden = !needed;
    $('login').hidden = needed;
    (needed ? $('setup-name') : $('email')).focus();
  } catch {
    $('setup').hidden = true;
    $('login').hidden = false;
  }
}

async function signIn(email, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not sign in');
  token = data.token;
  localStorage.setItem('token', token);
  await load();
}

async function startSession() {
  if (!token) { await showAuth(); return; }
  try {
    const me = await api('/api/me');
    if (me.role === 'customer') {
      const error = new Error('That account does not have staff access. Sign in with an administrator or staff account.');
      error.status = 403;
      throw error;
    }
  } catch (error) {
    if (error.status === 401) { localStorage.removeItem('token'); token = null; }
    $('msg').textContent = error.message;
    await showAuth();
    return;
  }
  try { await load(); } catch (error) { $('msg').textContent = error.message; }
}

$('login-form').onsubmit = (event) => {
  event.preventDefault();
  guard(async () => { await signIn($('email').value, $('pw').value); })();
};

$('setup-form').onsubmit = (event) => {
  event.preventDefault();
  guard(async () => {
    if ($('setup-pw').value !== $('setup-pw2').value) throw new Error('Passwords do not match');
    const res = await fetch('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: $('setup-name').value, email: $('setup-email').value, password: $('setup-pw').value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not create the administrator');
    token = data.token;
    localStorage.setItem('token', token);
    await load();
    return `Welcome, ${data.user.name}. Your administrator account is ready.`;
  })();
};

$('password-form').onsubmit = (event) => {
  event.preventDefault();
  guard(async () => {
    if ($('new-pw').value !== $('new-pw2').value) throw new Error('New passwords do not match');
    await api('/api/me/password', {
      method: 'PATCH',
      body: { current_password: $('current-pw').value, new_password: $('new-pw').value },
    });
    $('password-form').reset();
    return 'Password updated.';
  })();
};
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
$('ai-generate').onclick = guard(async () => {
  const productId = Number($('ai-product').value);
  if (!productId) throw new Error('Choose a product first');
  const keywords = $('ai-keywords').value.trim();
  const out = $('ai-copy-out');
  out.textContent = 'Writing…';
  let data;
  try {
    data = await api('/api/assistant/product-copy', { method: 'POST', body: { product_id: productId, keywords } });
  } catch (e) {
    out.textContent = e.message;
    return '';
  }
  const locales = ['en', 'de', 'fr'];
  out.replaceChildren(...locales.map((code) => {
    const wrap = el('div', '', { className: 'ai-locale' });
    wrap.append(el('small', code.toUpperCase()));
    const area = el('textarea', '', { className: 'ai-text' });
    area.value = data.descriptions[code] || '';
    wrap.append(area);
    if (code === 'en') {
      const apply = el('button', 'Apply to product');
      apply.onclick = guard(async () => {
        await api(`/api/products/${data.product_id}`, { method: 'PUT', body: { description: area.value.trim() } });
        await load();
        return `Description applied to ${data.name}.`;
      });
      wrap.append(apply);
    }
    return wrap;
  }));
  return `Generated ${data.name} copy in ${locales.length} languages.`;
});

// Product availability worklist: filter instantly, then hide/show per product or in bulk.
$('product-search').oninput = (e) => { productSearch = e.target.value; renderProductTable(); };
$('product-filter').onchange = (e) => { productFilter = e.target.value; renderProductTable(); };
$('hide-out-of-stock').onclick = guard(async () => {
  const targets = allProducts.filter((p) => p.active && p.stock <= 0);
  if (!targets.length) return 'Every out-of-stock product is already hidden.';
  if (!window.confirm(`Hide ${targets.length} out-of-stock product${targets.length === 1 ? '' : 's'} from the storefront?`)) return '';
  await Promise.all(targets.map((p) => api(`/api/products/${p.id}`, { method: 'PUT', body: { active: false } })));
  await load();
  return `Hidden ${targets.length} out-of-stock product${targets.length === 1 ? '' : 's'} from the store.`;
});

// Grouped dashboard navigation with hash support, so a section can be linked to.
for (const btn of document.querySelectorAll('.admin-nav [data-panel]')) {
  btn.onclick = () => showPanel(btn.dataset.panel);
}
window.addEventListener('hashchange', () => showPanel(location.hash.slice(1) || 'overview', { updateHash: false }));
$('logout').onclick = async () => {
  localStorage.removeItem('token');
  token = null;
  $('dash').hidden = true;
  $('admin-user').textContent = '';
  $('account-email').textContent = '';
  $('msg').textContent = 'You are logged out.';
  history.replaceState(null, '', location.pathname);
  await showAuth();
};

showPanel(location.hash.slice(1) || 'overview', { updateHash: false });
startSession();
