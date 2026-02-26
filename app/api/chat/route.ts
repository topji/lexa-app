import { NextRequest, NextResponse } from 'next/server'
import { processChatQuery } from '@/lib/ai'

export async function POST(request: NextRequest) {
  try {
    const { message } = await request.json()

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      )
    }

    const result = await processChatQuery(message)

    return NextResponse.json({
      response: result.response,
      markets: result.markets,
    })
  } catch (error) {
    console.error('Chat API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

