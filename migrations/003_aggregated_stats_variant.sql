-- What your existing /pages/api/model-stats.js expects
-- One row per (model, variant_key, condition_band, window_days)
CREATE TABLE IF NOT EXISTS aggregated_stats_variant (
  model            TEXT        NOT NULL,
  variant_key      TEXT        NOT NULL DEFAULT '',
  condition_band   TEXT        NOT NULL DEFAULT 'ANY',
  window_days      INTEGER     NOT NULL,           -- e.g. 30, 60
  n                INTEGER     NOT NULL,           -- sample size
  p10_cents        INTEGER,
  p50_cents        INTEGER,
  p90_cents        INTEGER,
  dispersion_ratio NUMERIC,                         -- optional spread metric
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (model, variant_key, condition_band, window_days)
);

CREATE INDEX IF NOT EXISTS idx_asv_lookup
  ON aggregated_stats_variant (model, variant_key, condition_band, window_days DESC);
