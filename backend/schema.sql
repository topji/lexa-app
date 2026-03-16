-- BTC 5m odds: one row per second per market window
-- window_ts = start of the 5-minute window (nearest 5-min mark)
-- sample_ts = exact observation time (UTC)
CREATE TABLE IF NOT EXISTS btc5m_odds (
  id                BIGSERIAL PRIMARY KEY,
  market_slug       VARCHAR(128) NOT NULL,
  market_name       VARCHAR(256) NOT NULL,
  window_ts         TIMESTAMPTZ NOT NULL,
  sample_ts         TIMESTAMPTZ NOT NULL,
  btc_price         NUMERIC(18, 4) NOT NULL,
  up_odd            NUMERIC(10, 6) NOT NULL,
  down_odd          NUMERIC(10, 6) NOT NULL,
  up_pct_chg_1s     NUMERIC(10, 4),
  up_pct_chg_2s     NUMERIC(10, 4),
  up_pct_chg_3s     NUMERIC(10, 4),
  up_pct_chg_4s     NUMERIC(10, 4),
  up_pct_chg_5s     NUMERIC(10, 4),
  down_pct_chg_1s   NUMERIC(10, 4),
  down_pct_chg_2s   NUMERIC(10, 4),
  down_pct_chg_3s   NUMERIC(10, 4),
  down_pct_chg_4s   NUMERIC(10, 4),
  down_pct_chg_5s   NUMERIC(10, 4),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_btc5m_odds_market_window ON btc5m_odds (market_slug, window_ts);
CREATE INDEX IF NOT EXISTS idx_btc5m_odds_sample_ts ON btc5m_odds (sample_ts);

COMMENT ON TABLE btc5m_odds IS 'Per-second Up/Down odds and BTC price for BTC 5m markets; window_ts = 5-min window start';

-- Generic market odds table supporting multiple assets and intervals
-- market: e.g. btc-5m, btc-15m, eth-5m, eth-15m, sol-5m, sol-15m
-- expiry_ts: end of the window (e.g. 5m or 15m expiry)
-- sample_ts: exact observation time (UTC)
-- price: underlying asset price (BTC, ETH, SOL, ...)
CREATE TABLE IF NOT EXISTS market_odds (
  id                BIGSERIAL PRIMARY KEY,
  market            VARCHAR(32) NOT NULL,
  expiry_ts         TIMESTAMPTZ NOT NULL,
  seconds_to_expiry INTEGER,
  sample_ts         TIMESTAMPTZ NOT NULL,
  price             NUMERIC(18, 4) NOT NULL,
  up_odd            NUMERIC(10, 6) NOT NULL,
  down_odd          NUMERIC(10, 6) NOT NULL,
  up_pct_chg_1s     NUMERIC(10, 4),
  up_pct_chg_2s     NUMERIC(10, 4),
  up_pct_chg_3s     NUMERIC(10, 4),
  up_pct_chg_4s     NUMERIC(10, 4),
  up_pct_chg_5s     NUMERIC(10, 4),
  down_pct_chg_1s   NUMERIC(10, 4),
  down_pct_chg_2s   NUMERIC(10, 4),
  down_pct_chg_3s   NUMERIC(10, 4),
  down_pct_chg_4s   NUMERIC(10, 4),
  down_pct_chg_5s   NUMERIC(10, 4),
  up_abs_chg_1s     NUMERIC(10, 6),
  up_abs_chg_2s     NUMERIC(10, 6),
  up_abs_chg_3s     NUMERIC(10, 6),
  up_abs_chg_4s     NUMERIC(10, 6),
  up_abs_chg_5s     NUMERIC(10, 6),
  down_abs_chg_1s   NUMERIC(10, 6),
  down_abs_chg_2s   NUMERIC(10, 6),
  down_abs_chg_3s   NUMERIC(10, 6),
  down_abs_chg_4s   NUMERIC(10, 6),
  down_abs_chg_5s   NUMERIC(10, 6),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_odds_market_expiry ON market_odds (market, expiry_ts, sample_ts DESC);
CREATE INDEX IF NOT EXISTS idx_market_odds_sample_ts ON market_odds (sample_ts);

COMMENT ON TABLE market_odds IS 'Per-second Up/Down odds and price for multiple crypto markets (btc-5m, btc-15m, eth-5m, etc.)';

-- SynthData API: per-second snapshots of Polymarket up/down insights (15m, 1h) for BTC
CREATE TABLE IF NOT EXISTS synthdata_insights (
  id                         BIGSERIAL PRIMARY KEY,
  market                     VARCHAR(16) NOT NULL,
  sample_ts                  TIMESTAMPTZ NOT NULL,
  slug                       VARCHAR(256),
  start_price                NUMERIC(18, 4),
  current_price              NUMERIC(18, 4),
  current_outcome            VARCHAR(8),
  synth_probability_up       NUMERIC(10, 6),
  polymarket_probability_up  NUMERIC(10, 6),
  event_start_time           TIMESTAMPTZ,
  event_end_time             TIMESTAMPTZ,
  best_bid_price             NUMERIC(10, 6),
  best_ask_price             NUMERIC(10, 6),
  best_bid_size              NUMERIC(18, 4),
  best_ask_size              NUMERIC(18, 4),
  polymarket_last_trade_time TIMESTAMPTZ,
  polymarket_last_trade_price NUMERIC(10, 6),
  polymarket_last_trade_outcome VARCHAR(8),
  raw                        JSONB,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_synthdata_insights_market_ts ON synthdata_insights (market, sample_ts DESC);
COMMENT ON TABLE synthdata_insights IS 'Per-second SynthData API responses for Polymarket up/down (btc-15m, btc-1h)';

-- Backfill for existing deployments: add seconds_to_expiry if missing
ALTER TABLE IF EXISTS market_odds
  ADD COLUMN IF NOT EXISTS seconds_to_expiry INTEGER;

ALTER TABLE IF EXISTS market_odds
  ADD COLUMN IF NOT EXISTS up_abs_chg_1s   NUMERIC(10, 6),
  ADD COLUMN IF NOT EXISTS up_abs_chg_2s   NUMERIC(10, 6),
  ADD COLUMN IF NOT EXISTS up_abs_chg_3s   NUMERIC(10, 6),
  ADD COLUMN IF NOT EXISTS up_abs_chg_4s   NUMERIC(10, 6),
  ADD COLUMN IF NOT EXISTS up_abs_chg_5s   NUMERIC(10, 6),
  ADD COLUMN IF NOT EXISTS down_abs_chg_1s NUMERIC(10, 6),
  ADD COLUMN IF NOT EXISTS down_abs_chg_2s NUMERIC(10, 6),
  ADD COLUMN IF NOT EXISTS down_abs_chg_3s NUMERIC(10, 6),
  ADD COLUMN IF NOT EXISTS down_abs_chg_4s NUMERIC(10, 6),
  ADD COLUMN IF NOT EXISTS down_abs_chg_5s NUMERIC(10, 6);

-- ---------------------------------------------------------------------------
-- Strategy + execution tables (Phase 2+)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id          BIGSERIAL PRIMARY KEY,
  wallet_address VARCHAR(64),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS wallet_address VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wallet_address_unique
  ON users (wallet_address)
  WHERE wallet_address IS NOT NULL;

-- If an older email index exists, it's safe to leave it; we stop using it.

-- Wallets can be custodial (server holds encrypted PK) or connected (no PK stored).
-- For auto-execution, custodial wallets are required.
CREATE TABLE IF NOT EXISTS wallets (
  id                         BIGSERIAL PRIMARY KEY,
  user_id                    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                       VARCHAR(16) NOT NULL CHECK (type IN ('custodial', 'connected')),
  funder_address             VARCHAR(64) NOT NULL,
  signature_type             SMALLINT NOT NULL DEFAULT 0,
  encrypted_private_key      TEXT,
  clob_api_key               TEXT,
  encrypted_clob_secret      TEXT,
  encrypted_clob_passphrase  TEXT,
  builder_proxy_address      VARCHAR(64),
  builder_deployed_at        TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets (user_id);

ALTER TABLE IF EXISTS wallets
  ADD COLUMN IF NOT EXISTS builder_proxy_address VARCHAR(64),
  ADD COLUMN IF NOT EXISTS builder_deployed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS strategies (
  id                           BIGSERIAL PRIMARY KEY,
  user_id                      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id                    BIGINT NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  name                         VARCHAR(128) NOT NULL,
  market                       VARCHAR(32) NOT NULL,
  active                       BOOLEAN NOT NULL DEFAULT FALSE,

  entry_side                   VARCHAR(8) NOT NULL CHECK (entry_side IN ('up', 'down')),
  entry_odd_max                 NUMERIC(10, 6) NOT NULL,
  entry_seconds_to_expiry_min   INTEGER NOT NULL,

  exit_stop_loss                NUMERIC(10, 6) NOT NULL,
  exit_seconds_to_expiry_max    INTEGER NOT NULL,

  order_size_usd                NUMERIC(18, 4) NOT NULL,

  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategies_user_active ON strategies (user_id, active);

ALTER TABLE IF EXISTS strategies
  ALTER COLUMN active SET DEFAULT FALSE;

-- Make entry_odd_max and exit_stop_loss nullable so users can use
-- change-based or percentage-based conditions instead of absolute thresholds.
ALTER TABLE IF EXISTS strategies
  ALTER COLUMN entry_odd_max  DROP NOT NULL,
  ALTER COLUMN exit_stop_loss DROP NOT NULL;

ALTER TABLE IF EXISTS strategies
  ADD COLUMN IF NOT EXISTS entry_odd_change_window_s  INTEGER,
  ADD COLUMN IF NOT EXISTS entry_odd_change_min       NUMERIC(10, 6),
  ADD COLUMN IF NOT EXISTS entry_odd_change_pct_min   NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS exit_profit_odd            NUMERIC(10, 6),
  ADD COLUMN IF NOT EXISTS exit_profit_pct            NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS exit_stop_loss_pct         NUMERIC(10, 4);

CREATE TABLE IF NOT EXISTS strategy_positions (
  id                  BIGSERIAL PRIMARY KEY,
  strategy_id         BIGINT NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  market              VARCHAR(32) NOT NULL,
  expiry_ts           TIMESTAMPTZ NOT NULL,
  side                VARCHAR(8) NOT NULL CHECK (side IN ('up', 'down')),
  token_id            VARCHAR(128),

  entry_sample_ts     TIMESTAMPTZ,
  entry_odd           NUMERIC(10, 6),
  entry_order_id      TEXT,
  entry_shares        NUMERIC(38, 18),

  exit_sample_ts      TIMESTAMPTZ,
  exit_odd            NUMERIC(10, 6),
  exit_order_id       TEXT,
  exit_reason         VARCHAR(16) CHECK (exit_reason IN ('stoploss', 'time', 'manual')),

  status              VARCHAR(16) NOT NULL CHECK (status IN ('open', 'closing', 'closed', 'failed')),

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_positions_strategy_status ON strategy_positions (strategy_id, status);

ALTER TABLE IF EXISTS strategy_positions
  ADD COLUMN IF NOT EXISTS entry_shares NUMERIC(38, 18);

-- Expand exit_reason to include 'profit'
ALTER TABLE IF EXISTS strategy_positions
  DROP CONSTRAINT IF EXISTS strategy_positions_exit_reason_check;
ALTER TABLE IF EXISTS strategy_positions
  ADD CONSTRAINT strategy_positions_exit_reason_check
    CHECK (exit_reason IN ('stoploss', 'time', 'manual', 'profit'));

-- Polymarket token_id can exceed 64 chars
ALTER TABLE IF EXISTS strategy_positions
  ALTER COLUMN token_id TYPE VARCHAR(128);

-- Edge trading: BTC 15m only, enter when Synth vs Polymarket edge >= 8 pp (Up) or <= -8 pp (Down). One config per user.
CREATE TABLE IF NOT EXISTS edge_trading (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id            BIGINT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  order_size_usd      NUMERIC(18, 4) NOT NULL,
  enabled             BOOLEAN NOT NULL DEFAULT FALSE,
  last_entered_slug   VARCHAR(256),
  last_entered_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_edge_trading_user_id ON edge_trading (user_id);
COMMENT ON TABLE edge_trading IS 'Edge trading (BTC/ETH/SOL 15m+1h): enter Up when edge >= 8 pp, Down when edge <= -8 pp.';

-- Cooldown per market (slug): do not enter the same slug twice per user. Also used to show "Your edge trades" and link to Polymarket to claim.
CREATE TABLE IF NOT EXISTS edge_trading_entered_slugs (
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug            VARCHAR(256) NOT NULL,
  market          VARCHAR(16),
  side            VARCHAR(8),
  order_size_usd  NUMERIC(18, 4),
  entered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_edge_trading_entered_slugs_user_id ON edge_trading_entered_slugs (user_id);
COMMENT ON TABLE edge_trading_entered_slugs IS 'Edge trading entries (one per market window per user). Link to Polymarket event to view position and claim.';

-- User trades from Polymarket CLOB (synced from getTrades). One row per trade per wallet.
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
CREATE INDEX IF NOT EXISTS idx_user_clob_trades_trade_timestamp ON user_clob_trades (trade_timestamp DESC);
COMMENT ON TABLE user_clob_trades IS 'Trades from CLOB getTrades, synced and stored for display.';
