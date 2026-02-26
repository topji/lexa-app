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
        if (msg.topic === 'crypto_prices_chainlink' && msg.payload?.symbol != null && typeof msg.payload.value === 'number') {
          const raw = String(msg.payload.symbol).toLowerCase()
          const sym = raw as SymbolKey
          if (raw !== 'btc/usd' && raw !== 'eth/usd' && raw !== 'sol/usd' && raw !== 'xrp/usd') return
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
    <div className="mb-4 sm:mb-6 rounded-xl sm:rounded-2xl border border-void-border bg-void-card/80 px-3 py-3 sm:px-5 sm:py-4 card-glow">
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-center gap-3 sm:gap-6 justify-items-center sm:justify-between">
        {ASSETS.map(({ symbol, label }) => {
          const v = prices[symbol]
          return (
            <div key={symbol} className="flex items-baseline gap-1.5 sm:gap-2 font-mono min-w-0">
              <span className="font-display text-[10px] sm:text-xs font-semibold uppercase tracking-widest text-neon-cyan shrink-0">{label}</span>
              <span className="text-sm sm:text-lg font-bold tabular-nums text-white truncate">
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
