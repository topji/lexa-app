'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { CRYPTO_HUB_ITEMS } from '@/lib/crypto-markets'

const CLOB_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market'
const RTDS_WS_URL = 'wss://ws-live-data.polymarket.com'

interface MarketSummary {
  slug: string
  hrefSlug: string
  title: string
  volume: number
  endDate: string
  upPrice: number
  downPrice: number
  livePrice: number | null
  clobTokenIds: string[]
  loaded: boolean
  window: '5m' | '15m'
}

export default function CryptoPage() {
  const [markets, setMarkets] = useState<Record<string, MarketSummary>>({})
  const [loading, setLoading] = useState(true)
  const wsRef = useRef<WebSocket | null>(null)
  const rtdsRef = useRef<WebSocket | null>(null)
  const pricesRef = useRef<Record<string, number>>({})

  useEffect(() => {
    const resolveSlugs = async (): Promise<string[]> => {
      const slugs: string[] = []
      for (const item of CRYPTO_HUB_ITEMS) {
        if (item.slug) {
          slugs.push(item.slug)
        } else {
          const res = await fetch(`/api/crypto/soonest?asset=${encodeURIComponent(item.label)}&interval=${item.window === '5m' ? '5' : '15'}`)
          const data = res.ok ? await res.json() : {}
          slugs.push(data.slug || item.id)
        }
      }
      return slugs
    }

    resolveSlugs()
      .then((resolvedSlugs) => {
        return Promise.all(
          CRYPTO_HUB_ITEMS.map((item, i) => {
            const slug = resolvedSlugs[i]
            return fetch(`/api/events/${slug}`).then((r) => (r.ok ? r.json() : null)).then((data) => ({ item, slug, data }))
          })
        )
      })
      .then((results) => {
        const next: Record<string, MarketSummary> = {}
        results.forEach(({ item, slug, data }) => {
          const hrefSlug = item.slug ?? item.id
          if (!data?.markets?.[0]) {
            next[hrefSlug] = {
              slug,
              hrefSlug,
              title: item.label,
              volume: 0,
              endDate: '',
              upPrice: 0.5,
              downPrice: 0.5,
              livePrice: null,
              clobTokenIds: [],
              loaded: false,
              window: item.window,
            }
            return
          }
          const m = data.markets[0]
          let ids: string[] = []
          try {
            if (m.clobTokenIds) ids = JSON.parse(m.clobTokenIds) as string[]
          } catch {}
          let up = 0.5
          try {
            const prices = JSON.parse(m.outcomePrices || '["0.5","0.5"]') as string[]
            up = parseFloat(prices[0]) || 0.5
          } catch {}
          next[hrefSlug] = {
            slug,
            hrefSlug,
            title: data.title || m.question || item.label,
            volume: parseFloat(m.volume) || data.volume || 0,
            endDate: m.endDate || data.endDate || '',
            upPrice: up,
            downPrice: 1 - up,
            livePrice: null,
            clobTokenIds: ids,
            loaded: true,
            window: item.window,
          }
        })
        setMarkets(next)
      })
      .finally(() => setLoading(false))
  }, [])

  const ready = !loading && Object.values(markets).some((m) => m.clobTokenIds.length > 0)

  useEffect(() => {
    if (!ready) return
    const allIds = Object.values(markets).flatMap((m) => m.clobTokenIds)
    if (allIds.length === 0) return
    const ws = new WebSocket(CLOB_WS_URL)
    wsRef.current = ws
    ws.onopen = () => {
      ws.send(JSON.stringify({ assets_ids: allIds, type: 'market' }))
      setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('PING') }, 10000)
    }
    ws.onmessage = (e) => {
      if (e.data === 'PONG') return
      try {
        const msg = JSON.parse(e.data)
        if (msg.event_type === 'price_change' && msg.price_changes?.length) {
          const first = msg.price_changes[0]
          const bid = first.best_bid != null ? parseFloat(String(first.best_bid)) : null
          const ask = first.best_ask != null ? parseFloat(String(first.best_ask)) : null
          if (typeof bid === 'number' && typeof ask === 'number') {
            const up = (bid + ask) / 2
            setMarkets((prev) => {
              const out = { ...prev }
              for (const key of Object.keys(prev)) {
                if (prev[key].clobTokenIds.includes(first.asset_id)) {
                  out[key] = { ...prev[key], upPrice: up, downPrice: 1 - up }
                  break
                }
              }
              return out
            })
          }
        }
      } catch {}
    }
    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [ready])

  useEffect(() => {
    const ws = new WebSocket(RTDS_WS_URL)
    rtdsRef.current = ws
    const symbols = Array.from(new Set(CRYPTO_HUB_ITEMS.map((c) => c.symbol)))
    ws.onopen = () => {
      ws.send(JSON.stringify({
        action: 'subscribe',
        subscriptions: symbols.map((symbol) => ({
          topic: 'crypto_prices_chainlink',
          type: '*',
          filters: `{"symbol":"${symbol}"}`,
        })),
      }))
    }
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.topic === 'crypto_prices_chainlink' && msg.payload?.value != null && msg.payload?.symbol != null) {
          const sym = String(msg.payload.symbol).toLowerCase()
          const value = msg.payload.value as number
          pricesRef.current[sym] = value
          setMarkets((prev) => {
            const out = { ...prev }
            CRYPTO_HUB_ITEMS.forEach((item) => {
              const key = item.slug ?? item.id
              if (item.symbol === sym && out[key]) {
                out[key] = { ...out[key], livePrice: value }
              }
            })
            return out
          })
        }
      } catch {}
    }
    return () => {
      ws.close()
      rtdsRef.current = null
    }
  }, [])

  const assetColor: Record<string, string> = {
    Bitcoin: '#f7931a',
    Ethereum: '#627eea',
    Solana: '#14f195',
    XRP: '#23292f',
  }
  const getColor = (label: string) => assetColor[label] ?? '#00f5ff'

  if (loading) {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center bg-grid px-4">
        <div className="font-display text-lexa-accent uppercase tracking-widest text-sm animate-pulse">Loading crypto markets…</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-void text-white bg-grid">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="mb-6 sm:mb-10">
          <h1 className="font-display text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white">
            <span className="text-lexa-gradient">CRYPTO</span>
            <span className="text-gray-400 font-sans font-semibold ml-2">· Up or Down</span>
          </h1>
          <p className="font-sans text-gray-500 text-xs sm:text-sm mt-1 tracking-wide">BTC 5m & 15m · ETH, SOL, XRP 15m · Chainlink resolution</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">
          {CRYPTO_HUB_ITEMS.map((item) => {
            const hrefSlug = item.slug ?? item.id
            const m = markets[hrefSlug]
            if (!m) return null
            const accent = getColor(item.label)
            const upPct = m.upPrice * 100
            return (
              <Link
                key={hrefSlug}
                href={`/crypto/${hrefSlug}`}
                className="group block rounded-2xl border border-lexa-border bg-lexa-glass hover:border-lexa-accent/50 transition-all card-glow overflow-hidden"
              >
                <div className="h-1 sm:h-1.5 shrink-0" style={{ backgroundColor: accent }} />
                <div className="p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl shrink-0 flex items-center justify-center font-display font-bold text-white text-sm sm:text-base"
                        style={{ backgroundColor: accent }}
                      >
                        {item.label.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-display font-semibold text-white uppercase tracking-wide truncate group-hover:text-lexa-accent transition-colors">
                          {item.label}
                        </p>
                        <p className="font-mono text-[10px] sm:text-xs text-gray-500 tabular-nums">{item.window}</p>
                      </div>
                    </div>
                    <span className="font-mono text-lg sm:text-xl font-bold text-white tabular-nums shrink-0">
                      {m.livePrice != null ? `$${m.livePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex-1 h-2 rounded-full bg-void overflow-hidden flex">
                      <div
                        className="h-full bg-neon-green transition-all duration-300"
                        style={{ width: `${upPct}%` }}
                      />
                      <div
                        className="h-full bg-neon-red transition-all duration-300"
                        style={{ width: `${100 - upPct}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs sm:text-sm">
                    <span className="text-neon-green font-semibold">Up {(m.upPrice * 100).toFixed(1)}%</span>
                    <span className="text-neon-red font-semibold">Down {(m.downPrice * 100).toFixed(1)}%</span>
                    <span className="font-sans text-gray-500">
                      Vol ${(m.volume || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
