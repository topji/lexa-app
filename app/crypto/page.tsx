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
        if (msg.topic === 'crypto_prices_chainlink' && msg.payload?.value != null) {
          const sym = msg.payload.symbol as string
          pricesRef.current[sym] = msg.payload.value
          const value = msg.payload.value as number
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

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-gray-500 text-sm">Loading crypto markets…</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">Crypto · Up or Down</h1>
            <p className="text-gray-500 text-sm mt-0.5">BTC 5m & 15m · ETH, SOL, XRP 15m · Chainlink resolution</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {CRYPTO_HUB_ITEMS.map((item) => {
            const hrefSlug = item.slug ?? item.id
            const m = markets[hrefSlug]
            if (!m) return null
            return (
              <Link
                key={hrefSlug}
                href={`/crypto/${hrefSlug}`}
                className="block rounded-xl border border-[#1e293b] bg-[#0f172a]/80 hover:border-[#334155] hover:bg-[#0f172a] transition-all"
              >
                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-lg font-semibold text-white">{item.label}</span>
                    <span className="text-xs text-gray-500 tabular-nums">{item.window}</span>
                  </div>
                  <div className="text-2xl font-mono font-semibold text-white mb-2">
                    {m.livePrice != null ? `$${m.livePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                  </div>
                  <div className="flex gap-3 text-sm">
                    <span className="text-green-400">Up {(m.upPrice * 100).toFixed(1)}%</span>
                    <span className="text-red-400">Down {(m.downPrice * 100).toFixed(1)}%</span>
                  </div>
                  <div className="mt-2 text-xs text-gray-500">
                    Vol ${(m.volume || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
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
