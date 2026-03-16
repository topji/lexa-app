import { getPool } from './client.js'

export type CopySubscriptionRow = {
  id: number
  user_id: number
  wallet_id: number
  leader_address: string
  order_size_usd: string
  copy_sells: boolean
  max_trade_usd: string | null
  enabled: boolean
  last_seen_timestamp: number
  created_at: Date
  updated_at: Date
}

export type CopyHistoryRow = {
  id: number
  user_id: number
  wallet_id: number
  leader_address: string
  leader_tx_hash: string
  token_id: string | null
  market_slug: string | null
  outcome: string | null
  side: string | null
  price: string | null
  size: string | null
  amount_usd: string | null
  status: string
  error_message: string | null
  executed_at: Date
}

export async function ensureCopyTradingTables(): Promise<void> {
  const pool = getPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS copy_trading_subscriptions (
      id            BIGSERIAL PRIMARY KEY,
      user_id       BIGINT NOT NULL,
      wallet_id     BIGINT NOT NULL,
      leader_address TEXT NOT NULL,
      order_size_usd NUMERIC(18,6) NOT NULL,
      copy_sells    BOOLEAN NOT NULL DEFAULT false,
      max_trade_usd NUMERIC(18,6),
      enabled       BOOLEAN NOT NULL DEFAULT true,
      last_seen_timestamp BIGINT NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, leader_address)
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS copy_trading_history (
      id            BIGSERIAL PRIMARY KEY,
      user_id       BIGINT NOT NULL,
      wallet_id     BIGINT NOT NULL,
      leader_address TEXT NOT NULL,
      leader_tx_hash TEXT NOT NULL,
      token_id      TEXT,
      market_slug   TEXT,
      outcome       TEXT,
      side          TEXT,
      price         NUMERIC(18,6),
      size          NUMERIC(18,6),
      amount_usd    NUMERIC(18,6),
      status        TEXT NOT NULL DEFAULT 'executed',
      error_message TEXT,
      executed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, leader_tx_hash)
    )
  `)
}

export async function upsertCopySubscription(params: {
  userId: number
  walletId: number
  leaderAddress: string
  orderSizeUsd: number
  copySells?: boolean
  maxTradeUsd?: number | null
}): Promise<CopySubscriptionRow> {
  const pool = getPool()
  const { rows } = await pool.query<CopySubscriptionRow>(`
    INSERT INTO copy_trading_subscriptions
      (user_id, wallet_id, leader_address, order_size_usd, copy_sells, max_trade_usd, enabled, last_seen_timestamp, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, true, 0, NOW())
    ON CONFLICT (user_id, leader_address) DO UPDATE SET
      wallet_id     = EXCLUDED.wallet_id,
      order_size_usd = EXCLUDED.order_size_usd,
      copy_sells    = EXCLUDED.copy_sells,
      max_trade_usd = EXCLUDED.max_trade_usd,
      enabled       = true,
      updated_at    = NOW()
    RETURNING *
  `, [
    params.userId,
    params.walletId,
    params.leaderAddress.toLowerCase(),
    params.orderSizeUsd,
    params.copySells ?? false,
    params.maxTradeUsd ?? null,
  ])
  return rows[0]
}

export async function disableCopySubscription(userId: number, leaderAddress: string): Promise<void> {
  const pool = getPool()
  await pool.query(
    `UPDATE copy_trading_subscriptions SET enabled = false, updated_at = NOW()
     WHERE user_id = $1 AND leader_address = $2`,
    [userId, leaderAddress.toLowerCase()]
  )
}

export async function getEnabledCopySubscriptions(): Promise<CopySubscriptionRow[]> {
  const pool = getPool()
  const { rows } = await pool.query<CopySubscriptionRow>(
    `SELECT * FROM copy_trading_subscriptions WHERE enabled = true`
  )
  return rows
}

export async function listCopySubscriptionsByUser(userId: number): Promise<CopySubscriptionRow[]> {
  const pool = getPool()
  const { rows } = await pool.query<CopySubscriptionRow>(
    `SELECT * FROM copy_trading_subscriptions WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  )
  return rows
}

export async function updateLastSeenTimestamp(id: number, ts: number): Promise<void> {
  const pool = getPool()
  await pool.query(
    `UPDATE copy_trading_subscriptions SET last_seen_timestamp = $2, updated_at = NOW() WHERE id = $1`,
    [id, ts]
  )
}

export async function isTxHashCopied(userId: number, txHash: string): Promise<boolean> {
  const pool = getPool()
  const { rows } = await pool.query(
    `SELECT 1 FROM copy_trading_history WHERE user_id = $1 AND leader_tx_hash = $2 LIMIT 1`,
    [userId, txHash]
  )
  return rows.length > 0
}

export async function recordCopyTrade(params: {
  userId: number
  walletId: number
  leaderAddress: string
  leaderTxHash: string
  tokenId?: string | null
  marketSlug?: string | null
  outcome?: string | null
  side?: string | null
  price?: number | null
  size?: number | null
  amountUsd?: number | null
  status: 'executed' | 'skipped' | 'failed'
  errorMessage?: string | null
}): Promise<void> {
  const pool = getPool()
  await pool.query(`
    INSERT INTO copy_trading_history
      (user_id, wallet_id, leader_address, leader_tx_hash, token_id, market_slug,
       outcome, side, price, size, amount_usd, status, error_message)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT (user_id, leader_tx_hash) DO NOTHING
  `, [
    params.userId, params.walletId, params.leaderAddress.toLowerCase(), params.leaderTxHash,
    params.tokenId ?? null, params.marketSlug ?? null, params.outcome ?? null,
    params.side ?? null, params.price ?? null, params.size ?? null, params.amountUsd ?? null,
    params.status, params.errorMessage ?? null,
  ])
}

/**
 * Returns the net open shares we hold for a given tokenId across all copy trades.
 * net > 0  → we have an open long position (bought but not fully sold)
 * net = 0  → flat (never entered, or fully exited)
 */
export async function getCopyPositionShares(userId: number, tokenId: string): Promise<number> {
  const pool = getPool()
  const { rows } = await pool.query<{ buy_shares: string; sell_shares: string }>(`
    SELECT
      COALESCE(SUM(CASE WHEN side = 'BUY'  THEN size ELSE 0 END), 0) AS buy_shares,
      COALESCE(SUM(CASE WHEN side = 'SELL' THEN size ELSE 0 END), 0) AS sell_shares
    FROM copy_trading_history
    WHERE user_id = $1 AND token_id = $2 AND status = 'executed'
  `, [userId, tokenId])
  const buy = Number(rows[0]?.buy_shares ?? 0)
  const sell = Number(rows[0]?.sell_shares ?? 0)
  return Math.max(0, buy - sell)
}

export async function listCopyHistoryByUser(userId: number, limit: number): Promise<CopyHistoryRow[]> {
  const pool = getPool()
  const { rows } = await pool.query<CopyHistoryRow>(
    `SELECT * FROM copy_trading_history WHERE user_id = $1 ORDER BY executed_at DESC LIMIT $2`,
    [userId, limit]
  )
  return rows
}
