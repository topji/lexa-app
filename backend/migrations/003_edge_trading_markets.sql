-- Add user-selected markets for edge trading (btc-15m, btc-1h, eth-15m, eth-1h, sol-15m, sol-1h).
-- NULL or empty = trade all markets.
-- From project root: psql $DATABASE_URL -f backend/migrations/003_edge_trading_markets.sql

ALTER TABLE edge_trading ADD COLUMN IF NOT EXISTS markets TEXT[] DEFAULT NULL;
