import { NextRequest, NextResponse } from 'next/server'
import { buildHmacSignature } from '@polymarket/builder-signing-sdk'

/** Remote signer for Polymarket Relayer (Builder API). Never expose builder creds to the client. */
export async function POST(request: NextRequest) {
  try {
    const key = process.env.POLY_BUILDER_API_KEY
    const secret = process.env.POLY_BUILDER_SECRET
    const passphrase = process.env.POLY_BUILDER_PASSPHRASE

    if (!key?.trim() || !secret?.trim() || !passphrase?.trim()) {
      return NextResponse.json(
        { error: 'Builder API credentials not configured' },
        { status: 503 }
      )
    }

    const payload = await request.json()
    const { method, path, body, timestamp: ts } = payload as {
      method?: string
      path?: string
      body?: string
      timestamp?: number
    }

    if (!method || !path) {
      return NextResponse.json(
        { error: 'method and path are required' },
        { status: 400 }
      )
    }

    const timestamp = ts != null ? Math.floor(Number(ts)) : Math.floor(Date.now() / 1000)
    const signature = buildHmacSignature(secret, timestamp, method, path, body)

    return NextResponse.json({
      POLY_BUILDER_API_KEY: key,
      POLY_BUILDER_TIMESTAMP: String(timestamp),
      POLY_BUILDER_PASSPHRASE: passphrase,
      POLY_BUILDER_SIGNATURE: signature,
    })
  } catch (error) {
    console.error('Relayer sign error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
