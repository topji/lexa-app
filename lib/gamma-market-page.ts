/**
 * Parse Gamma `/events/slug/{slug}` payloads for the Lexa market detail page.
 */

export type GammaTag = { id?: number; label?: string; slug?: string }

export interface EventSummary {
  id: string
  slug: string
  ticker: string
  title: string
  description: string
  image: string
  icon: string
  resolutionSource: string
  category: string
  tags: string[]
  active: boolean
  closed: boolean
  archived: boolean
  restricted: boolean
  featured: boolean
  negRisk: boolean
  enableOrderBook: boolean
  liquidity: number
  volume: number
  volume24hr: number
  volume1wk: number
  volume1mo: number
  volume1yr: number
  openInterest: number
  liquidityClob: number
  competitive: number | null
  commentCount: number
  startDate: string
  endDate: string
  createdAt: string
  updatedAt: string
  creationDate: string
}

export interface OutcomeRow {
  name: string
  price: number
}

export interface MarketDetailRow {
  index: number
  id: string
  question: string
  description: string
  marketSlug: string
  conditionId: string | null
  questionId: string | null
  groupItemTitle: string
  clobTokenIds: string[]
  outcomes: OutcomeRow[]
  volume: number
  volume24hr: number
  volumeNum: number
  liquidity: number
  bestBid: number | null
  bestAsk: number | null
  spread: number | null
  lastTradePrice: number | null
  active: boolean
  closed: boolean
  archived: boolean
  acceptingOrders: boolean
  resolved: boolean
  negRisk: boolean
  enableOrderBook: boolean
  orderMinSize: number | null
  tickSize: number | null
  line: number | null
  endDate: string
  startDate: string
  resolutionSource: string
  umaResolutionStatus: string
  sportsMarketType: string
  image: string
  icon: string
  /** True when Lexa can show the 2-outcome trade panel */
  isBinaryTradable: boolean
}

function num(v: unknown): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v
  if (typeof v === 'string') {
    const n = parseFloat(v)
    return Number.isNaN(n) ? 0 : n
  }
  return 0
}

function str(v: unknown): string {
  return v == null ? '' : String(v)
}

function bool(v: unknown): boolean {
  return Boolean(v)
}

export function parseClobTokenIds(m: Record<string, unknown>): string[] {
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

function parseOutcomesAndPrices(m: Record<string, unknown>): OutcomeRow[] {
  let names: string[] = []
  try {
    const raw = m.outcomes
    const arr = typeof raw === 'string' ? (JSON.parse(raw) as unknown[]) : Array.isArray(raw) ? raw : []
    names = arr.map((x) => {
      if (typeof x === 'string') return x
      const o = x as { title?: string; name?: string }
      return o.title ?? o.name ?? String(x)
    })
  } catch {
    names = []
  }
  let prices: number[] = []
  try {
    const raw = m.outcomePrices ?? m.outcome_prices
    const arr =
      typeof raw === 'string'
        ? (JSON.parse(raw) as string[])
        : Array.isArray(raw)
          ? (raw as (string | number)[]).map(String)
          : []
    prices = arr.map((p) => parseFloat(String(p)))
  } catch {
    prices = []
  }

  const bid = num(m.bestBid ?? m.best_bid)
  const ask = num(m.bestAsk ?? m.best_ask)
  if (
    names.length === 2 &&
    bid > 0 &&
    ask > 0 &&
    bid <= 1 &&
    ask <= 1 &&
    !Number.isNaN(bid) &&
    !Number.isNaN(ask)
  ) {
    const mid = (bid + ask) / 2
    prices = [mid, 1 - mid]
  }

  if (names.length === 0) names = ['Yes', 'No']
  while (prices.length < names.length) {
    prices.push(0.5)
  }
  return names.map((name, i) => ({
    name,
    price: Math.max(0, Math.min(1, prices[i] ?? 0.5)),
  }))
}

export function summarizeEvent(data: Record<string, unknown>): EventSummary {
  const tagsRaw = data.tags
  const tagStrings: string[] = []
  if (Array.isArray(tagsRaw)) {
    for (const t of tagsRaw) {
      const o = t as GammaTag
      const s = o.label || o.slug
      if (s) tagStrings.push(String(s))
    }
  }

  return {
    id: str(data.id),
    slug: str(data.slug),
    ticker: str(data.ticker),
    title: str(data.title),
    description: str(data.description),
    image: str(data.image),
    icon: str(data.icon),
    resolutionSource: str(data.resolutionSource ?? data.resolution_source),
    category: str(data.category),
    tags: tagStrings,
    active: bool(data.active),
    closed: bool(data.closed),
    archived: bool(data.archived),
    restricted: bool(data.restricted),
    featured: bool(data.featured),
    negRisk: bool(data.negRisk ?? data.neg_risk),
    enableOrderBook: bool(data.enableOrderBook ?? data.enable_order_book),
    liquidity: num(data.liquidity),
    volume: num(data.volume),
    volume24hr: num(data.volume24hr ?? data.volume_24hr),
    volume1wk: num(data.volume1wk),
    volume1mo: num(data.volume1mo),
    volume1yr: num(data.volume1yr),
    openInterest: num(data.openInterest ?? data.open_interest),
    liquidityClob: num(data.liquidityClob ?? data.liquidity_clob),
    competitive: data.competitive != null ? num(data.competitive) : null,
    commentCount: num(data.commentCount ?? data.comment_count),
    startDate: str(data.startDate ?? data.start_date),
    endDate: str(data.endDate ?? data.end_date),
    createdAt: str(data.createdAt ?? data.created_at),
    updatedAt: str(data.updatedAt ?? data.updated_at),
    creationDate: str(data.creationDate ?? data.creation_date),
  }
}

export function buildMarketRows(data: Record<string, unknown>): MarketDetailRow[] {
  const markets = data.markets
  if (!Array.isArray(markets)) return []

  return markets.map((raw, index) => {
    const m = raw as Record<string, unknown>
    const outcomes = parseOutcomesAndPrices(m)
    const clobTokenIds = parseClobTokenIds(m)
    const spreadRaw = m.spread
    const spread = spreadRaw != null ? num(spreadRaw) : null
    const lastTrade = m.lastTradePrice ?? m.last_trade_price

    const closed = bool(m.closed)
    const uma = str(m.umaResolutionStatus ?? m.uma_resolution_status)
    const resolved =
      closed ||
      /resolved/i.test(uma) ||
      bool(m.automaticallyResolved ?? m.automatically_resolved)

    const isBinaryTradable = outcomes.length === 2 && clobTokenIds.length >= 2

    return {
      index,
      id: str(m.id),
      question: str(m.question),
      description: str(m.description),
      marketSlug: str(m.slug),
      conditionId: str(m.conditionId ?? m.condition_id) || null,
      questionId: str(m.questionID ?? m.question_id) || null,
      groupItemTitle: str(m.groupItemTitle ?? m.group_item_title),
      clobTokenIds,
      outcomes,
      volume: num(m.volume ?? m.volumeClob ?? m.volume_clob),
      volume24hr: num(m.volume24hr ?? m.volume24hrClob ?? m.volume24hr_clob),
      volumeNum: num(m.volumeNum ?? m.volume_num),
      liquidity: num(m.liquidity ?? m.liquidityClob),
      bestBid: m.bestBid != null || m.best_bid != null ? num(m.bestBid ?? m.best_bid) : null,
      bestAsk: m.bestAsk != null || m.best_ask != null ? num(m.bestAsk ?? m.best_ask) : null,
      spread,
      lastTradePrice: lastTrade != null ? num(lastTrade) : null,
      active: bool(m.active),
      closed,
      archived: bool(m.archived),
      acceptingOrders: bool(m.acceptingOrders ?? m.accepting_orders),
      resolved,
      negRisk: bool(m.negRisk ?? m.neg_risk),
      enableOrderBook: bool(m.enableOrderBook ?? m.enable_order_book),
      orderMinSize: m.orderMinSize != null ? num(m.orderMinSize) : m.order_min_size != null ? num(m.order_min_size) : null,
      tickSize:
        m.orderPriceMinTickSize != null
          ? num(m.orderPriceMinTickSize)
          : m.order_price_min_tick_size != null
            ? num(m.order_price_min_tick_size)
            : null,
      line: m.line != null ? num(m.line) : null,
      endDate: str(m.endDate ?? m.end_date),
      startDate: str(m.startDate ?? m.start_date),
      resolutionSource: str(m.resolutionSource ?? m.resolution_source),
      umaResolutionStatus: uma,
      sportsMarketType: str(m.sportsMarketType ?? m.sports_market_type),
      image: str(m.image),
      icon: str(m.icon),
      isBinaryTradable,
    }
  })
}

export function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

export function shortenId(s: string, head = 10, tail = 6): string {
  if (!s || s.length <= head + tail + 3) return s
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}
