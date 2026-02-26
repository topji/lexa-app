import WebSocket from 'ws'
import { config } from './config.js'
import { fetchMarketInfo } from './fetch-market.js'
import { getPool, insertOdds, closePool } from './db/client.js'
import { getWindowTs, pctChange } from './utils.js'

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
let rtdsWs: WebSocket | null = null
const buffer: Sample[] = []
let intervalId: ReturnType<typeof setInterval> | null = null

function connectClob(tokenIds: [string, string]) {
  const ws = new WebSocket(config.clobWsUrl)
  clobWs = ws
  ws.on('open', () => {
    ws.send(JSON.stringify({ assets_ids: tokenIds, type: 'market' }))
    console.log('[CLOB] Connected')
  })
  ws.on('message', (data: Buffer) => {
    if (data.toString() === 'PONG') return
    try {
      const msg = JSON.parse(data.toString()) as {
        event_type?: string
        asset_id?: string
        best_bid?: string | number
        best_ask?: string | number
        price_changes?: Array<{ asset_id?: string; best_bid?: string | number; best_ask?: string | number }>
        bids?: Array<{ price: string; size: string }>
        asks?: Array<{ price: string; size: string }>
      }
      const upId = tokenIds[0]
      const downId = tokenIds[1]

      const setMid = (mid: number, isUp: boolean) => {
        if (isUp) {
          upOdd = mid
          downOdd = 1 - mid
        } else {
          downOdd = mid
          upOdd = 1 - mid
        }
      }

      if (msg.event_type === 'price_change' && msg.price_changes?.length) {
        for (const pc of msg.price_changes) {
          const bid = pc.best_bid != null ? parseFloat(String(pc.best_bid)) : NaN
          const ask = pc.best_ask != null ? parseFloat(String(pc.best_ask)) : NaN
          if (!Number.isFinite(bid) || !Number.isFinite(ask)) continue
          const mid = (bid + ask) / 2
          const aid = pc.asset_id ?? ''
          if (aid === upId) setMid(mid, true)
          else if (aid === downId) setMid(mid, false)
        }
      } else if (msg.event_type === 'best_bid_ask') {
        const bid = parseFloat(String(msg.best_bid))
        const ask = parseFloat(String(msg.best_ask))
        if (Number.isFinite(bid) && Number.isFinite(ask)) {
          const mid = (bid + ask) / 2
          const aid = msg.asset_id ?? ''
          if (aid === upId) setMid(mid, true)
          else if (aid === downId) setMid(mid, false)
        }
      } else if (msg.event_type === 'book' && msg.bids?.length && msg.asks?.length) {
        const aid = msg.asset_id ?? ''
        const bids = msg.bids.map((b) => parseFloat(b.price)).filter(Number.isFinite)
        const asks = msg.asks.map((a) => parseFloat(a.price)).filter(Number.isFinite)
        if (bids.length && asks.length) {
          const mid = (Math.max(...bids) + Math.min(...asks)) / 2
          if (aid === upId) setMid(mid, true)
          else if (aid === downId) setMid(mid, false)
        }
      }
    } catch {
      // ignore parse errors
    }
  })
  ws.on('error', (err: Error) => console.error('[CLOB] Error', err.message))
  ws.on('close', () => {
    console.log('[CLOB] Closed, reconnecting in 5s...')
    setTimeout(() => connectClob(tokenIds), 5000)
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
    console.log('[RTDS] Connected')
  })
  ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString()) as {
        topic?: string
        payload?: { symbol?: string; value?: number }
      }
      if (msg.topic === 'crypto_prices_chainlink' && msg.payload?.symbol === 'btc/usd' && typeof msg.payload.value === 'number') {
        btcPrice = msg.payload.value
      }
    } catch {
      // ignore
    }
  })
  ws.on('error', (err: Error) => console.error('[RTDS] Error', err.message))
  ws.on('close', () => {
    console.log('[RTDS] Closed, reconnecting in 5s...')
    setTimeout(connectRtds, 5000)
  })
}

function tick() {
  if (!marketInfo) return
  const now = new Date()
  const window_ts = getWindowTs(now)

  const upChg = (i: number): number | null => {
    if (i > buffer.length) return null
    return pctChange(upOdd, buffer[buffer.length - i].up_odd)
  }
  const downChg = (i: number): number | null => {
    if (i > buffer.length) return null
    return pctChange(downOdd, buffer[buffer.length - i].down_odd)
  }

  insertOdds({
    market_slug: marketInfo.slug,
    market_name: marketInfo.name,
    window_ts,
    sample_ts: now,
    btc_price: btcPrice,
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
  })
    .then(() => {
      buffer.push({ sample_ts: now, up_odd: upOdd, down_odd: downOdd })
      if (buffer.length > HISTORY) buffer.shift()
    })
    .catch((err) => console.error('[DB] Insert error', err))
}

async function main() {
  console.log('Fetching market info...')
  marketInfo = await fetchMarketInfo(config.marketSlug)
  console.log('Market:', marketInfo.name, marketInfo.clobTokenIds)

  connectClob(marketInfo.clobTokenIds)
  connectRtds()

  intervalId = setInterval(tick, config.sampleIntervalMs)
  console.log('Ingestion started (1 sample/sec). Press Ctrl+C to stop.')
}

process.on('SIGINT', async () => {
  if (intervalId) clearInterval(intervalId)
  clobWs?.close()
  rtdsWs?.close()
  await closePool()
  process.exit(0)
})

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
