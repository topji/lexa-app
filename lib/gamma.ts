import { PolymarketMarket } from '@/types/polymarket'

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com'

/** Gamma API event shape (simplified) */
interface GammaEvent {
  id: string
  slug: string | null
  title: string | null
  description: string | null
  volume?: number
  volume24hr?: number
  closed?: boolean
  active?: boolean
  category?: string | null
  createdAt?: string
  startDate?: string
  endDate?: string
  markets?: GammaMarket[]
  tags?: Array<{ id: number; label?: string; slug?: string }>
}

/** Gamma API market shape (nested in event) */
interface GammaMarket {
  id: string
  question: string
  slug: string
  conditionId?: string
  description?: string
  outcomes?: string // JSON string e.g. '["Up", "Down"]'
  outcomePrices?: string // JSON string e.g. '["0.5", "0.5"]' — often stale; prefer bestBid/bestAsk
  closed?: boolean
  bestBid?: number
  bestAsk?: number
  liquidity?: string | number
}

/**
 * Parse outcome names and prices. Use live order-book (bestBid/bestAsk) when
 * available; otherwise use outcomePrices. Gamma often returns outcomePrices
 * as "0.5","0.5" even when real odds differ, so we prefer bestBid/bestAsk for binary markets.
 */
function parseOutcomes(market: GammaMarket): PolymarketMarket['outcomes'] {
  let names: string[] = []

  try {
    if (market.outcomes) {
      names = JSON.parse(market.outcomes) as string[]
    }
  } catch {
    names = ['Yes', 'No']
  }

  let prices: number[] = []

  // 1) Prefer live order book for binary markets when present and sensible
  const bid = typeof market.bestBid === 'number' ? market.bestBid : parseFloat(String(market.bestBid))
  const ask = typeof market.bestAsk === 'number' ? market.bestAsk : parseFloat(String(market.bestAsk))
  if (
    names.length === 2 &&
    !Number.isNaN(bid) &&
    !Number.isNaN(ask) &&
    bid > 0 &&
    ask > 0 &&
    bid <= 1 &&
    ask <= 1
  ) {
    const yesPrice = (bid + ask) / 2
    prices = [yesPrice, 1 - yesPrice]
  } else {
    // 2) Use outcomePrices from Gamma (often real odds like "0.075","0.925")
    try {
      if (market.outcomePrices) {
        prices = (JSON.parse(market.outcomePrices) as string[]).map((p) => parseFloat(String(p)))
      }
    } catch {
      // ignore
    }
    if (names.length !== prices.length || prices.some((p) => Number.isNaN(p))) {
      prices = names.map(() => 0.5)
    }
  }

  return names.map((name, i) => ({ name, price: Math.max(0, Math.min(1, prices[i] ?? 0.5)) }))
}

function eventToMarkets(event: GammaEvent): PolymarketMarket[] {
  const eventSlug = event.slug || event.id
  const category = event.category || event.tags?.[0]?.label || ''
  const tagLabels: string[] = event.tags?.map((t) => t.label || t.slug).filter((x): x is string => Boolean(x)) ?? []

  const startDate = event.startDate ? new Date(event.startDate) : undefined
  const endDate = event.endDate ? new Date(event.endDate) : undefined

  if (!event.markets || event.markets.length === 0) {
    return [{
      id: event.id,
      question: event.title || 'Untitled',
      description: event.description || undefined,
      slug: eventSlug,
      outcomes: [{ name: 'Yes', price: 0.5 }, { name: 'No', price: 0.5 }],
      volume: event.volume,
      category,
      tags: tagLabels,
      isOpen: !event.closed,
      closed: event.closed,
      createdAt: event.createdAt ? new Date(event.createdAt) : undefined,
      startDate,
      endDate,
    }]
  }

  return event.markets.map((m) => {
    const volumeNum = typeof m.liquidity === 'string' ? parseFloat(m.liquidity) : m.liquidity
    return {
      id: m.id,
      question: m.question,
      description: m.description || event.description || undefined,
      slug: eventSlug,
      outcomes: parseOutcomes(m),
      volume: event.volume ?? volumeNum,
      category,
      tags: tagLabels,
      isOpen: !m.closed && !event.closed,
      closed: m.closed ?? event.closed,
      createdAt: event.createdAt ? new Date(event.createdAt) : undefined,
      startDate,
      endDate,
    }
  })
}

/**
 * Fetch active events from Gamma API (newest first).
 * Uses pagination; returns flattened list of markets from those events.
 */
export async function fetchGammaEvents(options: {
  limit?: number
  offset?: number
  closed?: boolean
}): Promise<PolymarketMarket[]> {
  const { limit = 100, offset = 0, closed = false } = options

  const params = new URLSearchParams({
    order: 'id',
    ascending: 'false',
    closed: String(closed),
    limit: String(limit),
    offset: String(offset),
  })

  const res = await fetch(`${GAMMA_API_BASE}/events?${params}`, {
    headers: { Accept: 'application/json' },
    next: { revalidate: 60 },
  })

  if (!res.ok) {
    throw new Error(`Gamma API error: ${res.status}`)
  }

  const events: GammaEvent[] = await res.json()
  const markets: PolymarketMarket[] = []

  for (const event of events) {
    markets.push(...eventToMarkets(event))
  }

  return markets
}

/**
 * Fetch open events that end within a time window, ordered by endDate ascending (soonest first).
 * Use this to get the market that expires next (e.g. current 15m window).
 */
export async function fetchGammaEventsEndingSoon(options: {
  endDateMin: string // ISO date-time, e.g. now
  endDateMax: string // ISO date-time, e.g. now + 1 hour
  limit?: number
}): Promise<PolymarketMarket[]> {
  const { endDateMin, endDateMax, limit = 100 } = options

  const params = new URLSearchParams({
    closed: 'false',
    end_date_min: endDateMin,
    end_date_max: endDateMax,
    order: 'endDate',
    ascending: 'true',
    limit: String(limit),
  })

  const res = await fetch(`${GAMMA_API_BASE}/events?${params}`, {
    headers: { Accept: 'application/json' },
    next: { revalidate: 30 },
  })

  if (!res.ok) {
    throw new Error(`Gamma API error: ${res.status}`)
  }

  const events: GammaEvent[] = await res.json()
  const markets: PolymarketMarket[] = []
  for (const event of events) {
    markets.push(...eventToMarkets(event))
  }
  return markets
}

/**
 * Search active markets by keyword.
 * Fetches from Gamma and filters by question, description, category, tags.
 */
export function filterMarketsBySearch(
  markets: PolymarketMarket[],
  search: string
): PolymarketMarket[] {
  const q = search.trim().toLowerCase()
  if (!q) return markets

  return markets.filter((m) => {
    const question = m.question?.toLowerCase() ?? ''
    const description = m.description?.toLowerCase() ?? ''
    const category = m.category?.toLowerCase() ?? ''
    const tags = m.tags?.join(' ').toLowerCase() ?? ''
    const text = `${question} ${description} ${category} ${tags}`
    return text.includes(q)
  })
}
