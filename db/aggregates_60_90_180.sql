-- db/aggregates_60_90_180.sql
-- Rebuild per-condition and ANY rollups for 60 / 90 / 180 day windows.
-- Uses listing_snapshots(model, variant_key, price_cents, condition_band, snapshot_ts).
-- NOTE: We aggregate on price_cents. If you prefer price+shipping, swap to total_cents.

BEGIN;

-- 0) Ensure target table exists (safe to re-run)
CREATE TABLE IF NOT EXISTS public.aggregated_stats_variant (
  model            text    NOT NULL,
  variant_key      text    NOT NULL DEFAULT '',
  condition_band   text    NOT NULL,
  window_days      integer NOT NULL,
  n                integer NOT NULL,
  p10_cents        integer,
  p50_cents        integer,
  p90_cents        integer,
  dispersion_ratio numeric,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aggregated_stats_variant_pkey
    PRIMARY KEY (model, variant_key, condition_band, window_days)
);

CREATE INDEX IF NOT EXISTS idx_agg_model_window
  ON public.aggregated_stats_variant (model, window_days);

-- Helper macro-ish comments:
-- Replace WINDOW := {60|90|180} and INTERVAL := '{60|90|180} days' in each block below.

--------------------------
-- 1) WINDOW = 60 days  --
--------------------------
DELETE FROM public.aggregated_stats_variant WHERE window_days = 60;

INSERT INTO public.aggregated_stats_variant
  (model, variant_key, condition_band, window_days, n,
   p10_cents, p50_cents, p90_cents, dispersion_ratio, updated_at)
SELECT * FROM (
  -- Per-condition rows (exclude NULL/'ANY')
  SELECT
    model,
    COALESCE(variant_key,'') AS variant_key,
    condition_band,
    60 AS window_days,
    COUNT(*) AS n,
    CAST(percentile_cont(0.10) WITHIN GROUP (ORDER BY price_cents) AS INT) AS p10_cents,
    CAST(percentile_cont(0.50) WITHIN GROUP (ORDER BY price_cents) AS INT) AS p50_cents,
    CAST(percentile_cont(0.90) WITHIN GROUP (ORDER BY price_cents) AS INT) AS p90_cents,
    CASE
      WHEN percentile_cont(0.50) WITHIN GROUP (ORDER BY price_cents) = 0 THEN NULL
      ELSE (
        (percentile_cont(0.90) WITHIN GROUP (ORDER BY price_cents))::numeric
        / NULLIF((percentile_cont(0.50) WITHIN GROUP (ORDER BY price_cents)), 0)::numeric
      )
    END AS dispersion_ratio,
    now() AS updated_at
  FROM public.listing_snapshots
  WHERE snapshot_ts >= now() - interval '60 days'
    AND condition_band IS NOT NULL
    AND condition_band <> 'ANY'
  GROUP BY model, COALESCE(variant_key,''), condition_band

  UNION ALL

  -- ANY roll-up (one per model+variant)
  SELECT
    model,
    COALESCE(variant_key,'') AS variant_key,
    'ANY'::text AS condition_band,
    60 AS window_days,
    COUNT(*) AS n,
    CAST(percentile_cont(0.10) WITHIN GROUP (ORDER BY price_cents) AS INT) AS p10_cents,
    CAST(percentile_cont(0.50) WITHIN GROUP (ORDER BY price_cents) AS INT) AS p50_cents,
    CAST(percentile_cont(0.90) WITHIN GROUP (ORDER BY price_cents) AS INT) AS p90_cents,
    CASE
      WHEN percentile_cont(0.50) WITHIN GROUP (ORDER BY price_cents) = 0 THEN NULL
      ELSE (
        (percentile_cont(0.90) WITHIN GROUP (ORDER BY price_cents))::numeric
        / NULLIF((percentile_cont(0.50) WITHIN GROUP (ORDER BY price_cents)), 0)::numeric
      )
    END AS dispersion_ratio,
    now() AS updated_at
  FROM public.listing_snapshots
  WHERE snapshot_ts >= now() - interval '60 days'
  GROUP BY model, COALESCE(variant_key,'')
) u
ON CONFLICT ON CONSTRAINT aggregated_stats_variant_pkey DO UPDATE
SET n = EXCLUDED.n,
    p10_cents = EXCLUDED.p10_cents,
    p50_cents = EXCLUDED.p50_cents,
    p90_cents = EXCLUDED.p90_cents,
    dispersion_ratio = EXCLUDED.dispersion_ratio,
    updated_at = EXCLUDED.updated_at;

--------------------------
-- 2) WINDOW = 90 days  --
--------------------------
DELETE FROM public.aggregated_stats_variant WHERE window_days = 90;

INSERT INTO public.aggregated_stats_variant
  (model, variant_key, condition_band, window_days, n,
   p10_cents, p50_cents, p90_cents, dispersion_ratio, updated_at)
SELECT * FROM (
  SELECT
    model,
    COALESCE(variant_key,'') AS variant_key,
    condition_band,
    90 AS window_days,
    COUNT(*) AS n,
    CAST(percentile_cont(0.10) WITHIN GROUP (ORDER BY price_cents) AS INT) AS p10_cents,
    CAST(percentile_cont(0.50) WITHIN GROUP (ORDER BY price_cents) AS INT) AS p50_cents,
    CAST(percentile_cont(0.90) WITHIN GROUP (ORDER BY price_cents) AS INT) AS p90_cents,
    CASE
      WHEN percentile_cont(0.50) WITHIN GROUP (ORDER BY price_cents) = 0 THEN NULL
      ELSE (
        (percentile_cont(0.90) WITHIN GROUP (ORDER BY price_cents))::numeric
        / NULLIF((percentile_cont(0.50) WITHIN GROUP (ORDER BY price_cents)), 0)::numeric
      )
    END AS dispersion_ratio,
    now() AS updated_at
  FROM public.listing_snapshots
  WHERE snapshot_ts >= now() - interval '90 days'
    AND condition_band IS NOT NULL
    AND condition_band <> 'ANY'
  GROUP BY model, COALESCE(variant_key,''), condition_band

  UNION ALL

  SELECT
    model,
    COALESCE(variant_key,'') AS variant_key,
    'ANY'::text AS condition_band,
    90 AS window_days,
    COUNT(*) AS n,
    CAST(percentile_cont(0.10) WITHIN GROUP (ORDER BY price_cents) AS INT) AS p10_cents,
    CAST(percentile_cont(0.50) WITHIN GROUP (ORDER BY price_cents) AS INT) AS p50_cents,
    CAST(percentile_cont(0.90) WITHIN GROUP (ORDER BY price_cents) AS INT) AS p90_cents,
    CASE
      WHEN percentile_cont(0.50) WITHIN GROUP (ORDER BY price_cents) = 0 THEN NULL
      ELSE (
        (percentile_cont(0.90) WITHIN GROUP (ORDER BY price_cents))::numeric
        / NULLIF((percentile_cont(0.50) WITHIN GROUP (ORDER BY price_cents)), 0)::numeric
      )
    END AS dispersion_ratio,
    now() AS updated_at
  FROM public.listing_snapshots
  WHERE snapshot_ts >= now() - interval '90 days'
  GROUP BY model, COALESCE(variant_key,'')
) u
ON CONFLICT ON CONSTRAINT aggregated_stats_variant_pkey DO UPDATE
SET n = EXCLUDED.n,
    p10_cents = EXCLUDED.p10_cents,
    p50_cents = EXCLUDED.p50_cents,
    p90_cents = EXCLUDED.p90_cents,
    dispersion_ratio = EXCLUDED.dispersion_ratio,
    updated_at = EXCLUDED.updated_at;

---------------------------
-- 3) WINDOW = 180 days  --
---------------------------
DELETE FROM public.aggregated_stats_variant WHERE window_days = 180;

INSERT INTO public.aggregated_stats_variant
  (model, variant_key, condition_band, window_days, n,
   p10_cents, p50_cents, p90_cents, dispersion_ratio, updated_at)
SELECT * FROM (
  SELECT
    model,
    COALESCE(variant_key,'') AS variant_key,
    condition_band,
    180 AS window_days,
    COUNT(*) AS n,
    CAST(percentile_cont(0.10) WITHIN GROUP (ORDER BY price_cents) AS INT) AS p10_cents,
    CAST(percentile_cont(0.50) WITHIN GROUP (ORDER BY price_cents) AS INT) AS p50_cents,
    CAST(percentile_cont(0.90) WITHIN GROUP (ORDER BY price_cents) AS INT) AS p90_cents,
    CASE
      WHEN percentile_cont(0.50) WITHIN GROUP (ORDER BY price_cents) = 0 THEN NULL
      ELSE (
        (percentile_cont(0.90) WITHIN GROUP (ORDER BY price_cents))::numeric
        / NULLIF((percentile_cont(0.50) WITHIN GROUP (ORDER BY price_cents)), 0)::numeric
      )
    END AS dispersion_ratio,
    now() AS updated_at
  FROM public.listing_snapshots
  WHERE snapshot_ts >= now() - interval '180 days'
    AND condition_band IS NOT NULL
    AND condition_band <> 'ANY'
  GROUP BY model, COALESCE(variant_key,''), condition_band

  UNION ALL

  SELECT
    model,
    COALESCE(variant_key,'') AS variant_key,
    'ANY'::text AS condition_band,
    180 AS window_days,
    COUNT(*) AS n,
    CAST(percentile_cont(0.10) WITHIN GROUP (ORDER BY price_cents) AS INT) AS p10_cents,
    CAST(percentile_cont(0.50) WITHIN GROUP (ORDER BY price_cents) AS INT) AS p50_cents,
    CAST(percentile_cont(0.90) WITHIN GROUP (ORDER BY price_cents) AS INT) AS p90_cents,
    CASE
      WHEN percentile_cont(0.50) WITHIN GROUP (ORDER BY price_cents) = 0 THEN NULL
      ELSE (
        (percentile_cont(0.90) WITHIN GROUP (ORDER BY price_cents))::numeric
        / NULLIF((percentile_cont(0.50) WITHIN GROUP (ORDER BY price_cents)), 0)::numeric
      )
    END AS dispersion_ratio,
    now() AS updated_at
  FROM public.listing_snapshots
  WHERE snapshot_ts >= now() - interval '180 days'
  GROUP BY model, COALESCE(variant_key,'')
) u
ON CONFLICT ON CONSTRAINT aggregated_stats_variant_pkey DO UPDATE
SET n = EXCLUDED.n,
    p10_cents = EXCLUDED.p10_cents,
    p50_cents = EXCLUDED.p50_cents,
    p90_cents = EXCLUDED.p90_cents,
    dispersion_ratio = EXCLUDED.dispersion_ratio,
    updated_at = EXCLUDED.updated_at;

COMMIT;
