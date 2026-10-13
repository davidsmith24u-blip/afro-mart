// Loyalty tiers, points multipliers and refer-a-friend.
const TIERS = [
  { key: 'bronze', label: 'Bronze', min_cents: 0, multiplier: 1 },
  { key: 'silver', label: 'Silver', min_cents: 5000, multiplier: 1.1 },
  { key: 'gold', label: 'Gold', min_cents: 20000, multiplier: 1.25 },
  { key: 'platinum', label: 'Platinum', min_cents: 50000, multiplier: 1.5 },
];

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REFERRAL_POINTS = 200;

export const TIER_LABELS = Object.fromEntries(TIERS.map((t) => [t.key, t.label]));

export function lifetimeSpendCents(db, userId) {
  return db.prepare(
    "SELECT COALESCE(SUM(total_cents), 0) AS cents FROM orders WHERE user_id = ? AND status != 'cancelled'",
  ).get(userId)?.cents ?? 0;
}

export function tierFor(spentCents) {
  return TIERS.filter((t) => spentCents >= t.min_cents).pop() ?? TIERS[0];
}

export function tierMultiplier(tier) {
  return tier?.multiplier ?? 1;
}

// Points a customer earns on a spend, after their tier multiplier.
export function pointsFor(centsSpent, tier) {
  return Math.floor((centsSpent / 100) * tierMultiplier(tier));
}

// Lazy-assign a unique, human-friendly referral code for a user.
export function referralCode(db, userId) {
  const existing = db.prepare('SELECT referral_code FROM users WHERE id = ?').get(userId);
  if (existing?.referral_code) return existing.referral_code;
  for (let attempt = 0; attempt < 30; attempt++) {
    let code = '';
    for (let i = 0; i < 8; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!db.prepare('SELECT 1 FROM users WHERE referral_code = ?').get(code)) {
      db.prepare('UPDATE users SET referral_code = ? WHERE id = ?').run(code, userId);
      return code;
    }
  }
  return null;
}

// Award a fresh signup to a valid referral code. Throws (400) on unknown codes.
export function applyReferral(db, code, newUserId) {
  const clean = String(code ?? '').toUpperCase().trim();
  if (!clean) return {};
  const referrer = db.prepare('SELECT id FROM users WHERE referral_code = ? AND id != ?').get(clean, newUserId);
  if (!referrer) throw Object.assign(new Error('Unknown referral code'), { status: 400 });
  db.prepare('UPDATE users SET referred_by = ? WHERE id = ?').run(clean, newUserId);
  db.prepare('UPDATE users SET loyalty_points = loyalty_points + ? WHERE id = ?').run(REFERRAL_POINTS, referrer.id);
  return { referrer_id: referrer.id, points_awarded: REFERRAL_POINTS };
}