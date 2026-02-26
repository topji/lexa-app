import { NextRequest, NextResponse } from 'next/server'
import { fetchGammaEventsEndingSoon, filterMarketsBySearch } from '@/lib/gamma'

/**
 * GET /api/crypto/soonest?asset=Bitcoin&interval=5|15
 * Returns the slug of the open market for this asset that ends soonest.
 * interval: 5 = only 5m markets (slug contains "5m"), 15 = only 15m (default).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const asset = searchParams.get('asset')?.trim()
    const intervalParam = searchParams.get('interval')?.trim()
    const interval = intervalParam === '5' ? 5 : intervalParam === '15' ? 15 : null

    if (!asset) {
      return NextResponse.json({ error: 'asset required' }, { status: 400 })
    }

    const now = new Date()
    const nowMs = now.getTime()
    const oneHourLater = new Date(nowMs + 60 * 60 * 1000)
    const oneDayLater = new Date(nowMs + 24 * 60 * 60 * 1000)

    let markets = await fetchGammaEventsEndingSoon({
      endDateMin: now.toISOString(),
      endDateMax: oneHourLater.toISOString(),
      limit: 50,
    })

    if (markets.length === 0) {
      markets = await fetchGammaEventsEndingSoon({
        endDateMin: now.toISOString(),
        endDateMax: oneDayLater.toISOString(),
        limit: 50,
      })
    }

    let filtered = filterMarketsBySearch(markets, asset)
    if (interval !== null) {
      const suffix = interval === 5 ? '5m' : '15m'
      filtered = filtered.filter((m) => m.slug?.toLowerCase().includes(suffix))
    }

    const bySlug = new Map<string, number>()
    for (const m of filtered) {
      const end = m.endDate ? new Date(m.endDate).getTime() : NaN
      if (Number.isNaN(end) || end <= nowMs) continue
      if (!bySlug.has(m.slug) || end < bySlug.get(m.slug)!) {
        bySlug.set(m.slug, end)
      }
    }

    const soonest = Array.from(bySlug.entries())
      .sort((a, b) => a[1] - b[1])[0]

    if (!soonest) {
      return NextResponse.json({ slug: null, message: 'No open market found for this asset' })
    }

    return NextResponse.json({ slug: soonest[0] })
  } catch (error) {
    console.error('Crypto soonest API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch soonest market' },
      { status: 500 }
    )
  }
}
