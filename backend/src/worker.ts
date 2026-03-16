import WebSocket from 'ws'
import { config } from './config.js'
import { fetchMarketInfo } from './fetch-market.js'
import { resolveSoonestBtc5mSlug } from './resolve-soonest.js'
import { insertOdds, closePool } from './db/client.js'
import { getWindowTs, pctChange } from './utils.js'
import { fetch15m, fetchHourly } from './synthdata/client.js'
import { toInsightRow, insertSynthdataInsight } from './db/synthdataInsights.js'

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
let synthdataIntervalId: ReturnType<typeof setInterval> | null = null
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

  if (config.synthdataEnabled && config.synthdataApiKey) {
    const intervalMs = config.synthdataPollIntervalMs
    synthdataIntervalId = setInterval(synthdataTick, intervalMs)
    console.log(`SynthData polling started (BTC/ETH/SOL 15m+1h every ${intervalMs / 1000}s, staggered). Storing in synthdata_insights.`)
  } else {
    console.log('SynthData skipped: set SYNTHDATA_ENABLED=1 and SYNTHDATA_API_KEY to enable.')
  }
}

process.on('SIGINT', async () => {
  if (intervalId) clearInterval(intervalId)
  if (synthdataIntervalId) clearInterval(synthdataIntervalId)
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
