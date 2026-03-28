import WebSocket from 'ws'
import { config } from './config.js'
import { fetchMarketInfo } from './fetch-market.js'
import { resolveSoonestBtc5mSlug } from './resolve-soonest.js'
import { insertOdds, closePool } from './db/client.js'
import { getWindowTs, pctChange } from './utils.js'
import { fetch15m, fetchHourly } from './synthdata/client.js'
import { toInsightRow, insertSynthdataInsight } from './db/synthdataInsights.js'
import { fetchLexaUpDownInsight } from './polymarket/lexaMarketInsights.js'

const HISTORY = 5

type Sample = {
  sample_ts: Date
  up_odd: number
  down_odd: number
}

let marketInfo: Awaited<ReturnType<typeof fetchMarketInfo>> | null = null
let upOdd = 0.5
let downOdd = 0.5
let btcPrice = 0
let clobWs: WebSocket | null = null
let clobPingId: ReturnType<typeof setInterval> | null = null
let clobReconnectTimeout: ReturnType<typeof setTimeout> | null = null
const buffer: Sample[] = []
let intervalId: ReturnType<typeof setInterval> | null = null
let marketInsightsIntervalId: ReturnType<typeof setInterval> | null = null
let clobDebugLogged = 0
let rtdsWs: WebSocket | null = null
let switchingMarket = false

const CLOB_PING_INTERVAL_MS = 10_000

function connectClob(tokenIds: [string, string]) {
  if (clobReconnectTimeout) {
    clearTimeout(clobReconnectTimeout)
    clobReconnectTimeout = null
  }
  if (clobWs != null) {
    try {
      clobWs.removeAllListeners()
      clobWs.terminate()
    } catch {
      // ignore
    }
    clobWs = null
  }
  if (clobPingId) {
    clearInterval(clobPingId)
    clobPingId = null
  }

  const ws = new WebSocket(config.clobWsUrl)
  clobWs = ws
  ws.on('open', () => {
    ws.send(JSON.stringify({ assets_ids: tokenIds, type: 'market' }))
    clobPingId = setInterval(() => {
      if (ws.readyState === 1) ws.send('PING')
    }, CLOB_PING_INTERVAL_MS)
    console.log('[CLOB] Connected')
  })
  ws.on('message', (data: Buffer) => {
    if (data.toString() === 'PONG') return
    try {
      const raw = data.toString()
      const msg = JSON.parse(raw) as {
        event_type?: string
        asset_id?: string
        best_bid?: string | number
        best_ask?: string | number
        price_changes?: Array<{ asset_id?: string; best_bid?: string | number; best_ask?: string | number }>
        bids?: Array<{ price: string; size: string }>
        asks?: Array<{ price: string; size: string }>
      }
      if (
        clobDebugLogged < 2 &&
        (msg.event_type === 'price_change' || msg.event_type === 'best_bid_ask' || msg.event_type === 'book')
      ) {
        console.log('[CLOB] Sample message:', raw.slice(0, 500))
        clobDebugLogged++
      }

      const upTokenId = tokenIds[0] ?? ''
      const downTokenId = tokenIds[1] ?? ''

      if (
        (msg.event_type === 'price_change' || (!msg.event_type && msg.price_changes?.length)) &&
        msg.price_changes?.length
      ) {
        for (const pc of msg.price_changes as Array<{
          asset_id?: string
          best_bid?: string | number
          best_ask?: string | number
        }>) {
          const bid = pc.best_bid != null ? parseFloat(String(pc.best_bid)) : NaN
          const ask = pc.best_ask != null ? parseFloat(String(pc.best_ask)) : NaN
          if (!Number.isFinite(bid) || !Number.isFinite(ask)) continue
          const mid = (bid + ask) / 2
          const aid = pc.asset_id ?? ''
          if (aid === upTokenId) {
            upOdd = mid
            downOdd = 1 - mid
          } else if (aid === downTokenId) {
            downOdd = mid
            upOdd = 1 - mid
          }
        }
      }

      if (msg.event_type === 'best_bid_ask') {
        const bid = parseFloat(String(msg.best_bid))
        const ask = parseFloat(String(msg.best_ask))
        const aid = msg.asset_id ?? ''
        if (!Number.isNaN(bid) && !Number.isNaN(ask)) {
          const mid = (bid + ask) / 2
          if (aid === upTokenId) {
            upOdd = mid
            downOdd = 1 - mid
          } else if (aid === downTokenId) {
            downOdd = mid
            upOdd = 1 - mid
          }
        }
      }

      if (msg.event_type === 'book' && msg.bids?.length && msg.asks?.length) {
        if (upTokenId && msg.asset_id && msg.asset_id !== upTokenId) return

        const bids = (msg.bids as Array<{ price: string; size: string }>)
          .map((b) => ({ price: parseFloat(b.price), size: parseFloat(b.size) }))
          .filter((b) => !Number.isNaN(b.price) && !Number.isNaN(b.size))

        const asks = (msg.asks as Array<{ price: string; size: string }>)
          .map((a) => ({ price: parseFloat(a.price), size: parseFloat(a.size) }))
          .filter((a) => !Number.isNaN(a.price) && !Number.isNaN(a.size))

        bids.sort((a, b) => b.price - a.price)
        asks.sort((a, b) => a.price - b.price)

        if (bids.length && asks.length) {
          const bid = bids[0].price
          const ask = asks[0].price
          const mid = (bid + ask) / 2
          upOdd = mid
          downOdd = 1 - mid
        }
      }
    } catch {
      // ignore parse errors
    }
  })
  ws.on('error', (err: Error) => console.error('[CLOB] Error', err.message))
  ws.on('close', () => {
    clobWs = null
    if (clobPingId) {
      clearInterval(clobPingId)
      clobPingId = null
    }
    const delay = 5000
    console.log('[CLOB] Closed, reconnecting in', delay / 1000, 's...')
    clobReconnectTimeout = setTimeout(() => connectClob(tokenIds), delay)
  })
}

function connectRtds() {
  const ws = new WebSocket(config.rtdsWsUrl)
  rtdsWs = ws
  ws.on('open', () => {
    ws.send(
      JSON.stringify({
        action: 'subscribe',
        subscriptions: [
          { topic: 'crypto_prices_chainlink', type: '*', filters: '{"symbol":"btc/usd"}' },
        ],
      })
    )
    console.log('[RTDS] Connected (btc/usd)')
  })
  ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString()) as {
        topic?: string
        payload?: { symbol?: string; value?: number | string }
      }
      if (msg.topic !== 'crypto_prices_chainlink' || !msg.payload || msg.payload.value == null) return
      const sym = String(msg.payload.symbol ?? '').toLowerCase()
      if (sym !== 'btc/usd') return
      const v =
        typeof msg.payload.value === 'number'
          ? msg.payload.value
          : parseFloat(String(msg.payload.value))
      if (Number.isFinite(v)) btcPrice = v
    } catch {
      // ignore malformed
    }
  })
  ws.on('error', (err: Error) => {
    console.error('[RTDS] Error', err.message)
  })
  ws.on('close', () => {
    console.log('[RTDS] Closed, reconnecting in 5s...')
    setTimeout(connectRtds, 5000)
  })
}

async function switchToNextMarket() {
  if (!marketInfo?.endDate) return
  try {
    const soonest = await resolveSoonestBtc5mSlug()
    if (!soonest) return
    const info = await fetchMarketInfo(soonest)
    if (info.slug === marketInfo.slug && info.clobTokenIds[0] === marketInfo.clobTokenIds[0]) return
    marketInfo = info
    upOdd = 0.5
    downOdd = 0.5
    buffer.length = 0
    connectClob(marketInfo.clobTokenIds)
    console.log('[Market] Switched to new contract:', marketInfo.slug, 'endDate:', marketInfo.endDate ?? 'unknown')
  } catch (err) {
    console.error('[Market] Switch error', err)
  } finally {
    switchingMarket = false
  }
}

function tick() {
  if (!marketInfo) return
  const now = new Date()

  if (marketInfo.endDate && !switchingMarket) {
    const endMs = new Date(marketInfo.endDate).getTime()
    if (now.getTime() >= endMs) {
      switchingMarket = true
      switchToNextMarket()
    }
  }

  const window_ts = getWindowTs(now)
  // For now, all windows are 5 minutes; expiry is window start + 5m
  const expiry_ts = new Date(window_ts.getTime() + 5 * 60 * 1000)
  const seconds_to_expiry = Math.round((expiry_ts.getTime() - now.getTime()) / 1000)

  const upChg = (i: number): number | null => {
    if (i > buffer.length) return null
    return pctChange(upOdd, buffer[buffer.length - i].up_odd)
  }
  const downChg = (i: number): number | null => {
    if (i > buffer.length) return null
    return pctChange(downOdd, buffer[buffer.length - i].down_odd)
  }

  const upAbs = (i: number): number | null => {
    if (i > buffer.length) return null
    const prev = buffer[buffer.length - i].up_odd
    return Number((upOdd - prev).toFixed(6))
  }
  const downAbs = (i: number): number | null => {
    if (i > buffer.length) return null
    const prev = buffer[buffer.length - i].down_odd
    return Number((downOdd - prev).toFixed(6))
  }

  const clobState = clobWs?.readyState === 1 ? 'ok' : 'down'
  const rtdsState = rtdsWs?.readyState === 1 ? 'ok' : 'down'
  console.log(
    `[Tick] ${now.toISOString()} | market=${config.marketCode} expiry_s=${seconds_to_expiry} price=${btcPrice.toFixed(2)} up=${upOdd.toFixed(4)} down=${downOdd.toFixed(4)} CLOB=${clobState} RTDS=${rtdsState}`
  )

  insertOdds({
    market: config.marketCode,
    expiry_ts,
    seconds_to_expiry,
    sample_ts: now,
    price: btcPrice,
    up_odd: upOdd,
    down_odd: downOdd,
    up_pct_chg_1s: upChg(1) ?? null,
    up_pct_chg_2s: upChg(2) ?? null,
    up_pct_chg_3s: upChg(3) ?? null,
    up_pct_chg_4s: upChg(4) ?? null,
    up_pct_chg_5s: upChg(5) ?? null,
    down_pct_chg_1s: downChg(1) ?? null,
    down_pct_chg_2s: downChg(2) ?? null,
    down_pct_chg_3s: downChg(3) ?? null,
    down_pct_chg_4s: downChg(4) ?? null,
    down_pct_chg_5s: downChg(5) ?? null,
    up_abs_chg_1s: upAbs(1) ?? null,
    up_abs_chg_2s: upAbs(2) ?? null,
    up_abs_chg_3s: upAbs(3) ?? null,
    up_abs_chg_4s: upAbs(4) ?? null,
    up_abs_chg_5s: upAbs(5) ?? null,
    down_abs_chg_1s: downAbs(1) ?? null,
    down_abs_chg_2s: downAbs(2) ?? null,
    down_abs_chg_3s: downAbs(3) ?? null,
    down_abs_chg_4s: downAbs(4) ?? null,
    down_abs_chg_5s: downAbs(5) ?? null,
  })
    .then(() => {
      buffer.push({ sample_ts: now, up_odd: upOdd, down_odd: downOdd })
      if (buffer.length > HISTORY) buffer.shift()
    })
    .catch((err) => console.error('[DB] Insert error', err))
}

const SYNTHDATA_ASSETS = ['BTC', 'ETH', 'SOL'] as const
const SYNTHDATA_DELAY_MS = 1500

async function synthdataTick() {
  const now = new Date()
  const pairs: { asset: string; horizon: '15m' | '1h'; market: string }[] = []
  for (const asset of SYNTHDATA_ASSETS) {
    const prefix = asset.toLowerCase()
    pairs.push({ asset, horizon: '15m', market: `${prefix}-15m` })
    pairs.push({ asset, horizon: '1h', market: `${prefix}-1h` })
  }
  const results: { market: string; data: Awaited<ReturnType<typeof fetch15m>> }[] = []
  for (const { asset, horizon, market } of pairs) {
    const data = horizon === '15m' ? await fetch15m(asset) : await fetchHourly(asset)
    results.push({ market, data })
    await new Promise((r) => setTimeout(r, SYNTHDATA_DELAY_MS))
  }
  for (const { market, data } of results) {
    if (data) {
      const row = toInsightRow(market, now, data, data as unknown as Record<string, unknown>)
      insertSynthdataInsight(row).catch((err) => console.error('[SynthData] insert', market, (err as Error)?.message))
    }
  }
}

const LEXA_INSIGHT_ASSETS = ['btc', 'eth', 'sol'] as const

/** Polymarket Gamma + Binance spot — fills synthdata_insights without SynthData API. */
async function lexaMarketInsightsTick() {
  for (const asset of LEXA_INSIGHT_ASSETS) {
    for (const horizon of ['15m', '1h'] as const) {
      try {
        const row = await fetchLexaUpDownInsight(asset, horizon)
        if (row) {
          await insertSynthdataInsight(row)
        }
      } catch (err) {
        console.error('[LexaInsights] tick', asset, horizon, (err as Error)?.message)
      }
      await new Promise((r) => setTimeout(r, SYNTHDATA_DELAY_MS))
    }
  }
}

// ── Quant Backend poller ─────────────────────────────────────────────────────
// Polls our Python quant-backend (GARCH + Monte Carlo + Bayesian + Momentum)
// and stores signals in synthdata_insights so the edge runner can consume them.
let quantIntervalId: ReturnType<typeof setInterval> | null = null

type QuantSummarySignal = {
  symbol: string
  engine: string
  horizon: string
  p_up: number
  p_up_raw: number
  p_down: number
  side: string
  kelly_fraction: number
  regime_kelly_fraction: number
  ev_gap: number
  edge_pct: number
  has_edge: boolean
  action: string
  confidence: string
  trade_allowed: boolean
  block_reason: string | null
  current_price_usd: number
  start_price: number | null
  distance_pct: number
  minutes_remaining: number | null
  market_price: number
  model_std?: number
  models_agree?: boolean
  recent_vol?: number
  vol_sufficient?: boolean
  regime?: string
  regime_kelly_multiplier?: number
  sigma_remaining?: number
  sigma_1m?: number
  time_ok?: boolean
  spread_ok?: boolean
}

async function fetchQuantSignalForHorizon(
  horizon: '15m' | '1h',
  startPrice: number | null,
  minutesRemaining: number | null,
  marketPrice: number | null,
  spread: number | null,
): Promise<QuantSummarySignal | null> {
  const params = new URLSearchParams()
  params.set('horizon', horizon)
  if (startPrice != null && Number.isFinite(startPrice)) params.set('start_price', String(startPrice))
  if (minutesRemaining != null && Number.isFinite(minutesRemaining)) params.set('minutes_remaining', String(minutesRemaining))
  if (marketPrice != null && Number.isFinite(marketPrice)) params.set('market_price', String(marketPrice))
  if (spread != null && Number.isFinite(spread)) params.set('spread', String(spread))

  const url = `${config.quantBackendUrl}/signal/btc/summary?${params.toString()}`
  const resp = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!resp.ok) {
    console.error(`[QuantBackend] ${horizon} fetch failed:`, resp.status, resp.statusText)
    return null
  }
  const signal = (await resp.json()) as QuantSummarySignal
  if (!Number.isFinite(signal.p_up)) return null
  return signal
}

async function quantBackendTick() {
  try {
    const now = new Date()
    const { resolveSoonestSlug } = await import('./resolve-soonest.js')
    const { getLatestSynthdataInsights } = await import('./db/synthdataInsights.js')

    // Get latest SynthData insights for start_price + event_end_time
    const allInsights = await getLatestSynthdataInsights()
    const insightByMarket = new Map(allInsights.map((i) => [i.market, i]))

    for (const horizon of ['15m', '1h'] as const) {
      const market = `btc-${horizon}`
      const slug = await resolveSoonestSlug('bitcoin', horizon)
      if (!slug) {
        console.log(`[QuantBackend] ${horizon}: no active market found`)
        continue
      }

      // Get start_price and minutes_remaining from SynthData insight
      const synthInsight = insightByMarket.get(market)
      const startPrice = synthInsight?.start_price ?? null
      let minutesRemaining: number | null = null

      if (synthInsight?.event_end_time) {
        const endMs = new Date(synthInsight.event_end_time).getTime()
        minutesRemaining = Math.max(0, (endMs - now.getTime()) / 60_000)
      }

      // Compute spread from best_bid/best_ask if available
      let spread: number | null = null
      if (synthInsight?.best_bid_price != null && synthInsight?.best_ask_price != null) {
        spread = synthInsight.best_ask_price - synthInsight.best_bid_price
      }

      const polyUp = synthInsight?.polymarket_probability_up ?? 0.5

      // Fetch signal from quant-backend with all context
      const signal = await fetchQuantSignalForHorizon(
        horizon,
        startPrice,
        minutesRemaining,
        polyUp,
        spread,
      )
      if (!signal) continue

      const outcome = signal.trade_allowed
        ? (signal.p_up >= 0.5 ? 'up' : 'down')
        : 'blocked'

      const row: import('./db/synthdataInsights.js').SynthdataInsightRow = {
        market: `${market}-quant`,
        sample_ts: now,
        slug,
        start_price: startPrice,
        current_price: signal.current_price_usd,
        current_outcome: outcome,
        synth_probability_up: signal.p_up,
        polymarket_probability_up: polyUp,
        event_start_time: synthInsight?.event_start_time ? new Date(synthInsight.event_start_time) : null,
        event_end_time: synthInsight?.event_end_time ? new Date(synthInsight.event_end_time) : null,
        best_bid_price: synthInsight?.best_bid_price ?? null,
        best_ask_price: synthInsight?.best_ask_price ?? null,
        best_bid_size: synthInsight?.best_bid_size ?? null,
        best_ask_size: synthInsight?.best_ask_size ?? null,
        polymarket_last_trade_time: null,
        polymarket_last_trade_price: null,
        polymarket_last_trade_outcome: null,
        raw: signal as unknown as Record<string, unknown>,
      }
      await insertSynthdataInsight(row).catch((err: unknown) =>
        console.error('[QuantBackend] insert', market, (err as Error)?.message)
      )

      const blockMsg = signal.trade_allowed ? '' : ` [BLOCKED: ${signal.block_reason ?? 'filters'}]`
      const startInfo = startPrice ? ` start=$${startPrice.toFixed(0)}` : ''
      const timeInfo = minutesRemaining != null ? ` rem=${minutesRemaining.toFixed(1)}m` : ''
      console.log('[QuantBackend] %s P(up)=%s raw=%s side=%s edge=%s%% engine=%s%s%s%s',
        horizon.toUpperCase(),
        signal.p_up.toFixed(4), signal.p_up_raw?.toFixed(4) ?? '?',
        signal.side, signal.edge_pct.toFixed(2),
        signal.engine, startInfo, timeInfo,
        blockMsg)
    }
  } catch (err) {
    console.error('[QuantBackend] tick error', (err as Error)?.message)
  }
}

async function main() {
  let slug = config.marketSlug
  const wantCurrentBtc5m = /btc.*5m|5m.*btc/i.test(slug)
  if (wantCurrentBtc5m) {
    console.log('Resolving current BTC 5m market...')
    const soonest = await resolveSoonestBtc5mSlug()
    if (soonest) {
      slug = soonest
      console.log('Using soonest market slug:', slug)
    } else {
      console.log('Could not resolve soonest, using config slug:', slug)
    }
  }
  console.log('Fetching market info...')
  marketInfo = await fetchMarketInfo(slug)
  console.log('Market:', marketInfo.name, marketInfo.clobTokenIds)
  if (marketInfo.endDate) {
    console.log('Market expiry (endDate):', marketInfo.endDate)
  } else {
    console.log('Market expiry (endDate): unknown (no endDate in Gamma response)')
  }

  connectClob(marketInfo.clobTokenIds)
  connectRtds()

  intervalId = setInterval(tick, config.sampleIntervalMs)
  console.log('Ingestion started (1 sample/sec). Each tick logs: sample_ts, market, expiry_s, price, up/down odds, CLOB/RTDS status.')

  if (config.lexaMarketInsightsEnabled) {
    const intervalMs = config.lexaMarketInsightsPollIntervalMs
    marketInsightsIntervalId = setInterval(lexaMarketInsightsTick, intervalMs)
    void lexaMarketInsightsTick().catch((err: unknown) =>
      console.error('[LexaInsights] initial tick', (err as Error)?.message)
    )
    console.log(
      `[LexaInsights] Polymarket+Binance polling (BTC/ETH/SOL 15m+1h every ${intervalMs / 1000}s, staggered). Storing in synthdata_insights.`
    )
  } else if (config.synthdataEnabled && config.synthdataApiKey) {
    const intervalMs = config.synthdataPollIntervalMs
    marketInsightsIntervalId = setInterval(synthdataTick, intervalMs)
    console.log(`SynthData polling started (BTC/ETH/SOL 15m+1h every ${intervalMs / 1000}s, staggered). Storing in synthdata_insights.`)
  } else {
    console.log('Market insights skipped: Lexa insights disabled (LEXA_MARKET_INSIGHTS_ENABLED=0) and SynthData not configured.')
  }

  if (config.quantBackendEnabled) {
    const intervalMs = config.quantBackendPollIntervalMs
    quantIntervalId = setInterval(quantBackendTick, intervalMs)
    // Also run immediately
    quantBackendTick().catch((err: unknown) => console.error('[QuantBackend] initial tick error', (err as Error)?.message))
    console.log(`[QuantBackend] polling started (every ${intervalMs / 1000}s). Signals stored as btc-*-quant in synthdata_insights.`)
  } else {
    console.log('[QuantBackend] skipped: set QUANT_BACKEND_ENABLED=1 to enable.')
  }
}

process.on('SIGINT', async () => {
  if (intervalId) clearInterval(intervalId)
  if (marketInsightsIntervalId) clearInterval(marketInsightsIntervalId)
  if (quantIntervalId) clearInterval(quantIntervalId)
  if (clobReconnectTimeout) {
    clearTimeout(clobReconnectTimeout)
    clobReconnectTimeout = null
  }
  if (clobPingId) {
    clearInterval(clobPingId)
    clobPingId = null
  }
  clobWs?.close()
  rtdsWs?.close()
  await closePool()
  process.exit(0)
})

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
