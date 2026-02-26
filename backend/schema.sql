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
