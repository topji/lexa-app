import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

type MarketResult = {
  marketId: string
  title: string
  slug?: string
  url?: string
  yesPrice?: number
  noPrice?: number
  volume24h?: number
  liquidity?: number
  resolutionDate?: string
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const q = (searchParams.get('q') ?? '').trim()
    const limitRaw = searchParams.get('limit')
    const limit = Math.min(Math.max(parseInt(limitRaw ?? '20', 10) || 20, 1), 50)

    if (!q) {
      return NextResponse.json({ markets: [] satisfies MarketResult[] })
    }

    const pmxtMod = await import('pmxtjs')
    // Handle ESM/CJS interop differences between Node and Next bundler
    const pmxt: any = (pmxtMod as any).default?.default ?? (pmxtMod as any).default ?? pmxtMod

    const PolyCtor = pmxt.PolymarketExchange ?? pmxt.Polymarket
    if (!PolyCtor) throw new Error('pmxtjs Polymarket constructor not found')
    const poly = new PolyCtor()

    const markets = typeof poly.searchMarkets === 'function'
      ? await poly.searchMarkets(q, { limit })
      : await poly.fetchMarkets({ limit })

    const mapped: MarketResult[] = (markets ?? []).map((m: any) => {
      const outcomes = Array.isArray(m.outcomes) ? m.outcomes : []
      const yes = m.yes ?? outcomes[0]
      const no = m.no ?? outcomes[1]
      return {
        marketId: String(m.marketId ?? m.id ?? ''),
        title: String(m.title ?? ''),
        slug: typeof m.slug === 'string' ? m.slug : undefined,
        url: typeof m.url === 'string' ? m.url : undefined,
        yesPrice: typeof yes?.price === 'number' ? yes.price : undefined,
        noPrice: typeof no?.price === 'number' ? no.price : undefined,
        volume24h: typeof m.volume24h === 'number' ? m.volume24h : undefined,
        liquidity: typeof m.liquidity === 'number' ? m.liquidity : undefined,
        resolutionDate: typeof m.resolutionDate === 'string'
          ? m.resolutionDate
          : m.resolutionDate instanceof Date
            ? m.resolutionDate.toISOString()
            : undefined,
      }
    }).filter((m: MarketResult) => m.marketId && m.title)

    return NextResponse.json({ markets: mapped })
  } catch (err) {
    console.error('pmxt markets search error', err)
    return NextResponse.json({ error: 'Failed to search markets' }, { status: 500 })
  }
}

