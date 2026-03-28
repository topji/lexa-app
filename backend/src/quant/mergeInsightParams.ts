import type { SynthdataInsightForApi } from '../db/synthdataInsights.js'

export type PolymarketContextMeta = {
  market: string
  slug: string | null
  start_price: number | null
  polymarket_probability_up: number | null
  best_bid_price: number | null
  best_ask_price: number | null
  event_start_time: string | null
  event_end_time: string | null
  sample_ts: string
  minutes_remaining_used: number | null
  spread_used: number | null
}

export function minutesRemainingFromInsight(
  insight: SynthdataInsightForApi,
  horizon: '15m' | '1h',
): number | undefined {
  const now = Date.now()
  if (insight.event_end_time) {
    const end = new Date(insight.event_end_time).getTime()
    if (!Number.isNaN(end)) return Math.max(0, (end - now) / 60_000)
  }
  if (insight.event_start_time) {
    const start = new Date(insight.event_start_time).getTime()
    if (!Number.isNaN(start)) {
      const windowMs = horizon === '15m' ? 15 * 60_000 : 60 * 60_000
      const end = start + windowMs
      return Math.max(0, (end - now) / 60_000)
    }
  }
  return undefined
}

function explicit(qs: Record<string, string | undefined>, k: string): boolean {
  const v = qs[k]
  return v != null && v !== ''
}

/** Build quant-backend query params: SynthData insight fills gaps; explicit query string always wins. */
export function mergeQuantQueryWithInsight(
  qs: Record<string, string | undefined>,
  insight: SynthdataInsightForApi | undefined,
  marketKey: string,
  horizon: '15m' | '1h',
): { params: URLSearchParams; contextMeta: PolymarketContextMeta | null; contextWarning: string | null } {
  const params = new URLSearchParams()
  params.set('horizon', horizon)

  let contextWarning: string | null = null
  if (!insight) {
    contextWarning = `No ${marketKey} row in synthdata_insights. Run the worker with Lexa market insights (default) or SynthData, or pass start_price and market_price query params yourself.`
  }

  if (insight) {
    if (!explicit(qs, 'start_price') && insight.start_price != null && Number.isFinite(insight.start_price) && insight.start_price > 0) {
      params.set('start_price', String(insight.start_price))
    }
    if (!explicit(qs, 'minutes_remaining')) {
      const mins = minutesRemainingFromInsight(insight, horizon)
      if (mins != null && Number.isFinite(mins)) params.set('minutes_remaining', String(mins))
    }
    if (!explicit(qs, 'market_price')) {
      const mp = insight.polymarket_probability_up
      if (mp != null && Number.isFinite(mp) && mp > 0 && mp <= 1) {
        params.set('market_price', String(mp))
      } else if (
        insight.best_bid_price != null &&
        insight.best_ask_price != null &&
        Number.isFinite(insight.best_bid_price) &&
        Number.isFinite(insight.best_ask_price)
      ) {
        params.set('market_price', String((insight.best_bid_price + insight.best_ask_price) / 2))
      }
    }
    if (!explicit(qs, 'spread')) {
      if (
        insight.best_bid_price != null &&
        insight.best_ask_price != null &&
        Number.isFinite(insight.best_bid_price) &&
        Number.isFinite(insight.best_ask_price)
      ) {
        const sp = insight.best_ask_price - insight.best_bid_price
        if (sp >= 0) params.set('spread', String(sp))
      }
    }
  }

  for (const key of ['horizon', 'start_price', 'minutes_remaining', 'market_price', 'spread'] as const) {
    if (explicit(qs, key)) params.set(key, qs[key]!)
  }

  const minsParsed = params.get('minutes_remaining')
  const spreadParsed = params.get('spread')
  const minsNum = minsParsed != null ? Number(minsParsed) : NaN
  const spreadNum = spreadParsed != null ? Number(spreadParsed) : NaN

  const contextMeta: PolymarketContextMeta | null = insight
    ? {
        market: insight.market,
        slug: insight.slug,
        start_price: insight.start_price,
        polymarket_probability_up: insight.polymarket_probability_up,
        best_bid_price: insight.best_bid_price,
        best_ask_price: insight.best_ask_price,
        event_start_time: insight.event_start_time,
        event_end_time: insight.event_end_time,
        sample_ts: insight.sample_ts,
        minutes_remaining_used: Number.isFinite(minsNum) ? minsNum : null,
        spread_used: Number.isFinite(spreadNum) ? spreadNum : null,
      }
    : null

  if (horizon === '15m' && !params.get('start_price')) {
    const extra = ' 15m engine requires start_price from the active Polymarket window.'
    contextWarning = contextWarning ? contextWarning + extra : extra.trim()
  }

  return { params, contextMeta, contextWarning }
}
