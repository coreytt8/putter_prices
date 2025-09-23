// pages/api/cron/collect-prices.js
export const runtime = 'nodejs';

import { getSql } from '../../../lib/db';
import { getEbayToken } from '../../../lib/ebayAuth';
import { normalizeModelKey } from '../../../lib/normalize';

// --- simple auth: header or query param must match CRON_SECRET ---
function isAuthorized(req) {
  const headerKey = req.headers['x-cron-secret'];
  const queryKey = req.query?.key;
  const secret = process.env.CRON_SECRET;
  return secret && (headerKey === secret || queryKey === secret);
}

// Expand/curate your seed queries here.
// Keep them specific enough to stay under eBay's caps, broad enough to find inventory.
const SEED_QUERIES = [
  // Scotty Cameron
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

  // Odyssey / Toulon
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

  // TaylorMade
  'taylormade spider tour putter',
  'taylormade spider x putter',
  'taylormade spider gt putter',
  'taylormade spider gtx putter',
  'taylormade spider s putter',
  'taylormade spider tour z putter',

  // Ping
  'ping anser putter',
  'ping ds72 putter',
  'ping tyne putter',

  // LAB / Bettinardi / Evnroll / etc.
  'lab golf mezz putter',
  'lab golf df putter',
  'lab golf link putter',
  'bettinardi queen b putter',
  'bettinardi studio stock putter',
  'bettinardi bb putter',
  'bettinardi inovai putter',
  'evnroll er2 putter',
  'evnroll er5 putter',
  'mizuno m craft putter',
  'wilson 8802 putter',
  'sik putter',
];

// Small helpers to read price/shipping safely
function readNumber(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}
function pickShipping(item) {
  const so = item?.shippingOptions?.[0];
  const v = so?.shippingCost?.value ?? so?.shippingCost?.convertedFromValue;
  return readNumber(v);
}
function normalizeSpecsFromTitle(title = '') {
  // very light extraction; you can enrich later
  const t = (title || '').toLowerCase();

  // length like 33/34/35/36"
  let length = null;
  const mLen = t.match(/(\d{2}(?:\.\d)?)\s*(?:in|inch|\"|\”)/i);
  if (mLen) length = readNumber(mLen[1]);

  // head type
  let headType = null;
  if (/\bmallet\b/i.test(title)) headType = 'MALLET';
  if (/\bblade\b/i.test(title)) headType = headType || 'BLADE';

  // dex
  let dexterity = null;
  if (/\b(left|lh)\b/i.test(title)) dexterity = 'LEFT';
  if (/\b(right|rh)\b/i.test(title)) dexterity = dexterity || 'RIGHT';

  // shaft (very rough)
  let shaft = null;
  if (/shafted/i.test(title)) shaft = 'shafted';
  if (/center\s*-?\s*shaft/i.test(title)) shaft = 'center-shaft';

  // headcover
  const hasHeadcover = /\b(hc|head\s*cover|headcover)\b/i.test(title);

  return { length, headType, dexterity, shaft, hasHeadcover };
}

async function fetchEbayPage(token, q, offset = 0, limit = 50) {
  const params = new URLSearchParams({
    q,
    limit: String(limit),
    offset: String(offset),
    sort: 'NEWLY_LISTED', // bring in fresh listings
    fieldgroups: 'EXTENDED',
  });

  const res = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`eBay ${res.status} ${res.statusText}${txt ? `: ${txt}` : ''}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  try {
    if (!isAuthorized(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const sql = await getSql();
    const token = await getEbayToken(); // Must be working; otherwise you’ll see a 401 in results.

    // Optional: run a single manual query with ?q=...
    const manualQ = (req.query?.q || '').trim() || null;
    const queries = manualQ ? [manualQ] : SEED_QUERIES;

    const out = [];
    let totalCalls = 0;

    for (const q of queries) {
      let inserted = 0;
      let found = 0;
      let error = null;

      try {
        // Pull up to 2 pages (100 items) per query. Tune as needed.
        const pages = [0, 50];
        let allItems = [];

        for (const offset of pages) {
          const data = await fetchEbayPage(token, q, offset, 50);
          totalCalls++;
          const items = Array.isArray(data?.itemSummaries) ? data.itemSummaries : [];
          allItems = allItems.concat(items);
          // stop early if < 50 returned
          if (items.length < 50) break;
        }

        found = allItems.length;

        // Begin transaction for this query’s batch
        await sql`BEGIN`;

        for (const it of allItems) {
          const itemId = it?.itemId || it?.item_id;
          const title = it?.title || null;
          const currency =
            it?.price?.currency || it?.price?.convertedFromCurrency || 'USD';
          const price =
            readNumber(it?.price?.value) ??
            readNumber(it?.price?.convertedFromValue);
          const shipping = pickShipping(it);
          const total = price != null && shipping != null ? price + shipping : price ?? null;
          const condition = it?.condition || null;
          const url = it?.itemWebUrl || null;
          const imageUrl = it?.image?.imageUrl || null;

          if (!itemId || price == null) {
            continue; // skip incomplete
          }

          const specs = normalizeSpecsFromTitle(title || '');
          const model_key = normalizeModelKey(title || '');

          // 1) upsert into items (unique catalog of listings)
          await sql`
            INSERT INTO items (item_id, title, brand, model_key, head_type, dexterity, length_in, currency,
                               seller_user, seller_score, seller_pct, url, image_url)
            VALUES (
              ${itemId},
              ${title},
              ${null},             -- brand (optional; can derive later)
              ${model_key},
              ${specs.headType},
              ${specs.dexterity},
              ${specs.length},
              ${currency},
              ${it?.seller?.username || null},
              ${it?.seller?.feedbackScore ?? null},
              ${readNumber(it?.seller?.feedbackPercentage) ?? null},
              ${url},
              ${imageUrl}
            )
            ON CONFLICT (item_id) DO UPDATE
              SET title = EXCLUDED.title,
                  model_key = EXCLUDED.model_key,
                  head_type = EXCLUDED.head_type,
                  dexterity = EXCLUDED.dexterity,
                  length_in = EXCLUDED.length_in,
                  currency = EXCLUDED.currency,
                  seller_user = EXCLUDED.seller_user,
                  seller_score = EXCLUDED.seller_score,
                  seller_pct = EXCLUDED.seller_pct,
                  url = EXCLUDED.url,
                  image_url = EXCLUDED.image_url
          `;

          // 2) append a price snapshot
          await sql`
            INSERT INTO item_prices (item_id, price, shipping, total, condition, location_cc)
            VALUES (
              ${itemId},
              ${price},
              ${shipping},
              ${total},
              ${condition},
              ${it?.itemLocation?.country || null}
            )
          `;

          inserted++;
        }

        await sql`COMMIT`;
      } catch (e) {
        try { await sql`ROLLBACK`; } catch {}
        error = e.message || String(e);
      }

      out.push({ q, found, inserted, error: error || null });
    }

    return res.status(200).json({ ok: true, calls: totalCalls, manualQ, results: out });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
