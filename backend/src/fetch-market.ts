import { config } from './config.js'

export interface MarketInfo {
  slug: string
  name: string
  clobTokenIds: [string, string]
}

export async function fetchMarketInfo(slug: string): Promise<MarketInfo> {
  const res = await fetch(
    `${config.gammaApiBase}/events/slug/${encodeURIComponent(slug)}`,
    { headers: { Accept: 'application/json' } }
  )
  if (!res.ok) throw new Error(`Gamma API error: ${res.status} for slug ${slug}`)
  const event = (await res.json()) as {
    slug?: string
    title?: string
    markets?: Array<{ clobTokenIds?: string }>
  }
  const markets = event.markets ?? []
  const first = markets[0]
  if (!first?.clobTokenIds) throw new Error(`No clobTokenIds for slug ${slug}`)
  let ids: string[]
  try {
    ids = typeof first.clobTokenIds === 'string' ? JSON.parse(first.clobTokenIds) : first.clobTokenIds
  } catch {
    ids = Array.isArray(first.clobTokenIds) ? first.clobTokenIds : []
  }
  if (ids.length < 2) throw new Error(`Expected 2 token IDs for slug ${slug}`)
  return {
    slug: event.slug ?? slug,
    name: event.title ?? slug,
    clobTokenIds: [ids[0], ids[1]],
  }
}
