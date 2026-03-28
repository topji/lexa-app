'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
import Link from 'next/link'
import { PlaceOrderPanel } from '@/components/PlaceOrderPanel'
import { MarketPositionAndClaim } from '@/components/MarketPositionAndClaim'
import {
  type EventSummary,
  type MarketDetailRow,
  summarizeEvent,
  buildMarketRows,
  formatUsd,
  shortenId,
} from '@/lib/gamma-market-page'

const CLOB_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market'

type ParsedTrade = {
  side: 'BUY' | 'SELL'
  price: number
  size: number
  timestamp: number
}

type TradableState = {
  question: string
  description: string
  volume: number
  endDate: string
  clobTokenIds: [string, string]
  upPrice: number
  downPrice: number
  conditionId: string | null
  resolved: boolean
  upLabel: string
  downLabel: string
  marketIndex: number
}

function rowToTradable(row: MarketDetailRow): TradableState | null {
  if (!row.isBinaryTradable || row.outcomes.length < 2 || row.clobTokenIds.length < 2) return null
  return {
    question: row.question,
    description: row.description,
    volume: row.volume,
    endDate: row.endDate,
    clobTokenIds: [row.clobTokenIds[0], row.clobTokenIds[1]],
    upPrice: row.outcomes[0].price,
    downPrice: row.outcomes[1].price,
    conditionId: row.conditionId,
    resolved: row.resolved,
    upLabel: row.outcomes[0].name.slice(0, 48),
    downLabel: row.outcomes[1].name.slice(0, 48),
    marketIndex: row.index,
  }
}

function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 py-2 border-b border-lexa-border/60 last:border-0">
      <span className="text-gray-500 font-sans text-xs uppercase tracking-wide shrink-0 sm:w-40">{label}</span>
      <div className="font-sans text-sm text-white break-words min-w-0 flex-1">{value}</div>
    </div>
  )
}

function CopyLine({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  if (!value) return null
  return (
    <div className="flex flex-wrap items-center gap-2 py-1.5">
      <span className="text-gray-500 text-xs uppercase tracking-wide shrink-0">{label}</span>
      <code className="text-[11px] font-mono text-gray-300 bg-void/80 px-2 py-1 rounded border border-lexa-border max-w-full truncate">
        {value.length > 48 ? shortenId(value, 14, 10) : value}
      </code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          })
        }}
        className="text-[10px] font-display uppercase tracking-wide text-lexa-accent hover:underline"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

export default function LexaMarketPage({ params }: { params: { slug: string } }) {
  const slug = decodeURIComponent(params.slug || '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [eventRaw, setEventRaw] = useState<Record<string, unknown> | null>(null)
  const [eventSummary, setEventSummary] = useState<EventSummary | null>(null)
  const [marketRows, setMarketRows] = useState<MarketDetailRow[]>([])
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null)
  const [upPrice, setUpPrice] = useState<number | null>(null)
  const [downPrice, setDownPrice] = useState<number | null>(null)
  const [recentTrades, setRecentTrades] = useState<ParsedTrade[]>([])
  const clobWsRef = useRef<WebSocket | null>(null)

  const polymarketUrl = `https://polymarket.com/event/${encodeURIComponent(slug)}`

  const tradable = useMemo(() => {
    if (selectedRowIndex == null) return null
    const row = marketRows[selectedRowIndex]
    if (!row) return null
    return rowToTradable(row)
  }, [marketRows, selectedRowIndex])

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    setError(null)
    fetch(`/api/events/${encodeURIComponent(slug)}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? 'Event not found' : 'Failed to load market')
        return r.json()
      })
      .then((data: Record<string, unknown>) => {
        setEventRaw(data)
        setEventSummary(summarizeEvent(data))
        const rows = buildMarketRows(data)
        setMarketRows(rows)
        const firstTradable = rows.findIndex((r) => r.isBinaryTradable)
        if (firstTradable >= 0) {
          setSelectedRowIndex(firstTradable)
          const t = rowToTradable(rows[firstTradable])
          if (t) {
            setUpPrice(t.upPrice)
            setDownPrice(t.downPrice)
          }
        } else {
          setSelectedRowIndex(null)
          setUpPrice(null)
          setDownPrice(null)
          setError('No binary CLOB market with two outcomes found — browse data below or open on Polymarket.')
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [slug])

  /** Reset displayed odds when user switches which nested market to trade */
  useEffect(() => {
    if (selectedRowIndex == null) return
    const row = marketRows[selectedRowIndex]
    const t = row ? rowToTradable(row) : null
    if (!t) return
    setUpPrice(t.upPrice)
    setDownPrice(t.downPrice)
  }, [selectedRowIndex, marketRows])

  const wsUpId = tradable?.clobTokenIds[0]
  const wsDownId = tradable?.clobTokenIds[1]

  useEffect(() => {
    if (!wsUpId || !wsDownId) return
    const ids: [string, string] = [wsUpId, wsDownId]
    const ws = new WebSocket(CLOB_WS_URL)
    clobWsRef.current = ws
    ws.onopen = () => {
      ws.send(JSON.stringify({ assets_ids: ids, type: 'market' }))
    }
    ws.onmessage = (e) => {
      if (e.data === 'PONG') return
      try {
        const msg = JSON.parse(e.data) as {
          event_type?: string
          price_changes?: Array<{ asset_id?: string; best_bid?: string | number; best_ask?: string | number }>
          best_bid?: string | number
          best_ask?: string | number
          asset_id?: string
        }
        const upId = ids[0]
        const downId = ids[1]
        if (msg.event_type === 'price_change' && msg.price_changes?.length) {
          for (const pc of msg.price_changes) {
            const bid = pc.best_bid != null ? parseFloat(String(pc.best_bid)) : null
            const ask = pc.best_ask != null ? parseFloat(String(pc.best_ask)) : null
            if (typeof bid !== 'number' || typeof ask !== 'number') continue
            const mid = (bid + ask) / 2
            const aid = pc.asset_id ?? ''
            if (aid === upId) {
              setUpPrice(mid)
              setDownPrice(1 - mid)
            } else if (aid === downId) {
              setDownPrice(mid)
              setUpPrice(1 - mid)
            }
          }
        }
        if (msg.event_type === 'best_bid_ask') {
          const bid = parseFloat(String(msg.best_bid))
          const ask = parseFloat(String(msg.best_ask))
          const aid = msg.asset_id ?? ''
          if (!Number.isNaN(bid) && !Number.isNaN(ask)) {
            const mid = (bid + ask) / 2
            if (aid === upId) {
              setUpPrice(mid)
              setDownPrice(1 - mid)
            } else if (aid === downId) {
              setDownPrice(mid)
              setUpPrice(1 - mid)
            }
          }
        }
      } catch {
        // ignore
      }
    }
    return () => {
      ws.close()
      clobWsRef.current = null
    }
  }, [wsUpId, wsDownId])

  useEffect(() => {
    const conditionId = tradable?.conditionId
    if (!conditionId) {
      setRecentTrades([])
      return
    }
    let cancelled = false
    const fetchTrades = async () => {
      try {
        const q = new URLSearchParams({ limit: '40', takerOnly: 'false', market: conditionId })
        const res = await fetch(`https://data-api.polymarket.com/trades?${q.toString()}`)
        if (!res.ok) return
        const data = (await res.json()) as ParsedTrade[]
        if (cancelled || !Array.isArray(data)) return
        setRecentTrades(
          data
            .filter((t) => typeof t.price === 'number' && typeof t.size === 'number')
            .sort((a, b) => b.timestamp - a.timestamp)
        )
      } catch {
        if (!cancelled) setRecentTrades([])
      }
    }
    fetchTrades()
    const id = setInterval(fetchTrades, 8000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [tradable?.conditionId])

  const tradableIndices = useMemo(() => marketRows.map((r, i) => (r.isBinaryTradable ? i : -1)).filter((i) => i >= 0), [marketRows])

  if (!slug) return null

  return (
    <div className="min-h-screen bg-void text-white bg-grid">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <Link href="/" className="font-sans text-gray-500 hover:text-lexa-accent text-sm transition-colors">
            ← Chat
          </Link>
          <span className="text-gray-600">·</span>
          <a
            href={polymarketUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-sans text-gray-500 hover:text-lexa-accent text-sm transition-colors"
          >
            Open on Polymarket ↗
          </a>
        </div>

        {loading && (
          <div className="rounded-2xl border border-lexa-border bg-lexa-glass p-10 text-center text-lexa-accent text-sm font-display uppercase tracking-widest animate-pulse">
            Loading market…
          </div>
        )}

        {!loading && error && !eventSummary && (
          <div className="rounded-2xl border border-neon-red/40 bg-neon-red/10 p-6 text-neon-red text-sm font-sans">{error}</div>
        )}

        {!loading && eventSummary && (
          <>
            {error && (
              <div className="rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-4 text-yellow-200 text-sm font-sans mb-6">
                {error}
              </div>
            )}

            {/* Event header */}
            <div className="flex flex-col sm:flex-row gap-6 mb-8">
              {(eventSummary.image || eventSummary.icon) && (
                <div className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={eventSummary.image || eventSummary.icon}
                    alt=""
                    className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl border border-lexa-border object-cover bg-lexa-glass"
                  />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-2 mb-3">
                  {eventSummary.closed && (
                    <span className="px-2 py-0.5 text-[10px] font-display uppercase tracking-wider rounded-md bg-gray-700 text-gray-300">
                      Closed
                    </span>
                  )}
                  {eventSummary.active && !eventSummary.closed && (
                    <span className="px-2 py-0.5 text-[10px] font-display uppercase tracking-wider rounded-md bg-neon-green/20 text-neon-green border border-neon-green/30">
                      Active
                    </span>
                  )}
                  {eventSummary.negRisk && (
                    <span className="px-2 py-0.5 text-[10px] font-display uppercase tracking-wider rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/30">
                      Neg risk
                    </span>
                  )}
                  {eventSummary.restricted && (
                    <span className="px-2 py-0.5 text-[10px] font-display uppercase tracking-wider rounded-md bg-orange-500/15 text-orange-300 border border-orange-500/25">
                      Restricted
                    </span>
                  )}
                  {eventSummary.enableOrderBook && (
                    <span className="px-2 py-0.5 text-[10px] font-display uppercase tracking-wider rounded-md bg-lexa-accent/15 text-lexa-accent border border-lexa-accent/30">
                      Order book
                    </span>
                  )}
                </div>
                <h1 className="font-display text-2xl sm:text-4xl font-bold text-white mb-2 leading-tight">{eventSummary.title}</h1>
                {eventSummary.ticker && (
                  <p className="font-mono text-xs text-gray-500 mb-2">{eventSummary.ticker}</p>
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-400 font-sans">
                  <span>
                    Event ID <span className="text-white font-mono">{eventSummary.id}</span>
                  </span>
                  {eventSummary.slug && (
                    <span>
                      Slug <span className="text-white font-mono">{eventSummary.slug}</span>
                    </span>
                  )}
                  {eventSummary.category && (
                    <span>
                      Category <span className="text-lexa-accent">{eventSummary.category}</span>
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Event stats */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
              {[
                ['Volume', formatUsd(eventSummary.volume)],
                ['24h volume', formatUsd(eventSummary.volume24hr)],
                ['1w volume', formatUsd(eventSummary.volume1wk)],
                ['Liquidity', formatUsd(eventSummary.liquidity)],
                ['Liquidity (CLOB)', formatUsd(eventSummary.liquidityClob)],
                ['Open interest', formatUsd(eventSummary.openInterest)],
                ...(eventSummary.competitive != null
                  ? [['Competitive', `${(eventSummary.competitive * 100).toFixed(2)}%`] as const]
                  : []),
                ['Comments', String(eventSummary.commentCount)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-lexa-border bg-lexa-glass/80 px-3 py-2.5">
                  <div className="text-[10px] font-display uppercase tracking-widest text-gray-500 mb-1">{k}</div>
                  <div className="font-mono text-sm text-white tabular-nums">{v}</div>
                </div>
              ))}
            </div>

            {/* Event narrative + meta */}
            <div className="rounded-2xl border border-lexa-border bg-lexa-glass p-5 sm:p-6 mb-8">
              <h2 className="font-display text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4">Event details</h2>
              {eventSummary.description ? (
                <div className="prose prose-invert prose-sm max-w-none text-gray-300 font-sans whitespace-pre-wrap mb-6">
                  {eventSummary.description}
                </div>
              ) : (
                <p className="text-gray-500 text-sm mb-6">No description.</p>
              )}
              <div className="divide-y divide-lexa-border/40">
                <DataRow
                  label="Start"
                  value={eventSummary.startDate ? new Date(eventSummary.startDate).toLocaleString() : '—'}
                />
                <DataRow label="End" value={eventSummary.endDate ? new Date(eventSummary.endDate).toLocaleString() : '—'} />
                <DataRow label="Created" value={eventSummary.createdAt || eventSummary.creationDate || '—'} />
                <DataRow label="Updated" value={eventSummary.updatedAt || '—'} />
                <DataRow
                  label="Resolution source"
                  value={
                    eventSummary.resolutionSource ? (
                      <a href={eventSummary.resolutionSource} target="_blank" rel="noopener noreferrer" className="text-lexa-accent hover:underline break-all">
                        {eventSummary.resolutionSource}
                      </a>
                    ) : (
                      '—'
                    )
                  }
                />
              </div>
              {eventSummary.tags.length > 0 && (
                <div className="mt-4 pt-4 border-t border-lexa-border">
                  <div className="text-[10px] font-display uppercase tracking-widest text-gray-500 mb-2">Tags</div>
                  <div className="flex flex-wrap gap-2">
                    {eventSummary.tags.map((t) => (
                      <span key={t} className="px-2 py-1 rounded-lg bg-void/60 border border-lexa-border text-xs text-gray-300">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* All markets */}
            <h2 className="font-display text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4">
              Markets ({marketRows.length})
            </h2>
            <div className="space-y-4 mb-10">
              {marketRows.map((row) => {
                const isSelected = selectedRowIndex === row.index
                return (
                  <div
                    key={row.id || row.index}
                    className={`rounded-2xl border p-4 sm:p-5 transition-colors ${
                      isSelected ? 'border-lexa-accent/60 bg-lexa-accent/5' : 'border-lexa-border bg-lexa-glass'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <h3 className="font-sans font-semibold text-white text-base">{row.question}</h3>
                          {row.isBinaryTradable && (
                            <span className="text-[10px] font-display uppercase text-neon-green border border-neon-green/30 px-1.5 py-0.5 rounded">
                              Tradable
                            </span>
                          )}
                          {row.closed && (
                            <span className="text-[10px] font-display uppercase text-gray-500 border border-gray-600 px-1.5 py-0.5 rounded">
                              Closed
                            </span>
                          )}
                        </div>
                        {row.groupItemTitle && row.groupItemTitle !== row.question && (
                          <p className="text-xs text-gray-500 font-sans">{row.groupItemTitle}</p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 shrink-0">
                        {row.isBinaryTradable && (
                          <button
                            type="button"
                            onClick={() => setSelectedRowIndex(row.index)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-display uppercase tracking-wide border transition-colors ${
                              isSelected
                                ? 'bg-lexa-accent/30 border-lexa-accent text-white'
                                : 'bg-void/50 border-lexa-border text-gray-300 hover:border-lexa-accent/50'
                            }`}
                          >
                            Trade this market
                          </button>
                        )}
                        {row.marketSlug && (
                          <a
                            href={`https://polymarket.com/event/${encodeURIComponent(eventSummary.slug)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 rounded-lg text-xs font-display uppercase text-gray-500 border border-lexa-border hover:text-lexa-accent"
                          >
                            Poly ↗
                          </a>
                        )}
                      </div>
                    </div>

                    {row.description ? (
                      <p className="text-sm text-gray-400 font-sans whitespace-pre-wrap mb-4">{row.description}</p>
                    ) : null}

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                      {[
                        ['Volume', formatUsd(row.volume)],
                        ['24h vol', formatUsd(row.volume24hr)],
                        ['Liquidity', formatUsd(row.liquidity)],
                        ['Vol #', row.volumeNum > 0 ? formatUsd(row.volumeNum) : '—'],
                      ].map(([k, v]) => (
                        <div key={k} className="rounded-lg bg-void/40 border border-lexa-border/50 px-2 py-1.5">
                          <div className="text-[9px] uppercase tracking-wider text-gray-500">{k}</div>
                          <div className="font-mono text-xs text-white">{v}</div>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-2 mb-4">
                      {row.outcomes.map((o, i) => {
                        const pct = (o.price * 100).toFixed(1)
                        return (
                          <div
                            key={i}
                            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-lexa-border bg-void/30"
                          >
                            <span className="text-sm text-gray-200 font-sans">{o.name}</span>
                            <span className="font-mono font-bold text-lexa-accent">{pct}%</span>
                          </div>
                        )
                      })}
                    </div>

                    <div className="rounded-xl bg-void/50 border border-lexa-border/60 p-3 space-y-1">
                      <div className="text-[10px] font-display uppercase tracking-widest text-gray-500 mb-2">Identifiers & book</div>
                      <CopyLine label="Market ID" value={row.id} />
                      <CopyLine label="Condition" value={row.conditionId ?? ''} />
                      {row.questionId && <CopyLine label="Question ID" value={row.questionId} />}
                      {row.marketSlug && <CopyLine label="Market slug" value={row.marketSlug} />}
                      {row.clobTokenIds.map((tid, i) => (
                        <CopyLine key={i} label={`CLOB token ${i + 1}`} value={tid} />
                      ))}
                      <div className="grid sm:grid-cols-2 gap-2 pt-2 text-xs font-sans">
                        <div>
                          <span className="text-gray-500">Best bid / ask</span>{' '}
                          <span className="font-mono text-white">
                            {row.bestBid != null && row.bestAsk != null
                              ? `${row.bestBid.toFixed(3)} / ${row.bestAsk.toFixed(3)}`
                              : '—'}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-500">Spread</span>{' '}
                          <span className="font-mono text-white">{row.spread != null ? row.spread.toFixed(4) : '—'}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Last trade</span>{' '}
                          <span className="font-mono text-white">
                            {row.lastTradePrice != null ? row.lastTradePrice.toFixed(4) : '—'}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-500">Ends</span>{' '}
                          <span className="text-white">{row.endDate ? new Date(row.endDate).toLocaleString() : '—'}</span>
                        </div>
                      </div>
                      <div className="grid sm:grid-cols-2 gap-2 pt-2 text-xs font-sans text-gray-400">
                        <div>Accepting orders: {row.acceptingOrders ? 'Yes' : 'No'}</div>
                        <div>Order book: {row.enableOrderBook ? 'Yes' : 'No'}</div>
                        <div>Neg risk: {row.negRisk ? 'Yes' : 'No'}</div>
                        <div>UMA: {row.umaResolutionStatus || '—'}</div>
                        {row.tickSize != null && <div>Tick size: {row.tickSize}</div>}
                        {row.orderMinSize != null && <div>Min size: {row.orderMinSize}</div>}
                        {row.line != null && <div>Line: {row.line}</div>}
                        {row.sportsMarketType && <div>Sports type: {row.sportsMarketType}</div>}
                        {row.resolutionSource && (
                          <div className="sm:col-span-2">
                            <a href={row.resolutionSource} target="_blank" rel="noopener noreferrer" className="text-lexa-accent hover:underline break-all">
                              Market resolution ↗
                            </a>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Trade panel */}
            {tradable && tradableIndices.length > 0 && (
              <div className="rounded-2xl border border-lexa-border bg-lexa-glass p-5 sm:p-6 card-glow mb-8">
                <h2 className="font-display text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4">Trade on Lexa</h2>
                {tradableIndices.length > 1 && (
                  <div className="mb-4">
                    <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-2">Active market</label>
                    <select
                      value={selectedRowIndex ?? ''}
                      onChange={(e) => setSelectedRowIndex(Number(e.target.value))}
                      className="w-full max-w-xl bg-void border border-lexa-border rounded-lg px-3 py-2 text-sm text-white font-sans"
                    >
                      {tradableIndices.map((i) => {
                        const r = marketRows[i]
                        return (
                          <option key={i} value={i}>
                            {r.question.slice(0, 80)}
                            {r.question.length > 80 ? '…' : ''}
                          </option>
                        )
                      })}
                    </select>
                  </div>
                )}
                <PlaceOrderPanel
                  upTokenId={tradable.clobTokenIds[0]}
                  downTokenId={tradable.clobTokenIds[1]}
                  upPrice={upPrice}
                  downPrice={downPrice}
                  polymarketUrl={polymarketUrl}
                  upOutcomeLabel={tradable.upLabel}
                  downOutcomeLabel={tradable.downLabel}
                />
                <MarketPositionAndClaim
                  conditionId={tradable.conditionId}
                  upTokenId={tradable.clobTokenIds[0]}
                  downTokenId={tradable.clobTokenIds[1]}
                  isResolved={tradable.resolved}
                  polymarketUrl={polymarketUrl}
                />
              </div>
            )}

            {/* Recent trades (selected tradable market) */}
            {tradable?.conditionId && recentTrades.length > 0 && (
              <div className="rounded-2xl border border-lexa-border bg-lexa-glass p-5 sm:p-6 mb-8">
                <h2 className="font-display text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4">
                  Recent trades (this market)
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm font-sans">
                    <thead>
                      <tr className="text-left text-gray-500 text-[10px] uppercase tracking-wider border-b border-lexa-border">
                        <th className="pb-2 pr-4">Time</th>
                        <th className="pb-2 pr-4">Side</th>
                        <th className="pb-2 pr-4">Price</th>
                        <th className="pb-2">Size</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentTrades.slice(0, 25).map((t, i) => (
                        <tr key={i} className="border-b border-lexa-border/40 text-gray-300">
                          <td className="py-2 pr-4 font-mono text-xs text-gray-500">
                            {t.timestamp ? new Date(t.timestamp * 1000).toLocaleTimeString() : '—'}
                          </td>
                          <td className={`py-2 pr-4 font-mono ${t.side === 'BUY' ? 'text-neon-green' : 'text-neon-red'}`}>
                            {t.side}
                          </td>
                          <td className="py-2 pr-4 font-mono">{t.price.toFixed(4)}</td>
                          <td className="py-2 font-mono">{t.size.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Raw payload */}
            {eventRaw && (
              <details className="rounded-2xl border border-lexa-border bg-void/40 p-4">
                <summary className="cursor-pointer font-display text-xs uppercase tracking-widest text-gray-500">
                  Raw API response (debug)
                </summary>
                <pre className="mt-4 text-[10px] font-mono text-gray-500 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(eventRaw, null, 2)}
                </pre>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  )
}
