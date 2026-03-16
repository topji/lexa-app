import { getPool } from './client.js'

export type PositionStatus = 'open' | 'closing' | 'closed' | 'failed'
export type ExitReason = 'stoploss' | 'time' | 'manual' | 'profit'

export type StrategyPositionRow = {
  id: number
  strategy_id: number
  market: string
  expiry_ts: Date
  side: 'up' | 'down'
  token_id: string | null
  entry_sample_ts: Date | null
  entry_odd: string | null
  entry_order_id: string | null
  entry_shares: string | null
  exit_sample_ts: Date | null
  exit_odd: string | null
  exit_order_id: string | null
  exit_reason: ExitReason | null
  status: PositionStatus
  created_at: Date
  updated_at: Date
}

export async function getOpenPositionForStrategy(strategyId: number): Promise<StrategyPositionRow | null> {
  const pool = getPool()
  const res = await pool.query<StrategyPositionRow>(
    `SELECT *
     FROM strategy_positions
     WHERE strategy_id = $1 AND status IN ('open', 'closing')
     ORDER BY id DESC
     LIMIT 1`,
    [strategyId]
  )
  return res.rows[0] ?? null
}

export async function createOpenPosition(args: {
  strategyId: number
  market: string
  expiryTs: Date
  side: 'up' | 'down'
  tokenId: string
  entrySampleTs: Date
  entryOdd: number
  entryOrderId: string
  entryShares: string
}): Promise<StrategyPositionRow> {
  const pool = getPool()
  const res = await pool.query<StrategyPositionRow>(
    `INSERT INTO strategy_positions (
      strategy_id, market, expiry_ts, side, token_id,
      entry_sample_ts, entry_odd, entry_order_id, entry_shares,
      status, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open', NOW())
    RETURNING *`,
    [
      args.strategyId,
      args.market,
      args.expiryTs,
      args.side,
      args.tokenId,
      args.entrySampleTs,
      args.entryOdd,
      args.entryOrderId,
      args.entryShares,
    ]
  )
  return res.rows[0]!
}

export async function markPositionClosing(args: {
  positionId: number
  exitReason: ExitReason
}): Promise<void> {
  const pool = getPool()
  await pool.query(
    `UPDATE strategy_positions
     SET status = 'closing', exit_reason = $2, updated_at = NOW()
     WHERE id = $1`,
    [args.positionId, args.exitReason]
  )
}

export async function closePosition(args: {
  positionId: number
  exitSampleTs: Date
  exitOdd: number
  exitOrderId: string
  exitReason: ExitReason
}): Promise<void> {
  const pool = getPool()
  await pool.query(
    `UPDATE strategy_positions
     SET status = 'closed',
         exit_sample_ts = $2,
         exit_odd = $3,
         exit_order_id = $4,
         exit_reason = $5,
         updated_at = NOW()
     WHERE id = $1`,
    [args.positionId, args.exitSampleTs, args.exitOdd, args.exitOrderId, args.exitReason]
  )
}

export async function listPositionsForStrategy(strategyId: number, limit: number): Promise<StrategyPositionRow[]> {
  const pool = getPool()
  const res = await pool.query<StrategyPositionRow>(
    `SELECT *
     FROM strategy_positions
     WHERE strategy_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [strategyId, limit]
  )
  return res.rows
}

export async function listAllPositionsForUser(userId: number, limit: number): Promise<StrategyPositionRow[]> {
  const pool = getPool()
  const res = await pool.query<StrategyPositionRow>(
    `SELECT p.*
     FROM strategy_positions p
     JOIN strategies s ON p.strategy_id = s.id
     WHERE s.user_id = $1
     ORDER BY p.created_at DESC
     LIMIT $2`,
    [userId, limit]
  )
  return res.rows
}

export async function countOpenPositionsForUser(userId: number): Promise<number> {
  const pool = getPool()
  const res = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM strategy_positions p
     JOIN strategies s ON p.strategy_id = s.id
     WHERE s.user_id = $1
       AND p.status IN ('open', 'closing')`,
    [userId]
  )
  const raw = res.rows[0]?.count
  const n = raw != null ? Number(raw) : 0
  return Number.isFinite(n) ? n : 0
}
