export const config = { api: { bodyParser: false } };
export const runtime = 'nodejs';

import fs from 'node:fs/promises';
import path from 'node:path';

import { getSql } from '../../../lib/db';
import { normalizeModelKey } from '../../../lib/normalize';
import { detectVariantTags, buildVariantKey } from '../../../lib/variant-detect';

const ADMIN_HDR = 'x-admin-key';

const FAMILY_CANON = new Map([
  ['spider tour x', 'spider tour'],
  ['spider tour v', 'spider tour'],
  ['spider tour z', 'spider tour'],
]);

function collapseToParent(modelKey) {
  return FAMILY_CANON.get(modelKey) || modelKey;
}

function wildcardFromSeed(label) {
  const tokens = label.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    return `%${tokens[0]}%${tokens[1]}%`;
  }
  return `%${tokens[0]}%`;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    const admin = req.headers[ADMIN_HDR];
    if (!admin || admin !== process.env.ADMIN_KEY) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    const sql = getSql();
    const sinceDays = Number(req.query.sinceDays || 3650);
    const limitPerModel = Number(req.query.limit || 1500);
    const onlyModel = (req.query.onlyModel || '').trim().toLowerCase();
    const dryRun = String(req.query.dryRun || '').toLowerCase() === '1';

    const seedPath = path.resolve(process.cwd(), 'data/seed-models.txt');
    const raw = await fs.readFile(seedPath, 'utf8');
    const seeds = raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('#'));
    const targets = onlyModel
      ? seeds.filter((s) => s.toLowerCase() === onlyModel)
      : seeds;

    const sinceDate = new Date(Date.now() - sinceDays * 24 * 3600 * 1000);

    const results = [];
    for (const label of targets) {
      const requestedKey = normalizeModelKey(label);
      const baseKey = collapseToParent(requestedKey);
      const like = wildcardFromSeed(label);

      const rows = await sql`
        SELECT item_id, snapshot_day, model
        FROM listing_snapshots
        WHERE COALESCE(variant_key,'') = ''
          AND snapshot_day >= ${sinceDate}
          AND lower(model) LIKE ${like}
        LIMIT ${limitPerModel}
      `;

      const updates = [];
      for (const r of rows) {
        const rawModel = String(r.model || '');
        const norm = normalizeModelKey(rawModel);
        const collapsed = collapseToParent(norm);

        if (collapsed !== baseKey) continue;

        const tags = detectVariantTags(rawModel);
        if (!tags || !tags.length) continue;

        const vk = buildVariantKey(baseKey, tags);
        if (!vk) continue;

        updates.push({ ...r, baseKey, variant_key: vk });
      }

      let updated = 0;
      if (!dryRun && updates.length) {
        for (const u of updates) {
          const res2 = await sql`
            UPDATE listing_snapshots
            SET model = ${u.baseKey}, variant_key = ${u.variant_key}
            WHERE item_id = ${u.item_id}
              AND snapshot_day = ${u.snapshot_day}
              AND COALESCE(variant_key,'') = ''
          `;
          updated += res2.count || 0;
        }

        await sql`
          WITH windows AS (SELECT unnest(ARRAY[60,90,180])::int AS w),
          base AS (
            SELECT s.model,
                   COALESCE(s.variant_key,'') AS variant_key,
                   s.condition_band,
                   w.w AS window_days,
                   COUNT(*)::int AS n,
                   PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY s.total_cents) AS p10,
                   PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY s.total_cents) AS p50,
                   PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY s.total_cents) AS p90
            FROM listing_snapshots s
            JOIN windows w ON s.snapshot_day >= (CURRENT_DATE - (w.w || ' days')::interval)
            WHERE s.model = ${baseKey}
            GROUP BY s.model, COALESCE(s.variant_key,''), s.condition_band, w.w
          )
          INSERT INTO aggregated_stats_variant
            (model, variant_key, condition_band, window_days, n, p10_cents, p50_cents, p90_cents, dispersion_ratio, updated_at)
          SELECT
            b.model, b.variant_key, b.condition_band, b.window_days, b.n,
            ROUND(b.p10)::int, ROUND(b.p50)::int, ROUND(b.p90)::int,
            CASE WHEN b.p50 > 0 THEN LEAST(5.0, GREATEST(0.1, (b.p90 - b.p10) / NULLIF(b.p50,0))) END,
            NOW()
          FROM base b
          ON CONFLICT (model, variant_key, condition_band, window_days)
          DO UPDATE
            SET n = EXCLUDED.n,
                p10_cents = EXCLUDED.p10_cents,
                p50_cents = EXCLUDED.p50_cents,
                p90_cents = EXCLUDED.p90_cents,
                dispersion_ratio = EXCLUDED.dispersion_ratio,
                updated_at = EXCLUDED.updated_at
        `;
      }

      results.push({
        label,
        baseKey,
        candidates: rows.length,
        tagged: updates.length,
        updated,
      });
    }

    return res.json({ ok: true, sinceDays, limitPerModel, dryRun, results });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
