# Afro Mart paid-ads plan

**Goal:** turn cold traffic into first orders, then build a retargeting audience for repeat purchases.

**Offer:** 10% off a first order over €20 with `WELCOME10`; free delivery over €50 within Bochum; free pickup in Bochum.

**Starting budget:** €10/day total (about €300/month).

> €10/day cannot be split three ways and still learn anything. Phase 1 runs **Meta + Google Search** only. TikTok creative is ready, but it stays paused until either the budget rises or the first two weeks prove a CPA below €12.

## Phase 1 — first 14 days (€10/day)

| Platform | Daily | Purpose |
|---|---:|---|
| Meta (Facebook + Instagram) | €6 | Demand creation: reach Nigerian diaspora and African-food shoppers in NRW |
| Google Search | €4 | Capture people actively looking for African/Nigerian groceries |
| TikTok | €0 | Prepared, paused until video creative + budget are ready |

**Geography:** Bochum + 50 km radius (Bochum, Essen, Dortmund, Duisburg, Düsseldorf, Wuppertal, Gelsenkirchen, Oberhausen, Hagen).

**Language:** English first; German second. Add Yoruba/Igbo/Hausa ad sets only if the English set gets traction.

**Age:** 24–55, all genders.

## Meta structure

### Ad set 1 — Diaspora interests (€4/day)
- Location: Bochum + 50 km
- Age: 24–55
- Languages: English, German, Yoruba, Igbo, Hausa
- Interests (stack 2–3, do not over-narrow): Nigerian cuisine, African cuisine, Jollof rice, Egusi soup, Fufu, Garri, African grocery store, Nigerian culture, Nigerian diaspora, RCCG, Winners Chapel
- Placements: Advantage+ automatic
- Optimisation: Conversions → Purchase (once Pixel has data); start with Add to cart if Purchase volume is too low

### Ad set 2 — Broad/local test (€2/day)
- Location: Bochum + 50 km
- Age: 25–50
- Language: English
- No interest targeting (let Meta’s broad delivery find buyers)
- Same creative and offer

### Ad set 3 — Retargeting (activate after Pixel has 100+ visitors)
- Website visitors 30 days
- Add to cart 14 days
- Instagram/Facebook engagers 30 days
- Budget: move €2/day from ad set 2 once this is live

### Creative mix
- `meta-hero-1080x1080.jpg` — brand/offer hero
- `meta-products-1080x1080.jpg` — product grid
- `story-1080x1920.jpg` — Stories/Reels placement
- `carousel-*.jpg` — six-card product carousel
- Test 2–3 primary texts per ad set; keep the same image for a fair comparison

## Google Search structure

### Campaign 1 — Non-brand (€3/day)
- Location: Bochum + 50 km
- Language: English + German
- Bid strategy: Maximise clicks with max CPC €0.50 (switch to Maximise conversions after 15+ conversions)
- Ad groups:
  1. **African grocery near me:** african grocery store bochum, afro shop bochum, afrikanischer supermarkt bochum, african food shop essen, afro shop dortmund
  2. **Nigerian food online:** nigerian food online germany, buy nigerian food online, nigerianische lebensmittel online, african food delivery germany
  3. **Product terms:** garri kaufen, egusi kaufen, ponmo kaufen, crayfish kaufen, iru kaufen, chin chin kaufen
- Negative keywords: restaurant, rezept, recipe, jobs, amazon, ebay, kostenlos, gratis, lieferando, uber eats

### Campaign 2 — Brand (€1/day)
- Keywords: afro mart, afromartz, afromartz.biz, afro mart bochum
- Cheap protection against competitors bidding on the brand

### Assets
- Sitelinks: Shop all, Meal packs, Kitchen helper, Track order
- Callouts: Free delivery over €50 · Bochum pickup · 10% off first order · Hand-packed
- Structured snippets: Garri, Egusi, Ponmo, Crayfish, Iru, Chin chin

## TikTok (prepared, paused)

- Format: 9:16 video, 15–25 seconds, UGC-style
- Location: Bochum + 50 km
- Age: 18–45
- Interests: African food, cooking, Nigerian culture, Afrobeats
- Budget when live: €5/day (requires total budget of at least €15/day)
- Creative: `story-1080x1920.jpg` as the cover/static fallback; use the script in `ad-copy.md`

## Decision rules

| Metric | Target | Action if missed after 7 days |
|---|---:|---|
| CTR | ≥ 1.5% | Change creative/headline |
| CPC | ≤ €0.60 | Tighten keywords/placements |
| Conversion rate | ≥ 2% | Improve landing page/offer |
| CPA | ≤ €12 | Cut the weakest ad set |
| ROAS | ≥ 2.5 | Scale only after 2 profitable weeks |

**Day 3:** check spend, CTR and CPC. Kill anything with CTR below 0.8%.
**Day 7:** cut the weakest ad set; move budget to the winner.
**Day 14:** if CPA ≤ €12 and ROAS ≥ 2.5, raise to €20/day and add TikTok. If not, keep €10/day and fix the offer/landing page before scaling.

## Tracking requirements

Before launch, the site needs:
- Meta Pixel + Conversions API: PageView, ViewContent, AddToCart, InitiateCheckout, Purchase
- Google Ads conversion tag: Purchase, AddToCart
- A GDPR consent banner that blocks marketing pixels until consent
- Impressum and Datenschutz pages

See `access-and-tracking.md` for the exact account access and IDs needed.
