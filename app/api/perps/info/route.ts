/**
 * Proxy to Hyperliquid Info API.
 *
 * POST /api/perps/info
 * Body: any valid Hyperliquid info request (e.g. { type: "allMids" })
 *
 * This avoids CORS issues when calling Hyperliquid from the browser.
 */

const HL_API = 'https://api.hyperliquid.xyz/info'

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const resp = await fetch(HL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!resp.ok) {
      const text = await resp.text()
      return Response.json(
        { error: `Hyperliquid API error: ${resp.status}`, detail: text },
        { status: resp.status },
      )
    }

    const data = await resp.json()
    return Response.json(data)
  } catch (err) {
    return Response.json(
      { error: 'Failed to reach Hyperliquid', detail: (err as Error)?.message },
      { status: 502 },
    )
  }
}
