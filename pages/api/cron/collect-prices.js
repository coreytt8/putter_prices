// pages/api/cron/collect-prices.js
import { getSql } from '../../../lib/db';
import { browseSearch } from '../../../lib/ebay';
import { normalizeModelKey } from '../../../lib/putter-normalize'; // or inline if you didn't keep the file

export const runtime = 'nodejs';

const QUERIES = [
  'scotty cameron newport 2 putter',
  'scotty cameron phantom 11 putter',
  'taylormade spider x putter',
  'odyssey seven #7 putter',
  'ping anser putter',
  'bettinardi queen b putter',
  'scotty cameron circle t',
  'logan olson',
];

const CRON_SECRET = process.env.CRON_SECRET || '';

export default async function handler(req, res) {
  // Auth: only enforce if CRON_SECRET is set
  if (CRON_SECRET) {
    const headerKey = req.headers['x-cron-secret'];
    const queryKey = req.query.key;
    if (headerKey !== CRON_SECRET && queryKey !== CRON_SECRET) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  }

  const sql = getSql();

  // Manual single-query run: /api/cron/collect-prices?q=<your search>
  const manualQ = (req.query.q || '').toString().trim();
  const queries = manualQ ? [manualQ] : QUERIES;

  const results = [];
  let calls = 0;

  try {
    for (const q of queries) {
      // keep quota-safe: one page per query
      const data = await browseSearch({ q, limit: 50, offset: 0 });
      calls++;

      const arr = Array.isArray(data?.itemSummaries) ? data.itemSummaries : [];
      const upserts = [];

      for (const it of arr) {
        const itemId = it?.itemId || it?.legacyItemId;
        if (!itemId) continue;

        const title = it?.title || '';
        const model_key = normalizeModelKey ? normalizeModelKey(title) : title.toLowerCase().trim();

        const price = Number(it?.price?.value ?? NaN);
        const shipping = Number(it?.shippingOptions?.[0]?.shippingCost?.value ?? NaN);
        const total = Number.isFinite(price) && Number.isFinite(shipping)
          ? price + shipping
          : (Number.isFinite(price) ? price : null);

        // UPSERT items
        upserts.push(sql`
          INSERT INTO items (item_id, title, brand, model_key, head_type, dexterity, length_in, currency, seller_user, seller_score, seller_pct, url, image_url)
          VALUES (
            ${itemId},
            ${title},
            ${null},
            ${model_key},
            ${null}, ${null}, ${null},
            ${it?.price?.currency || 'USD'},
            ${it?.seller?.username || null},
            ${it?.seller?.feedbackScore ? Number(it.seller.feedbackScore) : null},
            ${it?.seller?.feedbackPercentage ? Number(it.seller.feedbackPercentage) : null},
            ${it?.itemWebUrl || it?.itemHref || null},
            ${it?.image?.imageUrl || it?.thumbnailImages?.[0]?.imageUrl || null}
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
        `);

        // snapshot price
        upserts.push(sql`
          INSERT INTO item_prices (item_id, price, shipping, total, condition, location_cc)
          VALUES (
            ${itemId},
            ${Number.isFinite(price) ? price : null},
            ${Number.isFinite(shipping) ? shipping : null},
            ${Number.isFinite(total) ? total : null},
            ${it?.condition || null},
            ${it?.itemLocation?.country || null}
          )
        `);
      }

      // run all db ops for this query
      if (upserts.length) await Promise.all(upserts);

      // tiny burst protection
      await new Promise(r => setTimeout(r, 150));
      results.push({ q, found: arr.length });
    }

    return res.status(200).json({ ok: true, calls, manualQ: manualQ || null, results });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message, calls, manualQ: manualQ || null, results });
  }
}
