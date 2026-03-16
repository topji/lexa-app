'use client'

import { useEffect, useRef, useState } from 'react'

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3100'

type MarketInsight = {
  market: string
  sample_ts: string
  slug: string | null
  start_price: number | null
  current_price: number | null
  current_outcome: string | null
  /** From API (synth_probability_up); shown as Signal P(Up) in UI */
  synth_probability_up: number | null
  polymarket_probability_up: number | null
  event_start_time: string | null
  event_end_time: string | null
  best_bid_price: number | null
  best_ask_price: number | null
  best_bid_size: number | null
  best_ask_size: number | null
  polymarket_last_trade_time: string | null
  polymarket_last_trade_price: number | null
  polymarket_last_trade_outcome: string | null
}

async function api<T>(path: string): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('lexa_token') : null
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const data = await res.json()
      if (data?.error) message = data.error
    } catch {
      // ignore
    }
    throw new Error(message)
  }
  return (await res.json()) as T
}

async function apiPost<T>(path: string, body: object): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('lexa_token') : null
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const data = await res.json()
      if (data?.error) message = data.error
    } catch {
      // ignore
    }
    throw new Error(message)
  }
  return (await res.json()) as T
}

const EDGE_MARKET_OPTIONS = ['btc-15m', 'btc-1h', 'eth-15m', 'eth-1h', 'sol-15m', 'sol-1h'] as const

type EdgeTradingStatus = {
  enabled: boolean
  orderSizeUsd: number | null
  lastEnteredSlug: string | null
  lastEnteredAt: string | null
  markets: string[] | null
}

type EdgeTradingEntry = {
  slug: string
  market: string | null
  side: string | null
  orderSizeUsd: number | null
  enteredAt: string
  polymarketEventUrl: string
}

type ClobTrade = {
  id: number
  tradeId: string
  tokenId: string | null
  side: string | null
  price: number | null
  size: number | null
  amountUsd: number | null
  tradeTimestamp: string | null
  marketSlug: string | null
  polymarketEventUrl: string | null
}

type ClobPosition = {
  tokenId: string
  balance: number
  marketSlug: string | null
  polymarketEventUrl: string | null
}

const ASSETS = [
  { key: 'btc', label: 'BTC', markets: ['btc-15m', 'btc-1h'] },
  { key: 'eth', label: 'ETH', markets: ['eth-15m', 'eth-1h'] },
  { key: 'sol', label: 'SOL', markets: ['sol-15m', 'sol-1h'] },
] as const

const HORIZON_LABEL: Record<string, string> = {
  'btc-15m': '15 min',
  'btc-1h': '1 hr',
  'eth-15m': '15 min',
  'eth-1h': '1 hr',
  'sol-15m': '15 min',
  'sol-1h': '1 hr',
}

function formatPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(1)}%`
}

function formatPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toFixed(2)
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** Edge = Signal P(Up) − Polymarket P(Up) in percentage points. */
function edgeUp(signal: number | null, poly: number | null): number | null {
  if (signal == null || poly == null || !Number.isFinite(signal) || !Number.isFinite(poly)) return null
  return (signal - poly) * 100
}

function formatEdge(pp: number | null): string {
  if (pp == null || !Number.isFinite(pp)) return '—'
  const sign = pp >= 0 ? '+' : ''
  return `${sign}${pp.toFixed(1)} pp`
}

export default function QuantStrategyPage() {
  const [insights, setInsights] = useState<MarketInsight[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [edgeStatus, setEdgeStatus] = useState<EdgeTradingStatus | null>(null)
  const [edgeEntries, setEdgeEntries] = useState<EdgeTradingEntry[]>([])
  const [edgeModalOpen, setEdgeModalOpen] = useState(false)
  const [edgeSelectedMarkets, setEdgeSelectedMarkets] = useState<string[]>(() => [...EDGE_MARKET_OPTIONS])
  const [edgeOrderSizeInput, setEdgeOrderSizeInput] = useState('')
  const [edgeActionLoading, setEdgeActionLoading] = useState(false)

  const [clobTrades, setClobTrades] = useState<ClobTrade[]>([])
  const [clobOrders, setClobOrders] = useState<Record<string, unknown>[]>([])
  const [clobPositions, setClobPositions] = useState<ClobPosition[]>([])
  const [clobLoading, setClobLoading] = useState(false)
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null)

  const fetchBalance = async () => {
    try {
      const me = await api<{ walletId: number }>('/auth/me')
      const { collateral } = await api<{ collateral: { balance: string } }>(`/wallets/${me.walletId}/balance`)
      const bal = Number(collateral.balance)
      setUsdcBalance(Number.isFinite(bal) ? bal : null)
    } catch {
      setUsdcBalance(null)
    }
  }

  const fetchEdgeStatus = async () => {
    try {
      const data = await api<EdgeTradingStatus>('/edge-trading/status')
      setEdgeStatus(data)
    } catch {
      setEdgeStatus(null)
    }
  }

  const fetchEdgeEntries = async () => {
    try {
      const { entries } = await api<{ entries: EdgeTradingEntry[] }>('/edge-trading/entries?limit=30')
      setEdgeEntries(entries ?? [])
    } catch {
      setEdgeEntries([])
    }
  }

  const fetchClobData = async () => {
    setClobLoading(true)
    try {
      const [tradesRes, ordersRes, positionsRes] = await Promise.all([
        api<{ trades: ClobTrade[] }>('/clob/trades?limit=100'),
        api<{ orders: Record<string, unknown>[] }>('/clob/orders').catch(() => ({ orders: [] })),
        api<{ positions: ClobPosition[] }>('/clob/positions').catch(() => ({ positions: [] })),
      ])
      setClobTrades(tradesRes.trades ?? [])
      setClobOrders(ordersRes.orders ?? [])
      setClobPositions(positionsRes.positions ?? [])
    } catch {
      setClobTrades([])
      setClobOrders([])
      setClobPositions([])
    } finally {
      setClobLoading(false)
    }
  }

  const fetchLatest = async () => {
    try {
      const { insights: data } = await api<{ insights: MarketInsight[] }>('/insights/synthdata/latest')
      setInsights(data ?? [])
      setError(null)
    } catch (e) {
      if (e instanceof Error && e.message.includes('401')) {
        setIsLoggedIn(false)
        setInsights([])
      } else {
        setError(e instanceof Error ? e.message : 'Failed to load insights')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('lexa_token') : null
    if (!token) {
      setLoading(false)
      setIsLoggedIn(false)
      return
    }
    setIsLoggedIn(true)
    void fetchLatest()
    void fetchEdgeStatus()
    void fetchEdgeEntries()
    void fetchClobData()
    void fetchBalance()
    pollRef.current = setInterval(fetchLatest, 5000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const handleStartEdgeTrading = async () => {
    const num = parseFloat(edgeOrderSizeInput)
    if (!Number.isFinite(num) || num < 1) {
      setError('Order size must be at least 1 USD')
      return
    }
    if (edgeSelectedMarkets.length === 0) {
      setError('Select at least one market')
      return
    }
    setEdgeActionLoading(true)
    setError(null)
    try {
      await apiPost<{ ok: boolean; enabled: boolean; orderSizeUsd: number; markets: string[] | null }>('/edge-trading/start', { orderSizeUsd: num, markets: edgeSelectedMarkets })
      setEdgeModalOpen(false)
      setEdgeOrderSizeInput('')
      await fetchEdgeStatus()
      await fetchEdgeEntries()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start edge trading')
    } finally {
      setEdgeActionLoading(false)
    }
  }

  const handleStopEdgeTrading = async () => {
    setEdgeActionLoading(true)
    setError(null)
    try {
      await apiPost<{ ok: boolean; enabled: boolean }>('/edge-trading/stop', {})
      await fetchEdgeStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to stop edge trading')
    } finally {
      setEdgeActionLoading(false)
    }
  }

  const byMarket = new Map<string, MarketInsight>()
  for (const i of insights) byMarket.set(i.market, i)

  if (!isLoggedIn) {
    return (
      <div className="p-6 lg:p-10">
        <h1 className="font-display text-2xl font-bold text-white mb-2">Quant Strategy</h1>
        <p className="text-gray-400 mb-4">Live market insights for Up/Down (15m & 1h) — BTC, ETH, SOL.</p>
        <div className="rounded-xl border border-lexa-border bg-lexa-glass p-8 text-center text-gray-400">
          Connect your wallet to view insights.
        </div>
      </div>
    )
  }

  if (loading && insights.length === 0) {
    return (
      <div className="p-6 lg:p-10">
        <h1 className="font-display text-2xl font-bold text-white mb-2">Quant Strategy</h1>
        <div className="rounded-xl border border-lexa-border bg-lexa-glass p-8 text-center text-gray-400">
          Loading…
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 lg:p-10">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-white mb-1">Quant Strategy</h1>
          <p className="text-gray-400 text-sm">Live market insights for Up/Down (15m & 1h) — BTC, ETH, SOL.</p>
        </div>
        {/* Top bar: USDC balance + open trades count */}
        <div className="flex flex-wrap items-center gap-4 p-4 rounded-xl border border-lexa-border bg-lexa-glass">
          <div className="flex items-baseline gap-2">
            <span className="text-gray-400 text-sm">USDC balance</span>
            <span className="font-mono text-xl font-bold text-white">
              {usdcBalance != null ? `$${usdcBalance.toFixed(2)}` : '—'}
            </span>
          </div>
          <div className="h-4 w-px bg-lexa-border" />
          <div className="flex items-baseline gap-2">
            <span className="text-gray-400 text-sm">Open positions</span>
            <span className="font-mono text-xl font-bold text-lexa-accent">{clobPositions.length}</span>
          </div>
          <button type="button" onClick={() => void fetchBalance()} className="text-xs text-gray-500 hover:text-white">Refresh balance</button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-2 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Two columns: Edge (left) | Orders (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Left: Edge section */}
        <div className="space-y-4">
          <div className="rounded-xl border border-lexa-border bg-lexa-glass p-5 card-glow">
            <h3 className="font-display font-semibold text-white mb-1">Edge trading</h3>
            <p className="text-sm text-gray-400 mb-4">
              BTC/ETH/SOL 15m & 1h. Enters UP when edge ≥ +8 pp, DOWN when edge ≤ −8 pp. One entry per market.
            </p>
            {edgeStatus?.enabled ? (
              <div className="space-y-2">
                <p className="text-sm text-emerald-400">On · ${edgeStatus.orderSizeUsd ?? '—'}/order</p>
                {edgeStatus.markets?.length ? (
                  <p className="text-xs text-gray-400">Markets: {edgeStatus.markets.join(', ')}</p>
                ) : (
                  <p className="text-xs text-gray-500">Markets: all (BTC/ETH/SOL 15m & 1h)</p>
                )}
                {edgeStatus.lastEnteredSlug && (
                  <p className="text-xs text-gray-500 truncate">Last: {edgeStatus.lastEnteredSlug}</p>
                )}
                <button
                  type="button"
                  onClick={handleStopEdgeTrading}
                  disabled={edgeActionLoading}
                  className="w-full rounded-lg bg-red-500/20 text-red-300 border border-red-500/50 px-3 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {edgeActionLoading ? 'Stopping…' : 'Stop edge trading'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEdgeSelectedMarkets(edgeStatus?.markets?.length ? [...edgeStatus.markets] : [...EDGE_MARKET_OPTIONS])
                  setEdgeModalOpen(true)
                }}
                disabled={edgeActionLoading}
                className="w-full rounded-lg bg-lexa-accent/20 text-lexa-accent border border-lexa-accent/50 px-3 py-2.5 text-sm font-medium hover:bg-lexa-accent/30 disabled:opacity-50"
              >
                Start edge trading
              </button>
            )}
          </div>

          {edgeEntries.length > 0 && (
            <div className="rounded-xl border border-lexa-border bg-lexa-glass p-5 card-glow">
              <h3 className="font-display font-semibold text-white mb-2">Your edge entries</h3>
              <p className="text-xs text-gray-500 mb-3">View & claim on Polymarket when resolved.</p>
              <ul className="space-y-2 max-h-48 overflow-y-auto">
                {edgeEntries.map((entry) => (
                  <li key={entry.slug} className="flex items-center justify-between gap-2 rounded-lg border border-lexa-border/60 bg-black/20 px-3 py-2 text-sm">
                    <span className="text-gray-300 truncate min-w-0">
                      {entry.market ? <span className="font-medium text-white">{entry.market}</span> : <span className="text-gray-500">{entry.slug.slice(0, 20)}…</span>}
                      {entry.side && <span className="ml-2 text-lexa-accent">{entry.side.toUpperCase()}</span>}
                      {entry.orderSizeUsd != null && <span className="ml-2 text-gray-500">${entry.orderSizeUsd}</span>}
                    </span>
                    <a href={entry.polymarketEventUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded bg-lexa-accent/20 text-lexa-accent px-2 py-1 text-xs font-medium">View</a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* BTC, ETH, SOL edge / market insights */}
          <div className="space-y-4">
            <h3 className="font-display font-semibold text-white">Markets (15m & 1h)</h3>
            {ASSETS.map(({ key, label, markets }) => (
              <div key={key} className="rounded-xl border border-lexa-border bg-lexa-glass card-glow overflow-hidden">
                <div className="px-4 py-3 border-b border-lexa-border bg-black/20">
                  <h4 className="font-display font-semibold text-white">{label}</h4>
                </div>
                <div className="divide-y divide-lexa-border/60">
                  {markets.map((market) => {
                    const row = byMarket.get(market)
                    const horizon = HORIZON_LABEL[market] ?? market
                    return (
                      <div key={market} className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium uppercase tracking-wide text-lexa-accent">{horizon}</span>
                          {row?.sample_ts && <span className="text-xs text-gray-500">{formatTime(row.sample_ts)}</span>}
                        </div>
                        {!row ? (
                          <p className="text-gray-500 text-sm">No data yet</p>
                        ) : (
                          <div className="space-y-1.5 text-sm">
                            <div className="flex justify-between">
                              <span className="text-gray-400">Price</span>
                              <span className="text-white font-mono">{formatPrice(row.current_price)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400">Outcome</span>
                              <span className={row.current_outcome === 'Up' ? 'text-emerald-400' : 'text-red-400'}>{row.current_outcome ?? '—'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400">Signal P(Up)</span>
                              <span className="text-white font-mono">{formatPct(row.synth_probability_up)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400">Polymarket P(Up)</span>
                              <span className="text-white font-mono">{formatPct(row.polymarket_probability_up)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400">Edge (Up)</span>
                              <span className={`font-mono font-medium ${(edgeUp(row.synth_probability_up, row.polymarket_probability_up) ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {formatEdge(edgeUp(row.synth_probability_up, row.polymarket_probability_up))}
                              </span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-gray-400">Bid / Ask</span>
                              <span className="text-gray-300 font-mono text-xs">{formatPct(row.best_bid_price)} / {formatPct(row.best_ask_price)}</span>
                            </div>
                            {row.event_end_time && (
                              <div className="flex justify-between">
                                <span className="text-gray-400">Event ends</span>
                                <span className="text-gray-400 text-xs">{new Date(row.event_end_time).toLocaleString()}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Orders / Portfolio section */}
        <div className="rounded-xl border border-lexa-border bg-lexa-glass p-5 card-glow space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-semibold text-white">Orders & positions</h3>
            <button type="button" onClick={() => void fetchClobData()} disabled={clobLoading} className="rounded bg-lexa-border text-gray-300 hover:bg-white/10 px-2 py-1 text-xs disabled:opacity-50">
              {clobLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>

          <div>
            <h4 className="text-xs font-medium uppercase tracking-wide text-lexa-accent mb-2">Open positions ({clobPositions.length})</h4>
            {clobPositions.length === 0 ? (
              <p className="text-sm text-gray-500 py-2">No open positions</p>
            ) : (
              <ul className="space-y-1.5">
                {clobPositions.map((p) => (
                  <li key={p.tokenId} className="flex items-center justify-between rounded border border-lexa-border/60 bg-black/20 px-3 py-2 text-sm">
                    <span className="text-gray-300 truncate">
                      {p.marketSlug ? <span className="text-white">{p.marketSlug}</span> : <span className="font-mono text-gray-500 text-xs">{p.tokenId.slice(0, 12)}…</span>}
                      <span className="ml-2 text-lexa-accent">{p.balance.toFixed(2)} shares</span>
                    </span>
                    {p.polymarketEventUrl && <a href={p.polymarketEventUrl} target="_blank" rel="noopener noreferrer" className="text-lexa-accent text-xs shrink-0">View →</a>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h4 className="text-xs font-medium uppercase tracking-wide text-lexa-accent mb-2">Open orders ({clobOrders.length})</h4>
            {clobOrders.length === 0 ? (
              <p className="text-sm text-gray-500 py-2">No open orders</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-lexa-border">
                      <th className="py-1.5 pr-2">Side</th>
                      <th className="py-1.5 pr-2">Price</th>
                      <th className="py-1.5 pr-2">Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clobOrders.slice(0, 15).map((o, i) => (
                      <tr key={i} className="border-b border-lexa-border/60 text-gray-300">
                        <td className="py-1.5 pr-2">{String((o as Record<string, unknown>).side ?? '—')}</td>
                        <td className="py-1.5 pr-2 font-mono">{(o as Record<string, unknown>).price != null ? Number((o as Record<string, unknown>).price).toFixed(3) : '—'}</td>
                        <td className="py-1.5 font-mono">{(o as Record<string, unknown>).size != null ? Number((o as Record<string, unknown>).size).toFixed(2) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <h4 className="text-xs font-medium uppercase tracking-wide text-lexa-accent mb-2">Trade history</h4>
            {clobTrades.length === 0 ? (
              <p className="text-sm text-gray-500 py-2">No trades yet. Refresh to sync.</p>
            ) : (
              <div className="overflow-x-auto max-h-56 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-lexa-border sticky top-0 bg-lexa-glass">
                      <th className="py-1.5 pr-2">Time</th>
                      <th className="py-1.5 pr-2">Market</th>
                      <th className="py-1.5 pr-2">Side</th>
                      <th className="py-1.5 pr-2 text-right">Amount</th>
                      <th className="py-1.5">Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clobTrades.slice(0, 30).map((t) => (
                      <tr key={t.id} className="border-b border-lexa-border/60 text-gray-300">
                        <td className="py-1.5 pr-2 whitespace-nowrap text-xs">{t.tradeTimestamp ? new Date(t.tradeTimestamp).toLocaleString() : '—'}</td>
                        <td className="py-1.5 pr-2 truncate max-w-[100px]">{t.marketSlug ?? '—'}</td>
                        <td className="py-1.5 pr-2">{t.side ?? '—'}</td>
                        <td className="py-1.5 pr-2 text-right font-mono">{t.amountUsd != null ? `$${t.amountUsd.toFixed(2)}` : '—'}</td>
                        <td className="py-1.5">{t.polymarketEventUrl ? <a href={t.polymarketEventUrl} target="_blank" rel="noopener noreferrer" className="text-lexa-accent text-xs">View</a> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {edgeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => !edgeActionLoading && setEdgeModalOpen(false)}>
          <div className="rounded-xl border border-lexa-border bg-lexa-card p-6 w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display font-semibold text-lg text-white mb-2">Start edge trading</h3>
            <p className="text-sm text-gray-400 mb-3">Order size in USD. Bot enters UP when edge ≥ +8 pp, DOWN when edge ≤ −8 pp. One entry per market (cooldown).</p>
            <input
              type="number"
              min={1}
              step={1}
              placeholder="Order size (USD)"
              value={edgeOrderSizeInput}
              onChange={(e) => setEdgeOrderSizeInput(e.target.value)}
              className="w-full rounded-lg border border-lexa-border bg-black/30 px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-lexa-accent mb-3"
            />
            <p className="text-xs text-gray-400 mb-2">Markets to trade</p>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {EDGE_MARKET_OPTIONS.map((m) => (
                <label key={m} className="flex items-center gap-2 rounded-lg border border-lexa-border/60 bg-black/20 px-3 py-2 cursor-pointer hover:bg-white/5">
                  <input
                    type="checkbox"
                    checked={edgeSelectedMarkets.includes(m)}
                    onChange={(e) => {
                      if (e.target.checked) setEdgeSelectedMarkets((prev) => [...prev, m])
                      else setEdgeSelectedMarkets((prev) => prev.filter((x) => x !== m))
                    }}
                    className="rounded border-lexa-border text-lexa-accent focus:ring-lexa-accent"
                  />
                  <span className="text-sm text-white">{m}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleStartEdgeTrading}
                disabled={edgeActionLoading}
                className="flex-1 rounded-lg bg-lexa-accent text-white px-3 py-2 text-sm font-medium hover:bg-lexa-accent/90 disabled:opacity-50"
              >
                {edgeActionLoading ? 'Starting…' : 'Start'}
              </button>
              <button
                type="button"
                onClick={() => !edgeActionLoading && setEdgeModalOpen(false)}
                disabled={edgeActionLoading}
                className="rounded-lg border border-lexa-border px-3 py-2 text-sm text-gray-300 hover:bg-white/5 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
