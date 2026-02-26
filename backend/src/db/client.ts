import pg from 'pg'
import { config } from '../config.js'

const { Pool } = pg

let pool: pg.Pool | null = null

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 2,
      idleTimeoutMillis: 10000,
    })
  }
  return pool
}

export interface OddsRow {
  market_slug: string
  market_name: string
  window_ts: Date
  sample_ts: Date
  btc_price: number
  up_odd: number
  down_odd: number
  up_pct_chg_1s: number | null
  up_pct_chg_2s: number | null
  up_pct_chg_3s: number | null
  up_pct_chg_4s: number | null
  up_pct_chg_5s: number | null
  down_pct_chg_1s: number | null
  down_pct_chg_2s: number | null
  down_pct_chg_3s: number | null
  down_pct_chg_4s: number | null
  down_pct_chg_5s: number | null
}

export async function insertOdds(row: OddsRow): Promise<void> {
  const client = getPool()
  await client.query(
    `INSERT INTO btc5m_odds (
      market_slug, market_name, window_ts, sample_ts, btc_price, up_odd, down_odd,
      up_pct_chg_1s, up_pct_chg_2s, up_pct_chg_3s, up_pct_chg_4s, up_pct_chg_5s,
      down_pct_chg_1s, down_pct_chg_2s, down_pct_chg_3s, down_pct_chg_4s, down_pct_chg_5s
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [
      row.market_slug,
      row.market_name,
      row.window_ts,
      row.sample_ts,
      row.btc_price,
      row.up_odd,
      row.down_odd,
      row.up_pct_chg_1s,
      row.up_pct_chg_2s,
      row.up_pct_chg_3s,
      row.up_pct_chg_4s,
      row.up_pct_chg_5s,
      row.down_pct_chg_1s,
      row.down_pct_chg_2s,
      row.down_pct_chg_3s,
      row.down_pct_chg_4s,
      row.down_pct_chg_5s,
    ]
  )
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
