// pages/api/analytics/series.js
export const runtime = 'nodejs';

import { getSql } from '../../../lib/db';
import { normalizeModelKey } from '../../../lib/normalize';

export default async function handler(req, res) {
  try {
    const sql = getSql();
    const raw = (req.query.model || '').trim();
    if (!raw) return res.status(400).json({ ok:false, error:'Missing model' });

    const modelKey = normalizeModelKey(raw);
    const badKey = degradeKeyForKnownBugs(modelKey);

    // 1) strict normalized match
    let rows = await sql`
      SELECT
        date_trunc('day', p.observed_at) AS day,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY COALESCE(p.total, p.price + COALESCE(p.shipping, 0))
        ) AS median
      FROM item_prices p
      JOIN items i ON p.item_id = i.item_id
      WHERE i.model_key = ${modelKey}
        AND p.observed_at >= now() - interval '90 days'
      GROUP BY day
      ORDER BY day ASC
    `;

    // 2) tolerant fallback for legacy keys & title
    if (rows.length === 0) {
      rows = await sql`
        SELECT
          date_trunc('day', p.observed_at) AS day,
          percentile_cont(0.5) WITHIN GROUP (
            ORDER BY COALESCE(p.total, p.price + COALESCE(p.shipping, 0))
          ) AS median
        FROM item_prices p
        JOIN items i ON p.item_id = i.item_id
        WHERE (lower(i.model_key) LIKE ${'%' + modelKey.toLowerCase() + '%'}
            OR lower(i.model_key) LIKE ${'%' + badKey.toLowerCase() + '%'}
            OR lower(i.title)     LIKE ${'%' + raw.toLowerCase() + '%'})
          AND p.observed_at >= now() - interval '90 days'
        GROUP BY day
        ORDER BY day ASC
      `;
    }

    return res.status(200).json({ ok:true, modelKey, series: rows });
  } catch (e) {
    return res.status(500).json({ ok:false, error:e.message });
  }
}
