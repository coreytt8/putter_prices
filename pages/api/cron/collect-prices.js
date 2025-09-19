import { getSql } from '../../../lib/db';
import { browseSearch } from '../../../lib/ebay';
import { normalizeModelKey } from '../../../lib/putter-normalize';

export const runtime = 'nodejs';

const QUERIES = [
  'scotty cameron newport 2 putter',
  'scotty cameron phantom putter',
  'taylormade spider x putter',
  'odyssey seven #7 putter',
  'ping anser putter',
  'bettinardi queen b putter',
];

const CRON_SECRET = process.env.CRON_SECRET || '';

export default async function handler(req, res) {
  if (CRON_SECRET) {
    const key = req.headers['x-cron-secret'] || req.query.key;
    if (key !== CRON_SECRET) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const sql = getSql();
  const results = [];
  let calls = 0;

  try {
    for (const q of QUERIES) {
      // Keep it to ONE page per query to protect your Browse quota
      const data = await browseSearch({ q, limit: 50, offset: 0 });
      calls++;

      const arr = Array.isArray(data?.itemSummaries) ? data.itemSummaries : [];
      for (const it of arr) {
        const itemId = it?.itemId || it?.legacyItemId || null;
        if (!itemId) continue;

        const title = it?.title || '';
        const model_key = normalizeModelKey(title);

        const price = Number(it?.price?.value ?? NaN);
        const shipping = Number(it?.shippingOptions?.[0]?.shippingCost?.value ?? NaN);
        const total = Number.isFinite(price) && Number.isFinite(shipping) ? price + shipping : (Number.isFinite(price) ? price : null);

        // UPSERT items
        await sql`
          INSERT INTO items (item_id, title, brand, model_key, head_type, dexterity, length_in, currency, seller_user, seller_score, seller_pct, url, image_url)
          VALUES (
            ${itemId},
            ${title},
            ${null},                       -- brand (optional: parse if you want)
            ${model_key},
            ${null}, ${null}, ${null},     -- head_type, dexterity, length_in (parse later)
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
        `;

        // Insert price snapshot
        await sql`
          INSERT INTO item_prices (item_id, price, shipping, total, condition, location_cc)
          VALUES (
            ${itemId},
            ${Number.isFinite(price) ? price : null},
            ${Number.isFinite(shipping) ? shipping : null},
            ${Number.isFinite(total) ? total : null},
            ${it?.condition || null},
            ${it?.itemLocation?.country || null}
          )
        `;
      }

      // tiny delay between queries (burst safety)
      await new Promise(r => setTimeout(r, 150));
      results.push({ q, found: arr.length });
    }

    res.status(200).json({ ok: true, calls, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, calls, results });
  }
}
