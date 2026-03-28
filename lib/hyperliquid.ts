/**
 * Hyperliquid Perpetual DEX — client library.
 *
 * Info API:  POST https://api.hyperliquid.xyz/info   (read-only, no auth)
 * Exchange:  POST https://api.hyperliquid.xyz/exchange (requires EIP-712 sig)
 * WebSocket: wss://api.hyperliquid.xyz/ws
 *
 * Assets are referenced by coin name ("BTC") in Info API
 * and by integer index (0=BTC, 1=ETH, ...) in Exchange API.
 */

// ── Constants ────────────────────────────────────────────────────────────────

export const HL_INFO_URL = '/api/perps/info' // proxied through Next.js
export const HL_WS_URL = 'wss://api.hyperliquid.xyz/ws'

export const PERP_ASSETS = ['BTC', 'ETH', 'SOL', 'GOLD'] as const
export type PerpAsset = (typeof PERP_ASSETS)[number]

export const ASSET_ICONS: Record<PerpAsset, string> = {
  BTC: '₿',
  ETH: 'Ξ',
  SOL: '◎',
  GOLD: '🥇',
}

export const ASSET_COLORS: Record<PerpAsset, string> = {
  BTC: '#f7931a',
  ETH: '#627eea',
  SOL: '#9945ff',
  GOLD: '#ffd700',
}

/**
 * Map our UI asset name to Hyperliquid's internal coin name.
 * Gold trades as PAXG (Paxos Gold) perpetual on Hyperliquid.
 */
export function hlCoinName(asset: PerpAsset): string {
  if (asset === 'GOLD') return 'PAXG'
  return asset
}

export const CANDLE_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const
export type CandleInterval = (typeof CANDLE_INTERVALS)[number]

// ── Types ────────────────────────────────────────────────────────────────────

export type AssetMeta = {
  name: string
  szDecimals: number
  maxLeverage: number
  onlyIsolated?: boolean
}

export type AssetCtx = {
  dayNtlVlm: string
  funding: string
  impactPxs: [string, string] | null
  markPx: string
  midPx: string | null
  openInterest: string
  oraclePx: string
  premium: string
  prevDayPx: string
}

export type MetaAndCtx = {
  meta: { universe: AssetMeta[] }
  contexts: AssetCtx[]
}

export type L2Level = {
  px: string
  sz: string
  n: number
}

export type L2Book = {
  coin: string
  time: number
  levels: [L2Level[], L2Level[]] // [bids, asks]
}

export type Trade = {
  coin: string
  side: string
  px: string
  sz: string
  time: number
  hash: string
  tid: number
}

export type Position = {
  coin: string
  entryPx: string | null
  leverage: { type: string; value: number; rawUsd?: string }
  liquidationPx: string | null
  marginUsed: string
  maxLeverage: number
  positionValue: string
  returnOnEquity: string
  szi: string // signed size: positive = long, negative = short
  unrealizedPnl: string
  cumFunding: { allTime: string; sinceOpen: string; sinceChange: string }
}

export type AssetPosition = {
  position: Position
  type: string
}

export type MarginSummary = {
  accountValue: string
  totalNtlPos: string
  totalRawUsd: string
  totalMarginUsed: string
}

export type ClearinghouseState = {
  marginSummary: MarginSummary
  crossMarginSummary: MarginSummary
  crossMaintenanceMarginUsed: string
  assetPositions: AssetPosition[]
  withdrawable: string
}

export type OpenOrder = {
  coin: string
  side: 'B' | 'A'
  limitPx: string
  sz: string
  oid: number
  timestamp: number
  origSz: string
  cloid: string | null
  orderType: string
  reduceOnly: boolean
  triggerPx: string | null
  triggerCondition: string | null
  isTrigger: boolean
}

export type UserFill = {
  coin: string
  px: string
  sz: string
  side: string
  time: number
  startPosition: string
  dir: string
  closedPnl: string
  hash: string
  oid: number
  crossed: boolean
  fee: string
  tid: number
  feeToken: string
}

export type FundingEntry = {
  coin: string
  fundingRate: string
  premium: string
  time: number
}

export type HlCandle = {
  t: number  // open time (ms)
  T: number  // close time (ms)
  s: string  // coin
  i: string  // interval
  o: string  // open
  c: string  // close
  h: string  // high
  l: string  // low
  v: string  // volume (base)
  n: number  // num trades
}

// ── Info API Helpers ─────────────────────────────────────────────────────────

async function hlInfo<T>(body: Record<string, unknown>): Promise<T> {
  const resp = await fetch(HL_INFO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    throw new Error(`Hyperliquid info error: ${resp.status}`)
  }
  return (await resp.json()) as T
}

export async function fetchMetaAndCtxs(): Promise<MetaAndCtx> {
  const raw = await hlInfo<[{ universe: AssetMeta[] }, AssetCtx[]]>({
    type: 'metaAndAssetCtxs',
  })
  return { meta: raw[0], contexts: raw[1] }
}

export async function fetchAllMids(): Promise<Record<string, string>> {
  return hlInfo<Record<string, string>>({ type: 'allMids' })
}

export async function fetchL2Book(
  coin: string,
  nSigFigs?: number,
): Promise<L2Book> {
  return hlInfo<L2Book>({
    type: 'l2Book',
    coin,
    nSigFigs: nSigFigs ?? null,
    mantissa: null,
  })
}

export async function fetchClearinghouseState(
  user: string,
): Promise<ClearinghouseState> {
  return hlInfo<ClearinghouseState>({
    type: 'clearinghouseState',
    user,
  })
}

export async function fetchOpenOrders(user: string): Promise<OpenOrder[]> {
  return hlInfo<OpenOrder[]>({
    type: 'frontendOpenOrders',
    user,
  })
}

export async function fetchUserFills(user: string): Promise<UserFill[]> {
  return hlInfo<UserFill[]>({
    type: 'userFillsByTime',
    user,
    startTime: Date.now() - 24 * 60 * 60 * 1000, // last 24h
    aggregateByTime: false,
  })
}

export async function fetchFundingHistory(
  coin: string,
  startTime?: number,
): Promise<FundingEntry[]> {
  return hlInfo<FundingEntry[]>({
    type: 'fundingHistory',
    coin,
    startTime: startTime ?? Date.now() - 24 * 60 * 60 * 1000,
  })
}

export async function fetchPredictedFundings(): Promise<
  Array<[{ coin: string }, string, string]>
> {
  return hlInfo<Array<[{ coin: string }, string, string]>>({
    type: 'predictedFundings',
  })
}

/** Fetch OHLCV candles from Hyperliquid. */
export async function fetchCandles(
  coin: string,
  interval: CandleInterval = '15m',
  lookbackMs: number = 24 * 60 * 60 * 1000,
): Promise<HlCandle[]> {
  const now = Date.now()
  return hlInfo<HlCandle[]>({
    type: 'candleSnapshot',
    req: {
      coin,
      interval,
      startTime: now - lookbackMs,
      endTime: now,
    },
  })
}

// ── WebSocket Manager ────────────────────────────────────────────────────────

export type WsSubscription =
  | { type: 'allMids' }
  | { type: 'l2Book'; coin: string }
  | { type: 'trades'; coin: string }
  | { type: 'activeAssetCtx'; coin: string }
  | { type: 'userFills'; user: string }
  | { type: 'orderUpdates'; user: string }

type WsMessage = {
  channel: string
  data: unknown
}

type WsCallback = (channel: string, data: unknown) => void

export class HyperliquidWs {
  private ws: WebSocket | null = null
  private subs: WsSubscription[] = []
  private callbacks: WsCallback[] = []
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingInterval: ReturnType<typeof setInterval> | null = null
  private _connected = false

  get connected(): boolean {
    return this._connected
  }

  connect() {
    if (this.ws && this.ws.readyState <= 1) return
    this.ws = new WebSocket(HL_WS_URL)

    this.ws.onopen = () => {
      this._connected = true
      // Resubscribe
      for (const sub of this.subs) {
        this.ws?.send(
          JSON.stringify({ method: 'subscribe', subscription: sub }),
        )
      }
      // Ping every 30s to keep alive
      this.pingInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ method: 'ping' }))
        }
      }, 30_000)
    }

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as WsMessage
        if (msg.channel === 'pong' || msg.channel === 'subscriptionResponse') return
        for (const cb of this.callbacks) {
          cb(msg.channel, msg.data)
        }
      } catch {
        // ignore
      }
    }

    this.ws.onclose = () => {
      this._connected = false
      if (this.pingInterval) clearInterval(this.pingInterval)
      this.reconnectTimer = setTimeout(() => this.connect(), 3000)
    }

    this.ws.onerror = () => {
      this._connected = false
    }
  }

  subscribe(sub: WsSubscription) {
    const exists = this.subs.some(
      (s) => JSON.stringify(s) === JSON.stringify(sub),
    )
    if (!exists) this.subs.push(sub)
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({ method: 'subscribe', subscription: sub }),
      )
    }
  }

  unsubscribe(sub: WsSubscription) {
    this.subs = this.subs.filter(
      (s) => JSON.stringify(s) !== JSON.stringify(sub),
    )
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({ method: 'unsubscribe', subscription: sub }),
      )
    }
  }

  onMessage(cb: WsCallback) {
    this.callbacks.push(cb)
    return () => {
      this.callbacks = this.callbacks.filter((c) => c !== cb)
    }
  }

  close() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.pingInterval) clearInterval(this.pingInterval)
    this.subs = []
    this.callbacks = []
    this.ws?.close()
    this.ws = null
    this._connected = false
  }
}

// ── Formatting helpers ───────────────────────────────────────────────────────

export function formatPrice(px: string | number, coin?: PerpAsset): string {
  const n = typeof px === 'string' ? parseFloat(px) : px
  if (!Number.isFinite(n)) return '--'
  if (coin === 'BTC') return n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  if (coin === 'ETH') return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (coin === 'SOL') return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  // Auto: < 10 = 4dp, < 1000 = 2dp, else 1dp
  if (n < 10) return n.toFixed(4)
  if (n < 1000) return n.toFixed(2)
  return n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

export function formatSize(sz: string | number, decimals = 4): string {
  const n = typeof sz === 'string' ? parseFloat(sz) : sz
  if (!Number.isFinite(n)) return '--'
  return Math.abs(n).toFixed(decimals)
}

export function formatUsd(n: number | string): string {
  const v = typeof n === 'string' ? parseFloat(n) : n
  if (!Number.isFinite(v)) return '--'
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (Math.abs(v) >= 1_000) return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  return `$${v.toFixed(2)}`
}

export function formatPct(n: number | string, dp = 2): string {
  const v = typeof n === 'string' ? parseFloat(n) : n
  if (!Number.isFinite(v)) return '--'
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(dp)}%`
}

export function formatFunding(rate: string): string {
  const n = parseFloat(rate)
  if (!Number.isFinite(n)) return '--'
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(4)}%`
}

export function pnlColor(pnl: number | string): string {
  const v = typeof pnl === 'string' ? parseFloat(pnl) : pnl
  if (v > 0) return 'text-neon-green'
  if (v < 0) return 'text-neon-red'
  return 'text-gray-400'
}

export function sideColor(side: string): string {
  const s = side.toUpperCase()
  if (s === 'B' || s === 'BUY' || s === 'LONG') return 'text-neon-green'
  if (s === 'A' || s === 'SELL' || s === 'SHORT') return 'text-neon-red'
  return 'text-gray-400'
}

/** Get 24h price change percent from prevDayPx and markPx. */
export function get24hChange(ctx: AssetCtx): number {
  const mark = parseFloat(ctx.markPx)
  const prev = parseFloat(ctx.prevDayPx)
  if (!prev || !mark) return 0
  return (mark - prev) / prev
}
