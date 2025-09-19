// pages/api/cron/collect-prices.js
export const runtime = 'nodejs';

import { getSql } from '../../../lib/db';
import { browseSearch } from '../../../lib/ebay'; // must return Browse API JSON

// Minimal, inline model key cleaner (safe fallback)
function normalizeModelKey(title = '') {
  return (title || '')
    .toLowerCase()
    // drop common noise
    .replace(/scotty\s*cameron|titleist|putter|golf|\b(rh|lh)\b|right\s*hand(?:ed)?|left\s*hand(?:ed)?|men'?s|with|w\/|new|brand\s*new/g, ' ')
    // remove lengths like 34", 35 in
    .replace(/\b(3[2-9]|4[0-2])\s*(?:in|inch|inches|["”]|-?inch)\b/g, ' ')
    .replace(/[’“”]/g, m => (m === '’' ? "'" : '"'))
    // punctuation & decorators
    .replace(/[*_\-\(\)\[\],.:;#+]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Curated list of high-value models (one page per query to stay under Browse limits)
const QUERIES = [
  // Scotty Cameron
  'scotty cameron newport 2 putter',
  'scotty cameron newport putter',
  'scotty cameron phantom 11 putter',
  'scotty cameron phantom 7 putter',
  'scotty cameron fastback putter',
  'scotty cameron squareback putter',
  'scotty cameron futura putter',
  'scotty cameron tei3 putter',
  'scotty cameron button back putter',
  'scotty cameron circle t putter',
  'scotty cameron newport beach putter',
  'scotty cameron napa putter',

  // TaylorMade
  'taylormade spider tour putter',
  'taylormade spider x putter',
  'taylormade spider gt putter',

  // Odyssey / Toulon
  'odyssey seven putter',
  'odyssey #7 putter',
  'odyssey two ball putter',
  'odyssey eleven putter',
  'odyssey jailbird putter',
  'toulon garage putter',

  // Ping
  'ping anser putter',
  'ping tyne putter',
  'ping fetch putter',
  'ping tomcat putter',

  // Bettinardi
  'bettinardi queen b putter',
  'bettinardi studio stock putter',
  'bettinardi bb putter',
  'bettinardi inovai putter',

  // LAB / Evnroll / Mizuno / Wilson / SIK
  'lab golf mezz putter',
  'lab golf df putter',
  'lab golf link putter',
  'evnroll er2 putter',
  'evnroll er5 putter',
  'mizuno m craft putter',
  'wilson 8802 putter',
  'sik putter'
];

const CRON_SECRET = process.env.CRON_SECRET || '';
const PAUSE_MS = 200; // tiny spacing between queries

export default async function handler(req, res) {
  try {
    // --- Auth: require header or ?key= if a secret is set ---
    if (CRON_SECRET) {
      const headerKey = req.headers['x-cron-secret'];
      const queryKey = (req.query.key || '').toString();
      if (headerKey !== CRON_SECRET && queryKey !== CRON_SECRET) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
    }

    const sql = getSql();

    // Manual one-off: /api/cron/collect-prices?q=<your search>
    const manualQ = (req.query.q || '').toString().trim();
    const queries = manualQ ? [manualQ] : QUERIES;

    const results = [];
    let calls = 0;

    for (const q of queries) {
      // 1 page per query to respect Browse limits
      let data;
      try {
        data = await browseSearch({ q, limit: 50, offset: 0 });
        calls++;
      } catch (err) {
        // surface 429 clearly, but keep loop going for others
        const msg = String(err?.message || err);
        results.push({ q, error: msg });
        // if you want to abort the whole run on 429, uncomment:
        // if (msg.includes('429') || msg.toLowerCase().includes('too many requests')) break;
        await wait(PAUSE_MS);
        continue;
      }

      const items = Array.isArray(data?.itemSummaries) ? data.itemSummaries : [];
      const parents = [];
      const children = [];

      for (const it of items) {
        const itemId = it?.itemId || it?.legacyItemId;
        if (!itemId) continue;

        const title = it?.title || '';
        const model_key = normalizeModelKey(title);

        const price = num(it?.price?.value);
        // pick cheapest shipping option if available
        const ship = pickCheapestShipping(it?.shippingOptions);
        const shipping = num(ship?.value);
        const total = (isNum(price) && isNum(shipping)) ? price + shipping : (isNum(price) ? price : null);

        const currency = it?.price?.currency || 'USD';
        const url = it?.itemWebUrl || it?.itemHref || null;
        const image = it?.image?.imageUrl || it?.thumbnailImages?.[0]?.imageUrl || null;
        const sellerUser = it?.seller?.username || null;
        const sellerScore = num(it?.seller?.feedbackScore);
        const sellerPct = num(it?.seller?.feedbackPercentage);
        const condition = it?.condition || null;
        const locationCC = it?.itemLocation?.country || null;

        // Parent upsert
        parents.push(async (tx) => {
          await tx`
            INSERT INTO items (item_id, title, brand, model_key, head_type, dexterity, length_in, currency, seller_user, seller_score, seller_pct, url, image_url)
            VALUES (
              ${itemId}, ${title}, ${null}, ${model_key}, ${null}, ${null}, ${null},
              ${currency}, ${sellerUser}, ${sellerScore}, ${sellerPct}, ${url}, ${image}
            )
            ON CONFLICT (item_id) DO UPDATE SET
              title = EXCLUDED.title,
              model_key = EXCLUDED.model_key,
              currency = EXCLUDED.currency,
              seller_user = EXCLUDED.seller_user,
              seller_score = EXCLUDED.seller_score,
              seller_pct = EXCLUDED.seller_pct,
              url = EXCLUDED.url,
              image_url = EXCLUDED.image_url
          `;
        });

        // Child snapshot (must run after parent)
        children.push(async (tx) => {
          await tx`
            INSERT INTO item_prices (item_id, price, shipping, total, condition, location_cc)
            VALUES (
              ${itemId},
              ${isNum(price) ? price : null},
              ${isNum(shipping) ? shipping : null},
              ${isNum(total) ? total : null},
              ${condition},
              ${locationCC}
            )
          `;
        });
      }

      // Run parents first, then children — inside a transaction for safety
      let inserted = 0;
      await sql.begin(async (tx) => {
        for (const fn of parents) { await fn(tx); }
        for (const fn of children) { await fn(tx); inserted++; }
      });

      results.push({ q, found: items.length, inserted });
      await wait(PAUSE_MS);
    }

    return res.status(200).json({ ok: true, calls, manualQ: manualQ || null, results });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

/* ---------------- helpers ---------------- */
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
function num(n) { const x = Number(n); return Number.isFinite(x) ? x : null; }
function isNum(n) { return typeof n === 'number' && Number.isFinite(n); }

function pickCheapestShipping(options) {
  if (!Array.isArray(options) || options.length === 0) return null;
  let best = null;
  for (const opt of options) {
    const val = num(opt?.shippingCost?.value);
    if (val == null) continue;
    if (!best || val < best.value) best = { value: val, currency: opt?.shippingCost?.currency || 'USD' };
  }
  return best;
}
