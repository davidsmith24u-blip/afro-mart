// Crawlable product pages, Product structured data and the live sitemap.
//
// The storefront (public/) is a single-page app: a product only exists inside the
// grid and a modal, so it has no URL of its own and Google has nothing to attach a
// product rich result to. These server-rendered pages give every product a real,
// indexable URL carrying Product/Offer/Breadcrumb JSON-LD.
//
// That JSON-LD is per-product, so it cannot be allow-listed by the fixed sha256 hash
// used for the static block in index.html. Each product page is instead served with a
// fresh nonce, shared between the CSP header and the script tag.
import { randomBytes } from 'node:crypto';
import { DIET_LABELS } from './discovery.js';

export const SITE_URL = (process.env.SITE_URL || 'https://afromartz.biz').replace(/\/+$/, '');

export const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));

export const slugify = (value) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');

export const productSlug = (product) => `${slugify(product.name) || 'product'}-${product.id}`;
export const productPath = (product) => `/product/${productSlug(product)}`;
export const productUrl = (product) => `${SITE_URL}${productPath(product)}`;

// `/product/red-palm-oil-1l-42` → 42. Keeping the id in the URL means a renamed
// product still resolves; the readable part in front of it is cosmetic.
export const productIdFromSlug = (slug) => {
  const match = /-(\d+)$/.exec(String(slug || '').replace(/\/+$/, ''));
  return match ? Number(match[1]) : null;
};

const PLACEHOLDER_MATCHERS = [
  [/coca-cola/, '/products/coca-cola.jpg'],
  [/pepsi/, '/products/pepsi.jpg'],
  [/wine/, '/products/wine.jpg'],
];

// Mirrors public/app.js so a card and its page always show the same picture.
export function productImage(product) {
  if (product.image_url) return product.image_url;
  const name = String(product.name || '').toLowerCase();
  for (const [pattern, file] of PLACEHOLDER_MATCHERS) if (pattern.test(name)) return file;
  const category = String(product.category || '').toLowerCase();
  if (category === 'fresh produce') return '/products/produce.jpg';
  if (category === 'spices') return '/products/spices.jpg';
  if (category === 'beverages') return '/products/african-drinks.jpg';
  return '/products/staples.jpg';
}

export const productImageUrl = (product) => {
  const image = productImage(product);
  return /^https?:\/\//.test(image) ? image : `${SITE_URL}${image}`;
};

export const newNonce = () => randomBytes(16).toString('base64');

export const cspWithNonce = (nonce) =>
  `default-src 'self'; script-src 'self' 'nonce-${nonce}'; img-src 'self' https: data:; ` +
  `style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; ` +
  `base-uri 'self'; form-action 'self'; frame-ancestors 'self'`;

const price = (cents) => `€${(Number(cents) / 100).toFixed(2)}`;
const decimal = (cents) => (Number(cents) / 100).toFixed(2);
const stars = (rating) => `${'★'.repeat(Math.round(rating))}${'☆'.repeat(5 - Math.round(rating))}`;
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

export function productDescription(product) {
  return product.description
    || `${product.name} from the AFROMART African grocery range, delivered across Germany.`;
}

const metaDescription = (text) => (text.length > 158 ? `${text.slice(0, 155).trimEnd()}...` : text);

// Undefined (not null) for optional fields: JSON.stringify drops undefined, and Google
// ignores nothing as neatly as it ignores a missing property.
export function productJsonLd(product) {
  const url = productUrl(product);
  const description = productDescription(product);

  const crumbs = [
    { name: 'Home', item: `${SITE_URL}/` },
    ...(product.category ? [{ name: product.category, item: `${SITE_URL}/#shop` }] : []),
    { name: product.name, item: url },
  ].map((crumb, index) => ({ '@type': 'ListItem', position: index + 1, name: crumb.name, item: crumb.item }));

  const node = {
    '@type': 'Product',
    '@id': `${url}#product`,
    name: product.name,
    url,
    description,
    sku: product.sku ?? undefined,
    image: [productImageUrl(product)],
    category: product.category ?? undefined,
    brand: { '@type': 'Brand', name: 'AFROMART' },
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: 'EUR',
      price: decimal(product.price_cents),
      availability: product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@type': 'Organization', name: 'AFROMART', url: `${SITE_URL}/` },
    },
  };

  // Google only shows stars when the rating is visible on the page — the template
  // renders it whenever this node exists.
  if (product.rating_count > 0 && product.rating_average) {
    node.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: product.rating_average,
      reviewCount: product.rating_count,
      bestRating: 5,
      worstRating: 1,
    };
  }

  return {
    '@context': 'https://schema.org',
    '@graph': [node, { '@type': 'BreadcrumbList', itemListElement: crumbs }],
  };
}

function chipsFor(product) {
  const origin = product.origin_label ? [`From ${product.origin_label}`] : [];
  const cuisines = (product.cuisine_labels || []).map((label) => `${label} kitchen`);
  const diets = (product.diets || []).map((diet) => DIET_LABELS[diet] || diet);
  return [...origin, ...cuisines, ...diets];
}

function relatedHtml(related, category) {
  if (!related.length) return '';
  const items = related
    .map((item) => `<li><a href="${escapeHtml(productPath(item))}">`
      + `<img src="${escapeHtml(productImage(item))}" alt="" width="72" height="72" loading="lazy">`
      + `<span>${escapeHtml(item.name)}</span><strong>${price(item.price_cents)}</strong></a></li>`)
    .join('');
  return `<section class="related"><h2>More from ${escapeHtml(category || 'the market')}</h2><ul>${items}</ul></section>`;
}

// Server-rendered product page. `nonce` must match the value handed to cspWithNonce().
export function renderProductPage(product, { related = [], nonce } = {}) {
  const url = productUrl(product);
  const image = productImageUrl(product);
  const description = productDescription(product);
  const inStock = product.stock > 0;
  const chips = chipsFor(product);
  const json = JSON.stringify(productJsonLd(product)).replace(/</g, '\\u003c');

  const rating = product.rating_count > 0 && product.rating_average
    ? `<p class="rating"><span class="stars" aria-hidden="true">${stars(product.rating_average)}</span>`
      + ` <span>${Number(product.rating_average).toFixed(1)} &middot; ${plural(product.rating_count, 'review')}</span></p>`
    : '';

  const chipRow = chips.length
    ? `<ul class="chips">${chips.map((chip) => `<li>${escapeHtml(chip)}</li>`).join('')}</ul>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#a8401d">
<title>${escapeHtml(product.name)} — AFROMART</title>
<meta name="description" content="${escapeHtml(metaDescription(description))}">
<link rel="canonical" href="${escapeHtml(url)}">
<meta property="og:type" content="product">
<meta property="og:title" content="${escapeHtml(product.name)} — AFROMART">
<meta property="og:description" content="${escapeHtml(metaDescription(description))}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="product:price:amount" content="${escapeHtml(decimal(product.price_cents))}">
<meta property="product:price:currency" content="EUR">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/app-icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/logo.png">
<link rel="stylesheet" href="/product.css">
<script type="application/ld+json" nonce="${escapeHtml(nonce)}">${json}</script>
</head>
<body>
<header class="top">
	<a class="brand" href="/">AFROMART</a>
	<a class="back" href="/#shop">Back to the shop</a>
</header>
<main class="page">
	<div class="photo"><img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" width="640" height="640"></div>
	<div class="info">
		<nav class="crumbs" aria-label="Breadcrumb">
			<a href="/">Home</a>
			${product.category ? `<span>/</span> <a href="/#shop">${escapeHtml(product.category)}</a>` : ''}
			<span>/</span> <span aria-current="page">${escapeHtml(product.name)}</span>
		</nav>
		<h1>${escapeHtml(product.name)}</h1>
		${rating}
		<p class="price">${price(product.price_cents)}</p>
		<p class="stock ${inStock ? 'in' : 'out'}">${inStock ? 'In stock' : 'Currently out of stock'}</p>
		<p class="desc">${escapeHtml(description)}</p>
		${chipRow}
		${inStock
    ? `<a class="cta" href="/?add=${product.id}#shopping-cart">Add to bag</a>`
    : `<span class="cta disabled">Out of stock</span>`}
		<p class="note">Free delivery over €50 within Germany.</p>
	</div>
</main>
${relatedHtml(related, product.category)}
<footer class="foot"><a href="/">AFROMART</a> — African groceries delivered across Germany.</footer>
</body>
</html>
`;
}

export function renderSitemap(products) {
  const urls = products
    .map((product) => `  <url>\n    <loc>${escapeHtml(productUrl(product))}</loc>\n`
      + `    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
${urls}
</urlset>
`;
}
