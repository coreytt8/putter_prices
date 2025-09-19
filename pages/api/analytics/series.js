export const runtime = 'nodejs';
import { getSql } from '../../lib/db';

export default async function handler(req, res) {
  try {
    const sql = getSql();
    const model = (req.query.model || '').toLowerCase().trim();
    if (!model) return res.status(400).json({ ok:false, error:'Missing model' });

    const rows = await sql`
      SELECT
        date_trunc('day', observed_at) AS day,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY total) AS median
      FROM item_prices p
      JOIN items i ON p.item_id = i.item_id
      WHERE i.model_key ILIKE ${'%' + model + '%'}
        AND p.total IS NOT NULL
        AND observed_at >= now() - interval '90 days'
      GROUP BY day
      ORDER BY day ASC
    `;
    return res.status(200).json({ ok:true, model, series: rows });
  } catch (e) {
    return res.status(500).json({ ok:false, error:e.message });
  }
}
