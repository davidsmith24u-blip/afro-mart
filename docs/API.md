# API

JSON over HTTP. Send the token from register/login in an `Authorization` header as the word Bearer, a space, then the token. Money is in integer cents.
Errors: `{ "error": "message" }` with 400/401/403/404/409/413.

| Method & path | Access | Description |
|---|---|---|
| GET `/api/health` | public | `{status:"ok",time,version}` for uptime/monitoring |
| GET `/api/config` | public | App config for mobile/web clients (currency, delivery services, statuses) |
| POST `/api/auth/register` `{email,name,password}` | public | Create customer, returns `{token,user}` |
| POST `/api/auth/login` `{email,password}` | public | Returns `{token,user}` |
| GET `/api/me` | user | Current user incl. loyalty points |
| POST `/api/staff` `{email,name,password,role?}` | admin | Create staff/admin |
| GET `/api/categories` / POST | public / staff | List / create `{name}` |
| GET `/api/products?category=&q=&limit=&offset=` | public | Active products (staff also see cost/supplier/inactive) |
| GET `/api/products/:id` | public | One product |
| POST `/api/products`, PUT `/api/products/:id` | staff | `sku,name,description,category_id,supplier_id,price_cents,cost_cents,stock,reorder_level,reorder_quantity,expiry_date,active` |
| POST `/api/orders` `{items:[{product_id,quantity} | {bundle_id,quantity}],shipping_address,delivery_service?,shipping_country?,location_id?,promo_code?}` | user | Place order; bundle lines expand into stock-checked components, decrements stock (per location), awards points, applies bundle + promo discounts; courier is Germany-only |
| GET `/api/orders`, GET `/api/orders/:id` | user | Own orders (staff: all, limit/offset pagination) |
| PATCH `/api/orders/:id/status` `{status}` | staff | `pending,paid,packed,shipped,delivered,cancelled`; fires status-change automations |
| GET/POST `/api/suppliers`, PUT `/api/suppliers/:id` | staff | Supplier management |
| GET `/api/inventory/low-stock?location_id=` | staff | Products at/below reorder level (optionally at one location) |
| POST `/api/inventory/reorder` | staff | Create purchase orders for low-stock products (per supplier, skipping already-ordered) |
| GET/POST `/api/purchase-orders` | staff | List / create `{supplier_id,location_id?,items:[{product_id,quantity,unit_cost_cents?}]}` |
| POST `/api/purchase-orders/:id/receive` | staff | Mark received and add stock (to the PO's location) |
| GET `/api/reports/summary` | staff | Revenue, estimated profit, customers, low stock, inventory value, top products |

### Analytics (all staff; optional `?location_id=` on every endpoint)
| Method & path | Description |
|---|---|
| GET `/api/analytics/overview?days=30` | Orders, revenue, discounts, AOV, units, profit, customers, new/repeat customers, low-stock count |
| GET `/api/analytics/sales?days=30` | Daily order/revenue/units series |
| GET `/api/analytics/top-products?limit=10` | Best sellers by units and revenue |
| GET `/api/analytics/top-customers?limit=10` | Highest spenders |
| GET `/api/analytics/categories` | Revenue and units per category |

### Marketing
| Method & path | Access | Description |
|---|---|---|
| GET `/api/marketing/segments` | staff | Customer counts for `all,new,active,lapsed,vip` |
| POST `/api/marketing/subscribe` `{email,name?,source?}` | public | Newsletter signup (idempotent) |
| GET `/api/marketing/subscribers` | staff | Subscriber list |
| GET/POST `/api/marketing/campaigns`, PUT `/api/marketing/campaigns/:id` | staff | Campaigns (`segment,channel,subject,body,scheduled_at?`) |
| POST `/api/marketing/campaigns/:id/send` | staff | Enqueue messages to every customer in the segment |
| GET/POST `/api/marketing/promo-codes`, PUT `/api/marketing/promo-codes/:id` | staff | `{code,discount_type:percent|fixed,value,min_total_cents?,max_uses?,expires_at?}` |
| POST `/api/marketing/promo-codes/validate` `{code,total_cents}` | public | Returns `{code,discount_cents}` |

### Communications automation
| Method & path | Access | Description |
|---|---|---|
| GET/POST `/api/communications/templates`, PUT `/:id` | staff | Message templates with `{{field}}` placeholders |
| GET/POST `/api/communications/automations`, PUT/DELETE `/:id` | staff | Event → template rules; events: `customer.registered, order.placed, order.status_changed, inventory.low_stock` |
| GET `/api/communications/events` | staff | List of supported automation events |
| GET `/api/communications/messages?status=` | staff | Outbox (queued/sent/failed) |
| POST `/api/communications/dispatch` | staff | Deliver queued messages via the configured transport |
| POST `/api/communications/messages/:id/send` | staff | Deliver one message |

### Multi-location
| Method & path | Access | Description |
|---|---|---|
| GET `/api/locations` | public | Active locations (staff can pass `?all=1`) |
| POST `/api/locations`, PUT `/api/locations/:id` | staff | `{name,address,city,postal_code,country,phone,active,is_primary}`; first location becomes primary |
| GET `/api/locations/:id/inventory` | staff | Per-location stock view |
| PUT `/api/locations/:id/inventory/:productId` `{stock,reorder_level?,reorder_quantity?}` | staff | Set a location's allocation (product total stays in sync) |
| POST `/api/locations/transfer` `{product_id,from_location_id,to_location_id,quantity}` | staff | Move stock between locations |

### Bundles (curated packs & gift boxes)
Bundle price = contents subtotal − `savings_percent` (`meal_pack | starter_pack | party_pack | gift_box | taste_box`).
| Method & path | Access | Description |
|---|---|---|
| GET `/api/bundles` | public | Active bundles with expanded items, `subtotal_cents`, `savings_cents`, `price_cents` (staff can pass `?all=1`) |
| GET `/api/bundles/:id` | public | One bundle (staff can read inactive) |
| POST `/api/bundles`, PUT `/api/bundles/:id` | staff | `{sku,name,description,bundle_type,active,savings_percent,items:[{product_id,quantity}]}` (each product once per bundle) |
| DELETE `/api/bundles/:id` | staff | Remove a bundle |

API versioning: every `/api/...` route also works under the versioned prefix `/api/v1/...` (e.g. `/api/v1/products`).

## Schema
Tables: `users`, `categories`, `suppliers`, `products`, `orders`, `order_items`, `purchase_orders`, `purchase_order_items`,
`locations`, `inventory`, `subscribers`, `promo_codes`, `campaigns`, `message_templates`, `automations`, `messages`,
`bundles`, `bundle_items` (see `src/db.js`).
