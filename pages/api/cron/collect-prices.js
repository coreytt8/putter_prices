// pages/api/cron/collect-prices.js
export const runtime = 'nodejs';

import { getSql } from '../../../lib/db';
import { normalizeModelKey } from '../../../lib/normalize';

// -----------------------------
// Robust spec extractor (title/desc)
// -----------------------------
function extractSpecs(text = '') {
  const t = (text || '').toLowerCase();

  // length (34, 34", 34in, 34 in, 34-in)
  let lengthIn = null;
  const len =
    t.match(/(^|\s)(3[0-6])\s*(\"|in|inch|inches)\b/) ||
    t.match(/(^|\s)(3[0-6])(?=\s|$|[^0-9])/);
  if (len) {
    const n = Number(len[2]);
    if (Number.isFinite(n)) lengthIn = n;
  }

  // dexterity
  let dexterity = null;
  if (/\blh\b|\bleft[-\s]?hand(ed)?\b/.test(t)) dexterity = 'LEFT';
  else if (/\brh\b|\bright[-\s]?hand(ed)?\b/.test(t)) dexterity = 'RIGHT';

  // head type (heuristic)
  let headType = null;
  if (/\bmallet\b/.test(t)) headType = 'MALLET';
  else if (/\bblade\b/.test(t) || /\bnewport\b/.test(t) || /\banser\b/.test(t)) headType = 'BLADE';

  // hosel / neck style
  let hosel = null;
  if (/\b(plumber'?s|plumbers)\s*neck\b/.test(t)) hosel = "plumber's neck";
  else if (/\b(flow|flowing)\s*neck\b/.test(t)) hosel = 'flow neck';
  else if (/\bshort\s*slant\b/.test(t)) hosel = 'short slant';
  else if (/\bslant\b/.test(t)) hosel = 'slant';
  else if (/\bsingle\s*bend\b/.test(t)) hosel = 'single bend';
  else if (/\bdouble\s*bend\b/.test(t)) hosel = 'double bend';
  else if (/\bgoose\s*neck\b/.test(t)) hosel = 'gooseneck';

  // shaft brand/type (very light)
  let shaft = null;
  if (/\bstability\b|\bbgt\b/.test(t)) shaft = 'BGT Stability';
  else if (/\bla\s*golf\b/.test(t)) shaft = 'LA Golf';
  else if (/\bkbs\b/.test(t)) shaft = 'KBS';
  else if (/\bgraphite\b/.test(t)) shaft = 'Graphite';
  else if (/\bsteel\b/.test(t)) shaft = 'Steel';

  // grip (common putter grips)
  let grip = null;
  if (/\bsuper\s*stroke\b|\bsuperstroke\b/.test(t)) grip = 'SuperStroke';
  else if (/\bpistolini\b/.test(t)) grip = 'Pistolini';
  else if (/\bmatador\b/.test(t)) grip = 'Matador';
  else if (/\bgolf\s*pride\b/.test(t)) grip = 'Golf Pride';
  else if (/\blamkin\b/.test(t)) grip = 'Lamkin';

  // headcover present?
  const hasHeadcover =
    /\b(head\s*cover|headcover|w\/\s*hc|with\s*hc|includes?\s*hc)\b/.test(t) ||
    /\bwith\s*(matching|original)\s*cover\b/.test(t);

  return {
    // mapped to columns
    lengthIn,
    dexterity,
    headType,
    // extra JSON bucket
    extra: {
      hosel: hosel || null,
      shaft: shaft || null,
      grip: grip || null,
      hasHeadcover: hasHeadcover || false,
    },
  };
}

// ---------------------------------
// Query set (same spirit as before)
// ---------------------------------
const QUERIES = [
  'scotty cameron newport 2 putter',
  'scotty cameron newport putter',
  'scotty cameron phantom 5 putter',
  'scotty cameron phantom 7 putter',
  'scotty cameron phantom 9 putter',
  'scotty cameron phantom 11 putter',
  'scotty cameron squareback putter',
  'scotty cameron fastback putter',
  'scotty cameron futura putter',
  'scotty cameron button back putter',
  'scotty cameron tei3 putter',
  'scotty cameron studio select putter',
  'scotty cameron studio style putter',
  'scotty cameron special select putter',
  'scotty cameron champions choice putter',
  'scotty cameron jet set putter',
  'scotty cameron newport beach putter',
  'scotty cameron napa putter',
  'scotty cameron circle t putter',

  'odyssey two ball putter',
  'odyssey eleven putter',
  'odyssey seven putter',
  'odyssey ten putter',
  'odyssey versa putter',
  'odyssey jailbird putter',
  'odyssey white hot og putter',

  'toulon atlanta putter',
  'toulon memphis putter',
  'toulon san diego putter',
  'toulon las vegas putter',
  'toulon garage putter',

  'taylormade spider tour putter',
  'taylormade spider x putter',
  'taylormade spider gt putter',
  'taylormade spider gtx putter',
  'taylormade spider s putter',
  'taylormade spider tour z putter',

  'ping anser putter',
  'ping ds72 putter',
  'ping tyne putter',
];

// -----------------------------------------
// eBay Browse API search
// -----------------------------------------
const EBAY_ENDPOINT = 'https://api.ebay.com/buy/browse/v1/item_summary/search';

async function searchEbay({ q, limit = 50, offset = 0, token }) {
  const url = new URL(EBAY_ENDPOINT);
  url.searchParams.set('q', q);
  url.searchParams.set('limit', String(limit));
  if (offset) url.searchParams.set('offset', String(offset));

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`eBay ${res.status} ${res.statusText}`);
    err.details = text;
    throw err;
  }
  return res.json();
}

// -------------------------------------------------
// Map an eBay item to our DB-ready shape safely
// -------------------------------------------------
function mapEbayItemToDbRow(item) {
  const title = item?.title || '';
  const composite = title + ' ' + (item?.shortDescription || '');
  const specs = extractSpecs(composite);

  const price = Number(item?.price?.value);
  const shipCost = Number(item?.shippingOptions?.[0]?.shippingCost?.value);
  const safePrice = Number.isFinite(price) ? price : null;
  const safeShip = Number.isFinite(shipCost) ? shipCost : 0;
  const total = safePrice != null ? safePrice + safeShip : null;

  const sellerUser = item?.seller?.username || null;
  const sellerScore = Number.isFinite(Number(item?.seller?.feedbackScore))
    ? Number(item?.seller?.feedbackScore)
    : null;
  const sellerPct = Number.isFinite(Number(item?.seller?.feedbackPercentage))
    ? Number(item?.seller?.feedbackPercentage)
    : null;

  const model_key = normalizeModelKey(title);

  // brand (light)
  let brand = null;
  const t = title.toLowerCase();
  if (/\bscotty\b|\bcameron\b/.test(t)) brand = 'Scotty Cameron';
  else if (/\bodyssey\b/.test(t)) brand = 'Odyssey';
  else if (/\btaylor\s*made\b|\btaylormade\b/.test(t)) brand = 'TaylorMade';
  else if (/\bping\b/.test(t)) brand = 'Ping';
  else if (/\bbettinardi\b/.test(t)) brand = 'Bettinardi';
  else if (/\blab\b|\bl\.a\.b\b/.test(t)) brand = 'L.A.B.';

  const image = item?.image?.imageUrl || item?.thumbnailImages?.[0]?.imageUrl || null;
  const url = item?.itemWebUrl || null;
  const currency = item?.price?.currency || 'USD';
  const condition = item?.condition || null;
  const location_cc = item?.itemLocation?.country || null;

  return {
    item_id: item?.itemId,
    title,
    brand,
    model_key,
    head_type: specs.headType,
    dexterity: specs.dexterity,
    length_in: specs.lengthIn,
    currency,
    seller_user: sellerUser,
    seller_score: sellerScore,
    seller_pct: sellerPct,
    url,
    image_url: image,
    condition,
    location_cc,
    price: safePrice,
    shipping: Number.isFinite(shipCost) ? shipCost : null,
    total,
    extra_specs: {
      hosel: specs.extra.hosel,
      shaft: specs.extra.shaft,
      grip: specs.extra.grip,
      hasHeadcover: specs.extra.hasHeadcover,
    },
  };
}

// --------------------------------------
// Upsert into items, snapshot price
// --------------------------------------
async function upsertOne(sql, row) {
  if (!row.item_id) return false;

  await sql`
    INSERT INTO items (
      item_id, title, brand, model_key, head_type, dexterity, length_in,
      currency, seller_user, seller_score, seller_pct, url, image_url, extra_specs
    )
    VALUES (
      ${row.item_id}, ${row.title}, ${row.brand}, ${row.model_key}, ${row.head_type},
      ${row.dexterity}, ${row.length_in}, ${row.currency}, ${row.seller_user},
      ${row.seller_score}, ${row.seller_pct}, ${row.url}, ${row.image_url},
      ${sql.json(row.extra_specs || {})}
    )
    ON CONFLICT (item_id) DO UPDATE
    SET title = EXCLUDED.title,
        brand = COALESCE(EXCLUDED.brand, items.brand),
        model_key = COALESCE(EXCLUDED.model_key, items.model_key),
        head_type = COALESCE(EXCLUDED.head_type, items.head_type),
        dexterity = COALESCE(EXCLUDED.dexterity, items.dexterity),
        length_in = COALESCE(EXCLUDED.length_in, items.length_in),
        currency = COALESCE(EXCLUDED.currency, items.currency),
        seller_user = COALESCE(EXCLUDED.seller_user, items.seller_user),
        seller_score = COALESCE(EXCLUDED.seller_score, items.seller_score),
        seller_pct = COALESCE(EXCLUDED.seller_pct, items.seller_pct),
        url = COALESCE(EXCLUDED.url, items.url),
        image_url = COALESCE(EXCLUDED.image_url, items.image_url),
        extra_specs = COALESCE(items.extra_specs, '{}'::jsonb) || COALESCE(EXCLUDED.extra_specs, '{}'::jsonb)
  `;

  await sql`
    INSERT INTO item_prices (item_id, price, shipping, total, condition, location_cc)
    VALUES (${row.item_id}, ${row.price}, ${row.shipping}, ${row.total}, ${row.condition}, ${row.location_cc})
  `;

  return true;
}

// --------------------------------------
// Handler
// --------------------------------------
export default async function handler(req, res) {
  try {
    // Auth
    const key = req.query.key || req.headers['x-cron-secret'];
    if (!key || key !== process.env.CRON_SECRET) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    const token = process.env.EBAY_OAUTH_TOKEN;
    if (!token) return res.status(500).json({ ok: false, error: 'Missing EBAY_OAUTH_TOKEN' });

    const sql = getSql();

    // Optional manual single search
    const manualQ = (req.query.q || '').trim() || null;
    const list = manualQ ? [manualQ] : QUERIES;

    const results = [];
    let calls = 0;

    for (const q of list) {
      let found = 0;
      let inserted = 0;

      try {
        const data = await searchEbay({ q, limit: 50, offset: 0, token });
        calls += 1;

        const items = Array.isArray(data?.itemSummaries) ? data.itemSummaries : [];
        found += items.length;

        for (const it of items) {
          const row = mapEbayItemToDbRow(it);
          if (!row.item_id) continue;
          try {
            await upsertOne(sql, row);
            inserted += 1;
          } catch {
            // swallow one-off row errors to keep the job flowing
          }
        }
      } catch (e) {
        results.push({ q, found, inserted, error: e.message || 'fetch failed' });
        continue;
      }

      results.push({ q, found, inserted, error: null });
    }

    return res.status(200).json({ ok: true, calls, manualQ, results });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'server error' });
  }
}
