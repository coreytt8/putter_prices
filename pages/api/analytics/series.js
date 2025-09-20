// pages/api/analytics/series.js
export const runtime = 'nodejs';
import { getSql } from '../../lib/db';

// same normalizer as your model-stats route
function normalizeModelKey(title = '') {
  return String(title || '')
    .toLowerCase()
    .replace(/scotty\s*cameron|titleist|putter|golf|\b(rh|lh)\b|right\s*hand(ed)?|left\s*hand(ed)?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export default async function handler(req, res) {
  try {
    const sql = getSql();
    const raw = (req.query.model || '').trim();
    if (!raw) return res.status(400).json({ ok:false, error:'Missing model' });

    const modelKey = normalizeModelKey(raw);
    if (!modelKey) return res.status(400).json({ ok:false, error:'Bad model' });

    const rows = await sql`
      SELECT
        date_trunc('day', p.observed_at) AS day,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY p.total) AS median
      FROM item_prices p
      JOIN items i ON p.item_id = i.item_id
      WHERE i.model_key = ${modelKey}
        AND p.total IS NOT NULL
        AND p.observed_at >= now() - interval '90 days'
      GROUP BY day
      ORDER BY day ASC
    `;

    return res.status(200).json({ ok:true, modelKey, series: rows });
  } catch (e) {
    return res.status(500).json({ ok:false, error:e.message });
  }
}
