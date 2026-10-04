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

**Phase 3** (analytics, marketing, communications automation, multi-location, mobile app) is future work; the REST API is designed so a mobile app can reuse it.

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

Docker: `AUTH_SECRET=... docker compose up --build`.

## Security notes
Parameterised SQL everywhere, input validation, body size limit, CSP and `nosniff` headers, DOM rendering via `textContent`.
Run behind HTTPS (e.g. a reverse proxy). Payment is not integrated: orders start as `pending` and staff mark them `paid`;
add a payment provider and rate limiting before going live.

See [docs/API.md](docs/API.md) for the API and the schema in `src/db.js`.
