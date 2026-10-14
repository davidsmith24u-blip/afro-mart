import { openDb } from './db.js';
import { classifyProduct, wholesalePriceCents } from './catalog-meta.js';

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
// Descriptions are refreshed on existing SKUs so catalog copy stays up to date.
const ins = db.prepare(`INSERT INTO products (sku, name, description, category_id, supplier_id, price_cents, cost_cents, stock, reorder_level, reorder_quantity)
  VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(sku) DO UPDATE SET description = excluded.description`);
const products = [
  ['GAR-001', 'Garri (white) 2kg', 'Premium white cassava granules — sprinkled into warm water and stirred, they become a smooth, fluffy eba ready to scoop up soup.', 'Dry Goods', 899, 600, 40, 10, 50],
  ['YAM-001', 'Yam flour (Elubo) 1kg', 'Finely milled yam flour for soft, stretchy pounded yam in minutes — pair with egusi, okra or a rich vegetable soup.', 'Dry Goods', 699, 450, 8, 10, 40],
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
  ['CRY-001', 'Ground crayfish 150g', 'Finely ground dried crayfish that melts into soups, stews and rice — an instant, unmistakable West African umami lift.', 'Spices', 699, 430, 20, 7, 25],
  ['PSP-001', 'Pepper soup spice 100g', 'Fragrant grains of selim, uziza and warming peppers — the shortcut to a properly mouth-tingling pepper soup.', 'Spices', 499, 300, 25, 8, 35],
  ['JOL-001', 'Jollof rice seasoning 100g', 'Smoky tomato, pepper and spice blend that gives rice that party-jollof colour and deep flavour every time.', 'Spices', 449, 260, 35, 10, 45],
  ['BER-001', 'Berbere spice blend 100g', 'A bold Ethiopian-inspired blend of bird’s-eye chilli and warm aromatics — the deep red soul of doro wat and stews.', 'Spices', 599, 350, 18, 6, 25],
  ['PAL-001', 'Red palm oil 1L', 'Deep-orange, unrefined palm oil straight from the mill — the rich base of egusi, banga and jollof. Gently warm it if it solidifies in cool weather.', 'Oils & Condiments', 1299, 850, 20, 7, 28],
  ['GNP-001', 'Roasted groundnut paste 500g', 'Creamy paste of slow-roasted groundnuts — silky for groundnut soup and sauces, brilliant on toast and in smoothies.', 'Oils & Condiments', 899, 580, 18, 6, 24],
  ['CHI-001', 'Chin chin 300g', 'Golden, crisp chin chin with a gentle sweetness — moreish by the handful, at parties, or with a cold malt.', 'Snacks', 699, 420, 30, 10, 40],
  ['PLC-001', 'Plantain chips 150g', 'Thin, crispy plantain slices with a whisper of salt — savoury, snackable and gone way too fast.', 'Snacks', 399, 220, 32, 10, 45],
  ['PUF-001', 'Puff puff mix 500g', 'Just add water and fry for soft, golden puff puff — roll in sugar while warm for the full celebration feel.', 'Snacks', 599, 360, 24, 8, 32],
  ['CAS-001', 'Frozen cassava leaves 500g', 'Prepped, chopped cassava leaves flash-frozen for saka-saka, pondu and stews — earthy, tender greens in minutes.', 'Frozen', 799, 500, 15, 5, 22],
  ['TAM-001', 'Tamarind drink concentrate 500ml', 'Sweet-tart tamarind concentrate for an ice-cold refreshing drink in minutes — or add its tang to sauces and marinades.', 'Beverages', 899, 560, 18, 6, 24],
  ['BAO-001', 'Baobab fruit powder 150g', 'Bright, citrusy baobab powder rich in vitamin C — blend into smoothies, porridge and yoghurt or whisk into a tangy drink.', 'Dry Goods', 999, 650, 12, 4, 18],
  ['SNL-001', 'Dried snail 100g', 'Smoky, chewy dried snails that perfume soups and stews with deep flavour — soak, then simmer into egusi or pepper soup.', 'Dry Goods', 1299, 850, 12, 4, 18],
  ['CAT-001', 'Dried catfish cuts 200g', 'Clean, smoked catfish pieces with a rich smoky flavour — the base of catfish pepper soup or a big pot of egusi.', 'Dry Goods', 1099, 720, 16, 5, 22],
  ['CAT-002', 'Whole dried catfish 1 piece', 'One whole smoked catfish, cured and ready for the pot — break it up to enrich soups, stews and jollof.', 'Dry Goods', 1499, 980, 10, 4, 16],
  ['PON-001', 'Dried ponmo 100g', 'Dried cow skin that softens to a silky, jelly-rich texture in stews and pepper soup — stock up, it disappears fast.', 'Dry Goods', 599, 360, 20, 7, 28],
  ['CRY-002', 'Dried crayfish 100g', 'Sun-dried, aromatic crayfish that adds depth to soups, rice and stews — a true West African pantry essential.', 'Dry Goods', 699, 430, 20, 7, 28],
  ['IRU-001', 'Iru (locust beans) 100g', 'Traditionally fermented locust beans whose deep, savoury punch anchors efo riro and countless stews — a little goes a long way.', 'Oils & Condiments', 499, 300, 18, 6, 24],
  ['KNR-001', 'Knorr chicken cubes 8-pack', 'The classic chicken-flavoured cubes for everyday cooking — the savoury base behind countless West African pots.', 'Oils & Condiments', 249, 140, 40, 12, 55],
  ['GND-001', 'Roasted groundnuts 250g', 'Slow-roasted groundnuts with a deep, toasty crunch — snack on them, or grind fresh for sauces and soups.', 'Snacks', 499, 290, 28, 9, 38],
  ['TIG-001', 'Tigernut powder 250g', 'Finely milled tigernut for creamy dairy-free milk, smoothies and pap — naturally sweet with a subtle nutty finish.', 'Dry Goods', 899, 570, 16, 5, 22],
  ['OFA-001', 'Dry Ayamashe / Ofada mix 100g', 'A punchy pepper-and-spice mix for Ayamashe and Ofada sauce — the fiery, smoky partner for ofada rice and assorted meat.', 'Spices', 599, 360, 20, 7, 28],
  ['JOL-002', 'Dry jollof base mix 100g', 'A concentrated tomato, pepper and spice base for quick jollof that still tastes slow-cooked and smoky.', 'Spices', 549, 330, 24, 8, 32],
  ['EGM-001', 'Dry egusi mix 200g', 'Ground melon seeds pre-blended with classic soup spices — fry in palm oil, add stock, and your egusi is halfway done.', 'Spices', 849, 530, 18, 6, 24],
  ['ZOB-001', 'Zobo hibiscus drink 500ml', 'Ready-to-drink zobo with a bright hibiscus-red colour, ginger warmth and fruity tang — refreshing straight from the fridge.', 'Beverages', 399, 230, 24, 8, 32],
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
  ['DPP-001', 'Ground dried pepper (hot) 100g', 'Fiery ground scotch bonnet with a fine, even heat — a spoonful instantly wakes up soups, rice and stews.', 'Spices', 399, 240, 20, 7, 28],
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
  ['TIG-002', 'Tiger nuts (aya) 250g', 'Whole, nutty tiger nuts for crunchy snacking or a creamy cup of kunun aya — blend, strain and sweeten.', 'Dry Goods', 699, 450, 14, 5, 18],
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
];
let added = 0;
let refreshed = 0;
const hasProduct = db.prepare('SELECT 1 FROM products WHERE sku = ?');
for (const [sku, name, description, category, price, cost, stock, level, quantity] of products) {
  const existingId = !!hasProduct.get(sku);
  const { changes } = ins.run(sku, name, description, cats[category], supplier.id, price, cost, stock, level, quantity);
  if (changes) (existingId ? refreshed++ : added++);
}

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
if (!db.prepare('SELECT 1 FROM locations WHERE is_primary = 1').get()) {
  db.prepare("INSERT INTO locations (name, address, city, postal_code, country, phone, active, is_primary) VALUES ('Berlin Store', 'Ohlauer Straße 12', 'Berlin', '10999', 'DE', '+49 30 12345678', 1, 1)").run();
}
const welcomeTemplate = db.prepare(
  "INSERT INTO message_templates (name, channel, subject, body) VALUES ('Welcome', 'email', 'Welcome to Afro Mart, {{name}} 🧡', 'Hi {{name}},\\n\\nWelcome to Afro Mart — your neighborhood source for African groceries. Start shopping and get 10% off your first order with code WELCOME10.') ON CONFLICT(name) DO NOTHING").run();
if (welcomeTemplate.changes) {
  const templateId = db.prepare("SELECT id FROM message_templates WHERE name = 'Welcome'").get().id;
  db.prepare("INSERT INTO automations (name, event, template_id, channel, active) VALUES ('Welcome email', 'customer.registered', ?, 'email', 1)").run(templateId);
}
db.prepare("INSERT OR IGNORE INTO promo_codes (code, discount_type, value, min_total_cents, max_uses, active) VALUES ('WELCOME10', 'percent', 10, 2000, 500, 1)").run();

// Phase 3.5: curated meal packs & gift boxes backed by the catalog above.
const skuId = {};
for (const row of db.prepare('SELECT id, sku FROM products').all()) skuId[row.sku] = row.id;
const bundles = [
  {
    sku: 'EGS-BND', name: 'Egusi Soup Starter Kit', type: 'starter_pack', savings: 12, serves: 4,
    description: 'Everything for a rich egusi soup — ground egusi, red palm oil, stockfish, crayfish, spinach and seasonings.',
    items: [['EGU-001', 2], ['PAL-001', 1], ['CRY-001', 1], ['DSP-001', 1], ['DPP-001', 1], ['ONG-001', 1], ['STK-001', 1], ['IRU-001', 1]],
  },
  {
    sku: 'JOL-BND', name: 'Jollof Rice Party Pack', type: 'party_pack', savings: 10, serves: 12,
    description: 'Stock up for the party: perfumed rice, jollof seasoning, pepper mix, crayfish, cubes, palm oil and groundnuts.',
    items: [['RIC-001', 1], ['JOL-001', 2], ['PPR-002', 1], ['CRY-001', 1], ['ONG-001', 2], ['PAL-001', 1], ['GND-001', 1]],
  },
  {
    sku: 'FUF-BND', name: 'Fufu & Ogbono Night In', type: 'meal_pack', savings: 12, serves: 4,
    description: 'A classic draw-soup night: cassava fufu, ogbono, crayfish, pepper, palm oil and stockfish.',
    items: [['FUF-001', 2], ['OGB-001', 1], ['CRY-001', 1], ['DPP-001', 1], ['PAL-001', 1], ['STK-001', 1]],
  },
  {
    sku: 'YAM-BND', name: 'Pounded Yam & Vegetable Pot', type: 'meal_pack', savings: 12, serves: 4,
    description: 'Pounded yam flour with dried oha leaves, iru, crayfish, stockfish and spinach for a hearty vegetable pot.',
    items: [['YAM-002', 2], ['OHA-001', 1], ['IRU-001', 1], ['CRY-001', 1], ['STK-001', 1], ['DSP-001', 1]],
  },
  {
    sku: 'BRK-BND', name: 'Afro Breakfast Box', type: 'gift_box', savings: 10, serves: 2,
    description: 'A cheerful morning box: malt drink, Chapman, chin chin, groundnuts, plantain chips and zobo tea.',
    items: [['MAL-001', 1], ['CHP-001', 1], ['CHI-001', 1], ['GND-001', 1], ['PLC-001', 1], ['HIB-001', 1]],
  },
  {
    sku: 'BRA-BND', name: 'South African Braai & Wine Box', type: 'gift_box', savings: 10, serves: 4,
    description: 'A taste of the garden route: Pinotage, Chenin Blanc, biltong, suya spice and roasted groundnuts.',
    items: [['PIN-001', 1], ['BIL-001', 1], ['SPC-001', 1], ['CHW-001', 1], ['GND-001', 1]],
  },
  {
    sku: 'GHA-BND', name: 'Ghana Banku & Pepper Box', type: 'meal_pack', savings: 12, serves: 6,
    description: 'Banku mix, ground pepper sauce staples, stockfish, dried prawns, crayfish and palm oil.',
    items: [['BNK-001', 2], ['PSP-001', 1], ['STK-001', 1], ['CRY-001', 1], ['SHR-001', 1], ['PAL-001', 1]],
  },
  {
    sku: 'JWAR-BND', name: 'Jollof Rice Wars Box (NG vs GH)', type: 'taste_box', savings: 15, serves: 8,
    description: 'Settle the debate at home: Nigerian-style jollof base, Ghanaian-style jollof base, two rices, pepper and dried prawns.',
    items: [['RIC-001', 1], ['RIC-002', 1], ['JOL-001', 1], ['JOL-002', 1], ['PPR-002', 1], ['SHR-001', 1], ['KNR-001', 1]],
  },
  {
    sku: 'VEG-BND', name: 'Vegan Soups & Stews Box', type: 'meal_pack', savings: 12, serves: 4,
    description: '100% plant-based comfort: egusi, palmnut cream, oha, uziza, dehydrated spinach, palm oil, jollof base and plantain.',
    items: [['EGU-001', 1], ['PNC-001', 1], ['OHA-001', 1], ['UZI-001', 1], ['DSP-001', 1], ['PAL-001', 1], ['JOL-001', 1], ['PLN-001', 1]],
  },
  {
    sku: 'GLW-BND', name: 'Glow Up: Shea & Hair Care Kit', type: 'gift_box', savings: 10, serves: 1,
    description: 'Self-care from the village to your vanity: raw shea, black soap, hair butter, coconut oil and body butter.',
    items: [['SHE-001', 1], ['BSO-001', 1], ['HAI-001', 1], ['COC-001', 1], ['BTR-001', 1]],
  },
];
const insertBundle = db.prepare('INSERT OR IGNORE INTO bundles (sku, name, description, bundle_type, savings_percent, serves, active) VALUES (?,?,?,?,?,?,1)');
const setBundleServes = db.prepare('UPDATE bundles SET serves = ? WHERE id = ?');
const insertBundleItem = db.prepare('INSERT OR IGNORE INTO bundle_items (bundle_id, product_id, quantity) VALUES (?,?,?)');
let addedBundles = 0;
const skippedBundles = [];
for (const b of bundles) {
  const missing = b.items.filter(([sku]) => !skuId[sku]).map(([sku]) => sku);
  if (missing.length) {
    skippedBundles.push(`${b.sku} (missing: ${missing.join(', ')})`);
    continue;
  }
  const serves = b.serves ?? 0;
  let id = db.prepare('SELECT id FROM bundles WHERE sku = ?').get(b.sku)?.id;
  if (!id) {
    id = Number(insertBundle.run(b.sku, b.name, b.description, b.type, b.savings, serves).lastInsertRowid);
    addedBundles++;
  } else {
    setBundleServes.run(serves, id);
  }
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
    description: 'The one-pot showstopper: smoky, spicy party rice cooked low and slow.',
    items: [['RIC-001', 1, 'long-grain aromatic rice'], ['JOL-001', 2, 'party jollof seasoning'], ['PPR-002', 1, 'five-pepper blend'], ['ONG-001', 2, 'beef cubes'], ['GND-001', 1, 'peppered garnish']],
  },
  {
    title: 'Rich Egusi Soup Night', emoji: '🥘', prep_minutes: 45, servings: 4,
    description: 'Everything egusi: seeds, palm oil, stockfish and greens — with melt-in-the-mouth goat meat and fufu.',
    items: [['@EGS-BND', 1, 'Egusi Soup Starter Kit'], ['GOA-001', 1, 'goat meat, cubed'], ['FUF-001', 1, 'for the swallow']],
  },
  {
    title: 'Fufu & Ogbono Draw Soup', emoji: '🍲', prep_minutes: 40, servings: 4,
    description: 'A glossy, comforting draw soup to scoop up with smooth fufu.',
    items: [['FUF-001', 2], ['OGB-001', 1], ['CRY-001', 1], ['DPP-001', 1], ['PAL-001', 1], ['STK-001', 1]],
  },
  {
    title: 'Pounded Yam & Oha Vegetable Pot', emoji: '🍠', prep_minutes: 35, servings: 4,
    description: 'Silky pounded yam with an oha, uziza and iru leaf pot.',
    items: [['YAM-002', 2], ['OHA-001', 1], ['UZI-001', 1], ['IRU-001', 1], ['CRY-001', 1], ['STK-001', 1]],
  },
  {
    title: 'Zobo Cooler & Market Snacks', emoji: '🧃', prep_minutes: 15, servings: 4,
    description: 'Chilled zobo with roasted maize, chin chin and plantain chips for a relaxed afternoon.',
    items: [['ZOB-001', 2], ['RMC-001', 1], ['GND-001', 1], ['CHI-001', 1], ['PLC-001', 1]],
  },
  {
    title: 'Braai Evening', emoji: '🍷', prep_minutes: 25, servings: 4,
    description: 'Fire up the grill: braai box, marinated goat and fresh plantain, with a glass of Pinotage.',
    items: [['@BRA-BND', 1, 'Braai & Wine Box'], ['GOA-001', 1, 'marinate & grill'], ['PLN-001', 1, 'grilled plantain']],
  },
];
const insertRecipe = db.prepare('INSERT INTO recipes (title, description, prep_minutes, servings, emoji, active) VALUES (?,?,?,?,?,1)');
const insertRecipeIngredient = db.prepare('INSERT INTO recipe_ingredients (recipe_id, product_id, bundle_id, quantity, note) VALUES (?,?,?,?,?)');
let addedRecipes = 0;
const skippedRecipes = [];
for (const r of recipes) {
  if (db.prepare('SELECT 1 FROM recipes WHERE title = ?').get(r.title)) continue;
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
  const id = Number(insertRecipe.run(r.title, r.description, r.prep_minutes, r.servings, r.emoji).lastInsertRowid);
  for (const part of parts) insertRecipeIngredient.run(id, part.product_id, part.bundle_id, part.quantity, part.note);
  addedRecipes++;
}

console.log(`Seeded ${added} new products (${products.length - added} existing SKUs); refreshed descriptions on ${refreshed} existing SKUs.`);
console.log(`Tagged ${taggedProducts} products with origin/cuisine/diet + spice level and wholesale prices.`);
console.log(`Bundles: ${addedBundles} created.${skippedBundles.length ? ` Skipped ${skippedBundles.length} due to missing SKUs: ${skippedBundles.join('; ')}` : ''}`);
console.log(`Recipes: ${addedRecipes} created.${skippedRecipes.length ? ` Skipped ${skippedRecipes.length} (missing ingredients): ${skippedRecipes.join('; ')}` : ''}`);
