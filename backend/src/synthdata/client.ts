import { config } from '../config.js'

export type SynthdataUpDownResponse = {
  slug?: string
  start_price?: number
  current_time?: string
  current_price?: number
  current_outcome?: string
  synth_probability_up?: number
  synth_outcome?: string
  polymarket_probability_up?: number
  polymarket_outcome?: string
  event_start_time?: string
  event_end_time?: string
  event_creation_time?: string
  best_bid_price?: number
  best_ask_price?: number
  best_bid_size?: number
  best_ask_size?: number
  polymarket_last_trade_time?: string
  polymarket_last_trade_price?: number
  polymarket_last_trade_outcome?: string
}

const baseUrl = config.synthdataApiUrl.replace(/\/$/, '')

async function fetchUpDown(path: string, asset: string): Promise<SynthdataUpDownResponse | null> {
  const key = config.synthdataApiKey
  if (!key) return null
  const url = `${baseUrl}${path}?asset=${encodeURIComponent(asset)}`
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Apikey ${key}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      if (res.status === 429 || res.status >= 500) {
        console.warn('[SynthData]', path, res.status, res.status === 429 ? 'rate limit' : 'server error', '— backing off')
      } else {
        console.warn('[SynthData]', path, res.status, text.slice(0, 80))
      }
      return null
    }
    return (await res.json()) as SynthdataUpDownResponse
  } catch (err) {
    console.warn('[SynthData]', path, (err as Error)?.message)
    return null
  }
}

/** 15-minute up/down for BTC (and ETH, SOL per API). */
export function fetch15m(asset: string = 'BTC'): Promise<SynthdataUpDownResponse | null> {
  return fetchUpDown('/insights/polymarket/up-down/15min', asset)
}

/** Hourly up/down for BTC. */
export function fetchHourly(asset: string = 'BTC'): Promise<SynthdataUpDownResponse | null> {
  return fetchUpDown('/insights/polymarket/up-down/hourly', asset)
}

/** Daily up/down for BTC (optional; not stored every second by default). */
export function fetchDaily(asset: string = 'BTC'): Promise<SynthdataUpDownResponse | null> {
  return fetchUpDown('/insights/polymarket/up-down/daily', asset)
}
