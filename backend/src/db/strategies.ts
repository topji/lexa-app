import { getPool } from './client.js'

export type StrategyRow = {
  id: number
  user_id: number
  wallet_id: number
  name: string
  market: string
  active: boolean
  entry_side: 'up' | 'down'
  // Entry conditions — at least one must be configured
  entry_odd_max: string | null                // enter when odd <= this value
  entry_seconds_to_expiry_min: number
  entry_odd_change_window_s: number | null    // lookback window in seconds (1-5)
  entry_odd_change_min: string | null         // abs change >= this (signed, e.g. -0.05 = fell 0.05)
  entry_odd_change_pct_min: string | null     // pct change >= this (signed, e.g. -25 = fell 25%)
  // Exit conditions
  exit_stop_loss: string | null               // exit when odd <= this absolute value
  exit_stop_loss_pct: string | null           // exit when odd <= entryOdd * (pct/100), e.g. 60 = 60% of entry
  exit_seconds_to_expiry_max: number          // time-based exit (always active)
  exit_profit_odd: string | null              // exit when odd >= this absolute value
  exit_profit_pct: string | null              // exit when odd >= entryOdd * (1 + pct/100), e.g. 100 = 2x entry
  order_size_usd: string
  created_at: Date
  updated_at: Date
}

export async function createStrategy(input: {
  userId: number
  walletId: number
  name: string
  market: string
  entrySide: 'up' | 'down'
  entryOddMax?: number | null
  entrySecondsToExpiryMin: number
  entryOddChangeWindowS?: number | null
  entryOddChangeMin?: number | null
  entryOddChangePctMin?: number | null
  exitStopLoss?: number | null
  exitStopLossPct?: number | null
  exitSecondsToExpiryMax: number
  exitProfitOdd?: number | null
  exitProfitPct?: number | null
  orderSizeUsd: number
}): Promise<StrategyRow> {
  const pool = getPool()
  const res = await pool.query<StrategyRow>(
    `INSERT INTO strategies (
      user_id, wallet_id, name, market, active, entry_side,
      entry_odd_max, entry_seconds_to_expiry_min,
      entry_odd_change_window_s, entry_odd_change_min, entry_odd_change_pct_min,
      exit_stop_loss, exit_stop_loss_pct, exit_seconds_to_expiry_max,
      exit_profit_odd, exit_profit_pct, order_size_usd
    ) VALUES ($1,$2,$3,$4,false,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    RETURNING *`,
    [
      input.userId,
      input.walletId,
      input.name,
      input.market,
      input.entrySide,
      input.entryOddMax ?? null,
      input.entrySecondsToExpiryMin,
      input.entryOddChangeWindowS ?? null,
      input.entryOddChangeMin ?? null,
      input.entryOddChangePctMin ?? null,
      input.exitStopLoss ?? null,
      input.exitStopLossPct ?? null,
      input.exitSecondsToExpiryMax,
      input.exitProfitOdd ?? null,
      input.exitProfitPct ?? null,
      input.orderSizeUsd,
    ]
  )
  return res.rows[0]!
}

export async function listStrategiesByUser(userId: number): Promise<StrategyRow[]> {
  const pool = getPool()
  const res = await pool.query<StrategyRow>(
    `SELECT * FROM strategies WHERE user_id = $1 ORDER BY id DESC`,
    [userId]
  )
  return res.rows
}

export async function listActiveStrategies(): Promise<StrategyRow[]> {
  const pool = getPool()
  const res = await pool.query<StrategyRow>(`SELECT * FROM strategies WHERE active = true ORDER BY id ASC`)
  return res.rows
}

export async function getStrategyById(id: number): Promise<StrategyRow | null> {
  const pool = getPool()
  const res = await pool.query<StrategyRow>(`SELECT * FROM strategies WHERE id = $1`, [id])
  return res.rows[0] ?? null
}

export async function updateStrategy(
  id: number,
  fields: Partial<{
    name: string
    market: string
    active: boolean
    entry_side: 'up' | 'down'
    entry_odd_max: number | null
    entry_seconds_to_expiry_min: number
    entry_odd_change_window_s: number | null
    entry_odd_change_min: number | null
    entry_odd_change_pct_min: number | null
    exit_stop_loss: number | null
    exit_stop_loss_pct: number | null
    exit_seconds_to_expiry_max: number
    exit_profit_odd: number | null
    exit_profit_pct: number | null
    order_size_usd: number
  }>
): Promise<StrategyRow | null> {
  const pool = getPool()
  const keys = Object.keys(fields) as (keyof typeof fields)[]
  if (keys.length === 0) return getStrategyById(id)
  const sets = keys.map((k, idx) => `${k} = $${idx + 2}`)
  const values = keys.map((k) => fields[k])
  const res = await pool.query<StrategyRow>(
    `UPDATE strategies SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, ...values]
  )
  return res.rows[0] ?? null
}
