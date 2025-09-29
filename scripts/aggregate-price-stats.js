// scripts/aggregate-price-stats.js
// Node script to aggregate per-(model, variantKey, condition) stats and compute variant uplifts.
// Run with: node scripts/aggregate-price-stats.js
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const WINDOW_DAYS = Number(process.env.AGGR_WINDOW_DAYS || 60);
const TRIM_PCT = Number(process.env.AGGR_TRIM_PCT || 0.05); // 5%
const MIN_N_FOR_STATS = 5;
const MIN_N_FOR_UPLIFT = 12; // support across multiple models

function percentile(values, p) {
  if (!values.length) return null;
  const idx = (values.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return values[lo];
  return Math.round(values[lo] + (values[hi] - values[lo]) * (idx - lo));
}
function iqrOverMedian(values) {
  if (values.length < 4) return null;
  const sorted = [...values].sort((a,b)=>a-b);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const med = percentile(sorted, 0.50);
  if (!med) return null;
  const iqr = q3 - q1;
  return med > 0 ? (iqr / med) : null;
}

async function main() {
  const client = await pool.connect();
  try {
    // Pull the latest live listing totals per item within the lookback window
    const res = await client.query(`
      WITH latest_totals AS (
        SELECT DISTINCT ON (ip.item_id)
          i.model_key AS model,
          COALESCE(i.variant_key, '') AS variant_key,
          COALESCE(i.condition_band, 'ANY') AS condition_band,
          COALESCE(ip.total, ip.price + COALESCE(ip.shipping, 0)) AS total_cents
        FROM item_prices ip
        JOIN items i ON i.item_id = ip.item_id
        WHERE ip.observed_at >= NOW() - INTERVAL '${WINDOW_DAYS} days'
        ORDER BY ip.item_id, ip.observed_at DESC
      ),
      filtered AS (
        SELECT model, variant_key, condition_band, total_cents
        FROM latest_totals
        WHERE model IS NOT NULL
          AND model <> ''
          AND total_cents IS NOT NULL
          AND total_cents > 0
      ),
      grouped AS (
        SELECT model, variant_key, condition_band, array_agg(total_cents ORDER BY total_cents) AS totals
        FROM filtered
        GROUP BY model, variant_key, condition_band
      )
      SELECT model, variant_key, condition_band, totals FROM grouped
    `);

    for (const row of res.rows) {
      const totals = (row.totals || []).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
      const n = totals.length;
      if (n < MIN_N_FOR_STATS) {
        await client.query(`
          INSERT INTO aggregated_stats_variant (model, variant_key, condition_band, window_days, n, p10_cents, p50_cents, p90_cents, dispersion_ratio, updated_at)
          VALUES ($1,$2,$3,$4,$5,NULL,NULL,NULL,NULL,NOW())
          ON CONFLICT (model, variant_key, condition_band, window_days)
          DO UPDATE SET n = EXCLUDED.n, p10_cents = NULL, p50_cents = NULL, p90_cents = NULL, dispersion_ratio = NULL, updated_at = NOW()
        `, [row.model, row.variant_key, row.condition_band, WINDOW_DAYS, n]);
        continue;
      }
      const trimN = Math.floor(n * TRIM_PCT);
      const trimmed = totals.slice(trimN, totals.length - trimN);
      const p10 = percentile(trimmed, 0.10);
      const p50 = percentile(trimmed, 0.50);
      const p90 = percentile(trimmed, 0.90);
      const disp = iqrOverMedian(trimmed);

      await client.query(`
        INSERT INTO aggregated_stats_variant (model, variant_key, condition_band, window_days, n, p10_cents, p50_cents, p90_cents, dispersion_ratio, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
        ON CONFLICT (model, variant_key, condition_band, window_days)
        DO UPDATE SET n = EXCLUDED.n, p10_cents = EXCLUDED.p10_cents, p50_cents = EXCLUDED.p50_cents, p90_cents = EXCLUDED.p90_cents, dispersion_ratio = EXCLUDED.dispersion_ratio, updated_at = NOW()
      `, [row.model, row.variant_key, row.condition_band, WINDOW_DAYS, n, p10, p50, p90, disp]);
    }

    // Compute uplift ratios per variant_key (across all models)
    // For models where variant_key exists with enough n, divide variant median by base model median.
    const varRows = await client.query(`
      SELECT model, variant_key, p50_cents, n
      FROM aggregated_stats_variant
      WHERE window_days = $1
        AND variant_key <> ''
        AND n >= $2
        AND p50_cents IS NOT NULL
    `, [WINDOW_DAYS, MIN_N_FOR_STATS]);

    const baseMap = new Map(); // key: model -> base median cents (variant_key='')
    const baseRows = await client.query(`
      SELECT model, p50_cents, n
      FROM aggregated_stats_variant
      WHERE window_days = $1 AND variant_key = '' AND n >= $2 AND p50_cents IS NOT NULL
    `, [WINDOW_DAYS, MIN_N_FOR_STATS]);
    for (const b of baseRows.rows) {
      baseMap.set(b.model, Number(b.p50_cents || 0));
    }

    if (!varRows.rows.length) {
      console.log("No variant medians available; skipping uplift refresh.");
    } else {
      // Collect ratios for each variant_key across models
      const ratiosByVariant = new Map();
      for (const v of varRows.rows) {
        const baseMed = baseMap.get(v.model);
        const varMed = Number(v.p50_cents || 0);
        if (!baseMed || !varMed) continue;
        const ratio = varMed / baseMed;
        if (!isFinite(ratio) || ratio <= 0) continue;
        const arr = ratiosByVariant.get(v.variant_key) || [];
        arr.push(ratio);
        ratiosByVariant.set(v.variant_key, arr);
      }

      // Write aggregated uplifts
      for (const [vk, arr] of ratiosByVariant.entries()) {
        if (arr.length < MIN_N_FOR_UPLIFT) continue;
        arr.sort((a,b)=>a-b);
        const medRatio = arr.length % 2 ? arr[(arr.length-1)/2] : (arr[arr.length/2-1] + arr[arr.length/2]) / 2;
        await client.query(`
          INSERT INTO aggregated_variant_uplift (variant_key, uplift_ratio, support_n, updated_at)
          VALUES ($1,$2,$3,NOW())
          ON CONFLICT (variant_key)
          DO UPDATE SET uplift_ratio = EXCLUDED.uplift_ratio, support_n = EXCLUDED.support_n, updated_at = NOW()
        `, [vk, medRatio, arr.length]);
      }
    }

    console.log("Aggregation complete.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
