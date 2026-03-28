/**
 * Lexa-owned market insights for Polymarket Up/Down windows (15m & 1h).
 * Replaces paid SynthData: Gamma (slug, times, book hints) + Binance spot (start/current price).
 */

import { config } from '../config.js'
import { resolveSoonestSlug } from '../resolve-soonest.js'
import type { SynthdataInsightRow } from '../db/synthdataInsights.js'

type AssetSlug = 'bitcoin' | 'ethereum' | 'solana'
type AssetKey = 'btc' | 'eth' | 'sol'

const ASSET_MAP: { key: AssetKey; gamma: AssetSlug; symbol: string }[] = [
  { key: 'btc', gamma: 'bitcoin', symbol: 'BTCUSDT' },
  { key: 'eth', gamma: 'ethereum', symbol: 'ETHUSDT' },
  { key: 'sol', gamma: 'solana', symbol: 'SOLUSDT' },
]

function toNum(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

function parseClobTokenIds(m: Record<string, unknown>): string[] {
  const raw = m.clobTokenIds ?? m.clob_token_ids
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean)
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw) as unknown
      return Array.isArray(p) ? p.map(String).filter(Boolean) : []
    } catch {
      return []
    }
  }
  return []
}

function parseIso(s: unknown): Date | null {
  if (s == null || s === '') return null
  const d = new Date(String(s))
  return Number.isNaN(d.getTime()) ? null : d
}

/** First nested market with two CLOB tokens (Up/Down). */
function pickBinaryMarket(event: Record<string, unknown>): Record<string, unknown> | null {
  const markets = event.markets
  if (!Array.isArray(markets)) return null
  for (const raw of markets) {
    const m = raw as Record<string, unknown>
    const ids = parseClobTokenIds(m)
    if (ids.length >= 2) return m
  }
  return null
}

/**
 * Polymarket YES (up) mid and bid/ask from Gamma; falls back to outcomePrices.
 */
function polymarketUpFromMarket(m: Record<string, unknown>): {
  p: number | null
  bid: number | null
  ask: number | null
} {
  const bid = toNum(m.bestBid ?? m.best_bid)
  const ask = toNum(m.bestAsk ?? m.best_ask)
  if (bid != null && ask != null && bid > 0 && ask > 0 && bid < 1 && ask <= 1 && ask >= bid) {
    return { p: (bid + ask) / 2, bid, ask }
  }
  try {
    const raw = m.outcomePrices ?? m.outcome_prices
    const arr =
      typeof raw === 'string'
        ? (JSON.parse(raw) as string[])
        : Array.isArray(raw)
          ? (raw as (string | number)[]).map(String)
          : []
    const up = parseFloat(arr[0] ?? '')
    if (Number.isFinite(up) && up > 0 && up < 1) {
      return { p: up, bid: bid ?? null, ask: ask ?? null }
    }
  } catch {
    // ignore
  }
  return { p: null, bid: bid ?? null, ask: ask ?? null }
}

async function fetchBinanceKlineOpenUsd(symbol: string, openTimeMs: number): Promise<number | null> {
  const url = `${config.binanceSpotBase}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=1m&startTime=${openTimeMs}&limit=1`
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) })
    if (!res.ok) return null
    const row = (await res.json()) as unknown
    if (!Array.isArray(row) || !Array.isArray(row[0])) return null
    const open = parseFloat(String(row[0][1]))
    return Number.isFinite(open) && open > 0 ? open : null
  } catch {
    return null
  }
}

async function fetchBinanceLastUsd(symbol: string): Promise<number | null> {
  const url = `${config.binanceSpotBase}/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) })
    if (!res.ok) return null
    const j = (await res.json()) as { price?: string }
    const p = parseFloat(j.price ?? '')
    return Number.isFinite(p) && p > 0 ? p : null
  } catch {
    return null
  }
}

async function fetchGammaEvent(slug: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${config.gammaApiBase}/events/slug/${encodeURIComponent(slug)}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) return null
  return (await res.json()) as Record<string, unknown>
}

/**
 * Strike / reference at window open: prefer Gamma `line` when it looks like a spot USD price,
 * else Binance 1m open at window start.
 */
function lineAsStartPrice(line: number | null, refPrice: number | null): number | null {
  if (line == null || !Number.isFinite(line) || line <= 0) return null
  if (!refPrice || !Number.isFinite(refPrice)) return line
  const rel = Math.abs(line - refPrice) / refPrice
  if (rel < 0.05) return line
  if (line > 1e3 && line < 1e7) return line
  return null
}

/**
 * Build one synthdata_insights row for Polymarket up/down context (Lexa-owned pipeline).
 */
export async function fetchLexaUpDownInsight(
  asset: AssetKey,
  horizon: '15m' | '1h',
): Promise<SynthdataInsightRow | null> {
  const meta = ASSET_MAP.find((a) => a.key === asset)
  if (!meta) return null

  const slug = await resolveSoonestSlug(meta.gamma, horizon)
  if (!slug) return null

  const event = await fetchGammaEvent(slug)
  if (!event) return null

  const m = pickBinaryMarket(event)
  if (!m) return null

  const start =
    parseIso(m.eventStartTime ?? m.event_start_time) ??
    parseIso(m.startDate ?? m.start_date ?? m.startDateIso ?? m.start_date_iso) ??
    parseIso(event.eventStartTime ?? event.event_start_time) ??
    parseIso(event.startDate ?? event.start_date)
  const end =
    parseIso(m.endDate ?? m.end_date ?? m.endDateIso ?? m.end_date_iso) ??
    parseIso(event.endDate ?? event.end_date)

  const { p: polyUp, bid, ask } = polymarketUpFromMarket(m)
  const line = toNum(m.line)

  const startMs = start?.getTime()
  let startPrice: number | null = null
  const lastUsd = await fetchBinanceLastUsd(meta.symbol)
  if (startMs != null) {
    const fromKline = await fetchBinanceKlineOpenUsd(meta.symbol, startMs)
    startPrice = lineAsStartPrice(line, fromKline ?? lastUsd) ?? fromKline ?? null
  } else {
    startPrice = lineAsStartPrice(line, lastUsd)
  }

  const market = `${asset}-${horizon}`
  const now = new Date()

  return {
    market,
    sample_ts: now,
    slug,
    start_price: startPrice,
    current_price: lastUsd,
    current_outcome: null,
    synth_probability_up: null,
    polymarket_probability_up: polyUp,
    event_start_time: start,
    event_end_time: end,
    best_bid_price: bid,
    best_ask_price: ask,
    best_bid_size: null,
    best_ask_size: null,
    polymarket_last_trade_time: null,
    polymarket_last_trade_price: toNum(m.lastTradePrice ?? m.last_trade_price),
    polymarket_last_trade_outcome: null,
    raw: {
      source: 'lexa_polymarket',
      asset,
      horizon,
      gammaLine: line,
    },
  }
}
