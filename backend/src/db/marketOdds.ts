import { getPool } from './client.js'

export type LatestOddsRow = {
  market: string
  expiry_ts: Date
  seconds_to_expiry: number | null
  sample_ts: Date
  price: string
  up_odd: string
  down_odd: string
  // Percentage change: ((current - prev) / prev) * 100, signed
  up_pct_chg_1s: string | null
  up_pct_chg_2s: string | null
  up_pct_chg_3s: string | null
  up_pct_chg_4s: string | null
  up_pct_chg_5s: string | null
  down_pct_chg_1s: string | null
  down_pct_chg_2s: string | null
  down_pct_chg_3s: string | null
  down_pct_chg_4s: string | null
  down_pct_chg_5s: string | null
  // Absolute change: current - prev, signed
  up_abs_chg_1s: string | null
  up_abs_chg_2s: string | null
  up_abs_chg_3s: string | null
  up_abs_chg_4s: string | null
  up_abs_chg_5s: string | null
  down_abs_chg_1s: string | null
  down_abs_chg_2s: string | null
  down_abs_chg_3s: string | null
  down_abs_chg_4s: string | null
  down_abs_chg_5s: string | null
}

export async function getLatestOdds(market: string): Promise<LatestOddsRow | null> {
  const pool = getPool()
  const res = await pool.query<LatestOddsRow>(
    `SELECT market, expiry_ts, seconds_to_expiry, sample_ts, price, up_odd, down_odd,
            up_pct_chg_1s, up_pct_chg_2s, up_pct_chg_3s, up_pct_chg_4s, up_pct_chg_5s,
            down_pct_chg_1s, down_pct_chg_2s, down_pct_chg_3s, down_pct_chg_4s, down_pct_chg_5s,
            up_abs_chg_1s, up_abs_chg_2s, up_abs_chg_3s, up_abs_chg_4s, up_abs_chg_5s,
            down_abs_chg_1s, down_abs_chg_2s, down_abs_chg_3s, down_abs_chg_4s, down_abs_chg_5s
     FROM market_odds
     WHERE market = $1
     ORDER BY sample_ts DESC
     LIMIT 1`,
    [market]
  )
  return res.rows[0] ?? null
}
