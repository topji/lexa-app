'use client'

import { useEffect, useState, useRef } from 'react'

const RTDS_WS_URL = 'wss://ws-live-data.polymarket.com'

type SymbolKey = 'btc/usd' | 'eth/usd' | 'sol/usd' | 'xrp/usd'

const ASSETS: { symbol: SymbolKey; label: string }[] = [
  { symbol: 'btc/usd', label: 'BTC' },
  { symbol: 'eth/usd', label: 'ETH' },
  { symbol: 'sol/usd', label: 'SOL' },
  { symbol: 'xrp/usd', label: 'XRP' },
]

export function CryptoPriceTicker() {
  const [prices, setPrices] = useState<Record<SymbolKey, number | null>>({
    'btc/usd': null,
    'eth/usd': null,
    'sol/usd': null,
    'xrp/usd': null,
  })
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const ws = new WebSocket(RTDS_WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({
        action: 'subscribe',
        subscriptions: ASSETS.map((a) => ({
          topic: 'crypto_prices_chainlink',
          type: '*',
          filters: `{"symbol":"${a.symbol}"}`,
        })),
      }))
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.topic === 'crypto_prices_chainlink' && msg.payload?.symbol && typeof msg.payload.value === 'number') {
          const sym = msg.payload.symbol as SymbolKey
          if (!['btc/usd', 'eth/usd', 'sol/usd', 'xrp/usd'].includes(sym)) return
          const value = msg.payload.value as number
          setPrices((prev) => ({
            ...prev,
            [sym]: value,
          }))
        }
      } catch {
        // ignore malformed messages
      }
    }

    ws.onclose = () => {
      wsRef.current = null
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [])

  return (
    <div className="mb-4 rounded-xl border border-[#1e293b] bg-[#020617]/80 px-4 py-3 text-xs text-gray-300">
      <div className="flex flex-wrap items-center gap-4 justify-center sm:justify-between">
        {ASSETS.map(({ symbol, label }) => {
          const v = prices[symbol]
          return (
            <div key={symbol} className="flex items-baseline gap-2 font-mono">
              <span className="text-gray-400 font-semibold">{label}</span>
              <span className="text-white">
                {v != null
                  ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : '—'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

