// pages/api/cron/collect-prices.js
export const runtime = 'nodejs';

import { getSql } from '../../../lib/db';
import { getEbayToken } from '../../../lib/ebayAuth';
import {
  normalizeModelKey,
  detectDexterity,
  detectHeadType,
  extractLengthInches,
  coalesceSpecsFrom,
} from '../../../lib/specs-parse';

// ---- SEARCH SET ----
const QUERIES = [
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

  // TaylorMade Spider
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

  // LAB / Bettinardi / Evnroll / Mizuno / Wilson / SIK
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

// ---- eBay API helpers ----
async function searchEbay({ token, q, limit = 50, offset = 0 }) {
  const params = new URLSearchParams({
    q,
    limit: String(limit),
    offset: String(offset),
    sort: 'NEWLY_LISTED',
    fieldgroups: 'EXTENDED',
  });

  const res = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      'Accept': 'application/json',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    const msg = `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  const json = await res.json();
  return json?.itemSummaries ?? [];
}

// Optional: fetch more detail including shortDescription if available
async function fetchItemDetail({ token, itemId }) {
  try {
    const res = await fetch(`https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(itemId)}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Accept': 'application/json',
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const j = await res.json();
    // Different accounts/scopes expose different fields; shortDescription may be present
    const short = j?.shortDescription || j?.description || null;
    return { shortDescription: typeof short === 'string' ? short : null };
  } catch {
    return null;
  }
}

// ---- DB helpers ----
async function upsertItem(trx, item) {
  await trx`
    INSERT INTO items (item_id, title, brand, model_key, head_type, dexterity, length_in, currency, seller_user, seller_score, seller_pct, url, image_url, specs, desc_text)
    VALUES (
      ${item.item_id}, ${item.title}, ${item.brand}, ${item.model_key}, ${item.head_type},
      ${item.dexterity}, ${item.length_in}, ${item.currency}, ${item.seller_user},
      ${item.seller_score}, ${item.seller_pct}, ${item.url}, ${item.image_url},
      ${trx.json(item.specs || {})}, ${item.desc_text || null}
    )
    ON CONFLICT (item_id) DO UPDATE
    SET title = EXCLUDED.title,
        brand = EXCLUDED.brand,
        model_key = EXCLUDED.model_key,
        head_type = EXCLUDED.head_type,
        dexterity = EXCLUDED.dexterity,
        length_in = EXCLUDED.length_in,
        currency = EXCLUDED.currency,
        seller_user = EXCLUDED.seller_user,
        seller_score = EXCLUDED.seller_score,
        seller_pct = EXCLUDED.seller_pct,
        url = EXCLUDED.url,
        image_url = EXCLUDED.image_url,
        specs = EXCLUDED.specs,
        desc_text = EXCLUDED.desc_text
  `;
}

async function insertPriceSnapshot(trx, snap) {
  await trx`
    INSERT INTO item_prices (item_id, price, shipping, total, condition, location_cc)
    VALUES (${snap.item_id}, ${snap.price}, ${snap.shipping}, ${snap.total}, ${snap.condition}, ${snap.location_cc})
  `;
}

// ---- MAIN ----
export default async function handler(req, res) {
  try {
    // simple auth
    const secret = process.env.CRON_SECRET;
    const provided = req.query.key || req.headers['x-cron-secret'];
    if (secret && provided !== secret) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const manualQ = req.query.q ? String(req.query.q) : null;
    const sql = getSql();
    const token = await getEbayToken();

    const queries = manualQ ? [manualQ] : QUERIES;
    const results = [];
    let calls = 0;

    for (const q of queries) {
      try {
        const items = await searchEbay({ token, q, limit: 50, offset: 0 });
        calls += 1;

        let inserted = 0;
        await sql.begin(async (trx) => {
          for (const s of items) {
            const item_id = s?.itemId || s?.itemId?.toString();
            if (!item_id) continue;

            const title = s?.title || '';
            const url = s?.itemWebUrl || s?.itemAffiliateWebUrl || '';
            const image_url =
              s?.image?.imageUrl ||
              s?.thumbnailImages?.[0]?.imageUrl ||
              s?.image?.imageHref ||
              null;

            // seller, condition, pricing, location
            const seller_user = s?.seller?.username || null;
            const seller_score = Number(s?.seller?.feedbackScore) || null;
            const seller_pct = Number(s?.seller?.feedbackPercentage) || null;
            const condition = s?.condition || null;
            const currency = s?.price?.currency || 'USD';
            const price = Number(s?.price?.value) || null;

            let shipping = null;
            const shipCost = s?.shippingOptions?.[0]?.shippingCost || s?.shippingOptions?.[0]?.minEstimatedDeliveryCost;
            if (shipCost?.value) shipping = Number(shipCost.value);

            const total =
              price != null && Number.isFinite(price)
                ? (shipping != null && Number.isFinite(shipping) ? price + shipping : price)
                : null;

            const location_cc = s?.itemLocation?.country || null;

            // brand guess (coarse)
            let brand = null;
            const tl = title.toLowerCase();
            if (/\bscotty\b|\bcameron\b/.test(tl)) brand = 'Scotty Cameron';
            else if (/\btaylor\s*made\b|\btaylormade\b/.test(tl)) brand = 'TaylorMade';
            else if (/\bping\b/.test(tl)) brand = 'Ping';
            else if (/\bodyssey\b/.test(tl)) brand = 'Odyssey';
            else if (/\btoulon\b/.test(tl)) brand = 'Toulon';
            else if (/\blab\b|\bl\.a\.b\.\b/.test(tl)) brand = 'L.A.B.';
            else if (/\bbettinardi\b/.test(tl)) brand = 'Bettinardi';
            else if (/\bevnroll\b/.test(tl)) brand = 'Evnroll';
            else if (/\bmizuno\b/.test(tl)) brand = 'Mizuno';
            else if (/\bwilson\b/.test(tl)) brand = 'Wilson';
            else if (/\bsik\b/.test(tl)) brand = 'SIK';

            // derive model_key + basic columns
            const model_key = normalizeModelKey(title);
            const dexterity = detectDexterity(title);
            const head_type = detectHeadType(title);
            const length_in = extractLengthInches(title);

            // OPTIONAL: fetch detail to get shortDescription (if accessible)
            let desc_text = null;
            const detail = await fetchItemDetail({ token, itemId: item_id });
            if (detail?.shortDescription) {
              desc_text = detail.shortDescription;
            }

            // merged specs (title + desc), but DO NOT overwrite known columns; they’re duplicated for filtering
            const mergedSpecs = coalesceSpecsFrom(title, desc_text);

            await upsertItem(trx, {
              item_id,
              title,
              brand,
              model_key,
              head_type,
              dexterity,
              length_in,
              currency,
              seller_user,
              seller_score,
              seller_pct,
              url,
              image_url,
              specs: mergedSpecs,
              desc_text,
            });

            await insertPriceSnapshot(trx, {
              item_id,
              price,
              shipping,
              total,
              condition,
              location_cc,
            });

            inserted++;
          }
        });

        results.push({ q, found: items.length, inserted, error: null });
      } catch (err) {
        results.push({ q, found: 0, inserted: 0, error: String(err?.message || err) });
      }
    }

    return res.status(200).json({ ok: true, calls, manualQ, results });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
