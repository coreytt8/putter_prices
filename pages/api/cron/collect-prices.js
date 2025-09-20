// pages/api/cron/collect-prices.js
export const runtime = 'nodejs';

import { getSql } from '../../../lib/db';
import { normalizeModelKey } from '../../../lib/normalize';

const CRON_SECRET = process.env.CRON_SECRET || '';

const PRESET_QUERIES = [
  /* ... your list unchanged ... */
];

// NEW: robust base-url resolver for Vercel/local
function getBaseUrl(req) {
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL;            // e.g. https://putteriq.com
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;                   // e.g. https://your-app.vercel.app
  if (req?.headers?.host) return `http://${req.headers.host}`;                              // dev/preview
  return 'http://127.0.0.1:3000';                                                           // local fallback
}

async function fetchListingsServerSide(req, q) {
  const params = new URLSearchParams({
    q,
    group: 'false',
    onlyComplete: 'true',
    perPage: '50',
    page: '1',
    samplePages: '1',
    _ts: String(Date.now()),
  });

  const base = getBaseUrl(req);
  const url = `${base}/api/putters?${params.toString()}`;

  const res = await fetch(url, {
    cache: 'no-store',
    headers: { 'pragma': 'no-cache', 'cache-control': 'no-cache' },
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`/api/putters ${res.status}: ${t || 'bad response'}`);
  }
  const json = await res.json();
  return Array.isArray(json.offers) ? json.offers : [];
}

export default async function handler(req, res) {
  try {
    const key = (req.query.key || '').trim();
    if (!CRON_SECRET || key !== CRON_SECRET) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const sql = getSql();
    const manualModel = (req.query.model || '').trim();
    const manualQ = manualModel ? `scotty cameron ${manualModel} putter` : null;
    const queries = manualQ ? [manualQ] : PRESET_QUERIES;

    const results = [];
    let calls = 0;

    for (const q of queries) {
      calls++;
      const offers = await fetchListingsServerSide(req, q);

      let inserted = 0;
      for (const o of offers) {
        const title = o?.title || '';
        const model_key = normalizeModelKey(title);
        const item_id = String(o?.productId || o?.url || title);
        const price = Number(o?.price);
        const shipping = Number(o?.shipping?.cost ?? 0);
        const total = Number.isFinite(price) ? price + (Number.isFinite(shipping) ? shipping : 0) : null;

        await sql`
          INSERT INTO items (item_id, title, brand, model_key, head_type, dexterity, length_in, currency,
                             seller_user, seller_score, seller_pct, url, image_url)
          VALUES (
            ${item_id},
            ${title},
            ${null},
            ${model_key},
            ${(o?.specs?.headType || null)},
            ${(o?.specs?.dexterity || null)},
            ${Number.isFinite(Number(o?.specs?.length)) ? Number(o.specs.length) : null},
            ${(o?.currency || 'USD')},
            ${(o?.seller?.username || null)},
            ${Number.isFinite(Number(o?.seller?.feedbackScore)) ? Number(o.seller.feedbackScore) : null},
            ${Number.isFinite(Number(o?.seller?.feedbackPct)) ? Number(o.seller.feedbackPct) : null},
            ${(o?.url || null)},
            ${(o?.image || null)}
          )
          ON CONFLICT (item_id) DO UPDATE
          SET title = EXCLUDED.title,
              model_key = EXCLUDED.model_key,
              image_url = COALESCE(EXCLUDED.image_url, items.image_url)
        `;

        await sql`
          INSERT INTO item_prices (item_id, price, shipping, total, condition, location_cc)
          VALUES (
            ${item_id},
            ${Number.isFinite(price) ? price : null},
            ${Number.isFinite(shipping) ? shipping : null},
            ${Number.isFinite(total) ? total : null},
            ${(o?.condition || null)},
            ${(o?.location?.country || null)}
          )
        `;
        inserted++;
      }

      results.push({ q, found: offers.length, inserted });
    }

    return res.status(200).json({ ok: true, calls, manualQ: manualQ || null, results });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
