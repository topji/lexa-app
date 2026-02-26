import { NextRequest, NextResponse } from 'next/server'
import { fetchGammaEvents, filterMarketsBySearch } from '@/lib/gamma'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search')?.trim() ?? ''
    const limit = Math.min(Number(searchParams.get('limit')) || 100, 200)
    const offset = Number(searchParams.get('offset')) || 0

    const markets = await fetchGammaEvents({
      limit,
      offset,
      closed: false,
    })

    const filtered = search
      ? filterMarketsBySearch(markets, search)
      : markets

    return NextResponse.json({
      markets: filtered,
      total: filtered.length,
    })
  } catch (error) {
    console.error('Markets API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch markets' },
      { status: 500 }
    )
  }
}
