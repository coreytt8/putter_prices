// pages/api/cron/collect-prices.js
export const runtime = 'nodejs';

import { getSql } from '../../../lib/db';
import { normalizeModelKey } from '../../../lib/normalize';

// --- your existing env secret ---
const CRON_SECRET = process.env.CRON_SECRET || '';

/** Keep (or expand) your preset queries here */
const PRESET_QUERIES = [
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
  'sik putter',
];

/**
 * You already have /api/putters that calls eBay Browse.
 * We’ll reuse it server-side for persistence to Neon to avoid duplicating all your fetch logic.
 */
async function fetchListingsServerSide(q) {
  const params = new URLSearchParams({
    q,
    group: 'false',
    onlyComplete: 'true',
    perPage: '50',
    page: '1',
    samplePages: '1',
    // keep category/filtering consistent with your prod route defaults
  });

  const url = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/putters?${params.toString()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`/api/putters failed: ${res.status} ${t}`);
  }
  const json = await res.json();
  // in flat mode, offers list is used
  return Array.isArray(json.offers) ? json.offers : [];
}

export default async function handler(req, res) {
  try {
    // --- auth ---
    const key = (req.query.key || '').trim();
    if (!CRON_SECRET || key !== CRON_SECRET) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const sql = getSql();

    // manual single-model backfill: ?model=newport%202
    const manualModel = (req.query.model || '').trim();
    const manualQ = manualModel ? `scotty cameron ${manualModel} putter` : null;

    const queries = manualQ ? [manualQ] : PRESET_QUERIES;
    const results = [];
    let calls = 0;

    for (const q of queries) {
      calls++;
      // 1) get listings via your existing Browse wrapper
      const offers = await fetchListingsServerSide(q);

      // 2) upsert items + insert price snapshots
      let inserted = 0;
      for (const o of offers) {
        const title = o?.title || '';
        const model_key = normalizeModelKey(title);
        const item_id = String(o?.productId || o?.url || title);
        const price = Number(o?.price);
        const shipping = Number(o?.shipping?.cost ?? 0);
        const total = Number.isFinite(price) ? price + (Number.isFinite(shipping) ? shipping : 0) : null;

        // Upsert into items first (FK-safe)
        await sql`
          INSERT INTO items (item_id, title, brand, model_key, head_type, dexterity, length_in, currency,
                             seller_user, seller_score, seller_pct, url, image_url)
          VALUES (
            ${item_id},
            ${title},
            ${null},                                   -- brand (optional to parse later)
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

        // Insert a price row (allow null total if price not valid, though we prefer valid)
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
