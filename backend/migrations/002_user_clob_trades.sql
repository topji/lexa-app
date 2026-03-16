-- Run if user_clob_trades is missing: psql $DATABASE_URL -f backend/migrations/002_user_clob_trades.sql

CREATE TABLE IF NOT EXISTS user_clob_trades (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id       BIGINT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  trade_id        VARCHAR(128) NOT NULL,
  token_id        VARCHAR(128),
  side            VARCHAR(8),
  price           NUMERIC(18, 6),
  size            NUMERIC(18, 6),
  amount_usd      NUMERIC(18, 4),
  trade_timestamp TIMESTAMPTZ,
  market_slug     VARCHAR(256),
  raw             JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (wallet_id, trade_id)
);

CREATE INDEX IF NOT EXISTS idx_user_clob_trades_user_id ON user_clob_trades (user_id);
CREATE INDEX IF NOT EXISTS idx_user_clob_trades_wallet_id ON user_clob_trades (wallet_id);
CREATE INDEX IF NOT EXISTS idx_user_clob_trades_trade_timestamp ON user_clob_trades (trade_timestamp DESC NULLS LAST);
