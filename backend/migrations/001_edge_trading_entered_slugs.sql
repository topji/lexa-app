-- Run this if edge_trading_entered_slugs is missing (e.g. DB created before this table was added).
-- From project root: psql $DATABASE_URL -f backend/migrations/001_edge_trading_entered_slugs.sql

CREATE TABLE IF NOT EXISTS edge_trading_entered_slugs (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug       VARCHAR(256) NOT NULL,
  market     VARCHAR(16),
  side       VARCHAR(8),
  order_size_usd NUMERIC(18, 4),
  entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_edge_trading_entered_slugs_user_id ON edge_trading_entered_slugs (user_id);

-- Add columns if table existed without them (for existing deployments)
ALTER TABLE edge_trading_entered_slugs ADD COLUMN IF NOT EXISTS market VARCHAR(16);
ALTER TABLE edge_trading_entered_slugs ADD COLUMN IF NOT EXISTS side VARCHAR(8);
ALTER TABLE edge_trading_entered_slugs ADD COLUMN IF NOT EXISTS order_size_usd NUMERIC(18, 4);
