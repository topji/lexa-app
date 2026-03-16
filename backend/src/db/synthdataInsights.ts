import { getPool } from './client.js'
import type { SynthdataUpDownResponse } from '../synthdata/client.js'

export type SynthdataInsightRow = {
  market: string
  sample_ts: Date
  slug: string | null
  start_price: number | null
  current_price: number | null
  current_outcome: string | null
  synth_probability_up: number | null
  polymarket_probability_up: number | null
  event_start_time: Date | null
  event_end_time: Date | null
  best_bid_price: number | null
  best_ask_price: number | null
  best_bid_size: number | null
  best_ask_size: number | null
  polymarket_last_trade_time: Date | null
  polymarket_last_trade_price: number | null
  polymarket_last_trade_outcome: string | null
  raw: Record<string, unknown> | null
}

function toTs(s: string | undefined): Date | null {
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function toNum(v: unknown): number | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function toInsightRow(
  market: string,
  sample_ts: Date,
  data: SynthdataUpDownResponse,
  raw: Record<string, unknown>
): SynthdataInsightRow {
  return {
    market,
    sample_ts,
    slug: data.slug ?? null,
    start_price: toNum(data.start_price),
    current_price: toNum(data.current_price),
    current_outcome: data.current_outcome ?? null,
    synth_probability_up: toNum(data.synth_probability_up),
    polymarket_probability_up: toNum(data.polymarket_probability_up),
    event_start_time: toTs(data.event_start_time),
    event_end_time: toTs(data.event_end_time),
    best_bid_price: toNum(data.best_bid_price),
    best_ask_price: toNum(data.best_ask_price),
    best_bid_size: toNum(data.best_bid_size),
    best_ask_size: toNum(data.best_ask_size),
    polymarket_last_trade_time: toTs(data.polymarket_last_trade_time),
    polymarket_last_trade_price: toNum(data.polymarket_last_trade_price),
    polymarket_last_trade_outcome: data.polymarket_last_trade_outcome ?? null,
    raw,
  }
}

export async function insertSynthdataInsight(row: SynthdataInsightRow): Promise<void> {
  const pool = getPool()
  await pool.query(
    `INSERT INTO synthdata_insights (
      market, sample_ts, slug, start_price, current_price, current_outcome,
      synth_probability_up, polymarket_probability_up,
      event_start_time, event_end_time,
      best_bid_price, best_ask_price, best_bid_size, best_ask_size,
      polymarket_last_trade_time, polymarket_last_trade_price, polymarket_last_trade_outcome,
      raw
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
    )`,
    [
      row.market,
      row.sample_ts,
      row.slug,
      row.start_price,
      row.current_price,
      row.current_outcome,
      row.synth_probability_up,
      row.polymarket_probability_up,
      row.event_start_time,
      row.event_end_time,
      row.best_bid_price,
      row.best_ask_price,
      row.best_bid_size,
      row.best_ask_size,
      row.polymarket_last_trade_time,
      row.polymarket_last_trade_price,
      row.polymarket_last_trade_outcome,
      row.raw == null ? null : JSON.stringify(row.raw),
    ]
  )
}

export type SynthdataInsightForApi = {
  market: string
  sample_ts: string
  slug: string | null
  start_price: number | null
  current_price: number | null
  current_outcome: string | null
  synth_probability_up: number | null
  polymarket_probability_up: number | null
  event_start_time: string | null
  event_end_time: string | null
  best_bid_price: number | null
  best_ask_price: number | null
  best_bid_size: number | null
  best_ask_size: number | null
  polymarket_last_trade_time: string | null
  polymarket_last_trade_price: number | null
  polymarket_last_trade_outcome: string | null
}

export async function getLatestSynthdataInsights(): Promise<SynthdataInsightForApi[]> {
  const pool = getPool()
  const res = await pool.query<Record<string, unknown>>(
    `SELECT market, sample_ts, slug, start_price, current_price, current_outcome,
            synth_probability_up, polymarket_probability_up,
            event_start_time, event_end_time,
            best_bid_price, best_ask_price, best_bid_size, best_ask_size,
            polymarket_last_trade_time, polymarket_last_trade_price, polymarket_last_trade_outcome
     FROM (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY market ORDER BY sample_ts DESC) AS rn
       FROM synthdata_insights
     ) t
     WHERE rn = 1
     ORDER BY market`
  )
  return res.rows.map((row) => ({
    market: String(row.market ?? ''),
    sample_ts: row.sample_ts instanceof Date ? row.sample_ts.toISOString() : String(row.sample_ts ?? ''),
    slug: row.slug != null ? String(row.slug) : null,
    start_price: row.start_price != null ? Number(row.start_price) : null,
    current_price: row.current_price != null ? Number(row.current_price) : null,
    current_outcome: row.current_outcome != null ? String(row.current_outcome) : null,
    synth_probability_up: row.synth_probability_up != null ? Number(row.synth_probability_up) : null,
    polymarket_probability_up: row.polymarket_probability_up != null ? Number(row.polymarket_probability_up) : null,
    event_start_time: row.event_start_time instanceof Date ? row.event_start_time.toISOString() : (row.event_start_time != null ? String(row.event_start_time) : null),
    event_end_time: row.event_end_time instanceof Date ? row.event_end_time.toISOString() : (row.event_end_time != null ? String(row.event_end_time) : null),
    best_bid_price: row.best_bid_price != null ? Number(row.best_bid_price) : null,
    best_ask_price: row.best_ask_price != null ? Number(row.best_ask_price) : null,
    best_bid_size: row.best_bid_size != null ? Number(row.best_bid_size) : null,
    best_ask_size: row.best_ask_size != null ? Number(row.best_ask_size) : null,
    polymarket_last_trade_time: row.polymarket_last_trade_time instanceof Date ? row.polymarket_last_trade_time.toISOString() : (row.polymarket_last_trade_time != null ? String(row.polymarket_last_trade_time) : null),
    polymarket_last_trade_price: row.polymarket_last_trade_price != null ? Number(row.polymarket_last_trade_price) : null,
    polymarket_last_trade_outcome: row.polymarket_last_trade_outcome != null ? String(row.polymarket_last_trade_outcome) : null,
  }))
}
