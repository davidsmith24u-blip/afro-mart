# Afro Mart

E-commerce platform and business management system for an African grocery store.
The app itself has zero npm dependencies: Node.js ≥ 22.13 (built-in `node:http`, `node:sqlite`, `node:test`).
(The only dependency, `@netlify/blobs`, is used solely by the optional Netlify deployment layer.)

## Features

**Phase 1 – Foundation**
- Customer/staff authentication (scrypt password hashing, signed expiring tokens, roles: `customer`, `staff`, `admin`)
- Product catalog with categories (dry goods, fresh produce, beverages, spices, ...) and search
- Shopping cart (browser) and checkout (transactional, stock-checked)
- Order management with status workflow and cancellation (restores stock and loyalty points)
- Inventory tracking (stock, reorder levels, expiry date)

**Phase 2 – Operations**
- Supplier management and purchase orders; receiving a PO increases stock
- Automatic reorder: low-stock items grouped into purchase orders per supplier
- Staff dashboard at `/admin`
- Basic financial reporting (revenue, estimated cost/profit, inventory value, top products)
- Loyalty foundation: 1 point per whole currency unit spent

**Phase 3 – Growth & mobile**
- Analytics: overview (AOV, repeat-rate, profit), daily sales series, top products/customers, category performance — all filterable by store location
- Marketing: customer segments (new/active/lapsed/VIP), campaign sending, newsletter subscribers, promo codes applied at checkout
- Communications automation: message templates, event-driven automations (welcome, order placed, status changes, low-stock), queued outbox with pluggable delivery (webhook via `COMMS_WEBHOOK_URL` or log)
- Multi-location: store/warehouse locations with per-location inventory, stock transfers and per-location low stock; orders and staff can be assigned to a location
- Mobile-ready API: `/api/health`, `/api/config`, `/api/v1` versioned prefix, CORS, pagination on list endpoints

**Curated bundles & catalog depth**
- Meal packs, starter kits, party packs, gift boxes and taste boxes (Egusi Soup Starter Kit, Jollof Rice Party Pack, Jollof Rice Wars Box NG vs GH, Glow Up shea & hair kit, ...) — priced as their contents minus a percentage, orderable as one line, and expanded into stock-checked component products at checkout
- A resident-curated catalog spanning 10 categories — pantry staples, rice & grains, fresh & frozen, meat & fish, drinks (incl. South African wines), spices and health & beauty (raw shea, African black soap, natural hair care)
- Storefront "Packs & bundles" section showcases bundles with savings vs. buying items separately

**Fulfilment, rewards & recipes**
- Delivery areas matched by postal prefix, each with a fee and a minimum-order surcharge; store pickup with a location and collection slot; every order records `delivery_fee_cents` and its fulfilment
- Loyalty tiers (bronze/silver/gold/platinum) that multiply the points earned, plus refer-a-friend codes that reward the referrer on a new signup
- Monthly pantry subscriptions: any bundle delivered or collected every 30 days, turned into real, stock-checked orders with `POST /api/subscriptions/process` (staff or a cron job)
- Recipes that link to the exact products and packs needed to cook a dish, each with a step-by-step cooking method and a one-tap "add all ingredients to bag"
- Payment status on every order (`unpaid`/`paid`/`failed`/`refunded`) with staff settlement and an integration-ready gateway webhook (`POST /api/payments/webhook`, guarded by `PAYMENTS_WEBHOOK_SECRET`)
- WhatsApp added as a communications channel alongside email, SMS, push and webhook
- Storefront: an African-inspired brand identity (calabash-and-sun emblem, kente stripe), richer copy across 149 products, euro pricing, and UI for pickup, subscriptions, recipes and referrals

**Diaspora discovery & global reach**
- Every one of the 149 SKUs is classified by origin (Nigeria, Ghana, South Africa, Ethiopia, Kenya, Senegal, Cameroon, DR Congo, Somalia, …), cuisine, diet (halal, vegan, vegetarian, gluten-free) and a 0–5 spice level
- A discovery filter bar on the storefront — origin and cuisine chips, diet and heat filters, and sort by name/price/heat — backed by `GET /api/discovery/facets`
- Synonym-aware search that understands everyday diaspora names (*ata rodo* → scotch bonnet, *ugwu* → spinach, *semo* → semovita) on top of the plain text index
- Multi-language storefront (English, German, French) and display-currency switcher (EUR, USD, GBP), both remembered per browser

**Party, catering & wholesale**
- Recipe scaler: any recipe multiplied for a given number of guests, with per-guest cost (`GET /api/recipes/:id/scale`)
- Party planner: bundles that cover a headcount, with how many packs are needed and the running total (`GET /api/catering/party`), addable to the bag in one tap
- Catering quote requests from the storefront, triaged in the staff dashboard (`requested → quoted → confirmed/declined`)
- Wholesale (B2B) accounts: mark a customer as a `restaurant` and they automatically see and pay wholesale prices on every line

The REST API is mobile-app friendly: a React Native / Expo app can reuse every endpoint as-is.

**Trust, retention & operations**
- Real product photography: staff upload an image (stored inline and served from `GET /api/images/:id`) or paste a URL per product from the dashboard's product-image manager; every product still falls back to a category-appropriate placeholder
- Customer reviews with star ratings, an optional photo and a verified-purchase badge derived from paid order history, moderated in the staff dashboard before they appear; product payloads carry `rating_average`/`rating_count` and cards show stars
- Back-in-stock alerts: out-of-stock products offer "Notify me", and `POST /api/automations/back-in-stock` emails everyone waiting once stock returns
- Abandoned-cart recovery: signed-in carts are snapshotted server-side (`PUT /api/cart`), `POST /api/automations/abandoned-carts` chases quiet carts, and placing an order clears the snapshot
- Audit log of privileged actions (`GET /api/audit`) and per-IP rate limiting on API and auth endpoints
- Printable invoices at `GET /api/orders/:id/invoice` (owner or staff), linked from the account orders and the staff dashboard
- A product detail modal with imagery, description, ratings and a review form
- CI (`.github/workflows/ci.yml`) runs the full test suite on every push and pull request

## Installable web app (PWA)
The storefront is installable and works offline for the app shell. It ships a web app manifest
(`public/manifest.webmanifest`), an SVG app icon (`public/app-icon.svg`) and a service worker
(`public/sw.js`) that caches the shell and product imagery, falling back to the cached shell when
offline. API requests always go to the network and are never cached.

## Setup

```sh
npm run seed          # optional sample data (creates afromart.db)
export AUTH_SECRET="$(openssl rand -hex 32)"
export ADMIN_EMAIL=owner@example.com ADMIN_PASSWORD='choose-a-strong-password'
npm start             # http://localhost:3000  (staff dashboard: /admin)
npm test
```

Environment: `PORT` (3000), `DB_PATH` (`afromart.db`), `AUTH_SECRET` (required in production so sessions survive restarts),
`ADMIN_EMAIL`/`ADMIN_PASSWORD` (creates the first admin if absent; `npm run seed` also creates a default admin —
`davidsmith24u@gmail.com` — unless overridden). Admins can create staff via `POST /api/staff`.
`CORS_ORIGIN` (default `*`) controls which origins may call the API from a browser; `COMMS_WEBHOOK_URL` casts the
messages outbox to a webhook instead of the log transport. `DELIVERY_FEE_DEFAULT_CENTS` sets a fallback delivery fee
for postcodes outside any configured area; `PAYMENTS_WEBHOOK_SECRET` enables the payment webhook; `WHATSAPP_NUMBER`
is advertised to clients via `/api/config`.

Docker: `AUTH_SECRET=... docker compose up --build`.

## Deploy on Netlify

`netlify.toml` serves the storefront from `public/` and routes `/api/*` to a single Netlify Function
(`netlify/functions/api.mjs`) that runs the same app — no build step, no framework.

Because Netlify Functions have no persistent disk, the SQLite database is snapshotted to Netlify Blobs
(`netlify/functions/store.mjs`): it is restored on a cold start, seeded on the very first run, and written back after
every request that changes data. Node 24 (pinned in `.nvmrc`) provides a stable `node:sqlite`.

Catalog content (products, bundles, recipes and their copy) is versioned via `PRAGMA user_version` and
`src/catalog-version.js`: when a restored snapshot is older than `CATALOG_VERSION`, the idempotent seed re-runs and
refreshes descriptions, bundles and recipes in place — so content updates reach a snapshot-backed production database
on the next cold start **without discarding orders or customers**. Bump `CATALOG_VERSION` whenever the seed content
changes.

```sh
npx netlify-cli deploy --build --prod
```

Set `AUTH_SECRET` (and any other variable above) in the Netlify UI. Netlify Blobs is a key-value store, not a
database: this works well for a low-traffic shop, but for heavy concurrent writes run the app on a long-running
Node host and keep Netlify for the frontend.

## Security notes
Parameterised SQL everywhere, input validation, body size limit, CSP and `nosniff` headers, DOM rendering via `textContent`.
Run behind HTTPS (e.g. a reverse proxy). Payment processing is integration-ready but no gateway is wired: orders start
`unpaid` and staff settle them, or a provider can call `POST /api/payments/webhook` with the `x-webhook-secret` header.
Add rate limiting before going live.

See [docs/API.md](docs/API.md) for the API and the schema in `src/db.js`.
