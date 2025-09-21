// pages/api/models/specs.js
export const runtime = 'nodejs';

import { getSql } from '../../../lib/db';
import { normalizeModelKey } from '../../../lib/normalize';

export default async function handler(req, res) {
  try {
    const sql = getSql();
    const raw = (req.query.model || '').toString().trim();
    if (!raw) return res.status(400).json({ ok: false, error: 'Missing model' });
    const key = normalizeModelKey(raw);

    const rows = await sql`
      SELECT model_key, brand, display_name, spec_hint,
             toe_hang, loft, lie, weight, release_year, head_shape, grip
      FROM models
      WHERE model_key = ${key}
      LIMIT 1
    `;

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: 'Model not found', modelKey: key });
    }
    return res.status(200).json({ ok: true, modelKey: key, specs: rows[0] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
