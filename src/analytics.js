// Analytics: sales, profit, product and customer reporting with optional per-location scope.
import { lowStockAt } from './locations.js';

const salesFilter = ({ locationId, days } = {}) => {
  const where = ["o.status != 'cancelled'"];
  const params = [];
  if (locationId) { where.push('o.location_id = ?'); params.push(locationId); }
  if (days) { where.push("o.created_at >= datetime('now', ?)"); params.push(`-${days} days`); }
  return { sql: where.join(' AND '), params };
};

export function overview(db, { locationId = null, days = null } = {}) {
  const filter = salesFilter({ locationId, days });
  const sales = db.prepare(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(o.total_cents),0) AS revenue_cents,
            COALESCE(SUM(o.discount_cents),0) AS discount_cents
     FROM orders o WHERE ${filter.sql}`).get(...filter.params);
  const units = db.prepare(
    `SELECT COALESCE(SUM(oi.quantity),0) AS units_sold
     FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE ${filter.sql}`).get(...filter.params).units_sold;
  const cogs = db.prepare(
    `SELECT COALESCE(SUM(oi.quantity * p.cost_cents),0) AS cents
     FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
     WHERE ${filter.sql}`).get(...filter.params).cents;

  const locSql = locationId ? ' AND o.location_id = ?' : '';
  const locParams = locationId ? [locationId] : [];
  const repeat = db.prepare(
    `SELECT COUNT(*) AS n FROM (
       SELECT o.user_id FROM orders o WHERE o.status != 'cancelled' AND o.user_id IS NOT NULL${locSql} GROUP BY o.user_id HAVING COUNT(*) > 1)`).get(...locParams).n;
  const customers = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'").get().n;
  const newCustomers = days
    ? db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'customer' AND created_at >= datetime('now', ?)").get(`-${days} days`).n
    : customers;

  return {
    orders: sales.orders,
    revenue_cents: sales.revenue_cents,
    discount_cents: sales.discount_cents,
    average_order_cents: sales.orders ? Math.round(sales.revenue_cents / sales.orders) : 0,
    units_sold: units,
    estimated_cost_cents: cogs,
    estimated_profit_cents: sales.revenue_cents - cogs,
    customers,
    new_customers: newCustomers,
    repeat_customers: repeat,
    repeat_rate: customers ? Number((repeat / customers).toFixed(3)) : 0,
    low_stock_count: lowStockAt(db, locationId).length,
  };
}

export function salesSeries(db, { locationId = null, days = 30 } = {}) {
  const filter = salesFilter({ locationId, days });
  const orders = db.prepare(
    `SELECT date(o.created_at) AS date, COUNT(*) AS orders, COALESCE(SUM(o.total_cents),0) AS revenue_cents
     FROM orders o WHERE ${filter.sql} GROUP BY date(o.created_at) ORDER BY date`).all(...filter.params);
  const units = db.prepare(
    `SELECT date(o.created_at) AS date, COALESCE(SUM(oi.quantity),0) AS units
     FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE ${filter.sql}
     GROUP BY date(o.created_at)`).all(...filter.params);
  const unitByDate = new Map(units.map((r) => [r.date, r.units]));
  return orders.map((r) => ({ ...r, units: unitByDate.get(r.date) ?? 0 }));
}

export function topProducts(db, { locationId = null, limit = 10 } = {}) {
  const filter = salesFilter({ locationId });
  return db.prepare(
    `SELECT p.id, p.name, SUM(oi.quantity) AS units_sold, SUM(oi.quantity * oi.unit_price_cents) AS revenue_cents
     FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
     WHERE ${filter.sql} GROUP BY p.id ORDER BY units_sold DESC, revenue_cents DESC LIMIT ?`).all(...filter.params, limit);
}

export function topCustomers(db, { locationId = null, limit = 10 } = {}) {
  const filter = salesFilter({ locationId });
  return db.prepare(
    `SELECT COALESCE(u.id, 0) AS id, COALESCE(u.name, o.guest_name, 'Guest') AS name,
            COALESCE(u.email, o.guest_email) AS email, COALESCE(u.loyalty_points, 0) AS loyalty_points,
            COUNT(o.id) AS orders, COALESCE(SUM(o.total_cents),0) AS revenue_cents
     FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE ${filter.sql}
     GROUP BY COALESCE(u.id, 0), COALESCE(u.email, o.guest_email)
     ORDER BY revenue_cents DESC LIMIT ?`).all(...filter.params, limit);
}

export function categoryPerformance(db, { locationId = null } = {}) {
  const filter = salesFilter({ locationId });
  return db.prepare(
    `SELECT COALESCE(c.name, 'Uncategorised') AS category, SUM(oi.quantity) AS units_sold,
            SUM(oi.quantity * oi.unit_price_cents) AS revenue_cents
     FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE ${filter.sql} GROUP BY c.id ORDER BY revenue_cents DESC`).all(...filter.params);
}

export function registerAnalyticsRoutes(api) {
  const { route, requireStaff, db } = api;
  const opts = (ctx, { withDays = false } = {}) => {
    const locationId = ctx.query.get('location_id') ? Number(ctx.query.get('location_id')) : null;
    const days = withDays ? Math.min(Math.max(Number(ctx.query.get('days')) || 30, 1), 730) : null;
    return withDays ? { locationId, days } : { locationId };
  };

  route('GET', '/api/analytics/overview', (ctx) => { requireStaff(ctx); return overview(db, opts(ctx, { withDays: true })); });
  route('GET', '/api/analytics/sales', (ctx) => { requireStaff(ctx); return salesSeries(db, opts(ctx, { withDays: true })); });
  route('GET', '/api/analytics/top-products', (ctx) => {
    requireStaff(ctx);
    const limit = Math.min(Math.max(Number(ctx.query.get('limit')) || 10, 1), 100);
    return topProducts(db, { ...opts(ctx), limit });
  });
  route('GET', '/api/analytics/top-customers', (ctx) => {
    requireStaff(ctx);
    const limit = Math.min(Math.max(Number(ctx.query.get('limit')) || 10, 1), 100);
    return topCustomers(db, { ...opts(ctx), limit });
  });
  route('GET', '/api/analytics/categories', (ctx) => { requireStaff(ctx); return categoryPerformance(db, opts(ctx)); });
}
