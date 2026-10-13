# Afro Mart

E-commerce platform and business management system for an African grocery store.
Zero npm dependencies: Node.js ≥ 22.13 (built-in `node:http`, `node:sqlite`, `node:test`).

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

The REST API is mobile-app friendly: a React Native / Expo app can reuse every endpoint as-is.

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
`ADMIN_EMAIL`/`ADMIN_PASSWORD` (creates the first admin if absent). Admins can create staff via `POST /api/staff`.
`CORS_ORIGIN` (default `*`) controls which origins may call the API from a browser; `COMMS_WEBHOOK_URL` casts the
messages outbox to a webhook instead of the log transport.

Docker: `AUTH_SECRET=... docker compose up --build`.

## Security notes
Parameterised SQL everywhere, input validation, body size limit, CSP and `nosniff` headers, DOM rendering via `textContent`.
Run behind HTTPS (e.g. a reverse proxy). Payment processing is not integrated: staff manage order payment status manually.
Add a payment provider and rate limiting before going live.

See [docs/API.md](docs/API.md) for the API and the schema in `src/db.js`.
