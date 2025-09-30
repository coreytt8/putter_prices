// pages/api/cron/collect-prices.js
export const runtime = 'nodejs';

import { getSql } from '../../../lib/db';
import { getEbayToken } from '../../../lib/ebayAuth';
import { normalizeModelKey } from '../../../lib/normalize';
import {
  detectCanonicalBrand,
  containsAccessoryToken,
  stripAccessoryTokens,
  HEAD_COVER_TOKEN_VARIANTS,
  HEAD_COVER_TEXT_RX,
} from '../../../lib/sanitizeModelKey';
import { PUTTER_SEED_QUERIES } from '../../../lib/data/putterCatalog';

// --- simple auth: header or query param must match CRON_SECRET ---
function isAuthorized(req) {
  const headerKey = req.headers['x-cron-secret'];
  const queryKey = req.query?.key;
  const secret = process.env.CRON_SECRET;
  return secret && (headerKey === secret || queryKey === secret);
}

// Seed queries are derived from the shared catalog so everything stays in sync.
const SEED_QUERIES = PUTTER_SEED_QUERIES;

// TODO: A follow-on cron can iterate over existing items.updated_at and call the
// Browse get_item endpoint to refresh stale listings so high-savings deals stay
// aligned with the live ask.

function shouldSkipAccessoryDominatedTitle(title = '') {
  if (!title) return false;

  const raw = String(title);
  let hasHeadcoverSignal = HEAD_COVER_TEXT_RX.test(raw);
  const hasPutterToken = /\bputter\b/i.test(raw);
  const tokens = raw.split(/\s+/).filter(Boolean);

  let accessoryCount = 0;
  let substantiveCount = 0;

  for (const token of tokens) {
    const normalizedToken = token.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (!normalizedToken || normalizedToken === 'putter') continue;
    if (HEAD_COVER_TOKEN_VARIANTS.has(normalizedToken)) {
      hasHeadcoverSignal = true;
      continue;
    }
    if (containsAccessoryToken(token)) {
      accessoryCount++;
    } else {
      substantiveCount++;
    }
  }

  const strippedTokens = stripAccessoryTokens(raw)
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/gi, '').toLowerCase())
    .filter(
      (token) =>
        token &&
        token !== 'putter' &&
        !HEAD_COVER_TOKEN_VARIANTS.has(token)
    );
  const remainingCount = strippedTokens.length;

  if (hasHeadcoverSignal) {
    return false;
  }

  if (!remainingCount) {
    return true;
  }

  if (!hasPutterToken && accessoryCount) {
    if (accessoryCount >= remainingCount || accessoryCount >= 2) {
      return true;
    }
  }

  if (!accessoryCount) {
    return false;
  }

  if (substantiveCount && accessoryCount < substantiveCount) {
    return false;
  }

  return accessoryCount >= remainingCount;
}

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

function extractListingSnapshot(raw) {
  const itemId = raw?.itemId || raw?.item_id;
  if (!itemId) return null;

  const title = raw?.title || null;
  if (title && shouldSkipAccessoryDominatedTitle(title)) {
    return null;
  }
  const currency = raw?.price?.currency || raw?.price?.convertedFromCurrency || 'USD';
  const price =
    readNumber(raw?.price?.value) ?? readNumber(raw?.price?.convertedFromValue);
  const shipping = pickShipping(raw);
  const total = price != null && shipping != null ? price + shipping : price ?? null;
  const condition = raw?.condition || raw?.conditionDisplayName || null;
  const url = raw?.itemWebUrl || raw?.itemAffiliateWebUrl || null;
  const imageUrl =
    raw?.image?.imageUrl ||
    raw?.image?.imageUrl ||
    (Array.isArray(raw?.additionalImages) ? raw.additionalImages[0]?.imageUrl : null) ||
    null;
  const sellerUser = raw?.seller?.username || raw?.seller?.userId || null;
  const sellerScore = readNumber(raw?.seller?.feedbackScore) ?? null;
  const sellerPct = readNumber(raw?.seller?.feedbackPercentage) ?? null;
  const locationCc = raw?.itemLocation?.country || null;

  const specs = normalizeSpecsFromTitle(title || '');
  const model_key = normalizeModelKey(title || '');
  const canonicalBrand = detectCanonicalBrand(title || '') || null;

  return {
    itemId,
    title,
    currency,
    price,
    shipping,
    total,
    condition,
    url,
    imageUrl,
    sellerUser,
    sellerScore,
    sellerPct,
    locationCc,
    specs,
    model_key,
    canonicalBrand,
  };
}

async function upsertItem(sql, snapshot) {
  const {
    itemId,
    title,
    canonicalBrand,
    model_key,
    specs,
    currency,
    sellerUser,
    sellerScore,
    sellerPct,
    url,
    imageUrl,
  } = snapshot;

  await sql`
    INSERT INTO items (item_id, title, brand, model_key, head_type, dexterity, length_in, currency,
                       seller_user, seller_score, seller_pct, url, image_url)
    VALUES (
      ${itemId},
      ${title},
      ${canonicalBrand},
      ${model_key},
      ${specs.headType},
      ${specs.dexterity},
      ${specs.length},
      ${currency},
      ${sellerUser},
      ${sellerScore},
      ${sellerPct},
      ${url},
      ${imageUrl}
    )
    ON CONFLICT (item_id) DO UPDATE
      SET title = EXCLUDED.title,
          brand = COALESCE(EXCLUDED.brand, items.brand),
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
          updated_at = NOW()
  `;
}

async function upsertPriceSnapshot(sql, snapshot, { existing, forceTouchObserved = false } = {}) {
  const { itemId, price, shipping, total, condition, locationCc } = snapshot;

  if (price == null) {
    return { changed: false, skipped: true };
  }

  if (!existing) {
    await sql`
      INSERT INTO item_prices (item_id, price, shipping, total, condition, location_cc)
      VALUES (
        ${itemId},
        ${price},
        ${shipping},
        ${total},
        ${condition},
        ${locationCc}
      )
      ON CONFLICT (item_id)
      DO UPDATE
        SET price = EXCLUDED.price,
            shipping = EXCLUDED.shipping,
            total = EXCLUDED.total,
            condition = EXCLUDED.condition,
            location_cc = EXCLUDED.location_cc,
            observed_at = NOW()
    `;
    return { changed: true, skipped: false };
  }

  const prevPrice = existing.price != null ? readNumber(existing.price) : null;
  const prevShipping = existing.shipping != null ? readNumber(existing.shipping) : null;
  const prevTotal = existing.total != null ? readNumber(existing.total) : null;
  const prevCondition = existing.condition || null;
  const prevLocation = existing.location_cc || null;

  const changed =
    prevPrice !== price ||
    prevShipping !== shipping ||
    prevTotal !== total ||
    prevCondition !== condition ||
    prevLocation !== locationCc;

  if (changed) {
    await sql`
      UPDATE item_prices
         SET price = ${price},
             shipping = ${shipping},
             total = ${total},
             condition = ${condition},
             location_cc = ${locationCc},
             observed_at = NOW()
       WHERE item_id = ${itemId}
    `;
  } else if (forceTouchObserved) {
    await sql`
      UPDATE item_prices
         SET observed_at = NOW()
       WHERE item_id = ${itemId}
    `;
  }

  return { changed, skipped: false };
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

async function fetchEbayPage(token, q, { offset = 0, limit = 50, includeRefreshSort = true } = {}) {
  const sorts = ['NEWLY_LISTED'];
  if (includeRefreshSort) sorts.push('BEST_MATCH');

  const seen = new Set();
  const merged = [];
  let primaryCount = 0;
  let callCount = 0;

  for (let i = 0; i < sorts.length; i++) {
    const sort = sorts[i];
    const params = new URLSearchParams({
      q,
      limit: String(limit),
      offset: String(offset),
      sort,
      fieldgroups: 'EXTENDED',
    });

    const res = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
    });
    callCount++;

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`eBay ${res.status} ${res.statusText}${txt ? `: ${txt}` : ''}`);
    }

    const data = await res.json();
    const items = Array.isArray(data?.itemSummaries) ? data.itemSummaries : [];
    if (i === 0) {
      primaryCount = items.length;
    }

    for (const item of items) {
      const itemId = item?.itemId || item?.item_id;
      if (!itemId || seen.has(itemId)) continue;
      seen.add(itemId);
      merged.push(item);
    }
  }

  return { items: merged, callCount, primaryCount };
}

async function fetchEbayItem(token, itemId) {
  const res = await fetch(`https://api.ebay.com/buy/browse/v1/item/${itemId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    },
  });

  if (res.status === 404) {
    return { item: null, callCount: 1 };
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`eBay ${res.status} ${res.statusText}${txt ? `: ${txt}` : ''}`);
  }

  const data = await res.json();
  return { item: data, callCount: 1 };
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
    const refreshMode = req.query?.refresh === '1' || req.query?.mode === 'refresh';
    const queries = manualQ ? [manualQ] : SEED_QUERIES;

    const out = [];
    let totalCalls = 0;

    if (refreshMode) {
      const limitParam = Number.parseInt(req.query?.limit, 10);
      const refreshLimit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50;

      const rows = await sql`
        SELECT i.item_id,
               i.title,
               i.brand,
               i.model_key,
               i.head_type,
               i.dexterity,
               i.length_in,
               i.currency,
               i.seller_user,
               i.seller_score,
               i.seller_pct,
               i.url,
               i.image_url,
               i.updated_at,
               ip.price,
               ip.shipping,
               ip.total,
               ip.condition,
               ip.location_cc,
               ip.observed_at
          FROM items i
     LEFT JOIN item_prices ip ON ip.item_id = i.item_id
         ORDER BY COALESCE(ip.observed_at, i.updated_at) ASC NULLS FIRST
         LIMIT ${refreshLimit}
      `;

      const refreshResults = [];
      let refreshed = 0;
      let changed = 0;
      let missing = 0;

      for (const row of rows) {
        const itemId = row.item_id;
        let error = null;
        let status = 'ok';
        let priceChanged = false;

        try {
          const { item, callCount } = await fetchEbayItem(token, itemId);
          totalCalls += callCount;

          if (!item) {
            status = 'missing';
            missing++;
          } else {
            const snapshot = extractListingSnapshot(item);

            if (!snapshot || snapshot.price == null) {
              status = 'skipped';
            } else {
              await upsertItem(sql, snapshot);
              const existingPrice = row.observed_at
                ? {
                    price: row.price,
                    shipping: row.shipping,
                    total: row.total,
                    condition: row.condition,
                    location_cc: row.location_cc,
                  }
                : null;
              const { changed: hasChanged } = await upsertPriceSnapshot(sql, snapshot, {
                existing: existingPrice,
                forceTouchObserved: true,
              });

              if (hasChanged) {
                priceChanged = true;
                changed++;
              }

              refreshed++;
            }
          }
        } catch (e) {
          error = e.message || String(e);
          status = 'error';
        }

        refreshResults.push({ itemId, status, changed: priceChanged, error });
      }

      return res.status(200).json({
        ok: true,
        calls: totalCalls,
        manualQ,
        refresh: {
          limit: refreshLimit,
          refreshed,
          changed,
          missing,
          results: refreshResults,
        },
      });
    }

    for (const q of queries) {
      let inserted = 0;
      let found = 0;
      let error = null;

      try {
        // Pull up to 2 pages (100 items) per query. Tune as needed.
        const pages = [0, 50];
        let allItems = [];

        const seenIds = new Set();

        for (const offset of pages) {
          const { items, callCount, primaryCount } = await fetchEbayPage(token, q, {
            offset,
            limit: 50,
            includeRefreshSort: offset === 0,
          });
          totalCalls += callCount;

          for (const item of items) {
            const itemId = item?.itemId || item?.item_id;
            if (!itemId || seenIds.has(itemId)) continue;
            seenIds.add(itemId);
            allItems.push(item);
          }

          // stop early if the primary sort returns less than the requested page size
          if (primaryCount < 50) break;
        }

        found = allItems.length;

        // Begin transaction for this query’s batch
        await sql`BEGIN`;

        for (const it of allItems) {
          const snapshot = extractListingSnapshot(it);

          if (!snapshot || snapshot.price == null) {
            continue; // skip incomplete
          }

          await upsertItem(sql, snapshot);
          await upsertPriceSnapshot(sql, snapshot);

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
