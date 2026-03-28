/**
 * Proxy to Hyperliquid Exchange API.
 *
 * POST /api/perps/exchange
 * Body: signed action payload for Hyperliquid exchange endpoint
 */

const HL_EXCHANGE = 'https://api.hyperliquid.xyz/exchange'

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const resp = await fetch(HL_EXCHANGE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!resp.ok) {
      const text = await resp.text()
      return Response.json(
        { error: `Hyperliquid exchange error: ${resp.status}`, detail: text },
        { status: resp.status },
      )
    }

    const data = await resp.json()
    return Response.json(data)
  } catch (err) {
    return Response.json(
      { error: 'Failed to reach Hyperliquid Exchange', detail: (err as Error)?.message },
      { status: 502 },
    )
  }
}
