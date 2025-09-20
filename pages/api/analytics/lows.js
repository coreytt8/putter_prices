// pages/api/analytics/lows.js
export const runtime = 'nodejs';

import { getSql } from '../../lib/db';
import { normalizeModelKey, degradeKeyForKnownBugs } from '../../lib/normalize';

export default async function handler(req, res) {
  try {
    const sql = getSql();
    const raw = (req.query.model || req.query.q || '').trim();
    if (!raw) return res.status(400).json({ ok:false, error:'Missing model' });

    const modelKey = normalizeModelKey(raw);
    const badKey = degradeKeyForKnownBugs(modelKey);

    const run = async (whereSql) => {
      const [row] = await sql`
        SELECT
          MIN(COALESCE(p.total, p.price + COALESCE(p.shipping, 0)))
            FILTER (WHERE p.observed_at >= now() - interval '1 day')  AS low1d,
          MIN(COALESCE(p.total, p.price + COALESCE(p.shipping, 0)))
            FILTER (WHERE p.observed_at >= now() - interval '7 days') AS low7d,
          MIN(COALESCE(p.total, p.price + COALESCE(p.shipping, 0)))
            FILTER (WHERE p.observed_at >= now() - interval '30 days') AS low30d
        FROM item_prices p
        JOIN items i ON p.item_id = i.item_id
        WHERE ${whereSql}
      `;
      return row || { low1d: null, low7d: null, low30d: null };
    };

    // 1) strict normalized key
    let stats = await run(sql`i.model_key = ${modelKey}`);

    // 2) tolerant fallback for legacy keys & title contains
    if (stats && stats.low1d == null && stats.low7d == null && stats.low30d == null) {
      stats = await run(sql`
        (lower(i.model_key) LIKE ${'%' + modelKey.toLowerCase() + '%'}
         OR lower(i.model_key) LIKE ${'%' + badKey.toLowerCase() + '%'}
         OR lower(i.title)     LIKE ${'%' + raw.toLowerCase() + '%'})
      `);
    }

    return res.status(200).json({ ok:true, modelKey, lows: stats });
  } catch (e) {
    return res.status(500).json({ ok:false, error:e.message });
  }
}
