// pages/api/cron/collect-prices.js
export const runtime = 'nodejs';

import { getSql } from '../../../lib/db';
import { browseSearch } from '../../../lib/ebay';

// Minimal normalizer (safe fallback)
function normalizeModelKey(title = '') {
  return (title || '')
    .toLowerCase()
    .replace(/scotty\s*cameron|titleist|putter|golf|\b(rh|lh)\b|right\s*hand(?:ed)?|left\s*hand(?:ed)?|men'?s|with|w\/|new|brand\s*new/g, ' ')
    .replace(/\b(3[2-9]|4[0-2])\s*(?:in|inch|inches|["”]|-?inch)\b/g, ' ')
    .replace(/[’“”]/g, m => (m === '’' ? "'" : '"'))
    .replace(/[*_\-\(\)\[\],.:;#+]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Popular models/brands (1 page per query)
const QUERIES = [
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

  'taylormade spider tour putter',
  'taylormade spider x putter',
  'taylormade spider gt putter',

  'odyssey seven putter',
  'odyssey #7 putter',
  'odyssey two ball putter',
  'odyssey eleven putter',
  'odyssey jailbird putter',
  'toulon garage putter',

  'ping anser putter',
  'ping tyne putter',
  'ping fetch putter',
  'ping tomcat putter',

  'bettinardi queen b putter',
  'bettinardi studio stock putter',
  'bettinardi bb putter',
  'bettinardi inovai putter',

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
const PAUSE_MS = 200;

export default async function handler(req, res) {
  try {
    // Auth (header OR ?key=) — only enforced if CRON_SECRET is set
    if (CRON_SECRET) {
      const headerKey = req.headers['x-cron-secret'];
      const queryKey = (req.query.key || '').toString();
      if (headerKey !== CRON_SECRET && queryKey !== CRON_SECRET) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
    }

    const sql = getSql();

    // Manual one-off run: /api/cron/collect-prices?q=...
    const manualQ = (req.query.q || '').toString().trim();
    const queries = manualQ ? [manualQ] : QUERIES;

    const results = [];
    let calls = 0;

    for (const q of queries) {
      let data;
      try {
        data = await browseSearch({ q, limit: 50, offset: 0 });
        calls++;
      } catch (err) {
        results.push({ q, error: String(err?.message || err) });
        await wait(PAUSE_MS);
        continue;
      }

      const items = Array.isArray(data?.itemSummaries) ? data.itemSummaries : [];
      // Build two ordered lists of executable functions that accept a runner (tx or sql)
      const parents = [];
      const children = [];

      for (const it of items) {
        const itemId = it?.itemId || it?.legacyItemId;
        if (!itemId) continue;

        const title = it?.title || '';
        const model_key = normalizeModelKey(title);

        const price = num(it?.price?.value);
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

        parents.push(async (runner) => {
          await runner`
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

        children.push(async (runner) => {
          await runner`
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

      // Execute: transaction if supported, else ordered without transaction
      let inserted = 0;
      if (typeof sql.begin === 'function') {
        await sql.begin(async (tx) => {
          for (const fn of parents) await fn(tx);
          for (const fn of children) { await fn(tx); inserted++; }
        });
      } else {
        // No transaction available in your neon client version
        for (const fn of parents) await fn(sql);
        for (const fn of children) { await fn(sql); inserted++; }
      }

      results.push({ q, found: items.length, inserted });
      await wait(PAUSE_MS);
    }

    return res.status(200).json({ ok: true, calls, manualQ: manualQ || null, results });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

/* --------------- helpers --------------- */
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
