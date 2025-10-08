-- db/migrations/20251008_add_collector_columns.sql
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS collector_flags JSONB,
  ADD COLUMN IF NOT EXISTS rarity_score NUMERIC;
CREATE INDEX IF NOT EXISTS items_category_idx ON items(category);
