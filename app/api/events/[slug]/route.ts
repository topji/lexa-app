import { NextRequest, NextResponse } from 'next/server'

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    if (!slug) {
      return NextResponse.json({ error: 'Slug required' }, { status: 400 })
    }

    const res = await fetch(`${GAMMA_API_BASE}/events/slug/${encodeURIComponent(slug)}`, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 30 },
    })

    if (!res.ok) {
      if (res.status === 404) {
        return NextResponse.json({ error: 'Event not found' }, { status: 404 })
      }
      throw new Error(`Gamma API error: ${res.status}`)
    }

    const event = await res.json()
    return NextResponse.json(event)
  } catch (error) {
    console.error('Events API error:', error)
    return NextResponse.json({ error: 'Failed to fetch event' }, { status: 500 })
  }
}
