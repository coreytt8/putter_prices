// pages/api/admin/backfill-variants.js
export const runtime = "nodejs";

import { getSql } from "../../../lib/db";
import { normalizeModelKey } from "../../../lib/normalize";
import { detectVariantTags, buildVariantKey } from "../../../lib/variant-detect";

const DEFAULT_LIMIT = 5000;
const DEFAULT_SINCE_DAYS = 365;
const MAX_SINCE_DAYS = 3650;
const MAX_LIMIT = 20000;
const DEFAULT_MODEL_SCAN_LIMIT = 500;

function parseBool(value) {
  return /^(1|true|yes)$/i.test(String(value || ""));
}

function parseNumber(value, fallback, { min = 0, max = Number.POSITIVE_INFINITY } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num) || Number.isNaN(num)) return fallback;
  if (num < min) return min;
  if (num > max) return max;
  return num;
}

async function backfillForModel(sql, {
  searchLabel,
  baseKey,
  since,
  limit,
  dryRun,
  matchExact = false,
}) {
  const likePattern = searchLabel ? `%${searchLabel.replace(/\s+/g, "%")}%` : null;
  const rows = matchExact
    ? await sql`
        SELECT item_id, model, variant_key, snapshot_ts
        FROM listing_snapshots
        WHERE (variant_key IS NULL OR variant_key = '')
          AND model = ${searchLabel}
          AND snapshot_ts >= ${since}
        ORDER BY snapshot_ts DESC
        LIMIT ${limit}
      `
    : await sql`
        SELECT item_id, model, variant_key, snapshot_ts
        FROM listing_snapshots
        WHERE (variant_key IS NULL OR variant_key = '')
          AND model ILIKE ${likePattern}
          AND snapshot_ts >= ${since}
        ORDER BY snapshot_ts DESC
        LIMIT ${limit}
      `;

  let updated = 0;
  const attempts = [];
  const touchedModels = new Set();

  for (const row of rows) {
    const rawModel = row.model || "";
    const normalized = normalizeModelKey(rawModel);
    if (!matchExact && normalized !== baseKey) {
      continue;
    }

    const tags = detectVariantTags(rawModel);
    if (!tags || tags.length === 0) continue;

    const variantKey = buildVariantKey(baseKey, tags);
    if (!variantKey) continue;

    attempts.push({ item_id: row.item_id, tags, vkey: variantKey });
    if (rawModel) touchedModels.add(rawModel);

    if (!dryRun) {
      await sql`
        UPDATE listing_snapshots
        SET variant_key = ${variantKey}
        WHERE item_id = ${row.item_id}
          AND (variant_key IS NULL OR variant_key = '')
      `;
      updated++;
    }
  }

  return {
    scanned: rows.length,
    updated,
    attempts,
    sample: attempts[0] || null,
    touchedModels: Array.from(touchedModels),
  };
}

async function refreshAggregates(sql, models) {
  if (!models || models.length === 0) {
    return { triggered: false, windows: [] };
  }

  const windows = [60, 90, 180];
  const uniqueModels = Array.from(new Set(models.filter(Boolean)));
  if (uniqueModels.length === 0) {
    return { triggered: false, windows: [] };
  }

  const results = [];
  const modelArray = sql.array(uniqueModels, "text");

  for (const windowDays of windows) {
    const anyRows = await sql`
      INSERT INTO aggregated_stats_variant
        (model, variant_key, condition_band, window_days, n, p10_cents, p50_cents, p90_cents, dispersion_ratio, updated_at)
      SELECT
        s.model,
        COALESCE(s.variant_key, '') AS variant_key,
        'ANY'::text AS condition_band,
        ${windowDays}::int AS window_days,
        COUNT(*)::int AS n,
        CAST(percentile_cont(0.10) WITHIN GROUP (ORDER BY s.price_cents) AS INT) AS p10_cents,
        CAST(percentile_cont(0.50) WITHIN GROUP (ORDER BY s.price_cents) AS INT) AS p50_cents,
        CAST(percentile_cont(0.90) WITHIN GROUP (ORDER BY s.price_cents) AS INT) AS p90_cents,
        CASE
          WHEN percentile_cont(0.50) WITHIN GROUP (ORDER BY s.price_cents) = 0 THEN NULL
          ELSE (
            percentile_cont(0.90) WITHIN GROUP (ORDER BY s.price_cents)::numeric
            / NULLIF(percentile_cont(0.50) WITHIN GROUP (ORDER BY s.price_cents), 0)::numeric
          )
        END AS dispersion_ratio,
        NOW() AS updated_at
      FROM listing_snapshots s
      WHERE s.snapshot_ts >= NOW() - make_interval(days => ${windowDays})
        AND s.model = ANY(${modelArray})
        AND s.price_cents IS NOT NULL
      GROUP BY s.model, COALESCE(s.variant_key, '')
      ON CONFLICT (model, variant_key, condition_band, window_days)
      DO UPDATE SET
        n = EXCLUDED.n,
        p10_cents = EXCLUDED.p10_cents,
        p50_cents = EXCLUDED.p50_cents,
        p90_cents = EXCLUDED.p90_cents,
        dispersion_ratio = EXCLUDED.dispersion_ratio,
        updated_at = EXCLUDED.updated_at
      RETURNING 1
    `;

    const bandRows = await sql`
      INSERT INTO aggregated_stats_variant
        (model, variant_key, condition_band, window_days, n, p10_cents, p50_cents, p90_cents, dispersion_ratio, updated_at)
      SELECT
        s.model,
        COALESCE(s.variant_key, '') AS variant_key,
        s.condition_band,
        ${windowDays}::int AS window_days,
        COUNT(*)::int AS n,
        CAST(percentile_cont(0.10) WITHIN GROUP (ORDER BY s.price_cents) AS INT) AS p10_cents,
        CAST(percentile_cont(0.50) WITHIN GROUP (ORDER BY s.price_cents) AS INT) AS p50_cents,
        CAST(percentile_cont(0.90) WITHIN GROUP (ORDER BY s.price_cents) AS INT) AS p90_cents,
        CASE
          WHEN percentile_cont(0.50) WITHIN GROUP (ORDER BY s.price_cents) = 0 THEN NULL
          ELSE (
            percentile_cont(0.90) WITHIN GROUP (ORDER BY s.price_cents)::numeric
            / NULLIF(percentile_cont(0.50) WITHIN GROUP (ORDER BY s.price_cents), 0)::numeric
          )
        END AS dispersion_ratio,
        NOW() AS updated_at
      FROM listing_snapshots s
      WHERE s.snapshot_ts >= NOW() - make_interval(days => ${windowDays})
        AND s.model = ANY(${modelArray})
        AND s.price_cents IS NOT NULL
      GROUP BY s.model, COALESCE(s.variant_key, ''), s.condition_band
      ON CONFLICT (model, variant_key, condition_band, window_days)
      DO UPDATE SET
        n = EXCLUDED.n,
        p10_cents = EXCLUDED.p10_cents,
        p50_cents = EXCLUDED.p50_cents,
        p90_cents = EXCLUDED.p90_cents,
        dispersion_ratio = EXCLUDED.dispersion_ratio,
        updated_at = EXCLUDED.updated_at
      RETURNING 1
    `;

    results.push({
      windowDays,
      updatedAny: anyRows?.length || 0,
      updatedBands: bandRows?.length || 0,
    });
  }

  return { triggered: true, windows: results };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "method not allowed" });
    }

    const ADMIN = process.env.ADMIN_KEY || "12qwaszx!@QWASZX";
    const headerKey = String(req.headers["x-admin-key"] || "");
    if (headerKey !== ADMIN) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    // Inputs
    const onlyModelRaw = String(req.query.onlyModel || req.query.model || "").trim();
    const dryRun = parseBool(req.query.dryRun || req.query.dryrun);
    const limit = parseNumber(req.query.limit, DEFAULT_LIMIT, {
      min: 1,
      max: MAX_LIMIT,
    });
    const sinceDays = parseNumber(req.query.sinceDays, DEFAULT_SINCE_DAYS, {
      min: 1,
      max: MAX_SINCE_DAYS,
    });

    const sql = getSql();

    // Time window
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    if (!onlyModelRaw) {
      const limitModels = parseNumber(
        req.query.limitModels || req.query.modelLimit,
        DEFAULT_MODEL_SCAN_LIMIT,
        { min: 1, max: 5000 }
      );

      const models = await sql`
        SELECT DISTINCT model
        FROM listing_snapshots
        WHERE snapshot_day >= CURRENT_DATE - make_interval(days => ${sinceDays})
          AND COALESCE(model, '') <> ''
        ORDER BY model
        LIMIT ${limitModels}
      `;

      const processed = [];
      const samples = [];
      let totalUpdated = 0;
      let totalScanned = 0;

      for (const entry of models) {
        const baseModel = entry.model;
        const baseKey = normalizeModelKey(baseModel || "");
        if (!baseKey) continue;

        const result = await backfillForModel(sql, {
          searchLabel: baseModel,
          baseKey,
          since,
          limit,
          dryRun,
          matchExact: true,
        });

        processed.push({
          model: baseModel,
          baseKey,
          scanned: result.scanned,
          updated: result.updated,
          touchedModels: result.touchedModels,
        });
        if (result.sample) {
          samples.push({ model: baseModel, sample: result.sample });
        }
        totalUpdated += result.updated;
        totalScanned += result.scanned;
      }

      const aggregateResult = !dryRun && totalUpdated > 0
        ? await refreshAggregates(
            sql,
            processed
              .filter((p) => p.updated > 0)
              .flatMap((p) => p.touchedModels && p.touchedModels.length ? p.touchedModels : [p.model])
          )
        : { triggered: false, windows: [] };

      return res.status(200).json({
        ok: true,
        mode: "global",
        scannedModels: processed.length,
        scannedRows: totalScanned,
        updatedRows: totalUpdated,
        dryRun,
        models: processed,
        aggregates: aggregateResult,
        sample: samples[0] || null,
      });
    }

    const baseKey = normalizeModelKey(onlyModelRaw);
    const result = await backfillForModel(sql, {
      searchLabel: onlyModelRaw,
      baseKey,
      since,
      limit,
      dryRun,
      matchExact: false,
    });

    if (!dryRun && result.updated > 0) {
      const modelsToRefresh = result.touchedModels && result.touchedModels.length
        ? result.touchedModels
        : [onlyModelRaw, baseKey].filter(Boolean);
      await refreshAggregates(sql, modelsToRefresh);
    }

    return res.status(200).json({
      ok: true,
      onlyModel: onlyModelRaw,
      baseKey,
      scanned: result.scanned,
      updated: result.updated,
      dryRun,
      sample: result.sample,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
