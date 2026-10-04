# API

JSON over HTTP. Send the token from register/login in an `Authorization` header as the word Bearer, a space, then the token. Money is in integer cents.
Errors: `{ "error": "message" }` with 400/401/403/404/409/413.

| Method & path | Access | Description |
|---|---|---|
| POST `/api/auth/register` `{email,name,password}` | public | Create customer, returns `{token,user}` |
| POST `/api/auth/login` `{email,password}` | public | Returns `{token,user}` |
| GET `/api/me` | user | Current user incl. loyalty points |
| POST `/api/staff` `{email,name,password,role?}` | admin | Create staff/admin |
| GET `/api/categories` / POST | public / staff | List / create `{name}` |
| GET `/api/products?category=&q=` | public | Active products (staff also see cost/supplier/inactive) |
| GET `/api/products/:id` | public | One product |
| POST `/api/products`, PUT `/api/products/:id` | staff | `sku,name,description,category_id,supplier_id,price_cents,cost_cents,stock,reorder_level,reorder_quantity,expiry_date,active` |
| POST `/api/orders` `{items:[{product_id,quantity}],shipping_address}` | user | Place order; decrements stock, awards points |
| GET `/api/orders`, GET `/api/orders/:id` | user | Own orders (staff: all) |
| PATCH `/api/orders/:id/status` `{status}` | staff | `pending,paid,packed,shipped,delivered,cancelled` |
| GET/POST `/api/suppliers`, PUT `/api/suppliers/:id` | staff | Supplier management |
| GET `/api/inventory/low-stock` | staff | Products at/below reorder level |
| POST `/api/inventory/reorder` | staff | Create purchase orders for low-stock products (per supplier, skipping already-ordered) |
| GET/POST `/api/purchase-orders` | staff | List / create `{supplier_id,items:[{product_id,quantity,unit_cost_cents?}]}` |
| POST `/api/purchase-orders/:id/receive` | staff | Mark received and add stock |
| GET `/api/reports/summary` | staff | Revenue, estimated profit, customers, low stock, inventory value, top products |

## Schema
Tables: `users`, `categories`, `suppliers`, `products`, `orders`, `order_items`, `purchase_orders`, `purchase_order_items` (see `src/db.js`).
