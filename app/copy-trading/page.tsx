'use client'

import { useState, useEffect, useCallback } from 'react'

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3100'

// ------ types (exact Polymarket Data API field names) ------
type Position = {
  proxyWallet?: string
  asset?: string
  conditionId?: string
  title?: string
  slug?: string
  eventSlug?: string
  outcome?: string
  outcomeIndex?: number
  size?: number          // shares held
  avgPrice?: number      // average entry price 0–1  ← NOT initPrice
  curPrice?: number      // current market price 0–1
  initialValue?: number  // cost basis in USDC
  currentValue?: number  // current value in USDC
  cashPnl?: number       // unrealized dollar PnL
  percentPnl?: number    // unrealized % — ALREADY in percent (e.g. -100 = -100%)
  realizedPnl?: number   // realized dollar PnL for this position
  percentRealizedPnl?: number // realized % — already in percent
  totalBought?: number
  redeemable?: boolean
  endDate?: string
}

type Trade = {
  proxyWallet?: string
  side?: string          // "BUY" | "SELL"
  asset?: string
  conditionId?: string
  title?: string
  slug?: string
  eventSlug?: string
  outcome?: string
  price?: number         // 0–1
  size?: number          // shares
  timestamp?: number     // Unix seconds
  transactionHash?: string
}

type UserData = {
  address: string
  positions: Position[] | null
  trades: Trade[] | null
  usdcBalance: string | null
}

type CopySubscription = {
  id: number
  leaderAddress: string
  orderSizeUsd: number
  copySells: boolean
  maxTradeUsd: number | null
  enabled: boolean
  lastSeenTimestamp: number
  createdAt: string
  updatedAt: string
}

type CopyHistoryItem = {
  id: number
  leaderAddress: string
  leaderTxHash: string
  tokenId: string | null
  marketSlug: string | null
  outcome: string | null
  side: string | null
  price: number | null
  size: number | null
  amountUsd: number | null
  status: 'executed' | 'skipped' | 'failed'
  errorMessage: string | null
  executedAt: string
  polymarketEventUrl: string | null
}

// ------ helpers ------
function n(v: unknown): number | null {
  if (v == null) return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

function fmtUsd(v: unknown, alwaysSign = false): string {
  const x = n(v)
  if (x == null) return '—'
  const sign = alwaysSign ? (x >= 0 ? '+' : '') : x < 0 ? '-' : ''
  const abs = Math.abs(x)
  return `${sign}$${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// percentPnl from Polymarket API is already a whole-number percent (e.g. -100, not -1.0)
function fmtPct(v: unknown): string {
  const x = n(v)
  if (x == null) return '—'
  const sign = x >= 0 ? '+' : ''
  return `${sign}${x.toFixed(2)}%`
}

function fmtShares(v: unknown): string {
  const x = n(v)
  if (x == null) return '—'
  return x.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 })
}

// price 0–1 → "75.3¢"
function fmtPrice(v: unknown): string {
  const x = n(v)
  if (x == null) return '—'
  return (x * 100).toFixed(1) + '¢'
}

// Unix seconds or ISO string → "Mar 16, 2026"
function fmtDate(v: unknown): string {
  if (v == null || v === '') return '—'
  const d = new Date(typeof v === 'number' ? v * 1000 : String(v))
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(v: unknown): string {
  if (v == null || v === '') return '—'
  const d = new Date(typeof v === 'number' ? v * 1000 : String(v))
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function pnlColor(v: unknown): string {
  const x = n(v)
  if (x == null) return 'text-gray-400'
  return x >= 0 ? 'text-green-400' : 'text-red-400'
}

// ------ matched position types + logic ------
type MatchedPosition = {
  tokenId: string
  marketSlug: string | null
  outcome: string | null
  leaderAddress: string
  polymarketEventUrl: string | null
  entryPrice: number | null   // avg price per share (0–1)
  entryShares: number         // total shares bought
  entryValue: number          // total USDC spent
  exitPrice: number | null    // avg price per share (0–1)
  exitShares: number          // total shares sold
  exitValue: number           // total USDC received from sells
  openShares: number          // remaining open shares
  pnlUsd: number | null       // realized PnL on closed portion
  status: 'open' | 'closed' | 'partial'
  entryAt: string | null
  exitAt: string | null
}

function matchCopyTrades(history: CopyHistoryItem[]): MatchedPosition[] {
  // Only executed trades with a tokenId can be matched
  const executed = history.filter((h) => h.status === 'executed' && h.tokenId)

  // Group by tokenId
  const byToken = new Map<string, CopyHistoryItem[]>()
  for (const trade of executed) {
    const key = trade.tokenId!
    if (!byToken.has(key)) byToken.set(key, [])
    byToken.get(key)!.push(trade)
  }

  const positions: MatchedPosition[] = []

  for (const [tokenId, trades] of Array.from(byToken.entries())) {
    trades.sort((a: CopyHistoryItem, b: CopyHistoryItem) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime())

    const buys = trades.filter((t: CopyHistoryItem) => (t.side ?? '').toUpperCase() === 'BUY')
    const sells = trades.filter((t: CopyHistoryItem) => (t.side ?? '').toUpperCase() === 'SELL')

    const entryShares = buys.reduce((s: number, t: CopyHistoryItem) => s + (n(t.size) ?? 0), 0)
    const entryValue = buys.reduce((s: number, t: CopyHistoryItem) => s + (n(t.amountUsd) ?? (n(t.price) ?? 0) * (n(t.size) ?? 0)), 0)
    const exitShares = sells.reduce((s: number, t: CopyHistoryItem) => s + (n(t.size) ?? 0), 0)
    const exitValue = sells.reduce((s: number, t: CopyHistoryItem) => s + (n(t.amountUsd) ?? (n(t.price) ?? 0) * (n(t.size) ?? 0)), 0)

    const avgEntryPrice = entryShares > 0 ? entryValue / entryShares : null
    const avgExitPrice = exitShares > 0 ? exitValue / exitShares : null
    const openShares = Math.max(0, entryShares - exitShares)

    // PnL on the closed (sold) portion: what we received - what that portion cost
    const closedPnl = exitShares > 0 && entryShares > 0
      ? exitValue - entryValue * (Math.min(exitShares, entryShares) / entryShares)
      : null

    const status: MatchedPosition['status'] =
      openShares < 0.0001 ? 'closed'
      : exitShares > 0 ? 'partial'
      : 'open'

    const sample = trades[0]
    positions.push({
      tokenId,
      marketSlug: sample.marketSlug,
      outcome: sample.outcome,
      leaderAddress: sample.leaderAddress,
      polymarketEventUrl: sample.polymarketEventUrl,
      entryPrice: avgEntryPrice,
      entryShares,
      entryValue,
      exitPrice: avgExitPrice,
      exitShares,
      exitValue,
      openShares,
      pnlUsd: closedPnl,
      status,
      entryAt: buys[0]?.executedAt ?? null,
      exitAt: sells.at(-1)?.executedAt ?? null,
    })
  }

  // Open first, then by most recent entry
  positions.sort((a, b) => {
    if (a.status !== 'closed' && b.status === 'closed') return -1
    if (a.status === 'closed' && b.status !== 'closed') return 1
    return new Date(b.entryAt ?? '').getTime() - new Date(a.entryAt ?? '').getTime()
  })

  return positions
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('lexa_token')
}

async function apiAuth<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken()
  if (!token) throw new Error('Not logged in. Connect your wallet first.')
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options?.headers ?? {}),
    },
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { const d = await res.json(); if (d?.error) msg = d.error } catch { /* ignore */ }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

// ------ Main Page ------

export default function CopyTradingPage() {
  const [addressInput, setAddressInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [userData, setUserData] = useState<UserData | null>(null)
  const [posTab, setPosTab] = useState<'active' | 'claimable'>('active')

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [modalOrderSize, setModalOrderSize] = useState('')
  const [modalCopySells, setModalCopySells] = useState(false)
  const [modalMaxTrade, setModalMaxTrade] = useState('')
  const [modalLoading, setModalLoading] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

  // Subscriptions + history
  const [subscriptions, setSubscriptions] = useState<CopySubscription[]>([])
  const [copyHistory, setCopyHistory] = useState<CopyHistoryItem[]>([])
  const [subsLoading, setSubsLoading] = useState(false)
  const [unsubLoading, setUnsubLoading] = useState<string | null>(null)

  const loadSubscriptions = useCallback(async () => {
    const token = getToken()
    if (!token) return
    setSubsLoading(true)
    try {
      const data = await apiAuth<{ subscriptions: CopySubscription[] }>('/copy-trading/subscriptions')
      setSubscriptions(data.subscriptions)
      const hist = await apiAuth<{ history: CopyHistoryItem[] }>('/copy-trading/history?limit=50')
      setCopyHistory(hist.history)
    } catch { /* not logged in or error — silent */ } finally {
      setSubsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSubscriptions()
  }, [loadSubscriptions])

  const handleLookup = async () => {
    const addr = addressInput.trim()
    if (!addr) { setError('Enter a Polymarket wallet address'); return }
    setLoading(true)
    setError(null)
    setUserData(null)
    try {
      const res = await fetch(`${API_BASE}/copy-trading/user?address=${encodeURIComponent(addr)}`)
      if (!res.ok) {
        let msg = `HTTP ${res.status}`
        try { const d = await res.json(); if (d?.error) msg = d.error } catch { /* ignore */ }
        throw new Error(msg)
      }
      setUserData((await res.json()) as UserData)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch user data')
    } finally {
      setLoading(false)
    }
  }

  const handleStartCopying = async () => {
    if (!userData) return
    setModalError(null)
    const orderSize = parseFloat(modalOrderSize)
    if (!Number.isFinite(orderSize) || orderSize < 1) {
      setModalError('Order size must be at least $1')
      return
    }
    const maxTrade = modalMaxTrade.trim() ? parseFloat(modalMaxTrade) : null
    if (maxTrade !== null && (!Number.isFinite(maxTrade) || maxTrade < 1)) {
      setModalError('Max trade cap must be at least $1')
      return
    }
    setModalLoading(true)
    try {
      await apiAuth('/copy-trading/subscribe', {
        method: 'POST',
        body: JSON.stringify({
          leaderAddress: userData.address,
          orderSizeUsd: orderSize,
          copySells: modalCopySells,
          maxTradeUsd: maxTrade,
        }),
      })
      setShowModal(false)
      setModalOrderSize('')
      setModalCopySells(false)
      setModalMaxTrade('')
      await loadSubscriptions()
    } catch (e) {
      setModalError(e instanceof Error ? e.message : 'Failed to subscribe')
    } finally {
      setModalLoading(false)
    }
  }

  const handleUnsubscribe = async (leaderAddress: string) => {
    setUnsubLoading(leaderAddress)
    try {
      await apiAuth('/copy-trading/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({ leaderAddress }),
      })
      await loadSubscriptions()
    } catch { /* ignore */ } finally {
      setUnsubLoading(null)
    }
  }

  const allPositions: Position[] = userData?.positions ?? []
  const trades: Trade[] = userData?.trades ?? []

  const activePositions = allPositions.filter((p) => !p.redeemable)
  const redeemablePositions = allPositions.filter((p) => p.redeemable)
  const totalClaimable = redeemablePositions.reduce((s, p) => s + (n(p.currentValue) ?? 0), 0)
  const activeUnrealizedPnl = activePositions.reduce((s, p) => s + (n(p.cashPnl) ?? 0), 0)
  const activeInitialValue = activePositions.reduce((s, p) => s + (n(p.initialValue) ?? 0), 0)
  const activePctPnl = activeInitialValue > 0 ? (activeUnrealizedPnl / activeInitialValue) * 100 : null
  const totalInitialValue = allPositions.reduce((s, p) => s + (n(p.initialValue) ?? 0), 0)
  const totalCurrentValue = allPositions.reduce((s, p) => s + (n(p.currentValue) ?? 0), 0)
  const partialRealizedPnl = allPositions.reduce((s, p) => s + (n(p.realizedPnl) ?? 0), 0)
  const tradingVolume = trades.reduce((s, t) => s + (n(t.price) ?? 0) * (n(t.size) ?? 0), 0)
  const usdcBalance = userData?.usdcBalance != null ? n(userData.usdcBalance) : null

  const activeSubForLeader = userData
    ? subscriptions.find((s) => s.leaderAddress.toLowerCase() === userData.address.toLowerCase() && s.enabled)
    : null

  return (
    <div className="p-6 lg:p-10 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-display font-bold text-white mb-1">Copy Trading</h1>
        <p className="text-sm text-gray-400">Look up any Polymarket user to view their portfolio, then mirror their trades automatically.</p>
      </div>

      {/* Search */}
      <div className="bg-lexa-glass border border-lexa-border rounded-2xl p-5 mb-6">
        <label className="block text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">
          Wallet Address
        </label>
        <div className="flex gap-3">
          <input
            type="text"
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleLookup() }}
            placeholder="0x..."
            className="flex-1 bg-void border border-lexa-border rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-lexa-accent transition-colors font-mono"
          />
          <button
            onClick={() => void handleLookup()}
            disabled={loading}
            className="px-6 py-3 rounded-xl bg-lexa-gradient text-white text-sm font-display font-semibold uppercase tracking-wide shadow-glow-lexa disabled:opacity-50 transition-opacity"
          >
            {loading ? 'Loading…' : 'Look Up'}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </div>

      {/* Results */}
      {userData && (
        <>
          {/* Address + Start Copying */}
          <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Viewing</p>
              <p className="font-mono text-sm text-white break-all">{userData.address}</p>
            </div>
            {activeSubForLeader ? (
              <div className="flex items-center gap-3">
                <span className="px-3 py-1.5 rounded-lg bg-green-500/15 text-green-400 text-xs font-semibold border border-green-500/30">
                  ● Copying Active — ${activeSubForLeader.orderSizeUsd}/trade
                </span>
                <button
                  onClick={() => void handleUnsubscribe(userData.address)}
                  disabled={unsubLoading === userData.address}
                  className="px-4 py-2 rounded-xl border border-red-500/40 text-red-400 text-sm font-display font-semibold hover:bg-red-500/10 transition-colors disabled:opacity-50"
                >
                  {unsubLoading === userData.address ? 'Stopping…' : 'Stop Copying'}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowModal(true)}
                className="px-6 py-3 rounded-xl bg-lexa-gradient text-white text-sm font-display font-semibold uppercase tracking-wide shadow-glow-lexa hover:opacity-90 transition-opacity"
              >
                Start Copying
              </button>
            )}
          </div>

          {/* Row 1 — balances */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <StatCard label="USDC Balance" value={usdcBalance != null ? fmtUsd(usdcBalance) : '—'} />
            <StatCard label="Positions Value" value={totalCurrentValue > 0 ? fmtUsd(totalCurrentValue) : '—'} />
            <StatCard
              label="Claimable Wins"
              value={totalClaimable > 0 ? fmtUsd(totalClaimable) : '—'}
              colorClass="text-green-400"
              hint="Resolved markets user hasn't claimed yet"
            />
            <StatCard label="Volume (last 3500 trades)" value={tradingVolume > 0 ? fmtUsd(tradingVolume) : '—'} />
          </div>

          {/* Row 2 — PnL */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
            <StatCard
              label="Active Unrealized PnL"
              value={activePositions.length > 0 ? fmtUsd(activeUnrealizedPnl, true) : '—'}
              colorClass={activePositions.length > 0 ? pnlColor(activeUnrealizedPnl) : undefined}
              hint="Open positions not yet resolved"
            />
            <StatCard
              label="Active PnL %"
              value={activePctPnl != null ? fmtPct(activePctPnl) : '—'}
              colorClass={pnlColor(activePctPnl)}
            />
            <StatCard
              label="Partial Realized PnL"
              value={fmtUsd(partialRealizedPnl, true)}
              colorClass={pnlColor(partialRealizedPnl)}
              hint="From intra-position sells only — excludes historical closed positions"
            />
          </div>

          {/* Quick stats */}
          <div className="bg-lexa-glass border border-lexa-border rounded-2xl p-4 mb-5 flex flex-wrap gap-6">
            <Stat label="Active Positions" value={String(activePositions.length)} />
            <Stat label="Redeemable" value={String(redeemablePositions.length)} />
            <Stat label="Total Held" value={String(allPositions.length)} />
            <Stat label="Cost Basis" value={totalInitialValue > 0 ? fmtUsd(totalInitialValue) : '—'} />
            <Stat label="Trades Fetched" value={`${trades.length.toLocaleString()} / 45K+`} />
          </div>

          {/* Positions with toggle */}
          <div className="bg-lexa-glass border border-lexa-border rounded-2xl p-5 mb-5">
            <div className="flex items-center gap-2 mb-4">
              <button
                onClick={() => setPosTab('active')}
                className={`px-4 py-1.5 rounded-lg text-xs font-display font-semibold uppercase tracking-wide transition-colors ${
                  posTab === 'active'
                    ? 'bg-lexa-gradient text-white shadow-glow-lexa'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                Active <span className="ml-1 opacity-70">({activePositions.length})</span>
              </button>
              <button
                onClick={() => setPosTab('claimable')}
                className={`px-4 py-1.5 rounded-lg text-xs font-display font-semibold uppercase tracking-wide transition-colors ${
                  posTab === 'claimable'
                    ? 'bg-green-500/20 text-green-400 ring-1 ring-green-500/40'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                Claimable <span className="ml-1 opacity-70">({redeemablePositions.length})</span>
              </button>
            </div>

            {posTab === 'active' && (
              activePositions.length === 0 ? (
                <p className="text-sm text-gray-500 py-2">No active positions.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[680px]">
                    <thead>
                      <tr className="border-b border-lexa-border">
                        {['Market', 'Outcome', 'Shares', 'Avg Entry', 'Cur. Price', 'Cost Basis', 'Value', 'PnL', 'PnL %'].map((h) => (
                          <th key={h} className={`py-2 pr-3 text-xs font-semibold uppercase tracking-widest text-gray-500 ${h === 'Market' ? 'text-left' : 'text-right'}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activePositions.map((p, i) => {
                        const slug = p.eventSlug ?? p.slug
                        return (
                          <tr key={i} className="border-b border-lexa-border/40 hover:bg-white/[0.02] transition-colors">
                            <td className="py-2.5 pr-3 text-white max-w-[200px]">
                              {slug ? (
                                <a href={`https://polymarket.com/event/${encodeURIComponent(slug)}`} target="_blank" rel="noopener noreferrer"
                                  className="hover:text-lexa-accent transition-colors truncate block" title={p.title ?? slug}>
                                  {p.title ?? slug}
                                </a>
                              ) : <span className="truncate block text-gray-400">{p.title ?? '—'}</span>}
                            </td>
                            <td className="py-2.5 pr-3 text-right">
                              <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-semibold ${
                                (p.outcome ?? '').toLowerCase() === 'yes' || (p.outcome ?? '').toLowerCase() === 'up'
                                  ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                              }`}>{p.outcome ?? '—'}</span>
                            </td>
                            <td className="py-2.5 pr-3 text-right text-gray-300">{fmtShares(p.size)}</td>
                            <td className="py-2.5 pr-3 text-right text-gray-300">{p.avgPrice != null ? fmtPrice(p.avgPrice) : '—'}</td>
                            <td className="py-2.5 pr-3 text-right text-gray-300">{p.curPrice != null ? fmtPrice(p.curPrice) : '—'}</td>
                            <td className="py-2.5 pr-3 text-right text-gray-400">{fmtUsd(p.initialValue)}</td>
                            <td className="py-2.5 pr-3 text-right text-gray-300">{fmtUsd(p.currentValue)}</td>
                            <td className={`py-2.5 pr-3 text-right font-semibold ${pnlColor(p.cashPnl)}`}>{fmtUsd(p.cashPnl, true)}</td>
                            <td className={`py-2.5 text-right font-semibold ${pnlColor(p.percentPnl)}`}>{p.percentPnl != null ? fmtPct(p.percentPnl) : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {posTab === 'claimable' && (
              redeemablePositions.length === 0 ? (
                <p className="text-sm text-gray-500 py-2">No claimable positions.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[600px]">
                    <thead>
                      <tr className="border-b border-lexa-border">
                        {['Market', 'Outcome', 'Shares', 'Avg Entry', 'Claimable Value', 'PnL', 'PnL %'].map((h) => (
                          <th key={h} className={`py-2 pr-3 text-xs font-semibold uppercase tracking-widest text-gray-500 ${h === 'Market' ? 'text-left' : 'text-right'}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {redeemablePositions.map((p, i) => {
                        const slug = p.eventSlug ?? p.slug
                        return (
                          <tr key={i} className="border-b border-lexa-border/40 hover:bg-green-500/[0.04] transition-colors">
                            <td className="py-2.5 pr-3 text-white max-w-[200px]">
                              {slug ? (
                                <a href={`https://polymarket.com/event/${encodeURIComponent(slug)}`} target="_blank" rel="noopener noreferrer"
                                  className="hover:text-lexa-accent transition-colors truncate block" title={p.title ?? slug}>
                                  {p.title ?? slug}
                                </a>
                              ) : <span className="truncate block text-gray-400">{p.title ?? '—'}</span>}
                            </td>
                            <td className="py-2.5 pr-3 text-right">
                              <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-semibold ${
                                (p.outcome ?? '').toLowerCase() === 'yes' || (p.outcome ?? '').toLowerCase() === 'up'
                                  ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                              }`}>{p.outcome ?? '—'}</span>
                            </td>
                            <td className="py-2.5 pr-3 text-right text-gray-300">{fmtShares(p.size)}</td>
                            <td className="py-2.5 pr-3 text-right text-gray-300">{p.avgPrice != null ? fmtPrice(p.avgPrice) : '—'}</td>
                            <td className="py-2.5 pr-3 text-right font-semibold text-green-400">{fmtUsd(p.currentValue)}</td>
                            <td className={`py-2.5 pr-3 text-right font-semibold ${pnlColor(p.cashPnl)}`}>{fmtUsd(p.cashPnl, true)}</td>
                            <td className={`py-2.5 text-right font-semibold ${pnlColor(p.percentPnl)}`}>{p.percentPnl != null ? fmtPct(p.percentPnl) : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>

          {/* Recent Trades */}
          <Section title={`Recent Trades (${trades.length})`}>
            {trades.length === 0 ? (
              <p className="text-sm text-gray-500 py-2">No trades found for this address.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[540px]">
                  <thead>
                    <tr className="border-b border-lexa-border">
                      {['Market', 'Side', 'Outcome', 'Price', 'Shares', 'Value (USDC)', 'Date'].map((h) => (
                        <th key={h} className={`py-2 pr-3 text-xs font-semibold uppercase tracking-widest text-gray-500 ${h === 'Market' ? 'text-left' : 'text-right'}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t, i) => {
                      const isBuy = (t.side ?? '').toUpperCase() === 'BUY'
                      const slug = t.eventSlug ?? t.slug
                      const usdcValue = (n(t.price) ?? 0) * (n(t.size) ?? 0)
                      return (
                        <tr key={i} className="border-b border-lexa-border/40 hover:bg-white/[0.02] transition-colors">
                          <td className="py-2.5 pr-3 text-white max-w-[180px]">
                            {slug ? (
                              <a href={`https://polymarket.com/event/${encodeURIComponent(slug)}`} target="_blank" rel="noopener noreferrer"
                                className="hover:text-lexa-accent transition-colors truncate block" title={t.title ?? slug}>
                                {t.title ?? slug}
                              </a>
                            ) : (
                              <span className="truncate block text-gray-400">{t.title ?? '—'}</span>
                            )}
                          </td>
                          <td className="py-2.5 pr-3 text-right">
                            <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-semibold ${
                              isBuy ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                            }`}>{t.side ?? '—'}</span>
                          </td>
                          <td className="py-2.5 pr-3 text-right text-gray-300">{t.outcome ?? '—'}</td>
                          <td className="py-2.5 pr-3 text-right text-gray-300">{t.price != null ? fmtPrice(t.price) : '—'}</td>
                          <td className="py-2.5 pr-3 text-right text-gray-300">{t.size != null ? fmtShares(t.size) : '—'}</td>
                          <td className="py-2.5 pr-3 text-right text-gray-300">{usdcValue > 0 ? fmtUsd(usdcValue) : '—'}</td>
                          <td className="py-2.5 text-right text-gray-500 text-xs">{fmtDate(t.timestamp)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      )}

      {!userData && !loading && (
        <div className="text-center py-12 text-gray-600">
          <p className="text-4xl mb-4">🔍</p>
          <p className="text-sm">Enter a Polymarket wallet address above to view their trading profile.</p>
        </div>
      )}

      {/* Active Copy Subscriptions */}
      {(subscriptions.length > 0 || subsLoading) && (
        <Section title="Active Copy Subscriptions">
          {subsLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : (
            <div className="space-y-3">
              {subscriptions.filter((s) => s.enabled).map((sub) => (
                <div key={sub.id} className="flex items-center justify-between gap-4 rounded-xl border border-lexa-border bg-black/20 px-4 py-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-white truncate">{sub.leaderAddress}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      ${sub.orderSizeUsd}/trade
                      {sub.maxTradeUsd != null && ` · max $${sub.maxTradeUsd}`}
                      {sub.copySells && ' · copying sells'}
                      {' · since '}{fmtDate(sub.createdAt)}
                    </p>
                  </div>
                  <button
                    onClick={() => void handleUnsubscribe(sub.leaderAddress)}
                    disabled={unsubLoading === sub.leaderAddress}
                    className="px-3 py-1.5 rounded-lg border border-red-500/40 text-red-400 text-xs font-semibold hover:bg-red-500/10 transition-colors disabled:opacity-50 shrink-0"
                  >
                    {unsubLoading === sub.leaderAddress ? 'Stopping…' : 'Stop'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Copy Trading Positions (matched entry/exit) */}
      {copyHistory.length > 0 && (
        <CopyPositionsTable history={copyHistory} />
      )}

      {/* Start Copying Modal */}
      {showModal && userData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#0f111a] border border-lexa-border rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-base font-display font-bold text-white mb-1">Start Copying</h2>
            <p className="text-xs text-gray-500 font-mono truncate mb-5">{userData.address}</p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1.5">
                  Order Size (USD) <span className="text-red-400">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={modalOrderSize}
                  onChange={(e) => setModalOrderSize(e.target.value)}
                  placeholder="e.g. 10"
                  className="w-full bg-void border border-lexa-border rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-lexa-accent transition-colors"
                />
                <p className="text-xs text-gray-600 mt-1">Each copied trade will execute for this amount in USDC.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1.5">
                  Max Trade Cap (USD) <span className="text-gray-600">optional</span>
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={modalMaxTrade}
                  onChange={(e) => setModalMaxTrade(e.target.value)}
                  placeholder="No limit"
                  className="w-full bg-void border border-lexa-border rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-lexa-accent transition-colors"
                />
                <p className="text-xs text-gray-600 mt-1">Cap per individual trade regardless of order size setting.</p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setModalCopySells(!modalCopySells)}
                  className={`relative w-10 h-5 rounded-full transition-colors ${modalCopySells ? 'bg-lexa-accent' : 'bg-gray-700'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${modalCopySells ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
                <span className="text-sm text-gray-300">Copy sell orders too</span>
              </div>
            </div>

            {modalError && <p className="mt-4 text-sm text-red-400">{modalError}</p>}

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setShowModal(false); setModalError(null) }}
                className="flex-1 px-4 py-3 rounded-xl border border-lexa-border text-gray-400 text-sm font-semibold hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleStartCopying()}
                disabled={modalLoading}
                className="flex-1 px-4 py-3 rounded-xl bg-lexa-gradient text-white text-sm font-display font-semibold shadow-glow-lexa disabled:opacity-50 transition-opacity"
              >
                {modalLoading ? 'Starting…' : 'Start Copying'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CopyPositionsTable({ history }: { history: CopyHistoryItem[] }) {
  const positions = matchCopyTrades(history)
  const failedOrSkipped = history.filter((h) => h.status === 'failed' || h.status === 'skipped')

  // Summary stats
  const closed = positions.filter((p) => p.status === 'closed')
  const open = positions.filter((p) => p.status !== 'closed')
  const realizedPnl = closed.reduce((s, p) => s + (p.pnlUsd ?? 0), 0)
  const totalDeployed = positions.reduce((s, p) => s + p.entryValue, 0)

  return (
    <Section title={`Copy Positions (${positions.length} markets · ${history.filter(h => h.status === 'executed').length} trades)`}>
      {/* Summary */}
      <div className="flex flex-wrap gap-5 mb-4 pb-4 border-b border-lexa-border">
        <div><p className="text-xs text-gray-500">Open</p><p className="text-sm font-bold text-white">{open.length}</p></div>
        <div><p className="text-xs text-gray-500">Closed</p><p className="text-sm font-bold text-white">{closed.length}</p></div>
        <div><p className="text-xs text-gray-500">Deployed</p><p className="text-sm font-bold text-white">{fmtUsd(totalDeployed)}</p></div>
        <div>
          <p className="text-xs text-gray-500">Realized PnL</p>
          <p className={`text-sm font-bold ${realizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtUsd(realizedPnl, true)}</p>
        </div>
        {failedOrSkipped.length > 0 && (
          <div><p className="text-xs text-gray-500">Failed/Skipped</p><p className="text-sm font-bold text-red-400">{failedOrSkipped.length}</p></div>
        )}
      </div>

      {positions.length === 0 ? (
        <p className="text-sm text-gray-500 py-2">No executed copy trades yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-lexa-border">
                {['Status', 'Market / Outcome', 'Entry Price', 'Entry Shares', 'Exit Price', 'Exit Shares', 'Open Shares', 'PnL', 'Opened'].map((h) => (
                  <th key={h} className={`py-2 pr-3 text-xs font-semibold uppercase tracking-widest text-gray-500 ${h === 'Market / Outcome' ? 'text-left' : 'text-right'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {positions.map((p, i) => (
                <tr key={i} className="border-b border-lexa-border/40 hover:bg-white/[0.02] transition-colors">
                  <td className="py-2.5 pr-3 text-right">
                    <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-semibold ${
                      p.status === 'open' ? 'bg-blue-500/15 text-blue-400'
                        : p.status === 'partial' ? 'bg-yellow-500/15 text-yellow-400'
                        : 'bg-gray-500/15 text-gray-400'
                    }`}>{p.status.toUpperCase()}</span>
                  </td>
                  <td className="py-2.5 pr-3 max-w-[200px]">
                    {p.polymarketEventUrl ? (
                      <a href={p.polymarketEventUrl} target="_blank" rel="noopener noreferrer"
                        className="hover:text-lexa-accent transition-colors truncate block text-white text-xs" title={p.marketSlug ?? ''}>
                        {p.marketSlug ?? p.tokenId.slice(0, 14)}
                      </a>
                    ) : (
                      <span className="truncate block text-xs text-gray-400" title={p.tokenId}>
                        {p.marketSlug ?? p.tokenId.slice(0, 14)}
                      </span>
                    )}
                    {p.outcome && (
                      <span className={`text-[10px] font-semibold ${
                        ['yes','up'].includes(p.outcome.toLowerCase()) ? 'text-green-400' : 'text-red-400'
                      }`}>{p.outcome}</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-right text-gray-300 font-mono text-xs">
                    {p.entryPrice != null ? `${(p.entryPrice * 100).toFixed(1)}¢` : '—'}
                  </td>
                  <td className="py-2.5 pr-3 text-right text-gray-300 font-mono text-xs">
                    {p.entryShares > 0 ? p.entryShares.toFixed(2) : '—'}
                    <span className="block text-[10px] text-gray-600">{fmtUsd(p.entryValue)}</span>
                  </td>
                  <td className="py-2.5 pr-3 text-right text-gray-300 font-mono text-xs">
                    {p.exitPrice != null ? `${(p.exitPrice * 100).toFixed(1)}¢` : '—'}
                  </td>
                  <td className="py-2.5 pr-3 text-right text-gray-300 font-mono text-xs">
                    {p.exitShares > 0 ? p.exitShares.toFixed(2) : '—'}
                    {p.exitShares > 0 && <span className="block text-[10px] text-gray-600">{fmtUsd(p.exitValue)}</span>}
                  </td>
                  <td className="py-2.5 pr-3 text-right font-mono text-xs">
                    {p.openShares > 0.001 ? (
                      <span className="text-blue-400">{p.openShares.toFixed(2)}</span>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                  <td className={`py-2.5 pr-3 text-right font-bold text-xs ${p.pnlUsd == null ? 'text-gray-600' : p.pnlUsd >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {p.pnlUsd != null ? fmtUsd(p.pnlUsd, true) : '—'}
                  </td>
                  <td className="py-2.5 text-right text-gray-500 text-xs">{p.entryAt ? fmtDateTime(p.entryAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Failed/skipped trades collapsible */}
      {failedOrSkipped.length > 0 && (
        <details className="mt-4">
          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400 select-none">
            {failedOrSkipped.length} failed/skipped trade{failedOrSkipped.length > 1 ? 's' : ''} (click to expand)
          </summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs min-w-[520px]">
              <thead>
                <tr className="border-b border-lexa-border">
                  {['Status', 'Market', 'Side', 'Reason', 'Time'].map((h) => (
                    <th key={h} className={`py-1.5 pr-3 font-semibold uppercase tracking-widest text-gray-600 ${h === 'Market' ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {failedOrSkipped.map((h) => (
                  <tr key={h.id} className="border-b border-lexa-border/30">
                    <td className="py-2 pr-3 text-right">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${h.status === 'failed' ? 'bg-red-500/15 text-red-400' : 'bg-gray-500/15 text-gray-500'}`}>{h.status}</span>
                    </td>
                    <td className="py-2 pr-3 max-w-[160px]">
                      <span className="truncate block text-gray-500">{h.marketSlug ?? h.tokenId?.slice(0, 14) ?? '—'}</span>
                    </td>
                    <td className="py-2 pr-3 text-right text-gray-600">{h.side ?? '—'}</td>
                    <td className="py-2 pr-3 text-right text-gray-600 max-w-[180px]">
                      <span className="truncate block" title={h.errorMessage ?? ''}>{h.errorMessage?.slice(0, 40) ?? '—'}</span>
                    </td>
                    <td className="py-2 text-right text-gray-600">{fmtDateTime(h.executedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </Section>
  )
}

function StatCard({ label, value, colorClass, hint }: { label: string; value: string; colorClass?: string; hint?: string }) {
  return (
    <div className="bg-lexa-glass border border-lexa-border rounded-2xl p-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-1" title={hint}>{label}{hint && <span className="ml-1 text-gray-600 cursor-help">ⓘ</span>}</p>
      <p className={`text-lg font-display font-bold ${colorClass ?? 'text-white'}`}>{value}</p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-white">{value}</p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-lexa-glass border border-lexa-border rounded-2xl p-5 mb-5">
      <h2 className="text-xs font-display font-semibold uppercase tracking-widest text-gray-400 mb-4">{title}</h2>
      {children}
    </div>
  )
}
