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

// --- auth ---
function isAuthorized(req) {
  const headerKey = req.headers['x-cron-secret'];
  const queryKey = req.query?.key;
  const secret = process.env.CRON_SECRET;
  return secret && (headerKey === secret || queryKey === secret);
}

// seeds
const SEED_QUERIES = PUTTER_SEED_QUERIES;

// --- helpers ---
function readNumber(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}
function pickShipping(item) {
  const so = item?.shippingOptions?.[0];
  const v = so?.shippingCost?.value ?? so?.shippingCost?.convertedFromValue;
  return readNumber(v);
}

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
    if (containsAccessoryToken(token)) accessoryCount++;
    else substantiveCount++;
  }

  const remainingCount = stripAccessoryTokens(raw)
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/gi, '').toLowerCase())
    .filter((t) => t && t !== 'putter' && !HEAD_COVER_TOKEN_VARIANTS.has(t)).length;

  if (hasHeadcoverSignal) return false;
  if (!remainingCount) return true;
  if (!hasPutterToken && accessoryCount) {
    if (accessoryCount >= remainingCount || accessoryCount >= 2) return true;
  }
  if (!accessoryCount) return false;
  if (substantiveCount && accessoryCount < substantiveCount) return false;
  return accessoryCount >= remainingCount;
}

function normalizeSpecsFromTitle(title = '') {
  const t = (title || '').toLowerCase();
  let length = null;
  const mLen = t.match(/(\d{2}(?:\.\d)?)\s*(?:in|inch|\"|\”)/i);
  if (mLen) length = readNumber(mLen[1]);

  let headType = null;
  if (/\bmallet\b/i.test(title)) headType = 'MALLET';
  if (/\bblade\b/i.test(title)) headType = headType || 'BLADE';

  let dexterity = null;
  if (/\b(left|lh)\b/i.test(title)) dexterity = 'LEFT';
  if (/\b(right|rh)\b/i.test(title)) dexterity = dexterity || 'RIGHT';

  let shaft = null;
  if (/center\s*-?\s*shaft/i.test(title)) shaft = 'center-shaft';
  else if (/shafted/i.test(title)) shaft = 'shafted';

  const hasHeadcover = /\b(hc|head\s*cover|headcover)\b/i.test(title);

  return { length, headType, dexterity, shaft, hasHeadcover };
}

const CATEGORY_HEADCOVER_RX = /\b(head\s*cover|headcovers?|head-?covers?|hc|covers?)\b/i;
const CATEGORY_ACCESSORY_RX = /\b(wrench(?:es)?|tools?|plates?|weights?)\b/i;

const TOKEN_RULES = [
  // --- Tour tier tokens (highest priority) ---
  { name: 'Circle T', pattern: /\bcircle\s*t\b/i, rarity: 'tour', collectible: true },
  { name: 'Tour Only', pattern: /\btour\s*only\b/i, rarity: 'tour', collectible: true },
  { name: 'Tour Dept', pattern: /\btour\s*(dept|department)\b/i, rarity: null, collectible: true },
  { name: 'TourType', pattern: /\btour\s*type\b|\btourtype\b/i, rarity: null, collectible: true },
  { name: 'COA', pattern: /\bcoa\b/i, rarity: 'tour', collectible: true },
  { name: 'Gallery', pattern: /\bgallery\b/i, rarity: 'tour', collectible: true },
  { name: '009M', pattern: /\b009m\b/i, rarity: 'tour', collectible: true },
  { name: '009', pattern: /\b009\b/i, rarity: 'tour', collectible: true },
  { name: 'GSS', pattern: /\bgss\b|german\s*stainless/i, rarity: 'tour', collectible: true },
  { name: 'Lamb Crafted', pattern: /\blamb\s*crafted\b/i, rarity: null, collectible: true },

  // --- Limited tier tokens ---
  { name: 'Button Back', pattern: /\bbutton\s*back\b/i, rarity: 'limited', collectible: true },
  { name: 'Jet Set', pattern: /\bjet\s*set\b/i, rarity: 'limited', collectible: true },
  { name: 'T22', pattern: /\bt22\b/i, rarity: 'limited', collectible: true },
  { name: 'TeI3', pattern: /\btei\s*3\b|\btei3\b/i, rarity: 'limited', collectible: true },
  { name: 'Hive', pattern: /\bhive\b/i, rarity: 'limited', collectible: true },
  { name: 'Swag', pattern: /\bswag\b/i, rarity: 'limited', collectible: true },
  { name: 'Reserve', pattern: /\breserve\b/i, rarity: 'limited', collectible: false },
  { name: 'My Girl', pattern: /\bmy\s*girl\b/i, rarity: 'limited', collectible: false },
  { name: 'Garage', pattern: /\bgarage\b/i, rarity: 'limited', collectible: false },
  { name: 'MOTO', pattern: /\bmoto\b/i, rarity: 'limited', collectible: false },
  { name: 'LE', pattern: /\ble\b/i, rarity: 'limited', collectible: false },
  { name: 'Limited', pattern: /\blimited\b/i, rarity: 'limited', collectible: false },
  { name: 'Ltd', pattern: /\bltd\b/i, rarity: 'limited', collectible: false },
];

const YEAR_RX = /(20\d{2}|19\d{2})/;

const CONDITION_BAND_MAP = new Map([
  ['1000', 'NEW'],
  ['1500', 'NEW'],
  ['1750', 'MINT'],
  ['2000', 'VERY_GOOD'],
  ['2500', 'VERY_GOOD'],
  ['3000', 'GOOD'],
  ['4000', 'GOOD'],
]);

function detectCategory(title = '') {
  const text = String(title || '');
  if (CATEGORY_HEADCOVER_RX.test(text)) return 'headcover';
  if (CATEGORY_ACCESSORY_RX.test(text)) return 'accessory';
  if (containsAccessoryToken(text)) return 'accessory';
  return 'putter';
}

function deriveReleaseMetadata(title = '') {
  const text = String(title || '');
  let releaseName = null;
  let isCollectible = false;
  let rarityTier = 'retail';
  let hasTour = false;
  let hasLimited = false;

  for (const rule of TOKEN_RULES) {
    if (!rule.pattern.test(text)) continue;
    if (!releaseName) releaseName = rule.name;
    if (rule.collectible) isCollectible = true;
    if (rule.rarity === 'tour') {
      hasTour = true;
      rarityTier = 'tour';
    } else if (rule.rarity === 'limited') {
      hasLimited = true;
    }
  }

  if (!hasTour && hasLimited) rarityTier = 'limited';

  return { releaseName, isCollectible, rarityTier };
}

function extractReleaseYear(title = '') {
  const text = String(title || '');
  const match = text.match(YEAR_RX);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  return Number.isFinite(year) ? year : null;
}

function mapConditionBand(conditionId) {
  if (!conditionId) return 'ANY';
  const key = String(conditionId);
  return CONDITION_BAND_MAP.get(key) || 'ANY';
}

function extractListingSnapshot(raw) {
  const itemId = raw?.itemId || raw?.item_id;
  if (!itemId) return null;

  const title = raw?.title || null;
  if (title && shouldSkipAccessoryDominatedTitle(title)) return null;

  const category = detectCategory(title || '');
  const releaseMeta = deriveReleaseMetadata(title || '');
  const releaseYear = extractReleaseYear(title || '');

  const currency = raw?.price?.currency || raw?.price?.convertedFromCurrency || 'USD';
  const price = readNumber(raw?.price?.value) ?? readNumber(raw?.price?.convertedFromValue);
  const shipping = pickShipping(raw);
  const total = price != null && shipping != null ? price + shipping : price ?? null;
  const condition = raw?.condition || raw?.conditionDisplayName || null;
  const conditionId = raw?.conditionId || raw?.condition_id || null;
  const conditionBand = mapConditionBand(conditionId);
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
  const model_key = normalizeModelKey(title || '') || '';
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
    category,
    releaseMeta,
    releaseYear,
    conditionBand,
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
    category,
    releaseMeta,
    releaseYear,
    conditionBand,
  } = snapshot;

  await sql/* sql */`
    INSERT INTO items (
      item_id, url, title, image_url, brand, model_key, head_type, dexterity,
      length_in, currency, retailer, seller_user, seller_score, seller_pct,
      category, is_collectible, rarity_tier, release_name, release_year, condition_band, updated_at
    )
    VALUES (
      ${itemId}, ${url}, ${title}, ${imageUrl}, ${canonicalBrand}, ${model_key},
      ${specs?.headType}, ${specs?.dexterity}, ${specs?.length}, ${currency},
      'eBay', ${sellerUser}, ${sellerScore}, ${sellerPct},
      ${category}, ${releaseMeta?.isCollectible || false}, ${releaseMeta?.rarityTier},
      ${releaseMeta?.releaseName}, ${releaseYear}, ${conditionBand}, NOW()
    )
    ON CONFLICT (item_id) DO UPDATE SET
      url = EXCLUDED.url,
      title = EXCLUDED.title,
      image_url = EXCLUDED.image_url,
      brand = COALESCE(EXCLUDED.brand, items.brand),
      model_key = EXCLUDED.model_key,
      head_type = EXCLUDED.head_type,
      dexterity = EXCLUDED.dexterity,
      length_in = EXCLUDED.length_in,
      currency = EXCLUDED.currency,
      retailer = 'eBay',
      seller_user = EXCLUDED.seller_user,
      seller_score = EXCLUDED.seller_score,
      seller_pct = EXCLUDED.seller_pct,
      category = EXCLUDED.category,
      is_collectible = EXCLUDED.is_collectible,
      rarity_tier = EXCLUDED.rarity_tier,
      release_name = EXCLUDED.release_name,
      release_year = EXCLUDED.release_year,
      condition_band = EXCLUDED.condition_band,
      updated_at = NOW()
  `;
}

async function upsertPriceSnapshot(sql, snapshot, { forceTouchObserved = false } = {}) {
  const { itemId, price, shipping, total, condition, locationCc } = snapshot;
  if (price == null) return { changed: false, skipped: true };

  // try update first
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
  if (updated.length > 0) return { changed: true, skipped: false };

  // insert then retry update on race
  try {
    await sql`
      INSERT INTO item_prices (item_id, price, shipping, total, condition, location_cc, observed_at)
      VALUES (${itemId}, ${price}, ${shipping}, ${total}, ${condition}, ${locationCc}, NOW())
    `;
    return { changed: true, skipped: false };
  } catch (e) {
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

// sorts = ['NEWLY_LISTED'] or ['NEWLY_LISTED','BEST_MATCH'] etc.
async function fetchEbayPage(token, q, { offset = 0, limit = 50, sorts = ['NEWLY_LISTED'] } = {}) {
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

// GET only to simplify cron usage (POST would be fine too)
export default async function handler(req, res) {
  try {
    if (!isAuthorized(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const sql = await getSql();
    const token = await getEbayToken();

    // manual single query
    const manualQ = (req.query?.q || '').trim() || null;

    // refresh mode: re-fetch details for oldest observed items
    const refreshMode = req.query?.refresh === '1' || req.query?.mode === 'refresh';
    if (refreshMode) {
      const limitParam = Number.parseInt(req.query?.limit, 10);
      const refreshLimit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50;

      const rows = await sql`
        SELECT i.item_id, i.title, i.brand, i.model_key, i.head_type, i.dexterity, i.length_in, i.currency,
               i.seller_user, i.seller_score, i.seller_pct, i.url, i.image_url, i.updated_at,
               ip.price, ip.shipping, ip.total, ip.condition, ip.location_cc, ip.observed_at
          FROM items i
     LEFT JOIN item_prices ip ON ip.item_id = i.item_id
         ORDER BY COALESCE(ip.observed_at, i.updated_at) ASC NULLS FIRST
         LIMIT ${refreshLimit}
      `;

      let totalCalls = 0;
      const results = [];
      for (const row of rows) {
        try {
          const r = await fetch(`https://api.ebay.com/buy/browse/v1/item/${row.item_id}`, {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
              'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
            },
          });
          totalCalls++;
          if (r.status === 404) {
            results.push({ itemId: row.item_id, status: 'missing' });
            continue;
          }
          if (!r.ok) {
            const t = await r.text().catch(() => '');
            results.push({ itemId: row.item_id, status: 'error', error: `eBay ${r.status} ${r.statusText} ${t}` });
            continue;
          }
          const item = await r.json();
          const snapshot = extractListingSnapshot(item);
          if (!snapshot || snapshot.price == null) {
            results.push({ itemId: row.item_id, status: 'skipped' });
            continue;
          }
          await upsertItem(sql, snapshot);
          await upsertPriceSnapshot(sql, snapshot, { forceTouchObserved: true });
          results.push({ itemId: row.item_id, status: 'ok' });
        } catch (e) {
          results.push({ itemId: row.item_id, status: 'error', error: e.message || String(e) });
        }
      }
      return res.status(200).json({ ok: true, calls: totalCalls, manualQ, refresh: { limit: refreshLimit, results } });
    }

    // batching params
    const offset = Math.max(0, parseInt(req.query?.offset ?? '0', 10) || 0);
    const count = Math.max(1, parseInt(req.query?.count ?? '25', 10) || 25); // run ~25 seeds per call by default
    const pages = Math.max(1, parseInt(req.query?.pages ?? '1', 10) || 1);
    const limitPerPage = Math.min(50, Math.max(10, parseInt(req.query?.limit ?? '50', 10) || 50));
    const sorts = String(req.query?.sorts || 'NEWLY_LISTED')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    const queries = manualQ
      ? [manualQ]
      : SEED_QUERIES.slice(offset, offset + count);

    const pageOffsets = Array.from({ length: pages }, (_, i) => i * limitPerPage);

    let totalCalls = 0;
    const out = [];

    for (const q of queries) {
      let inserted = 0;
      let found = 0;
      let error = null;

      try {
        const seenIds = new Set();
        const allItems = [];

        for (const off of pageOffsets) {
          const { items, callCount, primaryCount } = await fetchEbayPage(token, q, {
            offset: off,
            limit: limitPerPage,
            sorts, // keep just NEWLY_LISTED by default
          });
          totalCalls += callCount;

          for (const item of items) {
            const itemId = item?.itemId || item?.item_id;
            if (!itemId || seenIds.has(itemId)) continue;
            seenIds.add(itemId);
            allItems.push(item);
          }

          // stop early if first sort returned less than requested
          if (primaryCount < limitPerPage) break;
        }

        found = allItems.length;

        await sql`BEGIN`;
        for (const it of allItems) {
          const snap = extractListingSnapshot(it);
          if (!snap || snap.price == null) continue;
          await upsertItem(sql, snap);
          await upsertPriceSnapshot(sql, snap);
          inserted++;
        }
        await sql`COMMIT`;
      } catch (e) {
        try { await sql`ROLLBACK`; } catch {}
        error = e.message || String(e);
      }

      out.push({ q, found, inserted, error: error || null });
    }

    return res.status(200).json({ ok: true, calls: totalCalls, manualQ, results: out, meta: { offset, count, pages, limit: limitPerPage, sorts } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
