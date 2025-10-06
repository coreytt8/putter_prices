// pages/api/cron/collect-prices.js
export const runtime = 'nodejs';

import { getSql } from '../../../lib/db.js';
import { getEbayToken } from '../../../lib/ebayAuth.js';
import { normalizeModelKey } from '../../../lib/normalize.js';
import {
  detectCanonicalBrand,
  containsAccessoryToken,
  stripAccessoryTokens,
  HEAD_COVER_TOKEN_VARIANTS,
  HEAD_COVER_TEXT_RX,
} from '../../../lib/sanitizeModelKey.js';
import { PUTTER_SEED_QUERIES } from '../../../lib/data/putterCatalog.js';

// --- simple auth: header or query param must match CRON_SECRET ---
function isAuthorized(req) {
  const headerKey = req.headers['x-cron-secret'];
  const queryKey = req.query?.key;
  const secret = process.env.CRON_SECRET;
  return secret && (headerKey === secret || queryKey === secret);
}

// Seed queries are derived from the shared catalog so everything stays in sync.
const SEED_QUERIES = PUTTER_SEED_QUERIES;

// Heuristic: skip accessory-dominated titles (weights/kits/etc.) but
// don't auto-skip if we detect a headcover signal (we sell putters w/ covers).
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
  if (!remainingCount) return true;

  if (!hasPutterToken && accessoryCount) {
    if (accessoryCount >= remainingCount || accessoryCount >= 2) {
      return true;
    }
  }
  if (!accessoryCount) return false;
  if (substantiveCount && accessoryCount < substantiveCount) return false;

  return accessoryCount >= remainingCount;
}

// ---- small helpers ----
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
  const t = (title || '').toLowerCase();

  // length like 33/34/35/36"
  let length = null;
  const mLen = t.match(/(\d{2}(?:\.\d)?)\s*(?:in|inch|\"|\”)/i);
  if (mLen) length = readNumber(mLen[1]);

  // head type
  let headType = null;
  if (/\bmallet\b/i.test(title)) headType = 'MALLET';
  if (/\bblade\b/i.test(title)) headType = headType || 'BLADE';

  // dexterity
  let dexterity = null;
  if (/\b(left|lh)\b/i.test(title)) dexterity = 'LEFT';
  if (/\b(right|rh)\b/i.test(title)) dexterity = dexterity || 'RIGHT';

  // shaft style (light)
  let shaft = null;
  if (/center\s*-?\s*shaft/i.test(title)) shaft = 'center-shaft';
  // headcover mention (for future enrichment)
  const hasHeadcover = /\b(hc|head\s*cover|headcover)\b/i.test(title);

  return { length, headType, dexterity, shaft, hasHeadcover };
}

// Convert eBay item to our snapshot shape
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
    (Array.isArray(raw?.additionalImages) ? raw.additionalImages[0]?.imageUrl : null) ||
    null;
  const sellerUser = raw?.seller?.username || raw?.seller?.userId || null;
  const sellerScore = readNumber(raw?.seller?.feedbackScore) ?? null;
  const sellerPct = readNumber(raw?.seller?.feedbackPercentage) ?? null;
  const locationCc = raw?.itemLocation?.country || null;

  const specs = normalizeSpecsFromTitle(title || '');
  const model_key = normalizeModelKey(title || '') || null;
  const canonicalBrand = detectCanonicalBrand(title || '') || null;

  return {
    // core
    itemId,
    title,
    url,
    imageUrl,
    // economics
    currency,
    price,
    shipping,
    total,
    condition,
    locationCc,
    // seller
    sellerUser,
    sellerScore,
    sellerPct,
    // derived
    canonicalBrand,
    model_key,
    specs,
  };
}

// ---- DB upserts ----

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

  const headType = specs?.headType ?? null;
  const dexterity = specs?.dexterity ?? null;
  const lengthIn = specs?.length ?? null;

  await sql/* sql */`
    INSERT INTO items (
      item_id, url, title, image_url, brand, model_key,
      head_type, dexterity, length_in,
      currency, retailer,
      seller_user, seller_score, seller_pct,
      updated_at
    )
    VALUES (
      ${itemId}, ${url}, ${title}, ${imageUrl}, ${canonicalBrand}, ${model_key},
      ${headType}, ${dexterity}, ${lengthIn},
      ${currency}, 'eBay',
      ${sellerUser}, ${sellerScore}, ${sellerPct},
      NOW()
    )
    ON CONFLICT (item_id) DO UPDATE
      SET url         = EXCLUDED.url,
          title       = EXCLUDED.title,
          image_url   = EXCLUDED.image_url,
          brand       = EXCLUDED.brand,
          model_key   = EXCLUDED.model_key,
          head_type   = EXCLUDED.head_type,
          dexterity   = EXCLUDED.dexterity,
          length_in   = EXCLUDED.length_in,
          currency    = EXCLUDED.currency,
          retailer    = 'eBay',
          seller_user = EXCLUDED.seller_user,
          seller_score= EXCLUDED.seller_score,
          seller_pct  = EXCLUDED.seller_pct,
          updated_at  = NOW()
  `;
}

async function upsertPriceSnapshot(sql, snapshot, { forceTouchObserved = false } = {}) {
  const { itemId, price, shipping, total, condition, locationCc } = snapshot;

  if (price == null) {
    return { changed: false, skipped: true };
  }

  // 1) Try UPDATE first (fast path)
  const updated = await sql`
    UPDATE item_prices
       SET price = ${price},
           shipping = ${shipping},
           total = ${total},
           condition = ${condition},
           location_cc = ${locationCc},
           observed_at = NOW()
     WHERE item_id = ${itemId}
     RETURNING 1
  `;
  if (updated.length > 0) {
    return { changed: true, skipped: false };
  }

  // 2) Not present → INSERT. If a concurrent insert wins, retry UPDATE.
  try {
    await sql`
      INSERT INTO item_prices (item_id, price, shipping, total, condition, location_cc, observed_at)
      VALUES (${itemId}, ${price}, ${shipping}, ${total}, ${condition}, ${locationCc}, NOW())
    `;
    return { changed: true, skipped: false };
  } catch (e) {
    // Unique violation (23505) → someone inserted in-between; do an UPDATE.
    if (String(e.code) === '23505') {
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
      return { changed: true, skipped: false };
    }
    throw e;
  }
}


// ---- eBay fetchers ----

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
    if (i === 0) primaryCount = items.length;

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

  if (res.status === 404) return { item: null, callCount: 1 };

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`eBay ${res.status} ${res.statusText}${txt ? `: ${txt}` : ''}`);
  }

  const data = await res.json();
  return { item: data, callCount: 1 };
}

// ---- API handler ----

export default async function handler(req, res) {
  try {
    if (!isAuthorized(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const sql = await getSql();
    const token = await getEbayToken();

    // Optional: run a single manual query with ?q=...
    const manualQ = (req.query?.q || '').trim() || null;
    const refreshMode = req.query?.refresh === '1' || req.query?.mode === 'refresh';
    const queries = manualQ ? [manualQ] : SEED_QUERIES;

    const out = [];
    let totalCalls = 0;

    // Refresh mode: re-ping stale stored items via Browse get_item
    if (refreshMode) {
      const limitParam = Number.parseInt(req.query?.limit, 10);
      const refreshLimit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50;

      const rows = await sql/* sql */`
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
     LEFT JOIN LATERAL (
           SELECT ip.*
             FROM item_prices ip
            WHERE ip.item_id = i.item_id
            ORDER BY ip.observed_at DESC
            LIMIT 1
        ) ip ON TRUE
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
              // Always insert a new observation (observed_at = now)
              const { changed: hasChanged } = await upsertPriceSnapshot(sql, snapshot);
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

    // Normal crawl: iterate seed queries, fetch 2 pages each (0 / 50)
    for (const q of queries) {
      let inserted = 0;
      let found = 0;
      let error = null;

      try {
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

          if (primaryCount < 50) break; // fewer than a full page → stop early
        }

        found = allItems.length;

        await sql`BEGIN`;

        for (const raw of allItems) {
          const snapshot = extractListingSnapshot(raw);
          if (!snapshot || snapshot.price == null) continue;

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
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}
