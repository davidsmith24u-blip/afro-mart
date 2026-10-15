# API

JSON over HTTP. Send the token from register/login in an `Authorization` header as the word Bearer, a space, then the token. Money is in integer cents.
Errors: `{ "error": "message" }` with 400/401/403/404/409/413.

| Method & path | Access | Description |
|---|---|---|
| GET `/api/health` | public | `{status:"ok",time,version}` for uptime/monitoring |
| GET `/api/config` | public | App config for mobile/web clients (currency, `base_currency`, accepted `currencies` with display rates, facet label maps, delivery services, order statuses, fulfilment options, payment methods, loyalty rate, default delivery fee, gateway flag, WhatsApp number) |
| POST `/api/auth/register` `{email,name,password,ref?}` | public | Create customer (`ref` = a friend's referral code, rewards them), returns `{token,user}` |
| POST `/api/auth/login` `{email,password}` | public | Returns `{token,user}` |
| GET `/api/me` | user | Current user incl. loyalty points, referral code and tier |
| POST `/api/staff` `{email,name,password,role?}` | admin | Create staff/admin |
| GET `/api/categories` / POST | public / staff | List / create `{name}` |
| GET `/api/products?category=&q=&cuisine=&origin=&diet=&max_spice=&min_spice=&sort=&limit=&offset=` | public | Active products. `q` understands diaspora synonyms (e.g. *ata rodo* → scotch bonnet, *ugwu* → spinach, *semo* → semovita); `cuisine`/`origin`/`diet` accept comma-separated or repeated values (AND across kinds); `max_spice`/`min_spice` filter 0–5 heat; `sort` is `name \| price_asc \| price_desc \| spice`. Products carry `origin`, `cuisines`, `diets`, `spice_level` plus human labels. Staff also see cost/supplier/inactive |
| GET `/api/products/:id` | public | One product |
| POST `/api/products`, PUT `/api/products/:id` | staff | `sku,name,description,category_id,supplier_id,price_cents,cost_cents,stock,reorder_level,reorder_quantity,expiry_date,active` |
| POST `/api/orders` `{items:[{product_id,quantity} | {bundle_id,quantity}],fulfillment:delivery|pickup,shipping_address?,delivery_service?,shipping_country?,pickup_location_id?,pickup_at?,location_id?,promo_code?}` | user | Place order; bundle lines expand into stock-checked components, decrements stock (per location), awards tiered points, applies bundle + promo discounts and adds the delivery-area fee; delivery is Germany-only and needs an address, pickup needs neither |
| GET `/api/orders`, GET `/api/orders/:id` | user | Own orders (staff: all, limit/offset pagination) |
| GET `/api/track?order=&email=` | public | Public delivery tracking: the order number plus the email used to place it returns status, courier, fulfilment and line items; a mismatched email is a 404 |
| PATCH `/api/orders/:id/status` `{status}` | staff | `pending,paid,packed,shipped,delivered,cancelled`; fires status-change automations |
| PATCH `/api/orders/:id/payment` `{status,method?,reference?}` | staff | Set `unpaid/paid/failed/refunded`; `paid` also advances a pending order to `paid` |
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

### Fulfilment & delivery areas
| Method & path | Access | Description |
|---|---|---|
| GET `/api/delivery-areas` | public | Active areas (staff can pass `?all=1`) |
| POST `/api/delivery-areas`, PUT `/api/delivery-areas/:id`, DELETE `/:id` | staff | `{name,city,postal_prefixes,fee_cents,min_order_cents,active}` |

A delivery fee is looked up by the longest matching postal prefix; an order below the area's minimum gets a shortfall
surcharge, and postcodes outside every area fall back to `DELIVERY_FEE_DEFAULT_CENTS`. Pickup orders pay no fee.

### Loyalty, tiers & referrals
| Method & path | Access | Description |
|---|---|---|
| GET `/api/me/referral` | user | `{code,points_per_friend,link,referred_by,tier}` |

Points are earned per euro spent, multiplied by the customer's tier (bronze 1×, silver 1.1×, gold 1.25×, platinum 1.5×,
by lifetime spend). Passing a valid `ref` at registration awards the referrer 200 points; an unknown code is rejected (400).

### Subscriptions (monthly pantry packs)
| Method & path | Access | Description |
|---|---|---|
| GET `/api/subscriptions` | user | Own plans (staff: all) with their bundle |
| POST `/api/subscriptions` `{bundle_id,fulfillment,shipping_address? \| pickup_location_id?,pickup_at?}` | user | Start a monthly plan (30-day cadence) |
| PUT `/api/subscriptions/:id` `{status?,fulfillment?,shipping_address?,pickup_location_id?,pickup_at?,next_run_on?}` | user | Pause/resume/cancel or change fulfilment |
| POST `/api/subscriptions/process` | staff | Turn every due, active plan into a real stock-checked order |

### Recipes
| Method & path | Access | Description |
|---|---|---|
| GET `/api/recipes` | public | Active recipes with priced ingredients and `items_available` (staff can pass `?all=1`) |
| GET `/api/recipes/:id` | public | One recipe |
| POST `/api/recipes`, PUT `/api/recipes/:id` | staff | `{title,description,steps,prep_minutes,servings,emoji,active,ingredients:[{product_id\|bundle_id,quantity,note?}]}` (`steps` is a newline-separated method) |
| DELETE `/api/recipes/:id` | staff | Remove a recipe and its ingredients |

### Diaspora discovery
Every product is classified by **origin** (ISO country, e.g. `NG`, `GH`, `ZA`), **cuisine** (`nigerian`, `ghanaian`, `west-african`, `caribbean`, …), **diet** (`halal`, `vegan`, `vegetarian`, `gluten-free`) and a 0–5 **spice level**, stored in `product_tags` + `products.spice_level`.
| Method & path | Access | Description |
|---|---|---|
| GET `/api/discovery/facets` | public | Facet counts for the storefront filter bar: `{origins:[{value,label,count}],cuisines:[…],diets:[…],spice_levels:[{level,label,count}]}` |

`GET /api/products` combines these as filters (multiple values are OR'd within a facet, AND'd across facets) and understands
everyday diaspora names via the synonym map in `src/discovery.js` — writing *ata rodo*, *ugwu*, *semo*, *eba*, *garri* and the like
still finds the right SKU even when the catalog uses its English/packaged name.

### Party, catering & wholesale
| Method & path | Access | Description |
|---|---|---|
| GET `/api/recipes/:id/scale?guests=N` | public | Recipe scaled to N guests: multiplied (never rounded-down) quantities, `multiplier`, `total_cents`, `per_guest_cents` |
| GET `/api/catering/party?guests=N` | public | Party packs that cover N guests with `serves`, `packs_needed`, `unit_price_cents`, `total_price_cents` |
| POST `/api/quotes` `{name,email,phone?,event_date?,guests?,message?,fulfillment?}` | public | File a catering/event quote request (201) |
| GET `/api/quotes?status=` | staff | List quote requests |
| PATCH `/api/quotes/:id` `{status?,quoted_cents?,staff_note?}` | staff | `requested \| quoted \| confirmed \| declined`, plus the quoted amount |
| GET `/api/customers?q=` | staff | Customer list (up to 100) with `account_type` and loyalty points |
| PATCH `/api/customers/:id/account-type` `{account_type:retail\|restaurant}` | staff | Toggle a wholesale (B2B) account |

Bundles carry a `serves` headcount (set via `POST/PUT /api/bundles`), and products carry a `wholesale_price_cents`
(the greater of cost × 1.12 or price × 0.82, capped just under retail). Shoppers on a `restaurant` account see and are charged
the wholesale price on every order line automatically.

### Reviews, imagery, retention & operations
| Method & path | Access | Description |
|---|---|---|
| POST `/api/images` `{content_type, data}` | signed-in | Upload a base64 image (≤ 3 MB; `data` may be a full `data:` URL), returns `{id, url}` (201) |
| GET `/api/images/:id` | public | Serve stored image bytes (immutable cache headers) |
| DELETE `/api/images/:id` | staff | Delete a stored image (204) |
| GET `/api/products/:id/reviews` | public | Approved reviews with `count` and `average` |
| POST `/api/products/:id/reviews` `{rating,title?,body?,image_url?}` | signed-in | Write/update your review (201); `verified` is set from paid order history; waits for moderation |
| GET `/api/reviews?status=pending\|approved\|rejected\|all` | staff | Moderation queue with product name and author email |
| PATCH `/api/reviews/:id` `{status}` | staff | Approve / reject / re-pend a review |
| DELETE `/api/reviews/:id` | staff | Delete a review (204) |
| POST `/api/stock-alerts` `{product_id,email}` | public | Register "notify me when back in stock" (201; duplicates ignored) |
| GET `/api/stock-alerts` | staff | Pending back-in-stock requests |
| POST `/api/automations/back-in-stock` | staff | Email everyone waiting on products that are back in stock; returns `{notified, products}` |
| PUT `/api/cart` `{items,subtotal_cents?}` | signed-in | Snapshot your bag server-side for recovery |
| GET `/api/carts` | staff | Saved carts (item count, subtotal, reminded/recovered flags) |
| POST `/api/automations/abandoned-carts` `{minutes?}` | staff | Email quiet carts (default 60 min); returns `{reminded, after_minutes}` |
| GET `/api/audit?limit=` | staff | Recent privileged actions (who, what, when) |
| GET `/api/orders/:id/invoice` | owner or staff | Printable HTML invoice |

### AI assistant
| Method & path | Access | Description |
|---|---|---|
| POST `/api/assistant/cook` `{pantry,guests?}` | public | Match a free-text pantry list to recipes; returns `matches` with coverage, `have`/`missing` items, scaled quantities and `add_missing`/`add_all` bag lines |
| POST `/api/assistant/chat` `{messages}` | public | Catalogue-grounded shopping chat (1–12 messages); returns `{reply, products, recipes, bundles}` suggestion cards |
| POST `/api/assistant/product-copy` `{product_id,keywords?}` | staff | Draft EN/DE/FR product descriptions (does not write; apply with `PUT /api/products/:id`) |

The assistant always matches against the live catalogue. When `AI_API_KEY` (or `OPENAI_API_KEY`) is set it
uses an LLM to parse messy input and phrase replies; otherwise it falls back to deterministic alias-aware
matching, so the endpoints keep working with no provider configured. `GET /api/config` reports
`ai: {enabled, provider, model}`. Assistant calls are limited to 30 requests/minute per IP.

Products now include `image_url`, `rating_average` and `rating_count`; staff set `image_url` via
`POST/PUT /api/products`. API responses are best-effort rate limited per client IP (900 requests/minute;
30 authentication attempts per 5 minutes), returning `429` with `Retry-After` when exceeded.

### Payments
| Method & path | Access | Description |
|---|---|---|
| POST `/api/payments/webhook` `{reference,status?,method?}` | gateway | Settle an order by `payment_reference`; requires the `x-webhook-secret` header matching `PAYMENTS_WEBHOOK_SECRET` (401 on a bad secret, 503 when unconfigured) |

API versioning: every `/api/...` route also works under the versioned prefix `/api/v1/...` (e.g. `/api/v1/products`).

## Schema
Tables: `users`, `categories`, `suppliers`, `products`, `orders`, `order_items`, `purchase_orders`, `purchase_order_items`,
`locations`, `inventory`, `subscribers`, `promo_codes`, `campaigns`, `message_templates`, `automations`, `messages`,
`bundles`, `bundle_items`, `delivery_areas`, `subscriptions`, `recipes`, `recipe_ingredients`, `product_tags`, `quotes`,
`images`, `product_reviews`, `stock_alerts`, `carts`, `audit_log` (see `src/db.js`).

Beyond the base schema, `orders` also carries `fulfillment`, `pickup_location_id`, `pickup_at`, `delivery_fee_cents`,
`payment_status`, `payment_method` and `payment_reference`; `users` carries `referral_code` and `account_type`
(`retail`/`restaurant`); `products` carries `spice_level`, `wholesale_price_cents` and `image_url`; `bundles` carries `serves`.
