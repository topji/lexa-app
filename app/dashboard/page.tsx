'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3100'

// ─── Types ────────────────────────────────────────────────────────────────────

type Position = {
  id: number
  strategy_id: number
  market: string
  side: 'up' | 'down'
  status: string
  entry_odd: number | null
  exit_odd: number | null
  exit_reason: string | null
  entry_shares: number | null
  entry_sample_ts: string | null
  exit_sample_ts: string | null
  expiry_ts: string | null
  pnl_usd: number | null
}

type Strategy = {
  id: number
  name: string
  market: string
  active: boolean
  entry_side: 'up' | 'down'
  order_size_usd: string
  entry_odd_max: string | null
  exit_stop_loss_pct: string | null
  exit_profit_pct: string | null
  positions: Position[]
  openCount: number
  wonCount: number
  lostCount: number
  pnlUsd: number
}

type EdgeEntry = {
  slug: string
  market: string | null
  side: string | null
  orderSizeUsd: number | null
  enteredAt: string | null
  polymarketEventUrl: string | null
}

type MarketInsight = {
  market: string
  slug: string | null
  currentOutcome: string | null
  synthProbUp: number | null
  polyProbUp: number | null
  edgePp: number | null
  sampleTs: string | null
  bestBid: number | null
  bestAsk: number | null
  lastTradePrice: number | null
}

type EdgeTrading = {
  enabled: boolean
  orderSizeUsd: number | null
  markets: string[] | null
  lastEnteredSlug: string | null
  lastEnteredAt: string | null
  entries: EdgeEntry[]
  insights: MarketInsight[]
}

type CopySubscription = {
  id: number
  leaderAddress: string
  orderSizeUsd: number
  copySells: boolean
  maxTradeUsd: number | null
  enabled: boolean
  createdAt: string
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
  executedAt: string | null
  polymarketEventUrl: string | null
}

type LeaderStat = {
  executed: number
  failed: number
  skipped: number
  totalUsd: number
}

type ClobTrade = {
  id: number
  tradeId: string
  side: string | null
  price: number | null
  size: number | null
  amountUsd: number | null
  tradeTimestamp: string | null
  marketSlug: string | null
  polymarketEventUrl: string | null
}

type DashboardData = {
  wallet: {
    address: string | null
    custodialAddress: string | null
    gaslessAddress: string | null
    usdcBalance: string | null
    usdcAllowance: string | null
  }
  strategies: Strategy[]
  edgeTrading: EdgeTrading
  copyTrading: {
    subscriptions: CopySubscription[]
    history: CopyHistoryItem[]
    leaderStats: Record<string, LeaderStat>
  }
  clobTrades: ClobTrade[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(v: unknown): number | null {
  if (v == null) return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

function fmtUsd(v: unknown, alwaysSign = false): string {
  const x = n(v)
  if (x == null) return '—'
  const sign = alwaysSign ? (x >= 0 ? '+' : '') : x < 0 ? '-' : ''
  return `${sign}$${Math.abs(x).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtPct(v: unknown, digits = 1): string {
  const x = n(v)
  if (x == null) return '—'
  return `${x >= 0 ? '+' : ''}${x.toFixed(digits)}%`
}

function fmtOdd(v: unknown): string {
  const x = n(v)
  if (x == null) return '—'
  return `${(x * 100).toFixed(1)}¢`
}

function fmtDt(v: string | null | undefined, short = false): string {
  if (!v) return '—'
  const d = new Date(v)
  if (isNaN(d.getTime())) return '—'
  if (short) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function truncAddr(a: string | null | undefined, chars = 6): string {
  if (!a) return '—'
  return `${a.slice(0, chars)}…${a.slice(-4)}`
}

function pnlCls(v: unknown): string {
  const x = n(v)
  if (x == null) return 'text-gray-400'
  return x > 0 ? 'text-green-400' : x < 0 ? 'text-red-400' : 'text-gray-400'
}

function edgeColor(pp: number | null): string {
  if (pp == null) return 'text-gray-400'
  if (pp >= 8) return 'text-green-400'
  if (pp <= -8) return 'text-red-400'
  return 'text-yellow-400'
}

async function apiFetch<T>(path: string): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('lexa_token') : null
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { const d = await res.json(); if (d?.error) msg = d.error } catch { /* ignore */ }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

// ─── Sub-components ───────────────────────────────────────────────────────────

// ─── Copy trade matching ──────────────────────────────────────────────────────

type MatchedPosition = {
  tokenId: string
  marketSlug: string | null
  outcome: string | null
  leaderAddress: string
  polymarketEventUrl: string | null
  entryPrice: number | null
  entryShares: number
  entryValue: number
  exitPrice: number | null
  exitShares: number
  exitValue: number
  openShares: number
  pnlUsd: number | null
  status: 'open' | 'closed' | 'partial'
  entryAt: string | null
  exitAt: string | null
}

function matchCopyTrades(history: CopyHistoryItem[]): MatchedPosition[] {
  const executed = history.filter((h) => h.status === 'executed' && h.tokenId)
  const byToken = new Map<string, CopyHistoryItem[]>()
  for (const trade of executed) {
    const key = trade.tokenId!
    if (!byToken.has(key)) byToken.set(key, [])
    byToken.get(key)!.push(trade)
  }
  const positions: MatchedPosition[] = []
  for (const [tokenId, trades] of Array.from(byToken.entries())) {
    trades.sort((a: CopyHistoryItem, b: CopyHistoryItem) => new Date(a.executedAt ?? '').getTime() - new Date(b.executedAt ?? '').getTime())
    const buys = trades.filter((t: CopyHistoryItem) => (t.side ?? '').toUpperCase() === 'BUY')
    const sells = trades.filter((t: CopyHistoryItem) => (t.side ?? '').toUpperCase() === 'SELL')
    const entryShares = buys.reduce((s: number, t: CopyHistoryItem) => s + (n(t.size) ?? 0), 0)
    const entryValue = buys.reduce((s: number, t: CopyHistoryItem) => s + (n(t.amountUsd) ?? (n(t.price) ?? 0) * (n(t.size) ?? 0)), 0)
    const exitShares = sells.reduce((s: number, t: CopyHistoryItem) => s + (n(t.size) ?? 0), 0)
    const exitValue = sells.reduce((s: number, t: CopyHistoryItem) => s + (n(t.amountUsd) ?? (n(t.price) ?? 0) * (n(t.size) ?? 0)), 0)
    const avgEntryPrice = entryShares > 0 ? entryValue / entryShares : null
    const avgExitPrice = exitShares > 0 ? exitValue / exitShares : null
    const openShares = Math.max(0, entryShares - exitShares)
    const closedPnl = exitShares > 0 && entryShares > 0
      ? exitValue - entryValue * (Math.min(exitShares, entryShares) / entryShares)
      : null
    const status: MatchedPosition['status'] =
      openShares < 0.0001 ? 'closed' : exitShares > 0 ? 'partial' : 'open'
    const sample = trades[0]
    positions.push({
      tokenId, marketSlug: sample.marketSlug, outcome: sample.outcome,
      leaderAddress: sample.leaderAddress, polymarketEventUrl: sample.polymarketEventUrl,
      entryPrice: avgEntryPrice, entryShares, entryValue,
      exitPrice: avgExitPrice, exitShares, exitValue,
      openShares, pnlUsd: closedPnl, status,
      entryAt: buys[0]?.executedAt ?? null,
      exitAt: sells.at(-1)?.executedAt ?? null,
    })
  }
  positions.sort((a, b) => {
    if (a.status !== 'closed' && b.status === 'closed') return -1
    if (a.status === 'closed' && b.status !== 'closed') return 1
    return new Date(b.entryAt ?? '').getTime() - new Date(a.entryAt ?? '').getTime()
  })
  return positions
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-lexa-border bg-lexa-glass p-4 sm:p-5 ${className}`}>
      {children}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-display font-bold uppercase tracking-widest text-gray-400 mb-4">{children}</h2>
  )
}

function StatusBadge({ active, label }: { active: boolean; label?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${active ? 'bg-green-500/15 text-green-400' : 'bg-gray-500/15 text-gray-500'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-green-400' : 'bg-gray-500'}`} />
      {label ?? (active ? 'Live' : 'Off')}
    </span>
  )
}

function StatPill({ label, value, color = 'text-white' }: { label: string; value: string; color?: string }) {
  return (
    <div className="text-center">
      <p className={`text-base font-bold font-mono ${color}`}>{value}</p>
      <p className="text-[10px] text-gray-500 uppercase tracking-widest mt-0.5">{label}</p>
    </div>
  )
}

function TxLink({ url, children }: { url: string | null; children: React.ReactNode }) {
  if (!url) return <span className="truncate text-gray-400">{children}</span>
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="truncate text-white hover:text-lexa-accent transition-colors"
    >{children}</a>
  )
}

// ─── Tab: Strategies ─────────────────────────────────────────────────────────

function StrategiesTab({ strategies, clobTrades }: { strategies: Strategy[]; clobTrades: ClobTrade[] }) {
  const [selectedId, setSelectedId] = useState<number | null>(strategies[0]?.id ?? null)
  const selected = strategies.find((s) => s.id === selectedId) ?? null

  // Summary stats
  const totalPnl = strategies.reduce((s, x) => s + (x.pnlUsd ?? 0), 0)
  const totalOpen = strategies.reduce((s, x) => s + x.openCount, 0)
  const totalWon = strategies.reduce((s, x) => s + x.wonCount, 0)
  const totalLost = strategies.reduce((s, x) => s + x.lostCount, 0)
  const winRate = totalWon + totalLost > 0 ? (totalWon / (totalWon + totalLost)) * 100 : null

  if (strategies.length === 0) {
    return (
      <div className="text-center py-16 text-gray-600">
        <p className="text-3xl mb-3">🤖</p>
        <p className="text-sm mb-3">No strategies yet.</p>
        <Link href="/strategies" className="text-lexa-accent text-sm underline">Create one on the Strategies page</Link>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Summary row */}
      <Card>
        <div className="flex flex-wrap gap-6 justify-around">
          <StatPill label="Strategies" value={String(strategies.length)} />
          <StatPill label="Open Positions" value={String(totalOpen)} />
          <StatPill label="Won" value={String(totalWon)} color="text-green-400" />
          <StatPill label="Lost" value={String(totalLost)} color="text-red-400" />
          <StatPill label="Win Rate" value={winRate != null ? `${winRate.toFixed(0)}%` : '—'} color={pnlCls(winRate != null ? winRate - 50 : null)} />
          <StatPill label="Total PnL" value={fmtUsd(totalPnl, true)} color={pnlCls(totalPnl)} />
        </div>
      </Card>

      {/* Strategy selector */}
      <div className="flex gap-2 flex-wrap">
        {strategies.map((s) => (
          <button
            key={s.id}
            onClick={() => setSelectedId(s.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold font-display uppercase tracking-wide border transition-colors ${
              selectedId === s.id
                ? 'bg-lexa-gradient text-white border-transparent shadow-glow-lexa'
                : 'border-lexa-border text-gray-400 hover:text-white hover:border-gray-500'
            }`}
          >
            {s.name}
            {s.active && <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />}
          </button>
        ))}
      </div>

      {/* Selected strategy detail */}
      {selected && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Config card */}
          <Card>
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-sm font-bold text-white">{selected.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">{selected.market} · {selected.entry_side.toUpperCase()}</p>
              </div>
              <StatusBadge active={selected.active} />
            </div>
            <div className="space-y-1.5 text-xs">
              <Row label="Order Size" value={fmtUsd(selected.order_size_usd)} />
              {selected.entry_odd_max && <Row label="Entry Odd Max" value={fmtOdd(selected.entry_odd_max)} />}
              {selected.exit_stop_loss_pct && <Row label="Stop Loss" value={`${selected.exit_stop_loss_pct}%`} />}
              {selected.exit_profit_pct && <Row label="Take Profit" value={`+${selected.exit_profit_pct}%`} />}
            </div>
            <div className="flex gap-3 mt-4 pt-3 border-t border-lexa-border">
              <StatPill label="Open" value={String(selected.openCount)} />
              <StatPill label="Won" value={String(selected.wonCount)} color="text-green-400" />
              <StatPill label="Lost" value={String(selected.lostCount)} color="text-red-400" />
              <StatPill label="PnL" value={fmtUsd(selected.pnlUsd, true)} color={pnlCls(selected.pnlUsd)} />
            </div>
          </Card>

          {/* Positions table */}
          <div className="lg:col-span-2">
            <Card>
              <SectionTitle>Positions ({selected.positions.length})</SectionTitle>
              {selected.positions.length === 0 ? (
                <p className="text-xs text-gray-600 py-4">No positions yet for this strategy.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs min-w-[520px]">
                    <thead>
                      <tr className="border-b border-lexa-border">
                        {['Status', 'Side', 'Entry', 'Exit', 'Reason', 'PnL', 'Date'].map((h) => (
                          <th key={h} className={`py-1.5 pr-3 font-semibold uppercase tracking-widest text-gray-500 ${h === 'Status' ? 'text-left' : 'text-right'}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {selected.positions.map((p) => {
                        const isOpen = p.status === 'open' || p.status === 'closing'
                        return (
                          <tr key={p.id} className="border-b border-lexa-border/40 hover:bg-white/[0.02]">
                            <td className="py-2 pr-3">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                isOpen ? 'bg-blue-500/15 text-blue-400'
                                  : p.exit_reason === 'profit' ? 'bg-green-500/15 text-green-400'
                                  : p.exit_reason === 'stoploss' ? 'bg-red-500/15 text-red-400'
                                  : 'bg-gray-500/15 text-gray-400'
                              }`}>{isOpen ? 'OPEN' : p.exit_reason?.toUpperCase() ?? 'CLOSED'}</span>
                            </td>
                            <td className="py-2 pr-3 text-right">
                              <span className={`font-bold ${p.side === 'up' ? 'text-green-400' : 'text-red-400'}`}>{p.side?.toUpperCase()}</span>
                            </td>
                            <td className="py-2 pr-3 text-right text-gray-300">{fmtOdd(p.entry_odd)}</td>
                            <td className="py-2 pr-3 text-right text-gray-300">{fmtOdd(p.exit_odd)}</td>
                            <td className="py-2 pr-3 text-right text-gray-500">{p.exit_reason ?? (isOpen ? '—' : 'closed')}</td>
                            <td className={`py-2 pr-3 text-right font-bold ${pnlCls(p.pnl_usd)}`}>{p.pnl_usd != null ? fmtUsd(p.pnl_usd, true) : '—'}</td>
                            <td className="py-2 text-right text-gray-500">{fmtDt(p.entry_sample_ts, true)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* Recent CLOB Trades */}
      {clobTrades.length > 0 && (
        <Card>
          <SectionTitle>Recent On-Chain Trades ({clobTrades.length})</SectionTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[500px]">
              <thead>
                <tr className="border-b border-lexa-border">
                  {['Market', 'Side', 'Price', 'Shares', 'Value', 'Date'].map((h) => (
                    <th key={h} className={`py-1.5 pr-3 font-semibold uppercase tracking-widest text-gray-500 ${h === 'Market' ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clobTrades.map((t) => (
                  <tr key={t.id} className="border-b border-lexa-border/40 hover:bg-white/[0.02]">
                    <td className="py-2 pr-3 max-w-[160px]">
                      <TxLink url={t.polymarketEventUrl}>{t.marketSlug ?? t.tradeId.slice(0, 12)}</TxLink>
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <span className={`font-bold ${t.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{t.side ?? '—'}</span>
                    </td>
                    <td className="py-2 pr-3 text-right text-gray-300">{fmtOdd(t.price)}</td>
                    <td className="py-2 pr-3 text-right text-gray-300">{t.size != null ? t.size.toFixed(2) : '—'}</td>
                    <td className="py-2 pr-3 text-right text-gray-300">{fmtUsd(t.amountUsd)}</td>
                    <td className="py-2 text-right text-gray-500">{fmtDt(t.tradeTimestamp, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

// ─── Tab: Quant Strategy ──────────────────────────────────────────────────────

const MARKET_LABELS: Record<string, string> = {
  'btc-15m': 'BTC 15min', 'btc-1h': 'BTC 1hr',
  'eth-15m': 'ETH 15min', 'eth-1h': 'ETH 1hr',
  'sol-15m': 'SOL 15min', 'sol-1h': 'SOL 1hr',
  'btc-15m-quant': 'BTC 15m QUANT', 'btc-1h-quant': 'BTC 1h QUANT',
}

const ASSET_ICON: Record<string, string> = {
  btc: '₿', eth: 'Ξ', sol: '◎',
}

function QuantTab({ edge }: { edge: EdgeTrading }) {
  const activeMarkets = edge.markets ?? ['btc-15m', 'btc-1h', 'eth-15m', 'eth-1h', 'sol-15m', 'sol-1h']

  return (
    <div className="space-y-5">
      {/* Status + Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Edge Trading</p>
            <StatusBadge active={edge.enabled} />
          </div>
          <p className={`text-2xl font-mono font-bold ${edge.enabled ? 'text-green-400' : 'text-gray-600'}`}>
            {edge.enabled ? 'LIVE' : 'OFF'}
          </p>
          {edge.orderSizeUsd != null && (
            <p className="text-xs text-gray-500 mt-1">{fmtUsd(edge.orderSizeUsd)} / trade</p>
          )}
          <Link href="/quant-strategy" className="mt-3 block text-xs text-lexa-accent hover:underline">
            Manage →
          </Link>
        </Card>
        <Card>
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Markets Active</p>
          <div className="flex flex-wrap gap-1.5">
            {(['btc-15m', 'btc-1h', 'eth-15m', 'eth-1h', 'sol-15m', 'sol-1h'] as const).map((m) => {
              const on = activeMarkets.includes(m)
              return (
                <span key={m} className={`px-2 py-0.5 rounded-lg text-xs font-semibold ${on ? 'bg-lexa-accent/15 text-lexa-accent border border-lexa-accent/30' : 'bg-gray-800 text-gray-600'}`}>
                  {MARKET_LABELS[m] ?? m}
                </span>
              )
            })}
          </div>
        </Card>
        <Card>
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Last Entry</p>
          {edge.lastEnteredSlug ? (
            <>
              <a href={`https://polymarket.com/event/${encodeURIComponent(edge.lastEnteredSlug)}`}
                target="_blank" rel="noopener noreferrer"
                className="text-sm text-white hover:text-lexa-accent truncate block">{edge.lastEnteredSlug}</a>
              <p className="text-xs text-gray-500 mt-1">{fmtDt(edge.lastEnteredAt)}</p>
            </>
          ) : (
            <p className="text-sm text-gray-600">No entries yet</p>
          )}
          <p className="text-xs text-gray-500 mt-2">Total entries: <span className="text-white font-semibold">{edge.entries.length}</span></p>
        </Card>
      </div>

      {/* Live signal cards */}
      {edge.insights.length > 0 && (
        <>
          <SectionTitle>Live Market Signals</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {edge.insights.map((insight) => {
              const assetKey = insight.market.split('-')[0]
              const icon = ASSET_ICON[assetKey] ?? '◆'
              const signalDir = insight.edgePp != null && Math.abs(insight.edgePp) >= 8
                ? insight.edgePp > 0 ? '▲ UP' : '▼ DOWN'
                : null
              const isActive = activeMarkets.includes(insight.market)
              return (
                <Card key={insight.market} className={isActive ? '' : 'opacity-50'}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-mono">{icon}</span>
                      <div>
                        <p className="text-xs font-bold text-white">{MARKET_LABELS[insight.market] ?? insight.market}</p>
                        {insight.slug && (
                          <a href={`https://polymarket.com/event/${encodeURIComponent(insight.slug)}`}
                            target="_blank" rel="noopener noreferrer"
                            className="text-[10px] text-gray-500 hover:text-lexa-accent truncate block max-w-[120px]"
                          >{insight.slug}</a>
                        )}
                      </div>
                    </div>
                    {signalDir ? (
                      <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${insight.edgePp! > 0 ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                        {signalDir}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-lg text-xs bg-gray-700/40 text-gray-500">neutral</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-gray-500">Signal P(Up)</p>
                      <p className="text-white font-mono font-semibold">
                        {insight.synthProbUp != null ? `${(insight.synthProbUp * 100).toFixed(1)}%` : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500">Market P(Up)</p>
                      <p className="text-white font-mono font-semibold">
                        {insight.polyProbUp != null ? `${(insight.polyProbUp * 100).toFixed(1)}%` : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500">Edge</p>
                      <p className={`font-mono font-bold ${edgeColor(insight.edgePp)}`}>
                        {insight.edgePp != null ? fmtPct(insight.edgePp) : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500">Outcome</p>
                      <p className={`font-semibold ${insight.currentOutcome?.toLowerCase() === 'up' ? 'text-green-400' : insight.currentOutcome ? 'text-red-400' : 'text-gray-500'}`}>
                        {insight.currentOutcome ?? '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500">Bid / Ask</p>
                      <p className="text-gray-300 font-mono">
                        {insight.bestBid != null ? `${(insight.bestBid * 100).toFixed(0)}¢` : '—'} / {insight.bestAsk != null ? `${(insight.bestAsk * 100).toFixed(0)}¢` : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500">Updated</p>
                      <p className="text-gray-400">{fmtDt(insight.sampleTs, true)}</p>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        </>
      )}

      {/* Entries table */}
      {edge.entries.length > 0 && (
        <Card>
          <SectionTitle>Entry History ({edge.entries.length})</SectionTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[420px]">
              <thead>
                <tr className="border-b border-lexa-border">
                  {['Market', 'Market/Event', 'Side', 'Size', 'Date'].map((h) => (
                    <th key={h} className={`py-1.5 pr-3 font-semibold uppercase tracking-widest text-gray-500 ${h === 'Market' ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {edge.entries.map((e, i) => (
                  <tr key={i} className="border-b border-lexa-border/40 hover:bg-white/[0.02]">
                    <td className="py-2 pr-3">
                      <span className="px-1.5 py-0.5 rounded bg-lexa-accent/10 text-lexa-accent text-[10px] font-semibold">{MARKET_LABELS[e.market ?? ''] ?? e.market ?? '—'}</span>
                    </td>
                    <td className="py-2 pr-3 text-right max-w-[160px]">
                      <TxLink url={e.polymarketEventUrl}>{e.slug?.slice(0, 24) ?? '—'}</TxLink>
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <span className={`font-bold ${e.side === 'up' ? 'text-green-400' : 'text-red-400'}`}>{e.side?.toUpperCase() ?? '—'}</span>
                    </td>
                    <td className="py-2 pr-3 text-right text-gray-300">{fmtUsd(e.orderSizeUsd)}</td>
                    <td className="py-2 text-right text-gray-500">{fmtDt(e.enteredAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {edge.entries.length === 0 && !edge.enabled && (
        <div className="text-center py-12 text-gray-600">
          <p className="text-3xl mb-3">📈</p>
          <p className="text-sm mb-3">Quant strategy is not running.</p>
          <Link href="/quant-strategy" className="text-lexa-accent text-sm underline">Start it on the Quant Strategy page</Link>
        </div>
      )}
    </div>
  )
}

// ─── Tab: Copy Trading ────────────────────────────────────────────────────────

function CopyTab({ copy }: { copy: DashboardData['copyTrading'] }) {
  const activeSubs = copy.subscriptions.filter((s) => s.enabled)
  const totalCopied = copy.history.filter((h) => h.status === 'executed').length
  const totalFailed = copy.history.filter((h) => h.status === 'failed').length
  const totalSpent = copy.history
    .filter((h) => h.status === 'executed')
    .reduce((s, h) => s + (h.amountUsd ?? 0), 0)

  if (activeSubs.length === 0 && copy.history.length === 0) {
    return (
      <div className="text-center py-16 text-gray-600">
        <p className="text-3xl mb-3">👥</p>
        <p className="text-sm mb-3">No copy trading subscriptions yet.</p>
        <Link href="/copy-trading" className="text-lexa-accent text-sm underline">Start copying a trader</Link>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Summary */}
      <Card>
        <div className="flex flex-wrap gap-6 justify-around">
          <StatPill label="Active Subs" value={String(activeSubs.length)} />
          <StatPill label="Trades Copied" value={String(totalCopied)} color="text-green-400" />
          <StatPill label="Failed" value={String(totalFailed)} color={totalFailed > 0 ? 'text-red-400' : 'text-gray-400'} />
          <StatPill label="Total Deployed" value={fmtUsd(totalSpent)} />
          <StatPill label="Success Rate" value={totalCopied + totalFailed > 0 ? `${((totalCopied / (totalCopied + totalFailed)) * 100).toFixed(0)}%` : '—'} color="text-green-400" />
        </div>
      </Card>

      {/* Active subscriptions */}
      {activeSubs.length > 0 && (
        <Card>
          <SectionTitle>Active Subscriptions</SectionTitle>
          <div className="space-y-3">
            {activeSubs.map((sub) => {
              const stats = copy.leaderStats[sub.leaderAddress] ?? { executed: 0, failed: 0, skipped: 0, totalUsd: 0 }
              return (
                <div key={sub.id} className="rounded-xl border border-lexa-border bg-black/20 px-4 py-3">
                  <div className="flex items-start justify-between flex-wrap gap-2">
                    <div>
                      <p className="font-mono text-xs text-white">{sub.leaderAddress}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        {fmtUsd(sub.orderSizeUsd)}/trade
                        {sub.maxTradeUsd != null && ` · max ${fmtUsd(sub.maxTradeUsd)}`}
                        {sub.copySells && ' · copies sells'}
                        {' · since '}{fmtDt(sub.createdAt, true)}
                      </p>
                    </div>
                    <Link href="/copy-trading" className="text-xs text-lexa-accent hover:underline">Manage →</Link>
                  </div>
                  <div className="flex gap-4 mt-2 pt-2 border-t border-lexa-border/40">
                    <StatPill label="Executed" value={String(stats.executed)} color="text-green-400" />
                    <StatPill label="Failed" value={String(stats.failed)} color={stats.failed > 0 ? 'text-red-400' : 'text-gray-500'} />
                    <StatPill label="Deployed" value={fmtUsd(stats.totalUsd)} />
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* Matched positions table */}
      {copy.history.length > 0 && (
        <Card>
          <SectionTitle>Copy Positions ({matchCopyTrades(copy.history).length} markets · {copy.history.filter(h => h.status === 'executed').length} executed trades)</SectionTitle>
          <MatchedPositionsTable positions={matchCopyTrades(copy.history)} />
        </Card>
      )}
    </div>
  )
}

// ─── Matched copy positions table ────────────────────────────────────────────

function MatchedPositionsTable({ positions }: { positions: MatchedPosition[] }) {
  if (positions.length === 0) return <p className="text-xs text-gray-600 py-3">No executed copy trades yet.</p>

  const realizedPnl = positions.filter(p => p.status === 'closed').reduce((s, p) => s + (p.pnlUsd ?? 0), 0)
  const totalDeployed = positions.reduce((s, p) => s + p.entryValue, 0)

  return (
    <>
      <div className="flex gap-5 mb-3 pb-3 border-b border-lexa-border flex-wrap">
        <div><p className="text-[10px] text-gray-500">Open</p><p className="text-xs font-bold text-white">{positions.filter(p => p.status !== 'closed').length}</p></div>
        <div><p className="text-[10px] text-gray-500">Closed</p><p className="text-xs font-bold text-white">{positions.filter(p => p.status === 'closed').length}</p></div>
        <div><p className="text-[10px] text-gray-500">Deployed</p><p className="text-xs font-bold text-white">{fmtUsd(totalDeployed)}</p></div>
        <div><p className="text-[10px] text-gray-500">Realized PnL</p><p className={`text-xs font-bold ${realizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtUsd(realizedPnl, true)}</p></div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[680px]">
          <thead>
            <tr className="border-b border-lexa-border">
              {['Status', 'Market / Outcome', 'Entry Price', 'Entry Shares', 'Exit Price', 'Exit Shares', 'Open', 'PnL', 'Opened'].map((h) => (
                <th key={h} className={`py-1.5 pr-3 font-semibold uppercase tracking-widest text-gray-500 ${h === 'Market / Outcome' ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.map((p, i) => (
              <tr key={i} className="border-b border-lexa-border/40 hover:bg-white/[0.02]">
                <td className="py-2 pr-3 text-right">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    p.status === 'open' ? 'bg-blue-500/15 text-blue-400'
                      : p.status === 'partial' ? 'bg-yellow-500/15 text-yellow-400'
                      : 'bg-gray-500/15 text-gray-400'
                  }`}>{p.status.toUpperCase()}</span>
                </td>
                <td className="py-2 pr-3 max-w-[160px]">
                  <TxLink url={p.polymarketEventUrl}>{p.marketSlug?.slice(0, 22) ?? p.tokenId.slice(0, 12)}</TxLink>
                  {p.outcome && (
                    <span className={`block text-[9px] font-semibold ${['yes','up'].includes(p.outcome.toLowerCase()) ? 'text-green-400' : 'text-red-400'}`}>{p.outcome}</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-right font-mono">{p.entryPrice != null ? `${(p.entryPrice * 100).toFixed(1)}¢` : '—'}</td>
                <td className="py-2 pr-3 text-right font-mono">
                  {p.entryShares > 0 ? p.entryShares.toFixed(2) : '—'}
                  <span className="block text-[9px] text-gray-600">{fmtUsd(p.entryValue)}</span>
                </td>
                <td className="py-2 pr-3 text-right font-mono">{p.exitPrice != null ? `${(p.exitPrice * 100).toFixed(1)}¢` : '—'}</td>
                <td className="py-2 pr-3 text-right font-mono">
                  {p.exitShares > 0 ? p.exitShares.toFixed(2) : '—'}
                  {p.exitShares > 0 && <span className="block text-[9px] text-gray-600">{fmtUsd(p.exitValue)}</span>}
                </td>
                <td className="py-2 pr-3 text-right font-mono">
                  {p.openShares > 0.001 ? <span className="text-blue-400">{p.openShares.toFixed(2)}</span> : <span className="text-gray-600">—</span>}
                </td>
                <td className={`py-2 pr-3 text-right font-bold ${p.pnlUsd == null ? 'text-gray-600' : p.pnlUsd >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {p.pnlUsd != null ? fmtUsd(p.pnlUsd, true) : '—'}
                </td>
                <td className="py-2 text-right text-gray-500">{fmtDt(p.entryAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ─── Helper row ───────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="text-white font-semibold">{value}</span>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type TabId = 'strategies' | 'quant' | 'copy'

const TABS: { id: TabId; label: string }[] = [
  { id: 'strategies', label: 'Strategies' },
  { id: 'quant', label: 'Quant Strategy' },
  { id: 'copy', label: 'Copy Trading' },
]

export default function DashboardPage() {
  const initOnceRef = useRef(false)
  const [tab, setTab] = useState<TabId>('strategies')
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  const loadDashboard = useCallback(async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('lexa_token') : null
    if (!token) { setLoading(false); return }
    try {
      const d = await apiFetch<DashboardData>('/dashboard')
      setData(d)
      setIsLoggedIn(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (initOnceRef.current) return
    initOnceRef.current = true
    void loadDashboard()
  }, [loadDashboard])

  // Auto-refresh every 30s
  useEffect(() => {
    if (!isLoggedIn) return
    const id = setInterval(() => { void loadDashboard() }, 30_000)
    return () => clearInterval(id)
  }, [isLoggedIn, loadDashboard])

  // ─── Not logged in ──────────────────────────────────────────────────────────
  if (!loading && !isLoggedIn) {
    return (
      <div className="min-h-screen bg-void text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-4">🔒</p>
          <p className="text-white font-semibold mb-2">Connect your wallet to view your dashboard</p>
          <p className="text-sm text-gray-500">Sign in via MetaMask from the sidebar to get started.</p>
        </div>
      </div>
    )
  }

  // ─── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-void text-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-lexa-accent border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Loading dashboard…</p>
        </div>
      </div>
    )
  }

  // ─── Error ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen bg-void text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-2">{error}</p>
          <button onClick={() => { setError(null); setLoading(true); void loadDashboard() }}
            className="text-sm text-lexa-accent underline">Retry</button>
        </div>
      </div>
    )
  }

  if (!data) return null

  // ─── Derived totals ─────────────────────────────────────────────────────────
  const activeStrategies = data.strategies.filter((s) => s.active).length
  const activeEdge = data.edgeTrading.enabled
  const activeCopy = data.copyTrading.subscriptions.filter((s) => s.enabled).length
  const totalOpenPositions = data.strategies.reduce((s, x) => s + x.openCount, 0)
  const totalStrategyPnl = data.strategies.reduce((s, x) => s + (x.pnlUsd ?? 0), 0)
  const totalCopyDeployed = data.copyTrading.history
    .filter((h) => h.status === 'executed')
    .reduce((s, h) => s + (h.amountUsd ?? 0), 0)

  return (
    <div className="min-h-screen bg-void text-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">

        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="mb-6">
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Dashboard
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">Your automated trading mission control</p>
        </div>

        {/* ── Portfolio Overview ────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
          <Card className="col-span-2 sm:col-span-2">
            <p className="text-xs text-gray-500 font-semibold uppercase tracking-widest mb-1">USDC Balance</p>
            <p className="text-2xl font-mono font-bold text-white">
              {data.wallet.usdcBalance != null ? fmtUsd(data.wallet.usdcBalance) : '—'}
            </p>
            <div className="mt-2 space-y-0.5">
              {data.wallet.gaslessAddress && (
                <p className="text-[10px] text-gray-600 font-mono">
                  <span className="text-gray-500">Gasless: </span>{truncAddr(data.wallet.gaslessAddress)}
                </p>
              )}
              {data.wallet.usdcAllowance && Number(data.wallet.usdcAllowance) > 0 && (
                <p className="text-[10px] text-gray-600">
                  <span className="text-gray-500">CTF allowance: </span>{fmtUsd(data.wallet.usdcAllowance)}
                </p>
              )}
            </div>
          </Card>

          <Card>
            <p className="text-xs text-gray-500 font-semibold uppercase tracking-widest mb-1">Open Positions</p>
            <p className="text-2xl font-mono font-bold text-white">{totalOpenPositions}</p>
            <p className="text-[10px] text-gray-600 mt-1">across {data.strategies.length} strateg{data.strategies.length === 1 ? 'y' : 'ies'}</p>
          </Card>

          <Card>
            <p className="text-xs text-gray-500 font-semibold uppercase tracking-widest mb-1">Strategy PnL</p>
            <p className={`text-2xl font-mono font-bold ${pnlCls(totalStrategyPnl)}`}>{fmtUsd(totalStrategyPnl, true)}</p>
            <p className="text-[10px] text-gray-600 mt-1">{activeStrategies} active</p>
          </Card>

          <Card>
            <p className="text-xs text-gray-500 font-semibold uppercase tracking-widest mb-1">Quant Strategy</p>
            <StatusBadge active={activeEdge} label={activeEdge ? 'Live' : 'Off'} />
            <p className="text-[10px] text-gray-600 mt-2">{data.edgeTrading.entries.length} entries</p>
          </Card>

          <Card>
            <p className="text-xs text-gray-500 font-semibold uppercase tracking-widest mb-1">Copy Trading</p>
            <p className="text-2xl font-mono font-bold text-white">{activeCopy}</p>
            <p className="text-[10px] text-gray-600 mt-1">
              {fmtUsd(totalCopyDeployed)} deployed
            </p>
          </Card>
        </div>

        {/* ── System status bar ────────────────────────────────────────────── */}
        <div className="flex gap-3 mb-6 flex-wrap">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold ${activeStrategies > 0 ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-gray-700 bg-gray-800/50 text-gray-500'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${activeStrategies > 0 ? 'bg-green-400' : 'bg-gray-600'}`} />
            {activeStrategies} Strateg{activeStrategies === 1 ? 'y' : 'ies'} Active
          </div>
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold ${activeEdge ? 'border-blue-500/30 bg-blue-500/10 text-blue-400' : 'border-gray-700 bg-gray-800/50 text-gray-500'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${activeEdge ? 'bg-blue-400' : 'bg-gray-600'}`} />
            Quant {activeEdge ? 'Running' : 'Off'}
          </div>
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold ${activeCopy > 0 ? 'border-purple-500/30 bg-purple-500/10 text-purple-400' : 'border-gray-700 bg-gray-800/50 text-gray-500'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${activeCopy > 0 ? 'bg-purple-400' : 'bg-gray-600'}`} />
            {activeCopy} Copy Sub{activeCopy === 1 ? '' : 's'}
          </div>
          <button onClick={() => { setLoading(false); void loadDashboard() }}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-lexa-border text-xs text-gray-400 hover:text-white hover:border-gray-500 transition-colors">
            ↻ Refresh
          </button>
        </div>

        {/* ── Tab Toggle ───────────────────────────────────────────────────── */}
        <div className="flex gap-1.5 p-1 bg-black/30 border border-lexa-border rounded-xl mb-6 w-fit">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-4 py-2 rounded-lg text-xs font-display font-bold uppercase tracking-wide transition-all ${
                tab === id
                  ? 'bg-lexa-gradient text-white shadow-glow-lexa'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {label}
              {id === 'strategies' && activeStrategies > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 text-[9px]">{activeStrategies}</span>
              )}
              {id === 'quant' && activeEdge && (
                <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
              )}
              {id === 'copy' && activeCopy > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-400 text-[9px]">{activeCopy}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Tab Content ──────────────────────────────────────────────────── */}
        {tab === 'strategies' && (
          <StrategiesTab strategies={data.strategies} clobTrades={data.clobTrades} />
        )}
        {tab === 'quant' && (
          <QuantTab edge={data.edgeTrading} />
        )}
        {tab === 'copy' && (
          <CopyTab copy={data.copyTrading} />
        )}

      </div>
    </div>
  )
}
