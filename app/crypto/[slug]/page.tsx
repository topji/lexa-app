'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { getCryptoConfig, getAssetSearchFromSlug, getIntervalMinutes } from '@/lib/crypto-markets'
import { PlaceOrderPanel } from '@/components/PlaceOrderPanel'
import { MarketPositionAndClaim } from '@/components/MarketPositionAndClaim'

const RealtimePriceChart = dynamic(() => import('@/components/RealtimePriceChart'), { ssr: false })

const CLOB_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market'
const RTDS_WS_URL = 'wss://ws-live-data.polymarket.com'

function formatCountdown(endDate: string): string {
  const end = new Date(endDate).getTime()
  const now = Date.now()
  if (end <= now) return 'RESOLVED'
  const d = Math.max(0, Math.floor((end - now) / 1000))
  const mins = Math.floor(d / 60)
  const secs = d % 60
  if (mins >= 60) {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return `${h} HR ${m} MINS`
  }
  return `${mins} MINS ${secs} SECS`
}

function useCountdown(endDate: string | null) {
  const [countdown, setCountdown] = useState<string>('—')
  useEffect(() => {
    if (!endDate) return
    const tick = () => setCountdown(formatCountdown(endDate))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [endDate])
  return countdown
}

const ODDS_UPDATE_INTERVAL_MS = 1000

/** Updates displayed value every intervalMs (e.g. every 1 second); does not update on every WebSocket tick. */
function useThrottledValue(value: number | null, intervalMs: number = ODDS_UPDATE_INTERVAL_MS): number | null {
  const [display, setDisplay] = useState<number | null>(value)
  const latestRef = useRef<number | null>(value)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  latestRef.current = value

  useEffect(() => {
    if (value === null) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      setDisplay(null)
      return
    }
    setDisplay(value)
    intervalRef.current = setInterval(() => {
      if (latestRef.current !== null) setDisplay(latestRef.current)
    }, intervalMs)
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [value === null, intervalMs])

  return display
}

const ASSET_COLORS: Record<string, string> = {
  'btc-updown-15m-1771286400': '#f7931a',
  'eth-updown-15m-1771287300': '#627eea',
  'sol-updown-15m-1771287300': '#14f195',
  'xrp-updown-15m-1771287300': '#23292f',
}

function getAssetColor(slug: string): string {
  const s = slug.toLowerCase()
  if (s.startsWith('btc-')) return '#f7931a'
  if (s.startsWith('eth-')) return '#627eea'
  if (s.startsWith('sol-')) return '#14f195'
  if (s.startsWith('xrp-')) return '#23292f'
  return ASSET_COLORS[slug] ?? '#3b82f6'
}

interface MarketData {
  title: string
  description: string
  volume: number
  startDate: string
  endDate: string
  clobTokenIds: string[]
   eventId: number | null
   conditionId: string | null
}

interface BookLevel {
  price: number
  size: number
}

interface RecentTrade {
  side: 'BUY' | 'SELL'
  price: number
  size: number
  timestamp: number
}

export default function CryptoMarketPage({ params }: { params: { slug: string } }) {
  const router = useRouter()
  const slug = params.slug
  const [event, setEvent] = useState<MarketData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [upPrice, setUpPrice] = useState<number | null>(null)
  const [downPrice, setDownPrice] = useState<number | null>(null)
  const [livePrice, setLivePrice] = useState<number | null>(null)
  const [chartData, setChartData] = useState<{ time: number; value: number }[]>([])
  const [orderBook, setOrderBook] = useState<{ bids: BookLevel[]; asks: BookLevel[] }>({
    bids: [],
    asks: [],
  })
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([])
  const [liveVolume, setLiveVolume] = useState<number | null>(null)
  const [wsStatus, setWsStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle')
  const [rtdsStatus, setRtdsStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle')
  const [redirectingToLatest, setRedirectingToLatest] = useState(false)
  const clobWsRef = useRef<WebSocket | null>(null)
  const rtdsWsRef = useRef<WebSocket | null>(null)
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const maxPoints = 300

  const intervalMinutes = slug ? getIntervalMinutes(slug) : null
  const isVirtualSlug = intervalMinutes !== null

  useEffect(() => {
    if (!slug) return
    if (isVirtualSlug) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    fetch(`/api/events/${slug}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? 'Not found' : 'Failed to fetch')
        return r.json()
      })
      .then((data) => {
        const m = data.markets?.[0]
        if (!m) {
          setError('No market data')
          return
        }
        const eventId = typeof data.id === 'number' ? data.id : null
        const conditionId: string | null = m.conditionId ?? m.condition_id ?? null
        let ids: string[] = []
        try {
          if (m.clobTokenIds) ids = JSON.parse(m.clobTokenIds) as string[]
        } catch {}
          let up = 0.5
        try {
          const prices = JSON.parse(m.outcomePrices || '["0.5","0.5"]') as string[]
          up = parseFloat(prices[0]) || 0.5
        } catch {}
        setEvent({
          title: data.title || m.question,
          description: m.description || data.description || '',
          volume: parseFloat(m.volume) || data.volume || 0,
          startDate: data.startDate || m.startDate || data.startTime || '',
          endDate: m.endDate || data.endDate || '',
          clobTokenIds: ids,
          eventId,
          conditionId,
        })
        setUpPrice(up)
        setDownPrice(1 - up)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [slug, isVirtualSlug])

  // Fetch recent trades from Polymarket Data API (public, no auth) by condition ID
  useEffect(() => {
    const conditionId = event?.conditionId ?? undefined
    if (!conditionId) return

    let cancelled = false

    const fetchTrades = async () => {
      try {
        const params = new URLSearchParams({
          limit: '50',
          takerOnly: 'false',
          market: conditionId,
        })
        const res = await fetch(`https://data-api.polymarket.com/trades?${params.toString()}`)
        if (!res.ok) return
        const data = (await res.json()) as Array<{
          side: 'BUY' | 'SELL'
          price: number
          size: number
          timestamp: number
        }>
        if (cancelled || !Array.isArray(data)) return
        const mapped: RecentTrade[] = data
          .filter((t) => typeof t.price === 'number' && typeof t.size === 'number')
          .map((t) => ({
            side: t.side,
            price: t.price,
            size: t.size,
            timestamp: t.timestamp,
          }))
          .sort((a, b) => b.timestamp - a.timestamp)
        setRecentTrades(mapped)
      } catch {
        // ignore errors; trades are best-effort
      }
    }

    fetchTrades()
    const id = setInterval(fetchTrades, 7000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [event?.conditionId])

  // Fetch live event volume from Polymarket Data API (/live-volume)
  useEffect(() => {
    const eventId = event?.eventId ?? null
    if (!eventId) return

    let cancelled = false

    const fetchVolume = async () => {
      try {
        const res = await fetch(`https://data-api.polymarket.com/live-volume?id=${eventId}`)
        if (!res.ok) return
        const data = await res.json() as Array<{ total: number }>
        if (!Array.isArray(data) || !data[0] || cancelled) return
        if (typeof data[0].total === 'number') {
          setLiveVolume(data[0].total)
        }
      } catch {
        // best-effort only
      }
    }

    fetchVolume()
    const id = setInterval(fetchVolume, 15000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [event?.eventId])

  useEffect(() => {
    if (!event?.clobTokenIds?.length) return
    setWsStatus('connecting')
    const ws = new WebSocket(CLOB_WS_URL)
    clobWsRef.current = ws
    ws.onopen = () => {
      ws.send(JSON.stringify({ assets_ids: event.clobTokenIds, type: 'market' }))
      setWsStatus('connected')
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('PING')
      }, 10000)
    }
    ws.onmessage = (e) => {
      if (e.data === 'PONG') return
      try {
        const msg = JSON.parse(e.data)
        const upTokenId = event?.clobTokenIds?.[0] ?? ''
        const downTokenId = event?.clobTokenIds?.[1] ?? ''

        if (msg.event_type === 'price_change' && msg.price_changes?.length) {
          for (const pc of msg.price_changes as Array<{ asset_id?: string; best_bid?: string | number; best_ask?: string | number }>) {
            const bid = pc.best_bid != null ? parseFloat(String(pc.best_bid)) : null
            const ask = pc.best_ask != null ? parseFloat(String(pc.best_ask)) : null
            if (typeof bid !== 'number' || typeof ask !== 'number') continue
            const mid = (bid + ask) / 2
            const aid = pc.asset_id ?? ''
            if (aid === upTokenId) {
              setUpPrice(mid)
              setDownPrice(1 - mid)
            } else if (aid === downTokenId) {
              setDownPrice(mid)
              setUpPrice(1 - mid)
            }
          }
        }
        if (msg.event_type === 'best_bid_ask') {
          const bid = parseFloat(msg.best_bid)
          const ask = parseFloat(msg.best_ask)
          const aid = msg.asset_id ?? ''
          if (!Number.isNaN(bid) && !Number.isNaN(ask)) {
            const mid = (bid + ask) / 2
            if (aid === upTokenId) {
              setUpPrice(mid)
              setDownPrice(1 - mid)
            } else if (aid === downTokenId) {
              setDownPrice(mid)
              setUpPrice(1 - mid)
            }
          }
        }
        if (msg.event_type === 'book' && msg.bids?.length && msg.asks?.length) {
          // Only show the book for the primary (Up) token
          if (upTokenId && msg.asset_id && msg.asset_id !== upTokenId) return

          const bids: BookLevel[] = (msg.bids as Array<{ price: string; size: string }>).map((b) => ({
            price: parseFloat(b.price),
            size: parseFloat(b.size),
          })).filter((b) => !Number.isNaN(b.price) && !Number.isNaN(b.size))

          const asks: BookLevel[] = (msg.asks as Array<{ price: string; size: string }>).map((a) => ({
            price: parseFloat(a.price),
            size: parseFloat(a.size),
          })).filter((a) => !Number.isNaN(a.price) && !Number.isNaN(a.size))

          bids.sort((a, b) => b.price - a.price)
          asks.sort((a, b) => a.price - b.price)

          setOrderBook({ bids, asks })

          if (bids.length && asks.length) {
            const bid = bids[0].price
            const ask = asks[0].price
            const mid = (bid + ask) / 2
            setUpPrice(mid)
            setDownPrice(1 - mid)
          }
        }
      } catch {}
    }
    ws.onerror = () => setWsStatus('error')
    ws.onclose = () => {
      setWsStatus('idle')
      if (pingRef.current) clearInterval(pingRef.current)
    }
    return () => {
      ws.close()
      clobWsRef.current = null
    }
  }, [event?.clobTokenIds])

  useEffect(() => {
    if (!slug) return
    const config = getCryptoConfig(slug)
    setRtdsStatus('connecting')
    const ws = new WebSocket(RTDS_WS_URL)
    rtdsWsRef.current = ws
    ws.onopen = () => {
      ws.send(JSON.stringify({
        action: 'subscribe',
        subscriptions: [
          { topic: 'crypto_prices_chainlink', type: '*', filters: `{"symbol":"${config.symbol}"}` },
        ],
      }))
      setRtdsStatus('connected')
    }
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.topic === 'crypto_prices_chainlink' && msg.payload?.symbol === config.symbol && typeof msg.payload.value === 'number') {
          const v = msg.payload.value
          const t = Math.floor((msg.payload.timestamp ?? Date.now()) / 1000)
          setLivePrice(v)
          setChartData((prev) => {
            const next = [...prev, { time: t, value: v }]
            if (next.length > maxPoints) return next.slice(-maxPoints)
            return next
          })
        }
      } catch {}
    }
    ws.onerror = () => setRtdsStatus('error')
    ws.onclose = () => setRtdsStatus('idle')
    return () => {
      ws.close()
      rtdsWsRef.current = null
    }
  }, [slug])

  const config = slug ? getCryptoConfig(slug) : null
  const polymarketUrl = slug ? `https://polymarket.com/event/${slug}` : '#'
  const countdown = useCountdown(event?.endDate ?? null)
  const assetColor = slug ? getAssetColor(slug) : '#3b82f6'
  const isResolved = countdown === 'RESOLVED'
  const throttledUpPrice = useThrottledValue(upPrice, ODDS_UPDATE_INTERVAL_MS)
  const throttledDownPrice = useThrottledValue(downPrice, ODDS_UPDATE_INTERVAL_MS)
  const displayVolume = liveVolume ?? event?.volume ?? 0

  // Only for virtual slugs (btc-5m, btc-15m): resolve to the real soonest slug and redirect.
  // For concrete slugs (e.g. eth-updown-15m-..., sol-...), stay on the chosen market — do not redirect.
  useEffect(() => {
    if (!slug || !isVirtualSlug) return
    setRedirectingToLatest(true)
    const asset = encodeURIComponent(getAssetSearchFromSlug(slug))
    const interval = getIntervalMinutes(slug)
    const url = `/api/crypto/soonest?asset=${asset}&interval=${interval!}`
    fetch(url)
      .then((r) => r.ok ? r.json() : { slug: null })
      .then((data: { slug: string | null }) => {
        if (data.slug && data.slug !== slug) {
          router.replace(`/crypto/${data.slug}`)
          return
        }
        setRedirectingToLatest(false)
      })
      .catch(() => setRedirectingToLatest(false))
  }, [slug, isVirtualSlug, router])

  // Virtual slug with no redirect: show error so user isn't stuck
  useEffect(() => {
    if (isVirtualSlug && !loading && !event && !redirectingToLatest) {
      const t = setTimeout(() => setRedirectingToLatest(false), 2000)
      return () => clearTimeout(t)
    }
  }, [isVirtualSlug, loading, event, redirectingToLatest])

  if (!slug) return null

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/crypto" className="text-gray-500 hover:text-white text-sm">
            ← Crypto
          </Link>
        </div>

        {loading && (
          <div className="rounded-xl border border-[#1e293b] bg-[#0f172a]/50 p-12 text-center text-gray-500 text-sm">
            Loading…
          </div>
        )}

        {isVirtualSlug && !event && !loading && (
          <div className="rounded-xl border border-[#1e293b] bg-[#0f172a]/50 p-12 text-center text-gray-400 text-sm">
            {redirectingToLatest ? 'Opening current market…' : 'No market found. Try again or go back to Crypto.'}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-red-300 text-sm">
            {error}
          </div>
        )}

        {!loading && !error && event && (
          <>
            {/* Polymarket-style: header with logo + title + timeframe */}
            <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg shrink-0"
                  style={{ backgroundColor: assetColor }}
                >
                  {config?.label?.charAt(0) ?? '?'}
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-white">
                    {(config?.label && config.label !== slug ? config.label : getAssetSearchFromSlug(slug))} Up or Down
                    {slug?.toLowerCase().includes('5m') ? ' - 5 min' : ' - 15 min'}
                  </h1>
                  <p className="text-gray-500 text-sm mt-0.5">
                    {event.startDate
                      ? new Date(event.startDate).toLocaleString('en-US', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) + ' ET'
                      : event.title}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <div className="text-red-400 font-mono font-semibold text-lg tabular-nums">
                  {countdown}
                </div>
                <div className="text-gray-500 text-xs mt-0.5">Time remaining</div>
              </div>
            </div>

            <div className="grid grid-cols-12 gap-6">
              {/* Left: CURRENT PRICE + Price to beat + Chart + Order Book */}
              <div className="col-span-12 lg:col-span-8 space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <div className="text-blue-400 text-xs font-medium uppercase tracking-wider mb-0.5">
                      Current price
                    </div>
                    <div className="text-3xl font-mono font-semibold text-white tabular-nums">
                      {livePrice != null ? `$${livePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}` : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500 text-xs font-medium uppercase tracking-wider mb-0.5">
                      Price to beat
                    </div>
                    <div className="text-xl font-mono font-medium text-gray-400 tabular-nums">
                      {chartData.length > 0
                        ? `$${chartData[0].value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`
                        : '—'}
                    </div>
                  </div>
                  {rtdsStatus === 'connected' && (
                    <span className="text-green-400 text-xs">● Live</span>
                  )}
                </div>

                <div className="rounded-xl border border-[#1e293b] bg-[#0f172a]/80 overflow-hidden">
                  <RealtimePriceChart
                    data={chartData}
                    height={360}
                    className="w-full"
                    lineColor={assetColor}
                    referencePrice={chartData.length > 0 ? chartData[0].value : undefined}
                  />
                </div>

                <div className="flex gap-4 text-sm mt-2">
                  <span className="text-green-400 font-medium">
                    Up {throttledUpPrice != null ? `${(throttledUpPrice * 100).toFixed(1)}%` : '—'}
                  </span>
                  <span className="text-red-400 font-medium">
                    Down {throttledDownPrice != null ? `${(throttledDownPrice * 100).toFixed(1)}%` : '—'}
                  </span>
                </div>

                <div className="mt-4">
                  <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
                    <span className="font-medium text-gray-400">Order book</span>
                    <span className="font-mono">
                      ${displayVolume.toLocaleString('en-US', { maximumFractionDigits: 0 })} Vol.
                    </span>
                    {wsStatus === 'connected' && (
                      <span className="text-green-400 text-xs">● Live</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                    <div>
                      <div className="flex justify-between text-gray-500 mb-1">
                        <span>Bids</span>
                        <span>Size</span>
                      </div>
                      <div className="space-y-0.5">
                        {orderBook.bids.slice(0, 8).map((level, idx) => (
                          <div
                            key={`bid-${idx}-${level.price}-${level.size}`}
                            className="flex justify-between rounded bg-green-500/5 px-2 py-1"
                          >
                            <span className="text-green-300">
                              {(level.price * 100).toFixed(1)}%
                            </span>
                            <span className="text-gray-400">
                              {level.size.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                            </span>
                          </div>
                        ))}
                        {orderBook.bids.length === 0 && (
                          <div className="text-gray-600 py-1">No bids</div>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-gray-500 mb-1">
                        <span>Asks</span>
                        <span>Size</span>
                      </div>
                      <div className="space-y-0.5">
                        {orderBook.asks.slice(0, 8).map((level, idx) => (
                          <div
                            key={`ask-${idx}-${level.price}-${level.size}`}
                            className="flex justify-between rounded bg-red-500/5 px-2 py-1"
                          >
                            <span className="text-red-300">
                              {(level.price * 100).toFixed(1)}%
                            </span>
                            <span className="text-gray-400">
                              {level.size.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                            </span>
                          </div>
                        ))}
                        {orderBook.asks.length === 0 && (
                          <div className="text-gray-600 py-1">No asks</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
                    <span className="font-medium text-gray-400">Recent trades</span>
                    {recentTrades.length > 0 && (
                      <span className="text-xs text-gray-500">
                        Last {Math.min(recentTrades.length, 10)}
                      </span>
                    )}
                  </div>
                  <div className="rounded-lg border border-[#1e293b] bg-[#020617] max-h-40 overflow-y-auto">
                    {recentTrades.slice(0, 10).map((t, idx) => {
                      const tsMs = t.timestamp > 1e12 ? t.timestamp : t.timestamp * 1000
                      const d = new Date(tsMs)
                      const timeStr = d.toLocaleTimeString('en-US', {
                        hour12: false,
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })
                      const isBuy = t.side === 'BUY'
                      const color = isBuy ? 'text-green-300' : 'text-red-300'
                      return (
                        <div
                          key={`${t.timestamp}-${idx}-${t.price}-${t.size}`}
                          className="flex items-center justify-between px-3 py-1.5 border-b border-[#111827]/80 last:border-b-0 text-xs"
                        >
                          <span className="text-gray-500">{timeStr}</span>
                          <div className="flex items-center gap-3">
                            <span className={`${color} font-semibold`}>
                              {(t.price * 100).toFixed(1)}%
                            </span>
                            <span className="text-gray-400">
                              {t.size.toLocaleString('en-US', { maximumFractionDigits: 0 })} sh
                            </span>
                          </div>
                        </div>
                      )
                    })}
                    {recentTrades.length === 0 && (
                      <div className="px-3 py-2 text-xs text-gray-600">No trades yet.</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right: Countdown + Up/Down buttons + CTA (Polymarket trading panel style) */}
              <div className="col-span-12 lg:col-span-4">
                <div className="rounded-xl border border-[#1e293b] bg-[#0f172a]/90 p-5 sticky top-6">
                  <div className="text-red-400 font-mono font-semibold text-xl tabular-nums mb-6">
                    {countdown}
                  </div>

                  <PlaceOrderPanel
                    upTokenId={event.clobTokenIds[0] ?? ''}
                    downTokenId={event.clobTokenIds[1] ?? ''}
                    upPrice={throttledUpPrice}
                    downPrice={throttledDownPrice}
                    polymarketUrl={polymarketUrl}
                  />

                  <a
                    href={polymarketUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full rounded-xl border border-[#334155] text-gray-300 hover:text-white hover:border-[#475569] text-center py-2.5 text-sm font-medium transition-colors mt-4"
                  >
                    Open on Polymarket →
                  </a>

                  <MarketPositionAndClaim
                    conditionId={event.conditionId ?? null}
                    upTokenId={event.clobTokenIds[0] ?? ''}
                    downTokenId={event.clobTokenIds[1] ?? ''}
                    isResolved={isResolved}
                    polymarketUrl={polymarketUrl}
                  />

                  <p className="text-gray-500 text-xs mt-4 text-center">
                    By trading, you agree to Polymarket&apos;s Terms of Use.
                  </p>
                </div>
              </div>
            </div>

            {isResolved && (
              <div className="rounded-xl border border-[#1e293b] bg-[#0f172a]/80 p-5 mt-6">
                {redirectingToLatest ? (
                  <p className="text-gray-400 text-sm">Updating to latest {config?.label ?? 'crypto'} market…</p>
                ) : (
                  <p className="text-gray-400 text-sm">
                    This market has resolved. <Link href="/crypto" className="text-blue-400 hover:underline">View crypto hub</Link> for other markets.
                  </p>
                )}
              </div>
            )}

            <div className="rounded-xl border border-[#1e293b] bg-[#0f172a]/50 p-5 mt-6">
              <div className="text-gray-500 text-xs uppercase tracking-wider mb-2">Rules</div>
              <p className="text-sm text-gray-400 whitespace-pre-wrap">{event.description}</p>
              {config?.resolutionUrl && (
                <a href={config.resolutionUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline text-xs mt-2 inline-block">
                  Resolution source →
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
