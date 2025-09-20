// pages/api/model-stats.js
export const runtime = 'nodejs';

import { getSql } from '../../lib/db';
import { normalizeModelKey } from '../../lib/normalize';

export default async function handler(req, res) {
  try {
    const sql = getSql();
    const raw = (req.query.model || req.query.q || '').trim();
    if (!raw) return res.status(400).json({ ok:false, error:'Missing model' });

    const modelKey = normalizeModelKey(raw);

    const [row] = await sql`
      WITH w AS (
        SELECT COALESCE(p.total, p.price + COALESCE(p.shipping, 0)) AS total
        FROM item_prices p
        JOIN items i ON p.item_id = i.item_id
        WHERE i.model_key = ${modelKey}
          AND p.observed_at >= now() - interval '90 days'
          AND (p.total IS NOT NULL OR p.price IS NOT NULL)
      )
      SELECT
        percentile_cont(0.1) WITHIN GROUP (ORDER BY total) AS p10,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY total) AS p50,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY total) AS p90,
        COUNT(*) AS n
      FROM w
    `;

    return res.status(200).json({ ok: true, modelKey, stats: row });
  } catch (e) {
    return res.status(500).json({ ok:false, error:e.message });
  }
}
