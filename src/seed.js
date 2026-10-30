import { openDb } from './db.js';
import { classifyProduct, wholesalePriceCents } from './catalog-meta.js';
import { CATALOG_VERSION } from './catalog-version.js';
import { hashPassword } from './auth.js';

const db = openDb(process.env.DB_PATH || 'afromart.db');
const categoryNames = ['Dry Goods', 'Fresh Produce', 'Beverages', 'Spices', 'Frozen', 'Snacks', 'Oils & Condiments', 'Rice & Grains', 'Meat & Fish', 'Health & Beauty'];
const insertCategory = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');
const cats = {};
for (const name of categoryNames) {
  insertCategory.run(name);
  cats[name] = db.prepare('SELECT id FROM categories WHERE name = ?').get(name).id;
}
let supplier = db.prepare('SELECT id FROM suppliers WHERE name = ?').get('Lagos Wholesale Foods');
if (!supplier) {
  const result = db.prepare("INSERT INTO suppliers (name, country, contact_name) VALUES ('Lagos Wholesale Foods', 'Nigeria', 'Ade')").run();
  supplier = { id: Number(result.lastInsertRowid) };
}
// Descriptions, names and prices are refreshed on existing SKUs so the catalog
// copy and the current price list stay up to date (stock stays untouched).
const ins = db.prepare(`INSERT INTO products (sku, name, description, category_id, supplier_id, price_cents, cost_cents, stock, reorder_level, reorder_quantity)
  VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(sku) DO UPDATE SET name = excluded.name, description = excluded.description, price_cents = excluded.price_cents, cost_cents = excluded.cost_cents`);
const products = [
  ['GAR-001', 'Garri (white) 2kg', 'Premium white cassava granules — sprinkled into warm water and stirred, they become a smooth, fluffy eba ready to scoop up soup.', 'Dry Goods', 899, 600, 40, 10, 50],
  ['PLN-001', 'Plantain (bunch)', 'Fresh green plantain, great for frying, roasting or pounding — keep it on the counter and choose your ripeness.', 'Fresh Produce', 499, 300, 25, 8, 30],
  ['HIB-001', 'Hibiscus tea (Zobo) 250g', 'Deep-red hibiscus petals for a ruby jug of zobo — steep with ginger and pineapple, then pour over ice.', 'Beverages', 599, 350, 30, 10, 40],
  ['SPC-001', 'Suya spice 100g', 'The signature suya rub of roasted peanuts, ginger and chilli — coat beef, chicken or plantain and grill for street-side flavour.', 'Spices', 449, 250, 60, 15, 60],
  ['PEP-001', 'Scotch bonnet peppers 200g', 'Fresh scotch bonnets with that unmistakable fruity heat — the soul of West African cooking, chopped into stews and pepper sauces.', 'Fresh Produce', 399, 200, 5, 10, 30],
  ['EGU-001', 'Egusi seeds 500g', 'Ground melon seeds that fry into a rich, nutty, thick soup — the heart of a proper West African egusi.', 'Dry Goods', 899, 550, 24, 8, 30],
  ['OGB-001', 'Ogbono seeds 250g', 'Ground wild-mango seeds for a glossy, draw-like ogbono soup — simmer with stock, meat and greens for a classic pot.', 'Dry Goods', 799, 480, 18, 7, 25],
  ['GAR-002', 'Ijebu garri 1kg', 'Fine, tangy Ijebu-style cassava granules from southwest Nigeria — the sharper, sourer garri for soaked garri and eba.', 'Dry Goods', 649, 420, 28, 8, 35],
  ['FUF-001', 'Cassava fufu flour 1kg', 'Easy cassava flour that cooks into a smooth, stretchy swallow — a fuss-free fufu for scooping up any soup.', 'Dry Goods', 749, 470, 22, 8, 30],
  ['YAM-002', 'Pounded yam flour 1.5kg', 'Quick-cooking yam flour for soft, stretchy pounded yam no one will guess was not pounded by hand.', 'Dry Goods', 1199, 780, 16, 6, 24],
  ['MAI-001', 'White maize meal 2kg', 'Stone-ground white maize meal — the smooth, comforting base of nshima, sadza and pap for any relish or stew.', 'Dry Goods', 999, 650, 20, 7, 28],
  ['TEF-001', 'Teff flour 1kg', 'Fine, naturally gluten-free teff flour for airy Ethiopian injera and soft flatbreads with an earthy, slightly sour tang.', 'Dry Goods', 1499, 1000, 14, 5, 20],
  ['PSP-001', 'Pepper soup spice 100g', 'Fragrant grains of selim, uziza and warming peppers — the shortcut to a properly mouth-tingling pepper soup.', 'Spices', 499, 300, 25, 8, 35],
  ['JOL-001', 'Jollof rice seasoning 100g', 'Smoky tomato, pepper and spice blend that gives rice that party-jollof colour and deep flavour every time.', 'Spices', 449, 260, 35, 10, 45],
  ['BER-001', 'Berbere spice blend 100g', 'A bold Ethiopian-inspired blend of bird’s-eye chilli and warm aromatics — the deep red soul of doro wat and stews.', 'Spices', 599, 350, 18, 6, 25],
  ['PAL-001', 'Red palm oil 1L', 'Deep-orange, unrefined palm oil straight from the mill — the rich base of egusi, banga and jollof. Gently warm it if it solidifies in cool weather.', 'Oils & Condiments', 1299, 850, 20, 7, 28],
  ['GNP-001', 'Roasted groundnut paste 500g', 'Creamy paste of slow-roasted groundnuts — silky for groundnut soup and sauces, brilliant on toast and in smoothies.', 'Oils & Condiments', 899, 580, 18, 6, 24],
  ['PUF-001', 'Puff puff mix 500g', 'Just add water and fry for soft, golden puff puff — roll in sugar while warm for the full celebration feel.', 'Snacks', 599, 360, 24, 8, 32],
  ['CAS-001', 'Frozen cassava leaves 500g', 'Prepped, chopped cassava leaves flash-frozen for saka-saka, pondu and stews — earthy, tender greens in minutes.', 'Frozen', 799, 500, 15, 5, 22],
  ['TAM-001', 'Tamarind drink concentrate 500ml', 'Sweet-tart tamarind concentrate for an ice-cold refreshing drink in minutes — or add its tang to sauces and marinades.', 'Beverages', 899, 560, 18, 6, 24],
  ['BAO-001', 'Baobab fruit powder 150g', 'Bright, citrusy baobab powder rich in vitamin C — blend into smoothies, porridge and yoghurt or whisk into a tangy drink.', 'Dry Goods', 999, 650, 12, 4, 18],
  ['KNR-001', 'Knorr chicken cubes 8-pack', 'The classic chicken-flavoured cubes for everyday cooking — the savoury base behind countless West African pots.', 'Oils & Condiments', 249, 140, 40, 12, 55],
  ['TIG-001', 'Tigernut powder 250g', 'Finely milled tigernut for creamy dairy-free milk, smoothies and pap — naturally sweet with a subtle nutty finish.', 'Dry Goods', 349, 209, 16, 5, 22],
  ['OFA-001', 'Dry Ayamashe / Ofada Mix 100g', 'A punchy pepper-and-spice mix for Ayamashe and Ofada sauce — the fiery, smoky partner for ofada rice and assorted meat.', 'Spices', 599, 360, 20, 7, 28],
  ['JOL-002', 'Dry Jollof Base Mix 100g', 'A concentrated tomato, pepper and spice base for quick jollof that still tastes slow-cooked and smoky.', 'Spices', 549, 330, 24, 8, 32],
  ['EGM-001', 'Dry Egusi Mix 250g', 'Ground melon seeds pre-blended with classic soup spices — fry in palm oil, add stock, and your egusi is halfway done.', 'Spices', 449, 269, 18, 6, 24],
  ['CHP-001', 'Chapman fruit drink 330ml', 'Nigerian-inspired Chapman — citrusy, fruity and gently spiced, poured over ice for bar-side flavour at home.', 'Beverages', 349, 200, 24, 8, 32],
  ['MAL-001', 'Malt drink 330ml', 'Rich, non-alcoholic malt with deep toasted-barley flavour — the classic anytime drink for chin chin and suya.', 'Beverages', 299, 170, 30, 10, 40],
  ['AMT-001', 'Amstel Malta 330ml', 'Smooth, full-bodied non-alcoholic malt with a clean malty finish — chilled, it is a household favourite.', 'Beverages', 299, 170, 24, 8, 32],
  ['GING-001', 'Ginger drink 330ml', 'A sparkling, gently spiced non-alcoholic ginger drink with a bright, warming kick — pairs with any meal.', 'Beverages', 349, 200, 18, 6, 24],
  ['COL-001', 'Coca-Cola 330ml', 'The classic cola, ice-cold and fizzy — a party-table regular and the base of a proper Chapman pitcher.', 'Beverages', 199, 110, 48, 16, 60],
  ['PEP-001B', 'Pepsi 330ml', 'Crisp, refreshing cola with a slightly sweeter, lighter finish — ice-cold by the glass or in a big Chapman jug.', 'Beverages', 199, 110, 48, 16, 60],
  ['FAN-001', 'Fanta Orange 330ml', 'Bubbly orange soda with a bright, juicy burst — a childhood favourite and a star of any party table.', 'Beverages', 199, 110, 36, 12, 48],
  ['SPR-001', 'Sprite Lemon-Lime 330ml', 'Crisp lemon-lime fizz that cuts through richness — pour over ice for a clean, refreshing drink or a mixer.', 'Beverages', 199, 110, 36, 12, 48],
  ['MIR-001', 'Mirinda Orange 330ml', 'Sunny, bubbly orange soda — sweet, zesty and refreshing straight from the fridge.', 'Beverages', 199, 110, 30, 10, 42],
  ['RED-001', 'Red Bull Energy Drink 250ml', 'The original energy drink in a single-serve can — a quick boost for long days and late nights.', 'Beverages', 299, 180, 24, 8, 32],
  ['MON-001', 'Monster Energy Original 500ml', 'A big 500ml can of the best-known energy drink — bold, fizzy and there when you need a lift.', 'Beverages', 399, 240, 20, 7, 28],
  ['POW-001', 'Power Horse Energy Drink 250ml', 'A popular energy drink in a palm-sized can — crisp, energising fizz that is easy to grab on the go.', 'Beverages', 249, 145, 24, 8, 32],
  ['PIN-001', 'South African Pinotage 750ml', 'South Africa’s signature grape — a dry, full-bodied red with dark berry, plum and a faint smoky edge. Great with braai and grilled meat.', 'Beverages', 1199, 800, 12, 4, 18],
  ['CHW-001', 'South African Chenin Blanc 750ml', 'Crisp, unoaked Chenin Blanc full of citrus and orchard fruit — a bright partner for grilled fish and plantain.', 'Beverages', 1099, 730, 12, 4, 18],
  ['SHI-001', 'South African Shiraz 750ml', 'Bold, full-bodied South African Shiraz with pepper, dark fruit and soft tannins — the wine to open at your next braai.', 'Beverages', 1299, 870, 10, 4, 16],
  ['MAN-001', 'Mango nectar 1L', 'Thick, golden mango nectar with a smooth tropical finish — pour over ice or blend into smoothies and punch.', 'Beverages', 399, 240, 20, 7, 28],
  ['KOL-001', 'Kola nut soft drink 330ml', 'A sparkling tribute to the kola nut — subtly sweet, lightly bitter and unmistakably African, served ice-cold.', 'Beverages', 349, 210, 18, 6, 24],
  // ---- Rice & Grains ----
  ['RIC-001', 'Perfumed long-grain rice 5kg', 'Fragrant long-grain rice that cooks fluffy and separate — the reliable base for party-size jollof or a simple weekday pot.', 'Rice & Grains', 1599, 1100, 24, 8, 30],
  ['RIC-002', 'Long-grain rice 2kg', 'Steady everyday long-grain rice that cooks fluffy without sticking — versatile enough for jollof, fried rice or plain.', 'Rice & Grains', 799, 540, 30, 10, 40],
  ['MLP-001', 'Millet & sorghum pap mix 1kg', 'A smooth millet and sorghum blend for Ghanaian-style koko — stir with hot water into a gently sour, comforting morning porridge.', 'Rice & Grains', 699, 450, 16, 6, 24],
  ['BNK-001', 'Banku corn & cassava mix 1kg', 'A fermented corn and cassava mix for proper Ghanaian banku and kenkey — boil, knead and serve with ground pepper and fried fish.', 'Rice & Grains', 799, 520, 15, 5, 22],
  // ---- Meat & Fish ----
  ['STK-001', 'Stockfish (dry cod) 250g', 'Hard-dried cod that infuses soups, egusi and stews with deep, briny umami — worth a soak, every time.', 'Meat & Fish', 1599, 1000, 10, 4, 16],
  ['CRO-001', 'Smoked croaker 300g', 'A whole smoked croaker, ready for the pot — firm flakes and smoky savour make pepper soup and stews sing.', 'Meat & Fish', 999, 650, 12, 4, 18],
  ['SHR-001', 'Dried prawns 100g', 'Sun-dried prawns with concentrated sea-sweet flavour — a handful lifts fried rice, jollof and stews in one go.', 'Meat & Fish', 799, 500, 14, 5, 20],
  ['GOA-001', 'Frozen goat meat 1kg', 'Clean cubes of frozen goat meat — braised low and slow, it makes rich pepper soup, asun or a big Sunday stew.', 'Meat & Fish', 1899, 1400, 12, 4, 18],
  ['SNA-001', 'Frozen red snapper 800g', 'A whole frozen red snapper, scaled and ready — grill it whole, fry it crisp, or poach it into a beautiful pepper soup.', 'Meat & Fish', 1499, 1050, 10, 4, 16],
  ['BIL-001', 'Biltong (spiced dried beef) 100g', 'South African-style spiced air-dried beef, chewy and full of flavour — the braai-side snack that disappears at gatherings.', 'Meat & Fish', 699, 450, 15, 5, 20],
  ['SARD-001', 'Sardines in tomato sauce 125g', 'Plump sardines in rich tomato sauce — the pantry hero for quick snacks, stews and a sneaky depth of flavour in jollof.', 'Meat & Fish', 399, 230, 30, 10, 40],
  // ---- Soup bases & greens ----
  ['PNC-001', 'Palmnut cream 800g', 'Smooth, ready-to-cook palmnut cream — the rich, fruity base for Ghanaian palmnut soup or Nigerian banga.', 'Oils & Condiments', 649, 420, 18, 6, 24],
  ['OHA-001', 'Dried oha leaves 100g', 'Dried oha leaves with a distinctive peppery aroma — add just before serving to keep your oha soup fresh and fragrant.', 'Dry Goods', 599, 380, 14, 5, 20],
  ['UZI-001', 'Dried uziza leaves 100g', 'Dried uziza leaves with a warm, peppery punch — stir into soups and stews for an authentic, slightly hot finish.', 'Dry Goods', 599, 380, 14, 5, 20],
  ['BTL-001', 'Dried bitterleaf 100g', 'Dried bitterleaf with its clean, distinctive bitterness — rinse well, then simmer into ofe onugbu and rich stews.', 'Dry Goods', 549, 350, 16, 6, 22],
  ['DSP-001', 'Dehydrated spinach (ugu / efo) 100g', 'Just soak and it swells back into green, fresh-tasting leaves — perfect for egusi, vegetable soup and efo.', 'Dry Goods', 499, 310, 20, 7, 26],
  ['ACH-001', 'Achi thickener 100g', 'A ground West African seed that thickens soups to a smooth, silky draw — stir in gradually and simmer.', 'Dry Goods', 399, 250, 18, 6, 24],
  // ---- Seasonings ----
  ['ONG-001', 'Seasoning cubes (beef) 8-pack', 'Beef-flavoured cubes that deepen every pot — crumble one into soups, stews, rice and sauces for quick savour.', 'Spices', 249, 140, 36, 12, 48],
  ['PPR-002', 'Jollof pepper mix 100g', 'A five-pepper blend built for party-style jollof — roast it low and slow for that rich, smoky, orange-red colour.', 'Spices', 499, 300, 18, 6, 24],
  // ---- More drinks & snacks ----
  ['CHP-002', 'Chapman syrup 750ml', 'A splash turns soda and ice into a showstopping pitcher of Chapman — sweet-tart, fruity and ready in seconds.', 'Beverages', 699, 450, 15, 5, 22],
  ['CHM-001', 'Chocolate malt drink 330ml', 'Chocolate-flavoured malt with a rich, satisfying cocoa kick — a sweeter take on the classic.', 'Beverages', 349, 220, 18, 6, 24],
  ['RMC-001', 'Roasted maize (corn) 200g', 'Golden corn kernels roasted until nutty and crisp — the classic market-day snack, great with zobo or a cold drink.', 'Snacks', 349, 200, 20, 7, 28],
  // ---- Health & Beauty ----
  ['SHE-001', 'Raw shea butter 250g', 'Unrefined, raw shea butter in its purest form — melts on contact to moisturise skin and tame hair, with a gentle nutty scent.', 'Health & Beauty', 899, 550, 20, 7, 28],
  ['BSO-001', 'African black soap 300g', 'A traditional West African black soap bar made the old way — gently cleanses face and body, leaving skin soft and clear.', 'Health & Beauty', 599, 380, 15, 5, 22],
  ['COC-001', 'Virgin coconut oil 250ml', 'Cold-pressed virgin coconut oil for hair, skin and cooking — lightly scented, silky and endlessly useful.', 'Health & Beauty', 799, 520, 14, 5, 20],
  ['HAI-001', 'Hair & edge growth butter 200g', 'A nourishing butter whipped with growth-friendly oils for hair, edges and scalp — soften, shine and edge up.', 'Health & Beauty', 999, 640, 12, 4, 18],
  ['BTR-001', 'Shea & cocoa body butter 200g', 'Whipped shea and cocoa body butter that melts into dry skin and leaves it soft, glowy and lightly cocoa-scented.', 'Health & Beauty', 899, 580, 15, 5, 22],
  // ---- Nigerian kitchen staples & local dishes ----
  ['UKW-001', 'Dried ukwa (African breadfruit) 500g', 'Smoked ukwa that softens into a rich, starchy comfort pot — simmer with palm oil, pepper, periwinkle or dried fish.', 'Dry Goods', 999, 650, 14, 4, 18],
  ['OLN-001', 'Honey beans (oloyin) 1kg', 'The sweet Nigerian brown beans behind ewa agoyin, plump moi moi and golden akara — soak overnight, boil and enjoy.', 'Dry Goods', 899, 580, 20, 6, 24],
  ['SEM-001', 'Semovita (wheat swallow) 2kg', 'Smooth golden semovita that kneads into a stretchy wheat swallow — the sturdy partner for egusi, efo riro and okro soup.', 'Dry Goods', 799, 520, 18, 6, 24],
  ['UGB-001', 'Ugba (oil bean seed) 200g', 'Fermented oil bean seeds with a nutty, pungent kick — the soul of African salad and a bold addition to soups.', 'Dry Goods', 599, 380, 15, 5, 20],
  ['ABA-001', 'Abacha (shredded cassava) 500g', 'Pre-shredded cassava for African salad — toss with ugba, palm oil, garden egg and stockfish for a Saturday special.', 'Dry Goods', 799, 520, 14, 5, 20],
  ['UTZ-001', 'Dried utazi leaves 100g', 'Aromatic utazi with a clean, gentle bitterness — the finishing herb for ofe nsala and pepper soup.', 'Dry Goods', 599, 380, 12, 4, 16],
  ['SCL-001', 'Dried scent leaf (efinrin / nchanwu) 50g', 'Hugely fragrant scent leaf that perfumes pepper soup and vegetable stews — add near the end to keep its aroma.', 'Dry Goods', 549, 350, 14, 5, 18],
  ['OKP-001', 'Dried okazi leaves (afang) 100g', 'Tough, earthy okazi — the essential green for afang soup, sliced fine and simmered with waterleaf and palm oil.', 'Dry Goods', 699, 450, 12, 4, 16],
  ['WTL-001', 'Waterleaf (gbure) dried 100g', 'Waterleaf that rehydrates soft and tender — a key green for efo riro, edikang ikong and afang.', 'Dry Goods', 549, 350, 14, 5, 18],
  ['OKM-001', 'Dried okra powder 100g', 'Instant okro — whisk this dried okra powder into stock for a fast, naturally draw-y pot of okro soup.', 'Dry Goods', 649, 420, 16, 5, 22],
  ['EWD-001', 'Dried ewedu (jute leaves) 100g', 'Slimy, silky ewedu leaves for the classic abula — mash with potash and spoon over amala with gbegiri and stew.', 'Dry Goods', 599, 380, 14, 5, 18],
  ['GBG-001', 'Gbegiri (bean soup) mix 400g', 'Ground beans for smooth gbegiri — simmered with pepper and palm oil, it completes the abula trio.', 'Dry Goods', 699, 450, 16, 5, 22],
  ['MBM-001', 'Moi moi mix 500g', 'Pre-blended beans for rich, steamed moi moi — add pepper, oil and your favourite fillings, then steam.', 'Dry Goods', 749, 480, 16, 5, 22],
  ['AKR-001', 'Akara mix 400g', 'Just add water and seasoning, then fry in hot oil — golden, fluffy akara for breakfast with pap.', 'Dry Goods', 599, 380, 18, 6, 24],
  ['TIG-002', 'Tiger Nuts (Aya) 250g', 'Whole, nutty tiger nuts for crunchy snacking or a creamy cup of kunun aya — blend, strain and sweeten.', 'Dry Goods', 699, 450, 14, 5, 18],
  ['YAM-003', 'Fresh yam (whole tuber) 2kg', 'A whole fresh yam tuber — boil it, roast it or turn it into asaro porridge. A true Nigerian staple for every table.', 'Fresh Produce', 1499, 1000, 12, 4, 16],
  ['TTS-001', 'Tatashe (red peppers) 500g', 'Large, sweet red tatashe with deep colour — the base of ofe ata and party-red stews.', 'Fresh Produce', 399, 240, 10, 3, 12],
  ['OKR-001', 'Fresh okra 400g', 'Fresh garden okra that draws beautifully — chop and stir into a glossy pot of okro soup with meat and fish.', 'Fresh Produce', 349, 200, 12, 4, 16],
  ['GG-001', 'Garden eggs 500g', 'Bitter-sweet aubergine fruits, the classic garden egg — dip them in groundnut sauce or slice into African salad.', 'Fresh Produce', 399, 240, 14, 5, 18],
  ['COC-002', 'Mature coconut (whole)', 'One mature coconut with firm, sweet flesh — crack it for coconut rice, fillings or fresh coconut milk.', 'Fresh Produce', 299, 180, 15, 5, 20],
  ['AGR-001', 'Alligator pepper (mbongo) 50g', 'Fiery alligator pepper with a resinous warmth — grind into pepper soup, ukodo or native rice.', 'Spices', 449, 280, 20, 7, 28],
  ['EHX-001', 'Calabash nutmeg (ehuru) 50g', 'Grate whole calabash nutmeg for an intoxicating warm spice — into ngwo-ngwo, pepper soup and stews.', 'Spices', 449, 280, 20, 7, 28],
  ['UDA-001', 'Uda (negro pepper) 50g', 'Dark, aromatic uda pods with a smoky clove-like punch — a precious depth for soups and native rice.', 'Spices', 499, 310, 18, 6, 24],
  ['NZS-001', 'Uziza seeds 100g', 'Pungent, peppery uziza seeds — grind into soups for that unmistakable local heat.', 'Spices', 449, 280, 18, 6, 24],
  ['NGM-001', 'Pepper soup seeds set (uda, ehuru, mbongo) 100g', 'The classic pepper-soup seed trio — uda, ehuru and alligator pepper. Grind, simmer and let the aroma work.', 'Spices', 599, 380, 20, 7, 26],
  ['OGI-001', 'Ogi (white corn pap) 500g', 'Nigeria’s beloved white corn pap — stir with hot water into a silky breakfast, or let it ferment for a gently sour kick.', 'Rice & Grains', 649, 420, 16, 5, 20],
  ['OFR-001', 'Ofada rice (unpolished) 2kg', 'Locally grown unpolished ofada rice with a nutty bite — serve with fiery ofada stew and assorted meat.', 'Rice & Grains', 1299, 850, 16, 5, 22],
  ['KLK-001', 'Kulikuli (roasted groundnut cake) 200g', 'Crunchy pressed groundnut cake with deep toasted flavour — the market-famous Nigerian snack, great with zobo.', 'Snacks', 449, 280, 20, 7, 28],
  ['KLS-001', 'Kilishi (spiced dried beef) 150g', 'Hausa-style air-dried beef spiced with suya and peanut — thin, chewy and seriously addictive.', 'Meat & Fish', 849, 550, 16, 5, 22],
  ['DBN-001', 'Dambun nama (shredded dried beef) 150g', 'Fluffy shredded dried beef with smoky, savoury depth — sprinkle over rice, eggs or suya-spiced snacks.', 'Meat & Fish', 699, 450, 14, 5, 18],
  ['CFT-001', 'Dried cow foot (nkwobi) 300g', 'Dried cow foot that braises into rich, sticky perfection — the star of nkwobi and a silky addition to soup pots.', 'Meat & Fish', 1099, 720, 12, 4, 16],
  ['PAL-002', 'Palm fruit (banga) 500g', 'Chunks of frozen palm fruit for authentic banga soup — boil, squeeze out the rich red juice and simmer.', 'Frozen', 649, 420, 18, 6, 24],
  // ---- Beyond Nigeria: Kenya, Ethiopia, Somalia, Senegal, Cameroon, South Africa ----
  ['PIL-001', 'Kenyan pilau masala 100g', 'A warm Kenyan blend of cumin, cardamom, clove and cinnamon — stir through rice and beef for a fragrant, golden pilau.', 'Spices', 499, 300, 24, 8, 32],
  ['KEN-001', 'Kenyan curry powder 100g', 'A mild, aromatic Kenyan-style curry powder — the everyday base for curries, stews and sukuma wiki.', 'Spices', 449, 270, 24, 8, 32],
  ['SHR-002', 'Ethiopian shiro powder 400g', 'Stone-ground chickpea flour seasoned the Ethiopian way — whisk with water and simmer into the creamy shiro wat served with injera.', 'Dry Goods', 799, 500, 18, 6, 24],
  ['CHA-001', 'Chakalaka relish 410g', 'A tangy South African relish of tomato, pepper, carrot, onion and spice — the braai-table side that goes with everything.', 'Oils & Condiments', 449, 280, 20, 7, 28],
  ['ROO-001', 'Rooibos tea 250g', 'Naturally caffeine-free South African rooibos with a smooth, lightly sweet taste — enjoy it hot or as a long iced tea.', 'Beverages', 599, 360, 20, 7, 28],
  ['SHH-001', 'Somali shaah spice tea 250g', 'The Somali chai blend of black tea, cardamom, cinnamon, clove and ginger — brew it strong with milk and sugar.', 'Beverages', 599, 370, 18, 6, 24],
  ['YAS-001', 'Yassa seasoning 100g', 'A bright Senegalese blend of onion, lemon, mustard and chilli — the tangy marinade behind poulet yassa.', 'Spices', 549, 330, 20, 7, 28],
  ['NDL-001', 'Ndole (bitterleaf) pack 400g', 'Prepped bitterleaf and groundnut base for Cameroonian ndole — simmer with prawns or beef for a rich, nutty stew.', 'Frozen', 899, 560, 14, 5, 20],
  // ---- More Nigerian favourites (Afro Mart Bochum) ----
  ['ATA-001', 'Ata rodo (scotch bonnet) powder 100g', 'Fiery ground scotch bonnet with a clean, fruity heat — the backbone of Nigerian pepper soup, stews and marinades.', 'Spices', 399, 220, 24, 8, 32],
  ['SUY-001', 'Suya spice (yaji) 100g', 'The smoky, nutty yaji blend of groundnut, ginger, paprika and chilli — rub it on skewers or sprinkle over grilled anything.', 'Spices', 499, 300, 24, 8, 32],
  ['EFO-001', 'Efo tete (African spinach) 400g', 'Frozen chopped African spinach with a tender, earthy leaf — perfect for efo riro, efo elegusi and quick vegetable soups.', 'Frozen', 549, 340, 16, 5, 22],
  ['MFN-001', 'Moin moin mix 500g', 'A seasoned bean-flour blend to steam the classic savoury bean pudding — just add water, pepper and oil, then wrap and cook.', 'Dry Goods', 749, 470, 16, 5, 22],
  ['KOK-001', 'Kokoro (maize & garri snack) 150g', 'Crunchy, lightly sweet maize-and-garri sticks — the addictive Lagos street snack, best shared with a cold drink.', 'Snacks', 349, 200, 20, 7, 28],
  ['KUN-001', 'Kunu (millet drink) mix 500g', 'A smooth millet-and-ginger blend for the creamy northern drink — whisk with cold water for a cooling, lightly spiced kunu.', 'Beverages', 599, 360, 18, 6, 24],
  ['TGM-001', 'Tiger nut milk (kunnu aya) 1L', 'Rich, naturally sweet tiger nut milk — a dairy-free Nigerian favourite that is lovely chilled, over ice or blended with dates.', 'Beverages', 699, 420, 18, 6, 24],
  ['BEA-001', 'Honey beans (oloyin) 2kg', 'Creamy, sweet oloyin beans that cook soft and hold their shape — the classic choice for ewa agoyin, akara and moin moin.', 'Rice & Grains', 1099, 720, 16, 5, 22],
  ['BRN-001', 'Brown beans (olotu) 2kg', 'Hearty brown beans with a firm bite and nutty flavour — simmer into a rich pottage or smoky ewa riro.', 'Rice & Grains', 999, 640, 16, 5, 22],
  ['IJE-001', 'Ijebu garri 2kg', 'Sour, crunchy Ijebu-style cassava garri — soak it cold with groundnut and sugar, or use it to thicken and lift any soup.', 'Rice & Grains', 799, 480, 18, 6, 24],
  ['PLA-002', 'Unripe plantain flour 1kg', 'Stone-ground green plantain flour, naturally low in sugar — bake into a firm, flavourful swallow or pounded-yam substitute.', 'Rice & Grains', 899, 560, 16, 5, 22],
  ['PNY-001', 'Poundo yam flour 2kg', 'Instant pounded-yam flour for a smooth, stretchy swallow in minutes — the quick route to a proper yam-and-egusi meal.', 'Rice & Grains', 1099, 700, 16, 5, 22],
  ['AML-001', 'Amala (yam flour) 2kg', 'The deep-brown yam flour behind silky amala — stir into hot water and serve with gbegiri and ewedu for a true Yoruba plate.', 'Rice & Grains', 999, 630, 16, 5, 22],
  ['PMO-002', 'Red palm oil 1L', 'Unrefined, deep-red palm oil with the rich aroma of home — the essential base for jollof, banga, stews and efo riro.', 'Oils & Condiments', 899, 560, 18, 6, 24],
  ['CCN-001', 'Coconut oil 500ml', 'Cold-pressed virgin coconut oil with a clean, tropical sweetness — for frying, baking and skin care alike.', 'Oils & Condiments', 799, 500, 18, 6, 24],
  ['TMP-001', 'Tomato paste (tinned) 400g', 'Thick, concentrated tomato paste that gives stews a deep red colour and body — a pantry workhorse for Nigerian cooking.', 'Oils & Condiments', 299, 170, 24, 8, 32],
  ['OGB-002', 'Ogbono (draw soup) seeds 200g', 'Ground wild mango seeds that draw into a glossy, silky soup — cook with stock and assorted meat for the classic ogbono.', 'Oils & Condiments', 749, 470, 16, 5, 22],
  ['EKU-001', 'Egusi (melon seeds) ground 1kg', 'Freshly ground melon seeds, rich and nutty — the heart of a thick, golden egusi soup with bitterleaf or efo.', 'Oils & Condiments', 1199, 760, 16, 5, 22],
  ['UGW-001', 'Ugwu (fluted pumpkin leaves) 400g', 'Shredded fluted pumpkin leaves (ugwu) with an earthy, iron-rich bite — stir into egusi, yam or pepper soup.', 'Frozen', 599, 370, 16, 5, 22],
  ['OGI-002', 'Ogi (white corn pap) 1kg', 'Velvety white corn pap that ferments to a gentle tang — stir with hot water for a silky breakfast or serve with akara.', 'Rice & Grains', 899, 540, 16, 5, 22],
  ['KLK-002', 'Kuli kuli (groundnut cake) 250g', 'Crunchy spiced groundnut cake pressed into rounds — crumble over salads, snack as is, or grind into suya spice.', 'Snacks', 549, 320, 20, 7, 28],
  ['BOL-001', 'Boli (roasted plantain) pack 4', 'Sweet, ripe plantain packed for roasting — grill or oven-bake and serve with groundnut and pepper sauce.', 'Fresh Produce', 599, 360, 15, 5, 20],
  ['AGB-001', 'Agbalumo (African star apple) 500g', 'Tart-sweet African star apple with a chewy skin and tangy flesh — a nostalgic seasonal treat eaten straight from the hand.', 'Fresh Produce', 699, 430, 12, 4, 16],
  ['WSK-001', 'Wara (soft cheese) 250g', 'Fresh, squeaky Nigerian wara cheese — grill it as a snack or drop it into soups and stews for a mild, milky richness.', 'Fresh Produce', 799, 500, 12, 4, 16],
  ['AKR-002', 'Akara (bean fritter) mix 500g', 'Peeled, ground bean flour blended with pepper and spice — whip with water and fry golden akara balls in minutes.', 'Dry Goods', 699, 430, 16, 5, 22],
  ['CHF-001', 'Chilli flakes 100g', 'Dried crushed chilli flakes for adding heat and flavour to your favourite meals.', 'Spices', 349, 200, 24, 8, 32],
  ['EWA-001', 'Ewa agoyin beans mix 500g', 'A dry beans-and-pepper mix for classic ewa agoyin — follow the instructions on the back of the pouch for soft beans in a smoky pepper sauce.', 'Dry Goods', 699, 450, 16, 5, 22],
  // ---- Final price list (October 2026) — buy items ----
  ['PON-002', 'Fresh Ponmo (small) 150g', 'Tender small-cut cow skin (ponmo) that turns silky and jelly-rich in stews and pepper soup — freshly packed, straight for the pot.', 'Meat & Fish', 799, 479, 14, 4, 18],
  ['PON-003', 'Fresh Ponmo (medium) 150g', 'Medium-cut ponmo with a bit more bite — freshly packed for ewedu, pepper soup and big weekend stews.', 'Meat & Fish', 999, 599, 12, 4, 16],
  ['SNL-002', 'Fresh Snail (small) 15 pcs', 'Fifteen cleaned small snails with that classic deep flavour — wash, season and simmer into pepper soup or egusi.', 'Meat & Fish', 1099, 659, 10, 3, 14],
  ['SNL-003', 'Fresh Snail (medium) 5 pcs', 'Five cleaned medium snails, meaty and tender — the hearty choice for pepper soup, egusi and native soups.', 'Meat & Fish', 899, 539, 12, 3, 15],
  ['SNL-004', 'Fresh Snail (large) 5 pcs', 'Five cleaned large snails with the fullest bite — portion in for a proper snail pepper soup.', 'Meat & Fish', 1099, 659, 10, 3, 14],
  ['CRY-003', 'Crayfish 30g', 'A small pouch of clean dried crayfish — the instant West African umami lift for soups, stews and rice.', 'Spices', 150, 90, 40, 10, 45],
  ['CRY-004', 'Crayfish 60g', 'A bigger pouch of dried crayfish — enough depth for a full pot of egusi, ewedu or jollof.', 'Spices', 250, 150, 36, 10, 40],
  ['CAT-003', 'Dried catfish 60g', 'A pouch of smoked dried catfish pieces with a rich, savoury depth - soak briefly, then drop into pepper soup or a pot of egusi.', 'Meat & Fish', 350, 210, 20, 6, 26],
  ['CAT-004', 'Dried catfish 120g (2 packs)', 'Two pouches of smoked dried catfish pieces - the full pot of pepper soup or egusi, ready to go.', 'Meat & Fish', 649, 389, 18, 6, 24],
  ['DPP-002', 'Chilli powder (dry pepper) 200g', 'Fiery ground dry pepper with a clean, lasting heat - the every-pot seasoning for stews, rice and marinades.', 'Spices', 399, 239, 30, 10, 40],
  ['YAM-004', 'Yam flour (Elubo) 500g', 'Finely milled yam (elubo) for silky amala — stir into hot water and serve with ewedu and gbegiri.', 'Dry Goods', 399, 239, 24, 8, 32],
  ['TUF-001', 'Tuwo/rice flour 500g', 'Fine rice flour for smooth tuwo — stir, knead and scoop it with your favourite soup.', 'Dry Goods', 349, 209, 26, 8, 34],
  ['TUF-002', 'Tuwo/rice flour 1kg', 'A kilo of fine rice flour for family-size tuwo — smooth, soft and ready in minutes.', 'Dry Goods', 599, 359, 20, 6, 28],
  ['IRU-002', 'Iru (locust beans) 30g', 'Fermented locust beans with the deep savoury punch every efo riro needs — a little goes a long way.', 'Spices', 149, 89, 30, 10, 40],
  ['IRU-003', 'Iru (locust beans) 60g', 'A bigger portion of fermented locust beans — the savoury anchor for efo riro, ewedu and stews.', 'Spices', 249, 149, 26, 8, 34],
  ['OGI-001', 'Ogiri (fermented seeds) 15g', 'The pungent traditional seasoning of fermented melon seeds — a pinch lifts ogbono, egusi and bitter leaf into the real thing.', 'Spices', 149, 89, 24, 8, 32],
  ['GND-002', 'Roasted groundnuts 200g', 'Slow-roasted groundnuts with a toasty crunch — snack straight from the bag or grind fresh for sauce.', 'Snacks', 199, 119, 30, 10, 40],
  ['TIG-003', 'Tigernut powder 100g', 'Finely milled tigernut for single-serve tiger nut milk, smoothies and pap — naturally sweet.', 'Dry Goods', 149, 89, 26, 8, 34],
  ['TIG-004', 'Tigernut powder 500g', 'A big pouch of finely milled tigernut — family jugs of tiger nut milk, baking and beyond.', 'Dry Goods', 549, 329, 16, 5, 24],
  ['ZOB-002', 'Zobo pouch 250ml', 'A 250ml pouch of zobo concentrate — dilute with water and ice for an instant ruby-red zobo.', 'Beverages', 99, 59, 36, 12, 48],
  ['CHI-002', 'Chinchin 100g', 'Pocket pouch of golden, crisp chin chin with a gentle sweetness — moreish by the handful.', 'Snacks', 149, 89, 40, 12, 48],
  ['CHI-003', 'Chinchin 200g', 'Golden, crisp chin chin to share — classic party-bowl crunch with a cold malt.', 'Snacks', 249, 149, 32, 10, 40],
  ['CHI-004', 'Chinchin 500g', 'The big 500g bag of golden chin chin — parties, road trips and everyone reaching for more.', 'Snacks', 499, 299, 24, 8, 32],
  ['PLC-002', 'Plantain chips 100g', 'Thin, crispy plantain slices with a whisper of salt — a pocket-size bag that never survives the trip.', 'Snacks', 189, 113, 40, 12, 48],
  ['PLC-003', 'Plantain chips 200g', 'Crispy salted plantain chips to share — savoury, snackable and gone way too fast.', 'Snacks', 349, 209, 32, 10, 40],
  ['PLC-004', 'Plantain chips 500g', 'The 500g family bag of crispy plantain chips — movie nights, picnics and properly big appetites.', 'Snacks', 549, 329, 24, 8, 32],
  ['EGM-002', 'Egusi mix 500g', 'The big bag of pre-spiced ground melon seeds — fry in palm oil, add stock and your egusi is halfway done.', 'Spices', 849, 509, 20, 6, 26],
  ['JOL-003', 'Jollof & stew base 250g', 'A concentrated tomato, pepper and spice base for party jollof and everyday stew — tastes slow-cooked.', 'Spices', 349, 209, 28, 8, 36],
  ['JOL-004', 'Jollof & stew base 500g', 'The 500g pot of jollof and stew base — enough flavour base for the whole weekend of cooking.', 'Spices', 749, 449, 22, 6, 28],
];
let added = 0;
let refreshed = 0;
const hasProduct = db.prepare('SELECT 1 FROM products WHERE sku = ?');
for (const [sku, name, description, category, price, cost, stock, level, quantity] of products) {
  const existingId = !!hasProduct.get(sku);
  const { changes } = ins.run(sku, name, description, cats[category], supplier.id, price, cost, stock, level, quantity);
  if (changes) (existingId ? refreshed++ : added++);
}


// Retired on 2026-10-29: superseded by the final buy price list (the new SKUs in
// the catalog above). Deactivate in place so they vanish from the shop, sitemap
// and checkout but stay in the admin for historical orders that reference them.
const RETIRED_SKUS = [
  'CRY-001', 'CRY-002', 'SNL-001', 'SNL-S20', 'SNL-M4', 'SNL-L4', 'CAT-001',
  'CAT-002', 'PON-001', 'IRU-001', 'DPP-001', 'YAM-001', 'GND-001', 'CHI-001',
  'PLC-001', 'ZOB-001', 'ZBK-001', 'STW-001',
];
const retireProduct = db.prepare('UPDATE products SET active = 0 WHERE sku = ? AND active = 1');
let retiredCount = 0;
for (const sku of RETIRED_SKUS) retiredCount += retireProduct.run(sku).changes;
if (retiredCount) console.log(retiredCount + ' retired SKUs deactivated.')

// Discovery metadata: origin/cuisine/diet tags, spice level and a wholesale
// price for restaurant accounts. Rebuilt on every seed so edits stay in sync.
const catNameById = {};
for (const row of db.prepare('SELECT id, name FROM categories').all()) catNameById[row.id] = row.name;
const updProductMeta = db.prepare('UPDATE products SET spice_level = ?, wholesale_price_cents = ? WHERE id = ?');
const delProductTags = db.prepare('DELETE FROM product_tags WHERE product_id = ?');
const insProductTag = db.prepare('INSERT OR IGNORE INTO product_tags (product_id, kind, value) VALUES (?,?,?)');
let taggedProducts = 0;
for (const p of db.prepare('SELECT id, sku, name, price_cents, cost_cents, category_id FROM products').all()) {
  const meta = classifyProduct({ sku: p.sku, name: p.name, category: catNameById[p.category_id] });
  updProductMeta.run(meta.spice, wholesalePriceCents(p.price_cents, p.cost_cents), p.id);
  delProductTags.run(p.id);
  if (meta.origin) insProductTag.run(p.id, 'origin', meta.origin);
  for (const value of meta.cuisines) insProductTag.run(p.id, 'cuisine', value);
  for (const value of meta.diet) insProductTag.run(p.id, 'diet', value);
  taggedProducts++;
}

// Phase 3 demo data: a primary store location, a welcome automation and a promo code.
const hasPrimary = db.prepare('SELECT 1 FROM locations WHERE is_primary = 1').get();
if (!hasPrimary) {
  db.prepare("INSERT INTO locations (name, address, city, postal_code, country, phone, active, is_primary) VALUES ('Bochum Store', 'Bochum', 'Bochum', '', 'DE', '+49 15567101378', 1, 1)").run();
} else {
  db.prepare("UPDATE locations SET name='Bochum Store', city='Bochum', address='Bochum', postal_code='', country='DE', phone='+49 15567101378' WHERE is_primary=1").run();
}
const welcomeTemplate = db.prepare(
  "INSERT INTO message_templates (name, channel, subject, body) VALUES ('Welcome', 'email', 'Welcome to Afro Mart, {{name}} 🧡', 'Hi {{name}},\\n\\nWelcome to Afro Mart — your neighborhood source for African groceries. Start shopping and get 10% off your first order with code WELCOME10.') ON CONFLICT(name) DO NOTHING").run();
if (welcomeTemplate.changes) {
  const templateId = db.prepare("SELECT id FROM message_templates WHERE name = 'Welcome'").get().id;
  db.prepare("INSERT INTO automations (name, event, template_id, channel, active) VALUES ('Welcome email', 'customer.registered', ?, 'email', 1)").run(templateId);
}
db.prepare("INSERT OR IGNORE INTO promo_codes (code, discount_type, value, min_total_cents, max_uses, first_order_only, active) VALUES ('WELCOME10', 'percent', 10, 2000, 500, 1, 1)").run();
// Upgrade an existing WELCOME10 (seeded before first-order-only support) so the
// welcome coupon stays reserved for a shopper's first order.
db.prepare("UPDATE promo_codes SET first_order_only = 1 WHERE code = 'WELCOME10'").run();

// Phase 3.5: curated meal packs & gift boxes backed by the catalog above.
const skuId = {};
for (const row of db.prepare('SELECT id, sku FROM products').all()) skuId[row.sku] = row.id;
const bundles = [
  {
    sku: 'EGS-BND', name: 'Egusi Soup Starter Kit', type: 'starter_pack', savings: 12, serves: 4,
    description: 'The heart of a proper Nigerian Sunday pot, already portioned so there is nothing left to hunt down. Two packs of ground melon seeds, unrefined red palm oil, stockfish, sun-dried crayfish, dehydrated spinach, ground pepper, beef seasoning and iru come together into a thick, golden, nutty soup. Just add meat or fish, simmer until the red oil floats on top, and serve with pounded yam, eba or fufu.',
    items: [['EGU-001', 2], ['PAL-001', 1], ['CRY-004', 1], ['DSP-001', 1], ['DPP-002', 1], ['ONG-001', 1], ['STK-001', 1], ['IRU-003', 1]],
  },
  {
    sku: 'JOL-BND', name: 'Jollof Rice Party Pack', type: 'party_pack', savings: 10, serves: 12,
    description: 'Everything you need to feed a crowd that will not stop talking about your jollof. A full bag of perfumed long-grain rice, two sachets of smoky jollof seasoning, a five-pepper blend, ground crayfish, beef cubes, red palm oil and roasted groundnuts for the peppered garnish. Cooks one giant party tray that comfortably serves twelve, with that unmistakable smoky bottom-pot flavour.',
    items: [['RIC-001', 1], ['JOL-001', 2], ['PPR-002', 1], ['CRY-004', 1], ['ONG-001', 2], ['PAL-001', 1], ['GND-002', 1]],
  },
  {
    sku: 'FUF-BND', name: 'Fufu & Ogbono Night In', type: 'meal_pack', savings: 12, serves: 4,
    description: 'A cozy draw-soup supper for four, made simple. Smooth cassava fufu, ground ogbono seeds that thicken into that glossy, stretchy draw, crayfish, hot dried pepper, red palm oil and stockfish for deep savour. Simmer the ogbono with stock and meat, drop in the greens of your choice, then scoop it all up with warm fufu. Comfort food that needs almost no shopping.',
    items: [['FUF-001', 2], ['OGB-001', 1], ['CRY-004', 1], ['DPP-002', 1], ['PAL-001', 1], ['STK-001', 1]],
  },
  {
    sku: 'YAM-BND', name: 'Pounded Yam & Vegetable Pot', type: 'meal_pack', savings: 12, serves: 4,
    description: 'Silky pounded yam with a fragrant oha, uziza and spinach vegetable pot built to feed four. Instant pounded-yam flour, dried oha leaves, uziza for a warm peppery finish, fermented iru, crayfish, stockfish and dehydrated spinach for body and colour. A quick, deeply savoury weekday dinner that still feels like a Sunday spread.',
    items: [['YAM-002', 2], ['OHA-001', 1], ['IRU-003', 1], ['CRY-004', 1], ['STK-001', 1], ['DSP-001', 1]],
  },
  {
    sku: 'BRK-BND', name: 'Afro Breakfast Box', type: 'gift_box', savings: 10, serves: 2,
    description: 'A cheerful little box for slow weekend mornings or a thoughtful gift. Rich non-alcoholic malt drink, a chilled Chapman for later, crisp golden chin chin, roasted groundnuts, sweet plantain chips and deep-red hibiscus petals for brewing a ruby jug of zobo. Pairs perfectly with a pot of hot tea and nowhere to be.',
    items: [['MAL-001', 1], ['CHP-001', 1], ['CHI-003', 1], ['GND-002', 1], ['PLC-003', 1], ['HIB-001', 1]],
  },
  {
    sku: 'BRA-BND', name: 'South African Braai & Wine Box', type: 'gift_box', savings: 10, serves: 4,
    description: 'A taste of the Garden Route delivered to your door. A bold Pinotage and a crisp Chenin Blanc to pour alongside, traditional biltong, smoky suya spice to rub over the grill and slow-roasted groundnuts to snack on while the coals catch. Fire up the braai, invite friends over and let the wines breathe.',
    items: [['PIN-001', 1], ['BIL-001', 1], ['SPC-001', 1], ['CHW-001', 1], ['GND-002', 1]],
  },
  {
    sku: 'GHA-BND', name: 'Ghana Banku & Pepper Box', type: 'meal_pack', savings: 12, serves: 6,
    description: 'A big Ghanaian feast for six, ready in one pot. Two packs of banku mix to steam into soft, tangy dumplings, ground pepper sauce staples, stockfish, dried prawns, crayfish and red palm oil. The prawns and stockfish build a deep, briny base, while the pepper sauce brings the heat you grind tilapia through. Serve banku, fish and a bowl of that pepper on the side.',
    items: [['BNK-001', 2], ['PSP-001', 1], ['STK-001', 1], ['CRY-004', 1], ['SHR-001', 1], ['PAL-001', 1]],
  },
  {
    sku: 'JWAR-BND', name: 'Jollof Rice Wars Box (NG vs GH)', type: 'taste_box', savings: 15, serves: 8,
    description: 'Settle the greatest debate in West African cooking, right at your own table. You get both perfumed and everyday long-grain rice, a Nigerian-style jollof seasoning, a Ghanaian-style dry jollof base, a five-pepper blend, dried prawns and ground nutmeg. Cook two pots side by side, taste them blind, and let your family cast the deciding vote. Serves eight and makes for a brilliant dinner-party game.',
    items: [['RIC-001', 1], ['RIC-002', 1], ['JOL-001', 1], ['JOL-002', 1], ['PPR-002', 1], ['SHR-001', 1], ['KNR-001', 1]],
  },
  {
    sku: 'VEG-BND', name: 'Vegan Soups & Stews Box', type: 'meal_pack', savings: 12, serves: 4,
    description: 'One hundred percent plant-based comfort food that loses nothing in flavour. Ground egusi, smooth palmnut cream, dried oha and uziza leaves, dehydrated spinach, unrefined palm oil, jollof seasoning and sweet plantain. Cook a rich banga-style palmnut soup, a meat-free egusi, or a bright vegetable pot — no animal products anywhere in the box. Serves four generously.',
    items: [['EGU-001', 1], ['PNC-001', 1], ['OHA-001', 1], ['UZI-001', 1], ['DSP-001', 1], ['PAL-001', 1], ['JOL-001', 1], ['PLN-001', 1]],
  },
  {
    sku: 'GLW-BND', name: 'Glow Up: Shea & Hair Care Kit', type: 'gift_box', savings: 10, serves: 1,
    description: 'Self-care straight from the village to your vanity. Raw unrefined shea butter, traditional black soap, rich hair butter, cold-pressed coconut oil and a deeply nourishing body butter. A complete five-step routine for skin and hair that smells warm and clean, and makes a lovely, useful gift for someone who deserves a little pampering.',
    items: [['SHE-001', 1], ['BSO-001', 1], ['HAI-001', 1], ['COC-001', 1], ['BTR-001', 1]],
  },
  {
    sku: 'STU-BND', name: 'Student Starter Bundle', type: 'starter_pack', savings: 12, serves: 2,
    description: 'A student-friendly first shop for a proper kitchen. White garri for quick eba and soaked garri, a big bag of rice, creamy honey beans, red palm oil, ground crayfish, jollof pepper mix, smoky jollof seasoning and beef cubes. Enough staples to cook real Nigerian food for two people for weeks on a tight budget — and everything keeps well in a shared kitchen.',
    items: [['GAR-001', 1], ['RIC-001', 1], ['BEA-001', 1], ['PAL-001', 1], ['CRY-004', 1], ['PPR-002', 1], ['JOL-001', 1], ['ONG-001', 1]],
  },
  {
    sku: 'SUR-BND', name: 'Student Survival Box', type: 'starter_pack', savings: 15, serves: 1,
    description: 'The first-year essentials, sized for one and priced for a student wallet. Sour Ijebu garri to soak cold with groundnuts and sugar, creamy honey beans, red palm oil, tinned tomato paste, ground pepper, beef cubes, crunchy kuli kuli and roasted groundnuts. Restock-proof and near impossible to get wrong: five-minute suppers on exam nights, or a slow pot of beans when you have time to spare.',
    items: [['IJE-001', 1], ['BEA-001', 1], ['PAL-001', 1], ['TMP-001', 1], ['PPR-002', 1], ['ONG-001', 1], ['KLK-002', 1], ['GND-002', 1]],
  },
  {
    sku: 'SEX-BND', name: 'Exam-Week Quick Meals Box', type: 'meal_pack', savings: 12, serves: 2,
    description: 'Study fuel for the weeks when you have no time and even less energy. Everyday long-grain rice, a Ghanaian-style jollof base, tomato paste, beef cubes, ground crayfish, ground pepper, roasted groundnuts and kuli kuli. Almost every dish here is one pot and under twenty minutes, with barely any washing-up — so you can eat properly between revision sessions instead of skipping dinner.',
    items: [['RIC-002', 1], ['JOL-002', 1], ['TMP-001', 1], ['ONG-001', 1], ['CRY-004', 1], ['PPR-002', 1], ['GND-002', 1], ['KLK-002', 1]],
  },
  {
    sku: 'SBS-BND', name: 'Student Beans & Budget Box', type: 'meal_pack', savings: 12, serves: 2,
    description: 'Cheap, filling and full of flavour — the box that gets you through to the end of the month. Honey beans and brown beans for big protein-rich pots, tomato paste, red palm oil, ground pepper, beef cubes, ground egusi and white garri. Cook a giant ewa riro or ewa agoyin on Sunday and eat well for pennies a plate all week.',
    items: [['BEA-001', 1], ['BRN-001', 1], ['TMP-001', 1], ['PAL-001', 1], ['PPR-002', 1], ['ONG-001', 1], ['EGU-001', 1], ['GAR-001', 1]],
  },
  {
    sku: 'SMN-BND', name: 'Meat-Free Student Month Box', type: 'meal_pack', savings: 12, serves: 2,
    description: 'Plant-based, pocket-friendly and surprisingly filling. Ground egusi, smooth palmnut cream, dried oha leaves, fragrant uziza, dehydrated spinach, red palm oil, smoky jollof seasoning and creamy honey beans. Swap meat for mushrooms if you like, or simply let the egusi and palmnut do the work — either way it still tastes like home, and a little stretches a long way. Serves two across several meals.',
    items: [['EGU-001', 1], ['PNC-001', 1], ['OHA-001', 1], ['UZI-001', 1], ['DSP-001', 1], ['PAL-001', 1], ['JOL-001', 1], ['BEA-001', 1]],
  },
  {
    sku: 'FAM-BND', name: 'Family Feast Pack', type: 'meal_pack', savings: 15, serves: 8,
    description: 'Feed the whole house without a second trip to the shops. Two big bags of rice for a party-size jollof or plain pot, creamy honey beans, frozen palm fruit for banga, two packs of ground egusi, crayfish, stockfish, a five-pepper blend, sweet plantain and beef seasoning. Built around eight generous servings, it is the pack for Sunday lunch, a family gathering or a week of serious meal prep.',
    items: [['RIC-001', 2], ['BEA-001', 1], ['PAL-002', 1], ['EGU-001', 2], ['CRY-004', 1], ['STK-001', 1], ['PPR-002', 1], ['PLN-001', 1], ['ONG-001', 2]],
  },
  {
    sku: 'XMS-BND', name: 'Christmas Celebration Hamper', type: 'gift_box', savings: 15, serves: 6,
    description: 'A festive hamper built for the season of plenty. Perfumed rice and two jollof seasonings for the Christmas pot, golden chin chin, malt drink, zobo concentrate to dilute into a ruby jug, roasted groundnuts and plantain chips for nibbling, frozen palm fruit and cubes of goat meat for a slow-braised stew. Arrives as a generous gift box and easily feeds six around the table.',
    items: [['RIC-001', 1], ['JOL-001', 2], ['CHI-003', 1], ['MAL-001', 1], ['ZOB-002', 1], ['GND-002', 1], ['PLC-003', 1], ['PAL-002', 1], ['GOA-001', 1]],
  },
  {
    sku: 'HMP-BND', name: 'Lagos Pantry Hamper', type: 'gift_box', savings: 12, serves: 4,
    description: 'A generous taste of Lagos in one box. Nutty unpolished ofada rice, deeply savoury iru, dried crayfish, red palm oil, ground hot pepper, ground egusi, crunchy kuli kuli and tangy zobo. Everything needed for a fiery ofada stew, a proper egusi, or a snack board with drinks — a lovely introduction for anyone new to the kitchen or a treat for someone who misses home.',
    items: [['OFR-001', 1], ['IRU-003', 1], ['CRY-004', 1], ['PAL-001', 1], ['DPP-002', 1], ['EGU-001', 1], ['KLK-002', 1], ['ZOB-002', 1]],
  },
  {
    sku: 'NYC-BND', name: 'New Yam Festival Box', type: 'taste_box', savings: 12, serves: 6,
    description: 'Celebrate the new yam harvest at your own table. Two packs of instant pounded-yam flour for a smooth, stretchy swallow, dried oha leaves, fragrant uziza, fermented iru, ground crayfish, stockfish and unrefined red palm oil. Assemble a fragrant oha and uziza vegetable pot and serve it hot with pounded yam — a festival plate that feeds six and tastes like a celebration.',
    items: [['PNY-001', 2], ['OHA-001', 1], ['UZI-001', 1], ['IRU-003', 1], ['CRY-004', 1], ['STK-001', 1], ['PAL-001', 1]],
  },
];
const upsertBundle = db.prepare(`INSERT INTO bundles (sku, name, description, bundle_type, savings_percent, serves, active) VALUES (?,?,?,?,?,?,1)
  ON CONFLICT(sku) DO UPDATE SET name = excluded.name, description = excluded.description, bundle_type = excluded.bundle_type, savings_percent = excluded.savings_percent, serves = excluded.serves, active = 1`);
const insertBundleItem = db.prepare('INSERT OR IGNORE INTO bundle_items (bundle_id, product_id, quantity) VALUES (?,?,?)');
const clearBundleItems = db.prepare('DELETE FROM bundle_items WHERE bundle_id = ?');
let addedBundles = 0;
let refreshedBundles = 0;
const skippedBundles = [];
for (const b of bundles) {
  const missing = b.items.filter(([sku]) => !skuId[sku]).map(([sku]) => sku);
  if (missing.length) {
    skippedBundles.push(`${b.sku} (missing: ${missing.join(', ')})`);
    continue;
  }
  const serves = b.serves ?? 0;
  const existing = db.prepare('SELECT id FROM bundles WHERE sku = ?').get(b.sku);
  if (existing) refreshedBundles++;
  else addedBundles++;
  upsertBundle.run(b.sku, b.name, b.description, b.type, b.savings, serves);
  const id = db.prepare('SELECT id FROM bundles WHERE sku = ?').get(b.sku).id;
  // Rebuild contents so the bundle always matches the seed definition (and its price).
  clearBundleItems.run(id);
  for (const [sku, qty] of b.items) insertBundleItem.run(id, skuId[sku], qty);
}

// Delivery zones: postal prefixes get an express fee; everything else is free
// unless DELIVERY_FEE_DEFAULT_CENTS is configured.
const insertArea = db.prepare("INSERT INTO delivery_areas (name, city, postal_prefixes, fee_cents, min_order_cents, active) VALUES (?,?,?,?,?,1)");
if (!db.prepare("SELECT 1 FROM delivery_areas WHERE name = 'Berlin zone'").get()) insertArea.run('Berlin zone', 'Berlin', '10', 490, 3000);
if (!db.prepare("SELECT 1 FROM delivery_areas WHERE name = 'Hamburg zone'").get()) insertArea.run('Hamburg zone', 'Hamburg', '20', 490, 3000);

// A ready-to-use WhatsApp template for order updates.
db.prepare(
  "INSERT INTO message_templates (name, channel, subject, body) VALUES ('WhatsApp order update', 'whatsapp', 'Order {{order_id}}', 'Hi {{name}}! Your Afro Mart order {{order_id}} (€{{total_cents}}) is now {{status}}. Got questions? Just reply here.') ON CONFLICT(name) DO NOTHING").run();

// Recipe-driven shopping: dishes linking straight to products and packs.
const bundleIdBySku = {};
for (const row of db.prepare('SELECT id, sku FROM bundles').all()) bundleIdBySku[row.sku] = row.id;
const recipes = [
  {
    title: 'Smoky Party Jollof', emoji: '🍛', prep_minutes: 60, servings: 6,
    description: 'The one-pot showstopper that wins every argument: smoky, spicy party rice cooked low and slow until the bottom catches just enough to perfume the whole pot. This is the jollof you make for birthdays, weddings and Sunday visitors, built on a rich pepper base and finished with a heap of fried plantain.',
    steps: '1. Blend the pepper mix with one onion and a little water until smooth, then reduce the purée in oil for 10 minutes until it darkens and the raw taste disappears.\n2. Stir in the jollof seasoning and crumbled beef cubes; cook 3 minutes so the spices bloom.\n3. Rinse the rice until the water runs clear and add it to the pot, turning gently to coat every grain in the base.\n4. Pour in hot stock or water to sit about 1cm above the rice, cover tightly and cook on the lowest heat for 25–30 minutes.\n5. Resist stirring. When the rice is tender, fluff with a fork, scatter over the ground crayfish and groundnuts, and let the bottom steam-catch for the signature smoky note.\n6. Rest 5 minutes, then serve with fried plantain and a spoon of pepper sauce on the side.',
    items: [['RIC-001', 1, 'long-grain aromatic rice'], ['JOL-001', 2, 'party jollof seasoning'], ['PPR-002', 1, 'five-pepper blend'], ['ONG-001', 2, 'beef cubes'], ['GND-002', 1, 'peppered garnish']],
  },
  {
    title: 'Rich Egusi Soup Night', emoji: '🥘', prep_minutes: 45, servings: 4,
    description: 'Everything egusi in one luxurious pot: ground melon seeds, red palm oil, stockfish and greens, simmered with melt-in-the-mouth goat meat and served with a smooth swallow. Deeply nutty, slightly bitter from the iru and glossy with red oil — the kind of soup that makes a Tuesday feel like a celebration.',
    steps: '1. Season the goat meat with half a crumbled stock cube and simmer in a little water until tender, keeping the stock.\n2. Mix the ground egusi with warm water into a loose paste and set aside.\n3. Heat the palm oil, add the egusi paste and fry gently for 8–10 minutes until it crumbles, smells nutty and releases oil.\n4. Pour in the reserved meat stock and a little more water, add crayfish, stockfish and iru, then simmer 15 minutes until the oil floats.\n5. Return the goat meat, stir in the soaked spinach (ugu), and simmer 5 minutes more; taste for salt.\n6. Serve piping hot with pounded yam, eba or fufu to scoop it all up.',
    items: [['@EGS-BND', 1, 'Egusi Soup Starter Kit'], ['GOA-001', 1, 'goat meat, cubed'], ['FUF-001', 1, 'for the swallow']],
  },
  {
    title: 'Fufu & Ogbono Draw Soup', emoji: '🍲', prep_minutes: 40, servings: 4,
    description: 'A glossy, comforting draw soup that clings to every mouthful of smooth fufu. The ground ogbono thickens the broth into that beloved stretchy texture, while crayfish, stockfish and dried pepper build a deep, savoury base. Simple, warming and endlessly satisfying.',
    steps: '1. Soak the stockfish in warm water for 15 minutes to soften and rinse away excess salt.\n2. Boil the stockfish and any meat in seasoned water until tender, reserving the broth.\n3. Mix the ground ogbono with a little warm water, then add it to the simmering broth in small spoonfuls, stirring to avoid lumps.\n4. Add the crayfish, dried pepper and palm oil; simmer 12–15 minutes until the soup thickens and draws.\n5. Adjust the consistency with hot water — it should coat the back of a spoon, not run off it.\n6. Serve with warm fufu or eba, molding a small ball, dipping and swallowing without chewing.',
    items: [['FUF-001', 2], ['OGB-001', 1], ['CRY-004', 1], ['DPP-002', 1], ['PAL-001', 1], ['STK-001', 1]],
  },
  {
    title: 'Pounded Yam & Oha Vegetable Pot', emoji: '🍠', prep_minutes: 35, servings: 4,
    description: 'Silky pounded yam paired with a fragrant oha, uziza and iru leaf pot. The oha leaves go in late to keep their peppery aroma, while the uziza and iru give the soup its warm, slightly bitter depth. A lighter, greener alternative to a heavy egusi, and quick enough for a weeknight.',
    steps: '1. Rinse the dried oha and uziza leaves and soak the stockfish until softened; keep the soaking water for extra flavour.\n2. Simmer the stockfish in seasoned water with the iru and crayfish for 15 minutes.\n3. Add the palm oil and a little of the soaking water, then simmer 5 minutes to marry the flavours.\n4. Stir in the uziza and most of the oha, cook 3 minutes, then add the remaining oha off the heat so it stays bright and fragrant.\n5. Prepare the pounded yam to a smooth, stretchy consistency while the soup rests.\n6. Serve the soup hot beside the pounded yam and eat with your hands, scooping and dipping.',
    items: [['YAM-002', 2], ['OHA-001', 1], ['UZI-001', 1], ['IRU-003', 1], ['CRY-004', 1], ['STK-001', 1]],
  },
  {
    title: 'Zobo Cooler & Market Snacks', emoji: '🧃', prep_minutes: 15, servings: 4,
    description: 'A chilled pitcher of deep-red zobo with roasted maize, crisp chin chin and sweet plantain chips for a relaxed afternoon. Bright, tangy and lightly spiced, it is the drink-and-nibbles spread you put out when friends drop by — no cooking required, just pouring and sharing.',
    steps: '1. Pour the zobo concentrate into a large jug and dilute with cold water to taste, about 1 part zobo to 3 parts water.\n2. Add sliced ginger or a squeeze of pineapple juice if you like, then chill for at least an hour.\n3. Roast the maize over a flame or under a hot grill until charred in spots, then cut into short lengths.\n4. Tip the chin chin and plantain chips into separate bowls and add the roasted groundnuts.\n5. Serve the zobo over plenty of ice with the snacks arranged around it for a help-yourself market-style spread.',
    items: [['ZOB-002', 2], ['RMC-001', 1], ['GND-002', 1], ['CHI-003', 1], ['PLC-003', 1]],
  },
  {
    title: 'Braai Evening', emoji: '🍷', prep_minutes: 25, servings: 4,
    description: 'Fire up the grill and let the evening take its time: a South African braai box, goat meat marinated in smoky suya spice and sweet plantain charred over the coals, all with a glass of Pinotage in hand. Smoke, spice and good company — the easiest way to turn dinner into an event.',
    steps: '1. Rub the goat meat all over with the suya spice and a little oil, then marinate for at least 20 minutes (overnight if you can).\n2. Light the coals and wait until they are grey and glowing — you want steady heat, not flames.\n3. Grill the goat meat 4–5 minutes per side, turning once, until nicely charred but still juicy.\n4. Slice the plantain thickly, brush with a little oil and grill until caramelised and tender.\n5. Arrange the biltong and groundnuts on a board for snacking while the meat rests.\n6. Serve everything hot with a glass of Pinotage or Chenin Blanc, and let everyone graze.',
    items: [['@BRA-BND', 1, 'Braai & Wine Box'], ['GOA-001', 1, 'marinate & grill'], ['PLN-001', 1, 'grilled plantain']],
  },
  {
    title: 'Five-Minute Student Garri Bowl', emoji: '🥣', prep_minutes: 5, servings: 1,
    description: 'The meal every Nigerian student knows by heart: cold, sour Ijebu garri soaked soft and crowned with roasted groundnuts, a spoon of sugar and a splash of cold milk or water. It is ready before the kettle boils, needs no hob and costs almost nothing — the ultimate study-night supper.',
    steps: '1. Spoon 3 heaped tablespoons of Ijebu garri into a bowl.\n2. Cover with cold water and leave to soak for 2–3 minutes until the grains soften and swell.\n3. Drain off a little of the water so it is pleasantly soupy, not watery.\n4. Sprinkle over a small handful of roasted groundnuts and a teaspoon of sugar, or kuli kuli crumbled for crunch.\n5. Add a splash of cold milk if you have it, stir once and eat straight away before it goes soggy.',
    items: [['IJE-001', 1, 'sour Ijebu garri'], ['GND-002', 1, 'roasted groundnuts'], ['KLK-002', 1, 'kuli kuli, crumbled']],
  },
  {
    title: 'One-Pot Student Jollof', emoji: '🍚', prep_minutes: 25, servings: 2,
    description: 'A scaled-down, no-fuss jollof for one or two: everyday long-grain rice simmered in a quick Ghanaian-style base with a handful of crayfish and a crumbled stock cube. One pot, one spoon and almost no washing-up — and the leftovers somehow taste even better the next day.',
    steps: '1. Rinse the rice under cold water until it runs clear, then drain well.\n2. In a single pot, whisk the jollof base and tomato paste with about a cup of water until smooth.\n3. Add the ground pepper, crayfish and crumbled stock cube, then stir in the rice.\n4. Pour in just enough water to sit about an inch above the rice, cover and simmer on the lowest heat for 18–20 minutes.\n5. Do not stir while it cooks. When the rice is tender, fluff gently with a fork and let the bottom catch a little for a smoky flavour.\n6. Serve straight from the pot with a sprinkle of roasted groundnuts on top.',
    items: [['RIC-002', 1, 'everyday long-grain rice'], ['JOL-002', 1, 'Ghanaian-style jollof base'], ['TMP-001', 1, 'tomato paste'], ['CRY-004', 1, 'ground crayfish'], ['PPR-002', 1, 'ground pepper'], ['ONG-001', 1, 'beef cube'], ['GND-002', 1, 'to garnish']],
  },
  {
    title: 'Budget Ewa Agoyin & Garri', emoji: '🫘', prep_minutes: 40, servings: 3,
    description: 'A big pot of soft, smoky beans under a punchy pepper sauce, eaten with cold garri. Cheap to make, heavy on protein and utterly comforting, it is the student meal-prep hero — cook once on Sunday and eat well for days. The secret is mashing the beans and letting the pepper sauce pool in the middle.',
    steps: '1. Rinse the beans well, then boil in plenty of water until very soft, about 30–35 minutes, topping up the water as needed (a pressure cooker cuts this in half).\n2. Meanwhile, blend the ground pepper with a little water and simmer with the tomato paste and half the palm oil until thick, dark and glossy, about 10 minutes.\n3. Add the crumbled stock cube to the pepper sauce and taste for salt.\n4. Mash the cooked beans roughly with the back of a spoon until creamy but still a little chunky.\n5. Heap the beans on a plate, spoon the pepper sauce over the top and drizzle with the remaining palm oil.\n6. Soak garri in cold water and serve on the side to scoop it all up.',
    items: [['BEA-001', 1, 'honey beans'], ['BRN-001', 1, 'brown beans'], ['TMP-001', 1, 'tomato paste'], ['PAL-001', 1, 'red palm oil'], ['PPR-002', 1, 'ground pepper'], ['ONG-001', 1, 'beef cube'], ['GAR-001', 1, 'garri, to serve']],
  },
  {
    title: 'Egusi for One', emoji: '🥘', prep_minutes: 30, servings: 2,
    description: 'A small-pot egusi that skips the market run: ground melon seeds simmered with palm oil, crayfish and spinach, thickened exactly the way you like it. Rich, nutty and ready in half an hour, it is proof that a proper soup does not need a crowd. Serve with garri, semo or pounded yam.',
    steps: '1. Mix the ground egusi with a little warm water into a loose paste so it will not clump.\n2. Heat the palm oil in a pot, add the egusi paste and fry gently, stirring, until it starts to crumble and smell nutty, about 5 minutes.\n3. Add the crayfish, a crumbled stock cube and one or two cups of water; simmer 10 minutes until the red oil floats on top.\n4. Stir in the soaked dehydrated spinach and simmer 3 more minutes.\n5. Taste for salt, adjust the thickness with a splash of hot water, and serve hot with your favourite swallow.',
    items: [['EGU-001', 1, 'ground egusi'], ['PAL-001', 1, 'red palm oil'], ['CRY-004', 1, 'ground crayfish'], ['DSP-001', 1, 'dehydrated spinach'], ['ONG-001', 1, 'beef cube']],
  },
];
const insertRecipe = db.prepare('INSERT INTO recipes (title, description, steps, prep_minutes, servings, emoji, active) VALUES (?,?,?,?,?,?,1)');
const updateRecipe = db.prepare('UPDATE recipes SET description = ?, steps = ?, prep_minutes = ?, servings = ?, emoji = ?, active = 1 WHERE id = ?');
const insertRecipeIngredient = db.prepare('INSERT INTO recipe_ingredients (recipe_id, product_id, bundle_id, quantity, note) VALUES (?,?,?,?,?)');
const clearRecipeIngredients = db.prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?');
let addedRecipes = 0;
let refreshedRecipes = 0;
const skippedRecipes = [];
for (const r of recipes) {
  const parts = [];
  let missing = false;
  for (const [key, qty, note] of r.items) {
    if (key.startsWith('@')) {
      const bid = bundleIdBySku[key.slice(1)];
      if (!bid) { missing = true; break; }
      parts.push({ product_id: null, bundle_id: bid, quantity: qty, note: note ?? null });
    } else {
      const pid = skuId[key];
      if (!pid) { missing = true; break; }
      parts.push({ product_id: pid, bundle_id: null, quantity: qty, note: note ?? null });
    }
  }
  if (missing) { skippedRecipes.push(r.title); continue; }
  const existing = db.prepare('SELECT id FROM recipes WHERE title = ?').get(r.title);
  let id;
  if (existing) {
    id = existing.id;
    updateRecipe.run(r.description, r.steps ?? '', r.prep_minutes, r.servings, r.emoji, id);
    clearRecipeIngredients.run(id);
    refreshedRecipes++;
  } else {
    id = Number(insertRecipe.run(r.title, r.description, r.steps ?? '', r.prep_minutes, r.servings, r.emoji).lastInsertRowid);
    addedRecipes++;
  }
  for (const part of parts) insertRecipeIngredient.run(id, part.product_id, part.bundle_id, part.quantity, part.note);
}

console.log(`Seeded ${added} new products (${products.length - added} existing SKUs); refreshed descriptions on ${refreshed} existing SKUs.`);
console.log(`Tagged ${taggedProducts} products with origin/cuisine/diet + spice level and wholesale prices.`);
console.log(`Bundles: ${addedBundles} created, ${refreshedBundles} refreshed.${skippedBundles.length ? ` Skipped ${skippedBundles.length} due to missing SKUs: ${skippedBundles.join('; ')}` : ''}`);
console.log(`Recipes: ${addedRecipes} created, ${refreshedRecipes} refreshed.${skippedRecipes.length ? ` Skipped ${skippedRecipes.length} (missing ingredients): ${skippedRecipes.join('; ')}` : ''}`);

// Record the catalog content version so the Netlify Function knows when a
// snapshot-backed database is behind the current seed content.
db.exec(`PRAGMA user_version = ${CATALOG_VERSION}`);

// Guarantee an administrator so the staff dashboard at /admin is usable on a
// fresh database. Overridable with ADMIN_EMAIL / ADMIN_PASSWORD.
const adminEmail = String(process.env.ADMIN_EMAIL || 'davidsmith24u@gmail.com').trim().toLowerCase();
const adminPassword = String(process.env.ADMIN_PASSWORD || 'Afro-b6135c923e43');
if (adminEmail && adminPassword && !db.prepare('SELECT 1 FROM users WHERE email = ?').get(adminEmail)) {
  db.prepare("INSERT INTO users (email, name, password_hash, role) VALUES (?, 'Administrator', ?, 'admin')")
    .run(adminEmail, hashPassword(adminPassword));
  console.log(`Admin user created: ${adminEmail}`);
} else if (db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) {
  console.log('Admin user already present.');
} else {
  console.log('No admin user configured.');
}
