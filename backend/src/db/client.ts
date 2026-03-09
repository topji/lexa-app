import pg from 'pg'
import { Pool as NeonPool, neonConfig } from '@neondatabase/serverless'
import ws from 'ws'
import { config } from '../config.js'

const { Pool: PgPool } = pg

// Required in Node.js so Neon's driver can open WebSockets
;(neonConfig as { webSocketConstructor?: unknown }).webSocketConstructor = ws

let pool: pg.Pool | InstanceType<typeof NeonPool> | null = null

export function getPool(): pg.Pool {
  if (!pool) {
    const isNeon = config.databaseUrl.includes('neon.tech')
    if (isNeon) {
      pool = new NeonPool({ connectionString: config.databaseUrl, max: 2 }) as pg.Pool
    } else {
      pool = new PgPool({
        connectionString: config.databaseUrl,
        max: 2,
        idleTimeoutMillis: 10000,
        ssl: { rejectUnauthorized: false },
      })
    }
  }
  return pool as pg.Pool
}

export interface OddsRow {
  market: string
  expiry_ts: Date
  seconds_to_expiry: number
  sample_ts: Date
  price: number
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
  up_abs_chg_1s: number | null
  up_abs_chg_2s: number | null
  up_abs_chg_3s: number | null
  up_abs_chg_4s: number | null
  up_abs_chg_5s: number | null
  down_abs_chg_1s: number | null
  down_abs_chg_2s: number | null
  down_abs_chg_3s: number | null
  down_abs_chg_4s: number | null
  down_abs_chg_5s: number | null
}

export async function insertOdds(row: OddsRow): Promise<void> {
  const client = getPool()
  await client.query(
    `INSERT INTO market_odds (
      market, expiry_ts, seconds_to_expiry, sample_ts, price, up_odd, down_odd,
      up_pct_chg_1s, up_pct_chg_2s, up_pct_chg_3s, up_pct_chg_4s, up_pct_chg_5s,
      down_pct_chg_1s, down_pct_chg_2s, down_pct_chg_3s, down_pct_chg_4s, down_pct_chg_5s,
      up_abs_chg_1s, up_abs_chg_2s, up_abs_chg_3s, up_abs_chg_4s, up_abs_chg_5s,
      down_abs_chg_1s, down_abs_chg_2s, down_abs_chg_3s, down_abs_chg_4s, down_abs_chg_5s
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11, $12,
      $13, $14, $15, $16, $17,
      $18, $19, $20, $21, $22,
      $23, $24, $25, $26, $27
    )`,
    [
      row.market,
      row.expiry_ts,
      row.seconds_to_expiry,
      row.sample_ts,
      row.price,
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
      row.up_abs_chg_1s,
      row.up_abs_chg_2s,
      row.up_abs_chg_3s,
      row.up_abs_chg_4s,
      row.up_abs_chg_5s,
      row.down_abs_chg_1s,
      row.down_abs_chg_2s,
      row.down_abs_chg_3s,
      row.down_abs_chg_4s,
      row.down_abs_chg_5s
    ]
  )
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
