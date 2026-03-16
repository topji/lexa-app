import { getPool } from './client.js'

/** Create user_clob_trades table if missing (e.g. DB created before this table). */
export async function ensureUserClobTradesTable(): Promise<void> {
  const pool = getPool()
  await pool.query(`
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
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_user_clob_trades_user_id ON user_clob_trades (user_id)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_user_clob_trades_wallet_id ON user_clob_trades (wallet_id)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_user_clob_trades_trade_timestamp ON user_clob_trades (trade_timestamp DESC NULLS LAST)')
}

export type UserClobTradeRow = {
  id: number
  user_id: number
  wallet_id: number
  trade_id: string
  token_id: string | null
  side: string | null
  price: string | null
  size: string | null
  amount_usd: string | null
  trade_timestamp: Date | null
  market_slug: string | null
  raw: unknown
  created_at: Date
}

/** Normalize a CLOB trade object into our columns (CLOB response shape may vary). */
function normalizeClobTrade(t: Record<string, unknown>): {
  trade_id: string
  token_id: string | null
  side: string | null
  price: number | null
  size: number | null
  amount_usd: number | null
  trade_timestamp: Date | null
  market_slug: string | null
} {
  const id = t.id ?? t.trade_id ?? t.transaction_id
  const tradeId = typeof id === 'string' ? id : typeof id === 'number' ? String(id) : ''
  const assetId = t.asset_id ?? t.token_id ?? t.assetID ?? t.asset
  const tokenId = assetId != null ? String(assetId) : null
  const side = t.side != null ? String(t.side).toUpperCase() : null
  const price = typeof t.price === 'number' ? t.price : t.price != null ? parseFloat(String(t.price)) : null
  const size = typeof t.size === 'number' ? t.size : t.size != null ? parseFloat(String(t.size)) : null
  const amount = t.amount ?? (price != null && size != null ? price * size : null)
  const amountUsd = typeof amount === 'number' ? amount : amount != null ? parseFloat(String(amount)) : null
  const ts = t.timestamp ?? t.trade_timestamp ?? t.created_at ?? t.time
  let tradeTimestamp: Date | null = null
  if (ts != null) {
    if (ts instanceof Date) tradeTimestamp = ts
    else if (typeof ts === 'number') {
      const ms = ts > 1e12 ? ts : ts * 1000
      tradeTimestamp = new Date(ms)
    } else tradeTimestamp = new Date(String(ts))
  }
  const slug = t.market_slug ?? t.slug ?? t.eventSlug ?? t.market
  const marketSlug = slug != null ? String(slug) : null
  return {
    trade_id: tradeId || `unknown-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    token_id: tokenId,
    side: side && (side === 'BUY' || side === 'SELL') ? side : null,
    price: price != null && Number.isFinite(price) ? price : null,
    size: size != null && Number.isFinite(size) ? size : null,
    amount_usd: amountUsd != null && Number.isFinite(amountUsd) ? amountUsd : null,
    trade_timestamp: tradeTimestamp,
    market_slug: marketSlug,
  }
}

export async function upsertClobTrades(
  walletId: number,
  userId: number,
  trades: Record<string, unknown>[]
): Promise<void> {
  if (trades.length === 0) return
  const pool = getPool()
  for (const t of trades) {
    const n = normalizeClobTrade(t)
    const raw = JSON.stringify(t)
    await pool.query(
      `INSERT INTO user_clob_trades (wallet_id, user_id, trade_id, token_id, side, price, size, amount_usd, trade_timestamp, market_slug, raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       ON CONFLICT (wallet_id, trade_id) DO UPDATE SET
         token_id = COALESCE(EXCLUDED.token_id, user_clob_trades.token_id),
         side = COALESCE(EXCLUDED.side, user_clob_trades.side),
         price = COALESCE(EXCLUDED.price, user_clob_trades.price),
         size = COALESCE(EXCLUDED.size, user_clob_trades.size),
         amount_usd = COALESCE(EXCLUDED.amount_usd, user_clob_trades.amount_usd),
         trade_timestamp = COALESCE(EXCLUDED.trade_timestamp, user_clob_trades.trade_timestamp),
         market_slug = COALESCE(EXCLUDED.market_slug, user_clob_trades.market_slug),
         raw = EXCLUDED.raw`,
      [
        walletId,
        userId,
        n.trade_id,
        n.token_id,
        n.side,
        n.price,
        n.size,
        n.amount_usd,
        n.trade_timestamp,
        n.market_slug,
        raw,
      ]
    )
  }
}

export async function listClobTradesByUserId(
  userId: number,
  limit: number = 100
): Promise<UserClobTradeRow[]> {
  const pool = getPool()
  const res = await pool.query<UserClobTradeRow>(
    `SELECT id, user_id, wallet_id, trade_id, token_id, side, price, size, amount_usd, trade_timestamp, market_slug, raw, created_at
     FROM user_clob_trades
     WHERE user_id = $1
     ORDER BY COALESCE(trade_timestamp, created_at) DESC
     LIMIT $2`,
    [userId, limit]
  )
  return res.rows
}

export async function getDistinctTokenIdsByUserId(userId: number): Promise<string[]> {
  const pool = getPool()
  const res = await pool.query<{ token_id: string }>(
    `SELECT DISTINCT token_id FROM user_clob_trades WHERE user_id = $1 AND token_id IS NOT NULL`,
    [userId]
  )
  return res.rows.map((r) => r.token_id)
}

/** Get one market_slug per token_id for this user (for position display). */
export async function getTokenIdToMarketSlug(userId: number): Promise<Map<string, string>> {
  const pool = getPool()
  const res = await pool.query<{ token_id: string; market_slug: string }>(
    `SELECT DISTINCT ON (token_id) token_id, market_slug
     FROM user_clob_trades
     WHERE user_id = $1 AND token_id IS NOT NULL AND market_slug IS NOT NULL
     ORDER BY token_id, trade_timestamp DESC NULLS LAST`,
    [userId]
  )
  const map = new Map<string, string>()
  for (const r of res.rows) if (r.market_slug) map.set(r.token_id, r.market_slug)
  return map
}
