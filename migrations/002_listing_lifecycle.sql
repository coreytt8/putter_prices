-- Track appearance/disappearance for velocity (time to sell)
CREATE TABLE IF NOT EXISTS listing_lifecycle (
  item_id         TEXT PRIMARY KEY,
  model           TEXT        NOT NULL,
  variant_key     TEXT        NOT NULL DEFAULT '',
  condition_band  TEXT        NOT NULL DEFAULT 'ANY',
  first_seen_ts   TIMESTAMPTZ NOT NULL,
  last_seen_ts    TIMESTAMPTZ NOT NULL,
  is_active       BOOLEAN     NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ll_model_active ON listing_lifecycle (model, is_active);
