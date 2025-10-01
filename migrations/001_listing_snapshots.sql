-- Raw listing snapshots (append-only)
CREATE TABLE IF NOT EXISTS listing_snapshots (
  snapshot_ts       TIMESTAMPTZ NOT NULL,
  item_id           TEXT        NOT NULL,
  model             TEXT        NOT NULL,          -- canonical model key (e.g., "scotty-cameron__phantom-x-5-5")
  variant_key       TEXT        NOT NULL DEFAULT '',-- '' for base; else e.g. 'ct', 'lh', 'arm-lock'
  condition_band    TEXT        NOT NULL DEFAULT 'ANY', -- 'NEW' | 'LIKE_NEW' | 'USED_GOOD' | ... or 'ANY'
  price_cents       INTEGER     NOT NULL,          -- total (item + shipping) in cents
  currency          TEXT        NOT NULL DEFAULT 'USD',
  seller_username   TEXT,
  seller_feedback   NUMERIC,                       -- 0..100
  location          TEXT,
  title             TEXT,
  url               TEXT,
  PRIMARY KEY (snapshot_ts, item_id)
);

CREATE INDEX IF NOT EXISTS idx_ls_model_cond_time
  ON listing_snapshots (model, variant_key, condition_band, snapshot_ts);
