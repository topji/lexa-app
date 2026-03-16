import { getPool } from './client.js'

export type EdgeTradingRow = {
  id: number
  user_id: number
  wallet_id: number
  order_size_usd: string
  enabled: boolean
  last_entered_slug: string | null
  last_entered_at: Date | null
  created_at: Date
  updated_at: Date
  /** Selected market ids (e.g. btc-15m, eth-1h). Null/empty = all markets. */
  markets: string[] | null
}

export async function getEdgeTradingByUserId(userId: number): Promise<EdgeTradingRow | null> {
  const pool = getPool()
  const res = await pool.query<EdgeTradingRow>(
    'SELECT * FROM edge_trading WHERE user_id = $1',
    [userId]
  )
  return res.rows[0] ?? null
}

export async function upsertEdgeTradingStart(args: {
  userId: number
  walletId: number
  orderSizeUsd: number
  markets?: string[] | null
}): Promise<EdgeTradingRow> {
  const pool = getPool()
  const markets = args.markets && args.markets.length > 0 ? args.markets : null
  const res = await pool.query<EdgeTradingRow>(
    `INSERT INTO edge_trading (user_id, wallet_id, order_size_usd, enabled, markets, updated_at)
     VALUES ($1, $2, $3, TRUE, $4, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       wallet_id = EXCLUDED.wallet_id,
       order_size_usd = EXCLUDED.order_size_usd,
       enabled = TRUE,
       markets = EXCLUDED.markets,
       updated_at = NOW()
     RETURNING *`,
    [args.userId, args.walletId, args.orderSizeUsd, markets]
  )
  return res.rows[0]!
}

export async function setEdgeTradingStop(userId: number): Promise<void> {
  const pool = getPool()
  await pool.query(
    'UPDATE edge_trading SET enabled = FALSE, updated_at = NOW() WHERE user_id = $1',
    [userId]
  )
}

export async function setEdgeTradingLastEntered(args: {
  userId: number
  slug: string
}): Promise<void> {
  const pool = getPool()
  await pool.query(
    'UPDATE edge_trading SET last_entered_slug = $2, last_entered_at = NOW(), updated_at = NOW() WHERE user_id = $1',
    [args.userId, args.slug]
  )
}

/** Ensure edge_trading has markets column (user-selected markets for edge trading). */
export async function ensureEdgeTradingMarketsColumn(): Promise<void> {
  const pool = getPool()
  await pool.query('ALTER TABLE edge_trading ADD COLUMN IF NOT EXISTS markets TEXT[] DEFAULT NULL')
}

/** Ensure edge_trading_entered_slugs table exists (for DBs created before this table was added). */
export async function ensureEdgeTradingEnteredSlugsTable(): Promise<void> {
  const pool = getPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS edge_trading_entered_slugs (
      user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slug            VARCHAR(256) NOT NULL,
      market          VARCHAR(16),
      side            VARCHAR(8),
      order_size_usd  NUMERIC(18, 4),
      entered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, slug)
    )
  `)
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_edge_trading_entered_slugs_user_id ON edge_trading_entered_slugs (user_id)'
  )
  await pool.query('ALTER TABLE edge_trading_entered_slugs ADD COLUMN IF NOT EXISTS market VARCHAR(16)')
  await pool.query('ALTER TABLE edge_trading_entered_slugs ADD COLUMN IF NOT EXISTS side VARCHAR(8)')
  await pool.query('ALTER TABLE edge_trading_entered_slugs ADD COLUMN IF NOT EXISTS order_size_usd NUMERIC(18, 4)')
}

/** Cooldown: has this user already entered this slug (market window)? */
export async function hasEnteredSlug(userId: number, slug: string): Promise<boolean> {
  const pool = getPool()
  const res = await pool.query<{ n: number }>(
    'SELECT 1 AS n FROM edge_trading_entered_slugs WHERE user_id = $1 AND slug = $2 LIMIT 1',
    [userId, slug]
  )
  return res.rows.length > 0
}

export type EdgeTradingEntryRow = {
  slug: string
  market: string | null
  side: string | null
  order_size_usd: string | null
  entered_at: Date
}

/** List edge trading entries for a user (for "Your edge trades" and Polymarket claim link). */
export async function listEdgeTradingEntriesByUserId(userId: number, limit: number = 50): Promise<EdgeTradingEntryRow[]> {
  const pool = getPool()
  const res = await pool.query<EdgeTradingEntryRow>(
    `SELECT slug, market, side, order_size_usd, entered_at
     FROM edge_trading_entered_slugs
     WHERE user_id = $1
     ORDER BY entered_at DESC
     LIMIT $2`,
    [userId, limit]
  )
  return res.rows
}

/** Record that this user entered this slug (for cooldown and history). */
export async function recordEnteredSlug(args: {
  userId: number
  slug: string
  market?: string
  side?: string
  orderSizeUsd?: number
}): Promise<void> {
  const pool = getPool()
  const { userId, slug, market, side, orderSizeUsd } = args
  await pool.query(
    `INSERT INTO edge_trading_entered_slugs (user_id, slug, market, side, order_size_usd) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, slug) DO UPDATE SET market = COALESCE(EXCLUDED.market, edge_trading_entered_slugs.market),
       side = COALESCE(EXCLUDED.side, edge_trading_entered_slugs.side),
       order_size_usd = COALESCE(EXCLUDED.order_size_usd, edge_trading_entered_slugs.order_size_usd)`,
    [userId, slug, market ?? null, side ?? null, orderSizeUsd ?? null]
  )
}

export async function getAllEnabledEdgeTrading(): Promise<EdgeTradingRow[]> {
  const pool = getPool()
  const res = await pool.query<EdgeTradingRow>(
    'SELECT * FROM edge_trading WHERE enabled = TRUE'
  )
  return res.rows
}
