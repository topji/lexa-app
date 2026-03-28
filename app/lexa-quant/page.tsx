'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@/contexts/WalletContext'

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3100'

// ── Types ────────────────────────────────────────────────────────────────────

type ModelBreakdown = {
  p_up: number
  weight: number
  contribution: number
  [key: string]: unknown
}

type KellyResult = {
  side: string
  raw_kelly_fraction: number
  safe_kelly_fraction: number
  regime_kelly_fraction?: number
  ev_per_dollar: number
  edge: number
  edge_pct: number
  has_edge: boolean
  p_true: number
  market_price: number
  yes_ev: number
  no_ev: number
}

type EvResult = {
  action: string
  ev_gap: number
  edge_pct: number
  confidence: string
  market_mispriced_by: string
  block_reason?: string
}

type FiltersInfo = {
  // 1h engine
  models_agree?: boolean
  model_std?: number
  model_std_threshold?: number
  vol_sufficient?: boolean
  recent_vol?: number
  min_vol_threshold?: number
  regime?: string
  regime_kelly_multiplier?: number
  // 15m engine
  time_ok?: boolean
  spread_ok?: boolean
  spread?: number | null
  minutes_remaining?: number
}

type RegimeInfo = {
  name: string
  adx: number
  vol_ratio: number
  kelly_multiplier: number
  description: string
  weight_adjustments: Record<string, number>
}

type CalibrationInfo = {
  raw: number
  calibrated: number
  slope: number
  intercept: number
}

type AdjustmentsInfo = {
  orderbook: number
  momentum: number
  volume: number
  total: number
}

/** Mirrors backend `PolymarketContextMeta` when `auto_context=1` is used. */
type PolymarketContextMeta = {
  market: string
  slug: string | null
  start_price: number | null
  polymarket_probability_up: number | null
  best_bid_price: number | null
  best_ask_price: number | null
  event_start_time: string | null
  event_end_time: string | null
  sample_ts: string
  minutes_remaining_used: number | null
  spread_used: number | null
}

type QuantSignal = {
  engine: string
  horizon: string
  timestamp: number
  symbol: string
  current_price_usd: number
  start_price?: number | null
  distance_pct?: number
  minutes_remaining?: number | null
  market_price: number
  p_up_raw?: number
  p_up: number
  p_down: number
  p_base?: number
  calibration?: CalibrationInfo
  sigma_remaining?: number
  sigma_1m?: number
  adjustments?: AdjustmentsInfo
  filters?: FiltersInfo
  trade_allowed?: boolean
  regime?: RegimeInfo
  models?: {
    garch: ModelBreakdown & {
      base_weight?: number
      sigma_horizon?: number
      annualized_vol?: number
      persistence?: number
      garch_params?: { omega: number; alpha: number; beta: number; nu: number }
    }
    monte_carlo: ModelBreakdown & {
      base_weight?: number
      expected_price?: number
      expected_return_pct?: number
      percentiles?: Record<string, number>
      var_95?: number
      horizon_hours?: number
      num_paths?: number
    }
    bayesian: ModelBreakdown & {
      base_weight?: number
      prior?: number
      shift?: number
      shift_capped?: boolean
      signals?: Record<string, { value?: number; likelihood_up?: number; likelihood_down?: number; posterior_after?: number; oi_change_pct?: number; price_change_pct?: number }>
    }
    momentum: ModelBreakdown & {
      base_weight?: number
      indicators?: Record<string, { value?: number; p_up?: number; bullish_cross?: boolean; spread_pct?: number; histogram?: number; bullish?: boolean }>
    }
  }
  kelly?: KellyResult
  ev?: EvResult
  data_summary?: {
    funding_rate?: number
    orderbook_imbalance?: number
    best_bid?: number
    best_ask?: number
    open_interest?: number
    long_short_ratio?: number
    oi_change_pct?: number
    price_change_pct?: number
    momentum_3m?: number
    volume_ratio?: number
  }
  horizon_hours?: number
  error?: string
  polymarket_context?: PolymarketContextMeta | null
  context_warning?: string | null
}

// ── API Helpers ──────────────────────────────────────────────────────────────

function getToken(): string | null {
  return typeof window !== 'undefined' ? localStorage.getItem('lexa_token') : null
}

async function api<T>(path: string): Promise<T> {
  const token = getToken()
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try { const d = await res.json(); if (d?.error) message = d.error } catch { /* */ }
    throw new Error(message)
  }
  return (await res.json()) as T
}

// ── Formatters ───────────────────────────────────────────────────────────────

const fmtPct = (n: number | null | undefined, dp = 1): string =>
  n != null && Number.isFinite(n) ? `${(n * 100).toFixed(dp)}%` : '--'

const fmtPp = (n: number | null | undefined): string =>
  n != null && Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)} pp` : '--'

const fmtUsd = (n: number | null | undefined): string =>
  n != null && Number.isFinite(n) ? `$${n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toFixed(2)}` : '--'

const fmtNum = (n: number | null | undefined, dp = 4): string =>
  n != null && Number.isFinite(n) ? n.toFixed(dp) : '--'

const fmtTime = (ts: number | null | undefined): string => {
  if (!ts) return '--'
  const d = new Date(ts * 1000)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ── Components ───────────────────────────────────────────────────────────────

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-lexa-border bg-lexa-glass p-5 card-glow ${className}`}>
      {children}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="font-display text-xs font-semibold uppercase tracking-widest text-lexa-accent mb-3">{children}</h3>
}

function Stat({ label, value, sub, color = 'text-white' }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">{label}</p>
      <p className={`text-xl font-mono font-bold ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}

function ProbBar({ pUp, label }: { pUp: number; label: string }) {
  const pct = Math.max(2, Math.min(98, pUp * 100))
  const isUp = pUp >= 0.5
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className={`font-mono font-semibold ${isUp ? 'text-neon-green' : 'text-neon-red'}`}>
          {(pUp * 100).toFixed(1)}%
        </span>
      </div>
      <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${isUp ? 'bg-gradient-to-r from-neon-green/60 to-neon-green' : 'bg-gradient-to-r from-neon-red/60 to-neon-red'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function SignalBadge({ action, confidence }: { action: string; confidence: string }) {
  const colorMap: Record<string, string> = {
    BUY_YES: 'bg-neon-green/15 text-neon-green border-neon-green/40',
    BUY_NO: 'bg-neon-red/15 text-neon-red border-neon-red/40',
    NO_TRADE: 'bg-gray-700/40 text-gray-400 border-gray-600/40',
  }
  const confColor: Record<string, string> = {
    high: 'text-neon-green',
    medium: 'text-yellow-400',
    low: 'text-gray-500',
    blocked: 'text-neon-red',
  }
  return (
    <div className="flex items-center gap-2">
      <span className={`px-3 py-1 rounded-lg text-sm font-display font-bold border ${colorMap[action] ?? colorMap.NO_TRADE}`}>
        {action.replace('_', ' ')}
      </span>
      <span className={`text-xs font-semibold uppercase ${confColor[confidence] ?? 'text-gray-500'}`}>
        {confidence}
      </span>
    </div>
  )
}

function ModelCard({ name, icon, model, pUp }: { name: string; icon: string; model: ModelBreakdown; pUp: number }) {
  const isUp = pUp >= 0.5
  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <div>
            <p className="text-sm font-display font-bold text-white">{name}</p>
            <p className="text-[10px] text-gray-500">Weight: {(model.weight * 100).toFixed(0)}%</p>
          </div>
        </div>
        <span className={`text-xl font-mono font-bold ${isUp ? 'text-neon-green' : 'text-neon-red'}`}>
          {(pUp * 100).toFixed(1)}%
        </span>
      </div>
      <ProbBar pUp={pUp} label="P(Up)" />
    </Card>
  )
}

function HorizonToggle({ horizon, onChange }: { horizon: '15m' | '1h'; onChange: (h: '15m' | '1h') => void }) {
  return (
    <div className="flex rounded-lg border border-lexa-border bg-black/40 p-0.5">
      {(['15m', '1h'] as const).map((h) => (
        <button
          key={h}
          onClick={() => onChange(h)}
          className={`px-4 py-1.5 rounded-md text-xs font-display font-bold uppercase tracking-wider transition-all ${
            horizon === h
              ? 'bg-lexa-accent/20 text-lexa-accent border border-lexa-accent/40'
              : 'text-gray-500 hover:text-gray-300 border border-transparent'
          }`}
        >
          {h}
        </button>
      ))}
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function LexaQuantPage() {
  const { address: walletAddress } = useWallet()
  const [signal, setSignal] = useState<QuantSignal | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [contextWarning, setContextWarning] = useState<string | null>(null)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [horizon, setHorizon] = useState<'15m' | '1h'>('1h')
  const [marketPriceInput, setMarketPriceInput] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchSignal = useCallback(async (h?: '15m' | '1h') => {
    try {
      const activeHorizon = h ?? horizon
      const params = new URLSearchParams()
      params.set('horizon', activeHorizon)
      params.set('auto_context', '1')
      const raw = marketPriceInput.trim()
      if (raw) {
        let v = parseFloat(raw.replace(',', '.'))
        if (Number.isFinite(v)) {
          if (v > 1) v = v / 100
          if (v > 0 && v < 1) params.set('market_price', String(v))
        }
      }
      const data = await api<QuantSignal>(`/quant/signal/btc?${params.toString()}`)
      setContextWarning(data.context_warning ?? null)
      setSignal(data)
      if (data.error) {
        setError(typeof data.error === 'string' ? data.error : 'Engine error')
      } else {
        setError(null)
        setLastUpdate(new Date())
      }
    } catch (e) {
      setContextWarning(null)
      if (e instanceof Error && e.message.includes('401')) {
        setIsLoggedIn(false)
      } else if (e instanceof Error && (e.message.includes('503') || e.message.includes('502'))) {
        setError('Quant engine offline. Start it: cd quant-backend && python main.py')
      } else {
        setError(e instanceof Error ? e.message : 'Failed to fetch signal')
      }
    } finally {
      setLoading(false)
    }
  }, [horizon, marketPriceInput])

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); setIsLoggedIn(false); return }
    setIsLoggedIn(true)
    void fetchSignal()
    const ms = horizon === '15m' ? 5000 : 15000
    pollRef.current = setInterval(() => void fetchSignal(), ms)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [horizon, fetchSignal])

  const handleHorizonChange = (h: '15m' | '1h') => {
    setHorizon(h)
    setSignal(null)
    setLoading(true)
    void fetchSignal(h)
  }

  if (!isLoggedIn) {
    return (
      <div className="p-6 lg:p-10">
        <h1 className="font-display text-2xl font-bold text-white mb-2">Lexa Quant</h1>
        <p className="text-gray-400 mb-4">Dual-engine signal system for BTC Polymarket.</p>
        <Card className="text-center text-gray-400 py-12 space-y-3 px-4">
          {walletAddress ? (
            <>
              <p>Wallet connected — sign in on Lexa to load signals.</p>
              <p className="text-sm text-gray-500">
                Go to{' '}
                <Link href="/strategies" className="text-lexa-accent underline hover:text-white">
                  Strategies
                </Link>{' '}
                and complete <span className="text-gray-300">Connect MetaMask</span> (one signature).
              </p>
            </>
          ) : (
            <p>Connect your wallet from the sidebar, then sign in on the Strategies page to view signals.</p>
          )}
        </Card>
      </div>
    )
  }

  if (loading && !signal) {
    return (
      <div className="p-6 lg:p-10">
        <h1 className="font-display text-2xl font-bold text-white mb-2">Lexa Quant</h1>
        <Card className="text-center py-12">
          <div className="flex items-center justify-center gap-3 text-gray-400">
            <svg className="animate-spin h-5 w-5 text-lexa-accent" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            Loading {horizon} engine...
          </div>
        </Card>
      </div>
    )
  }

  const s = signal
  const kelly = s?.kelly
  const ev = s?.ev
  const data = s?.data_summary
  const is15m = s?.engine === '15m_analytical'
  const is1h = s?.engine === '1h_quant'
  const garch = s?.models?.garch
  const mc = s?.models?.monte_carlo
  const bayesian = s?.models?.bayesian
  const momentum = s?.models?.momentum

  return (
    <div className="p-6 lg:p-10 space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="font-display text-2xl font-bold text-white">Lexa Quant</h1>
            <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-lexa-accent/15 text-lexa-accent border border-lexa-accent/30">
              V2
            </span>
            <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-neon-green/15 text-neon-green border border-neon-green/30 animate-pulse-glow">
              LIVE
            </span>
          </div>
          <p className="text-gray-400 text-sm">
            {is15m ? 'Analytical boundary crossing engine (1m candles, microstructure)' :
             is1h ? 'GARCH + Monte Carlo + Bayesian + Momentum ensemble' :
             'Dual-engine signal system for BTC Polymarket'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <HorizonToggle horizon={horizon} onChange={handleHorizonChange} />
          <div className="flex items-center gap-2 p-2 rounded-xl border border-lexa-border bg-lexa-glass text-sm">
            <span className="text-[10px] text-gray-500 uppercase shrink-0 hidden sm:inline">Override YES</span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max="0.99"
              placeholder="auto"
              title="Leave empty to use Polymarket YES from worker insights (DB); or enter 0.55 or 55"
              value={marketPriceInput}
              onChange={(e) => setMarketPriceInput(e.target.value)}
              className="w-20 rounded-lg border border-lexa-border bg-void px-2 py-1 text-white text-sm font-mono placeholder-gray-600 focus:outline-none focus:border-lexa-accent"
            />
            <button
              onClick={() => void fetchSignal()}
              className="rounded-lg bg-lexa-accent/20 text-lexa-accent border border-lexa-accent/50 px-3 py-1 text-xs font-semibold hover:bg-lexa-accent/30"
            >
              Refresh
            </button>
          </div>
          {lastUpdate && (
            <span className="text-[10px] text-gray-500">
              {lastUpdate.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {contextWarning && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-200/90 text-sm">
          {contextWarning}
        </div>
      )}

      {s?.polymarket_context && (
        <div className="rounded-xl border border-lexa-border bg-black/30 px-4 py-3 text-xs text-gray-300 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-gray-500 font-semibold uppercase tracking-wider">Polymarket context</span>
          {s.polymarket_context.slug ? (
            <a
              href={`https://polymarket.com/event/${encodeURIComponent(s.polymarket_context.slug)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-lexa-accent hover:underline font-mono"
            >
              {s.polymarket_context.slug.slice(0, 36)}
              {s.polymarket_context.slug.length > 36 ? '…' : ''}
            </a>
          ) : (
            <span className="text-gray-500">— slug</span>
          )}
          <span>
            Start:{' '}
            <span className="text-white font-mono">
              {s.polymarket_context.start_price != null ? fmtUsd(s.polymarket_context.start_price) : '—'}
            </span>
          </span>
          <span>
            YES (Polymarket):{' '}
            <span className="text-white font-mono">
              {s.polymarket_context.polymarket_probability_up != null
                ? `${(s.polymarket_context.polymarket_probability_up * 100).toFixed(1)}%`
                : '—'}
            </span>
          </span>
          {s.polymarket_context.best_bid_price != null && s.polymarket_context.best_ask_price != null && (
            <span className="text-gray-500 font-mono">
              bid {s.polymarket_context.best_bid_price.toFixed(3)} / ask {s.polymarket_context.best_ask_price.toFixed(3)}
            </span>
          )}
          {s.polymarket_context.minutes_remaining_used != null && (
            <span>
              Remaining (used):{' '}
              <span className="text-white font-mono">{s.polymarket_context.minutes_remaining_used.toFixed(1)}m</span>
            </span>
          )}
        </div>
      )}

      {s && !s.error && typeof s.p_up === 'number' && (
        <>
          {/* ── Top Signal Hero ───────────────────────────────────────── */}
          <div className="rounded-2xl border-2 border-lexa-border bg-gradient-to-br from-lexa-glass to-black/40 p-6 card-glow">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-6">
              <Stat label="BTC Price" value={fmtUsd(s.current_price_usd)} />
              {s.start_price != null && (
                <Stat
                  label="Start Price"
                  value={fmtUsd(s.start_price)}
                  sub={`${(s.distance_pct ?? 0) >= 0 ? '+' : ''}${(s.distance_pct ?? 0).toFixed(2)}% away`}
                />
              )}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">P(Up)</p>
                <p className={`text-3xl font-mono font-bold ${s.p_up >= 0.5 ? 'text-neon-green text-glow-green' : 'text-neon-red text-glow-red'}`}>
                  {(s.p_up * 100).toFixed(1)}%
                </p>
                <p className="text-[10px] text-gray-500 mt-0.5">
                  {s.engine === '15m_analytical' ? '15m analytical' : '1h ensemble'}
                </p>
              </div>
              <Stat
                label="Signal"
                value={ev?.action.replace('_', ' ') ?? '--'}
                sub={ev?.confidence ?? ''}
                color={ev?.action === 'BUY_YES' ? 'text-neon-green' : ev?.action === 'BUY_NO' ? 'text-neon-red' : 'text-gray-500'}
              />
              <Stat
                label="Edge"
                value={`${(ev?.edge_pct ?? 0) >= 0 ? '+' : ''}${(ev?.edge_pct ?? 0).toFixed(2)}%`}
                sub={`EV: ${fmtNum(ev?.ev_gap, 4)}`}
                color={kelly?.has_edge ? 'text-lexa-accent' : 'text-gray-500'}
              />
              <Stat
                label="Kelly Fraction"
                value={`${((kelly?.safe_kelly_fraction ?? 0) * 100).toFixed(1)}%`}
                sub={kelly?.regime_kelly_fraction != null && kelly.regime_kelly_fraction !== kelly.safe_kelly_fraction
                  ? `Regime: ${(kelly.regime_kelly_fraction * 100).toFixed(1)}%`
                  : `Raw: ${((kelly?.raw_kelly_fraction ?? 0) * 100).toFixed(1)}%`}
                color="text-lexa-accent"
              />
              {s.minutes_remaining != null && (
                <Stat
                  label="Time Left"
                  value={`${s.minutes_remaining.toFixed(1)}m`}
                  sub={s.horizon === '15m' ? '15min market' : '1hr market'}
                  color={s.minutes_remaining < 2 ? 'text-neon-red' : 'text-white'}
                />
              )}
            </div>

            {/* Main probability bar */}
            <div className="mt-5">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-neon-red font-semibold">DOWN {(s.p_down * 100).toFixed(1)}%</span>
                <span className="text-gray-500 font-mono text-[10px]">
                  P(S_T {'>'} start_price)
                </span>
                <span className="text-neon-green font-semibold">UP {(s.p_up * 100).toFixed(1)}%</span>
              </div>
              <div className="h-3 rounded-full bg-gray-800 overflow-hidden flex">
                <div
                  className="h-full bg-gradient-to-r from-neon-red to-neon-red/60 transition-all duration-700"
                  style={{ width: `${s.p_down * 100}%` }}
                />
                <div
                  className="h-full bg-gradient-to-r from-neon-green/60 to-neon-green transition-all duration-700"
                  style={{ width: `${s.p_up * 100}%` }}
                />
              </div>
            </div>
          </div>

          {/* ── Filters & Status Bar ──────────────────────────────────── */}
          <div className={`grid grid-cols-1 sm:grid-cols-2 ${is1h ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-3`}>
            {/* Trade Gate */}
            <Card className={`${s.trade_allowed !== false ? 'border-neon-green/30' : 'border-neon-red/30'}`}>
              <div className="flex items-center justify-between mb-2">
                <SectionTitle>Trade Gate</SectionTitle>
                <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${s.trade_allowed !== false ? 'bg-neon-green/15 text-neon-green' : 'bg-neon-red/15 text-neon-red'}`}>
                  {s.trade_allowed !== false ? 'OPEN' : 'BLOCKED'}
                </span>
              </div>
              {s.trade_allowed === false && s.ev?.block_reason && (
                <p className="text-xs text-neon-red/80 mt-1">{s.ev.block_reason}</p>
              )}
              {s.trade_allowed !== false && (
                <p className="text-xs text-gray-500">All filters passing</p>
              )}
            </Card>

            {/* 15m: Volatility + Spread */}
            {is15m && (
              <>
                <Card>
                  <SectionTitle>Realized Vol</SectionTitle>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-mono text-white">{((s.sigma_1m ?? 0) * 100).toFixed(4)}%/min</span>
                    <span className={`text-xs font-bold ${s.filters?.vol_sufficient ? 'text-neon-green' : 'text-neon-red'}`}>
                      {s.filters?.vol_sufficient ? 'OK' : 'FLAT'}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-600 mt-1">
                    Horizon vol: {((s.sigma_remaining ?? 0) * 100).toFixed(3)}%
                  </p>
                </Card>

                <Card>
                  <SectionTitle>Microstructure Adj</SectionTitle>
                  {s.adjustments && (
                    <div className="space-y-1.5 text-xs">
                      {Object.entries(s.adjustments).map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between">
                          <span className="text-gray-400 capitalize">{k}</span>
                          <span className={`font-mono font-semibold ${(v as number) > 0 ? 'text-neon-green' : (v as number) < 0 ? 'text-neon-red' : 'text-gray-500'}`}>
                            {(v as number) >= 0 ? '+' : ''}{((v as number) * 100).toFixed(2)} pp
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </>
            )}

            {/* 1h: Model Agreement */}
            {is1h && (
              <Card>
                <SectionTitle>Model Agreement</SectionTitle>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-mono text-white">{((s.filters?.model_std ?? 0) * 100).toFixed(2)}%</span>
                  <span className={`text-xs font-bold ${s.filters?.models_agree ? 'text-neon-green' : 'text-neon-red'}`}>
                    {s.filters?.models_agree ? 'ALIGNED' : 'DIVERGENT'}
                  </span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${s.filters?.models_agree ? 'bg-neon-green' : 'bg-neon-red'}`}
                    style={{ width: `${Math.min(100, ((s.filters?.model_std ?? 0) / (s.filters?.model_std_threshold ?? 0.04)) * 100)}%` }}
                  />
                </div>
                <p className="text-[10px] text-gray-600 mt-1">Threshold: {((s.filters?.model_std_threshold ?? 0.04) * 100).toFixed(1)}%</p>
              </Card>
            )}

            {/* 1h: Volatility Check */}
            {is1h && (
              <Card>
                <SectionTitle>Volatility Filter</SectionTitle>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-mono text-white">{((s.filters?.recent_vol ?? 0) * 100).toFixed(3)}%</span>
                  <span className={`text-xs font-bold ${s.filters?.vol_sufficient ? 'text-neon-green' : 'text-neon-red'}`}>
                    {s.filters?.vol_sufficient ? 'SUFFICIENT' : 'FLAT'}
                  </span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${s.filters?.vol_sufficient ? 'bg-lexa-accent' : 'bg-neon-red'}`}
                    style={{ width: `${Math.min(100, ((s.filters?.recent_vol ?? 0) / (s.filters?.min_vol_threshold ?? 0.0015)) * 50)}%` }}
                  />
                </div>
                <p className="text-[10px] text-gray-600 mt-1">Min: {((s.filters?.min_vol_threshold ?? 0.0015) * 100).toFixed(3)}%/hr</p>
              </Card>
            )}

            {/* 1h: Market Regime */}
            {is1h && (
              <Card>
                <SectionTitle>Market Regime</SectionTitle>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2.5 py-1 rounded-lg text-sm font-display font-bold border ${
                    s.regime?.name === 'TRENDING' ? 'bg-lexa-accent/15 text-lexa-accent border-lexa-accent/30' :
                    s.regime?.name === 'HIGH_VOL' ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' :
                    'bg-gray-700/40 text-gray-400 border-gray-600/30'
                  }`}>
                    {s.regime?.name ?? 'UNKNOWN'}
                  </span>
                </div>
                <p className="text-[10px] text-gray-500">{s.regime?.description ?? ''}</p>
                <div className="flex gap-3 mt-2 text-[10px] text-gray-500">
                  <span>ADX: <span className="text-white font-mono">{(s.regime?.adx ?? 0).toFixed(1)}</span></span>
                  <span>Vol: <span className="text-white font-mono">{(s.regime?.vol_ratio ?? 1).toFixed(2)}x</span></span>
                  <span>Kelly: <span className="text-white font-mono">{(s.regime?.kelly_multiplier ?? 1).toFixed(1)}x</span></span>
                </div>
              </Card>
            )}
          </div>

          {/* ── Calibration Info ─────────────────────────────────────────── */}
          {s.calibration && (
            <Card className="flex flex-wrap items-center gap-4 sm:gap-6 text-sm">
              <span className="text-gray-500 text-xs font-display uppercase tracking-wider">Calibration</span>
              <span className="text-gray-400">Raw: <span className="text-white font-mono">{(s.calibration.raw * 100).toFixed(2)}%</span></span>
              <span className="text-lexa-accent">-{'>'}</span>
              <span className="text-gray-400">Calibrated: <span className="text-white font-mono font-bold">{(s.calibration.calibrated * 100).toFixed(2)}%</span></span>
              <span className="text-gray-600 text-xs">f(p) = {s.calibration.slope}p + {s.calibration.intercept}</span>
              {s.p_base != null && (
                <span className="text-gray-600 text-xs">Base (pre-adj): {(s.p_base * 100).toFixed(2)}%</span>
              )}
            </Card>
          )}

          {/* ── 15m Engine: Boundary Crossing Detail ──────────────────── */}
          {is15m && (
            <Card>
              <SectionTitle>Boundary Crossing Model</SectionTitle>
              <p className="text-xs text-gray-500 mb-4">
                Options-style probability: P(S_T {'>'} start_price) using realized 1-minute volatility scaled to remaining time.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div className="flex justify-between flex-col">
                  <span className="text-gray-400 text-xs">Current</span>
                  <span className="text-white font-mono text-lg">{fmtUsd(s.current_price_usd)}</span>
                </div>
                <div className="flex justify-between flex-col">
                  <span className="text-gray-400 text-xs">Start (threshold)</span>
                  <span className="text-white font-mono text-lg">{fmtUsd(s.start_price)}</span>
                </div>
                <div className="flex justify-between flex-col">
                  <span className="text-gray-400 text-xs">Distance</span>
                  <span className={`font-mono text-lg ${(s.distance_pct ?? 0) >= 0 ? 'text-neon-green' : 'text-neon-red'}`}>
                    {(s.distance_pct ?? 0) >= 0 ? '+' : ''}{(s.distance_pct ?? 0).toFixed(3)}%
                  </span>
                </div>
                <div className="flex justify-between flex-col">
                  <span className="text-gray-400 text-xs">Time Remaining</span>
                  <span className={`font-mono text-lg ${(s.minutes_remaining ?? 0) < 2 ? 'text-neon-red' : 'text-white'}`}>
                    {(s.minutes_remaining ?? 0).toFixed(1)}m
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-lexa-border/50 text-sm">
                <div>
                  <span className="text-gray-500 text-[10px] uppercase tracking-wider">sigma_1m</span>
                  <p className="text-white font-mono">{((s.sigma_1m ?? 0) * 100).toFixed(4)}%</p>
                </div>
                <div>
                  <span className="text-gray-500 text-[10px] uppercase tracking-wider">sigma_remaining</span>
                  <p className="text-white font-mono">{((s.sigma_remaining ?? 0) * 100).toFixed(3)}%</p>
                </div>
                <div>
                  <span className="text-gray-500 text-[10px] uppercase tracking-wider">z-score</span>
                  <p className="text-white font-mono">
                    {s.sigma_remaining && s.start_price && s.current_price_usd
                      ? (Math.log(s.start_price / s.current_price_usd) / s.sigma_remaining).toFixed(3)
                      : '--'}
                  </p>
                </div>
              </div>
            </Card>
          )}

          {/* ── 1h Engine: 4 Model Cards ──────────────────────────────── */}
          {is1h && (
            <div>
              <SectionTitle>Model Breakdown</SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {garch && <ModelCard name="GARCH(1,1)" icon="📈" model={garch} pUp={garch.p_up} />}
                {mc && <ModelCard name="Monte Carlo" icon="🎲" model={mc} pUp={mc.p_up} />}
                {bayesian && <ModelCard name="Bayesian" icon="🧠" model={bayesian} pUp={bayesian.p_up} />}
                {momentum && <ModelCard name="Momentum" icon="⚡" model={momentum} pUp={momentum.p_up} />}
              </div>
            </div>
          )}

          {/* ── Deep Dive: Two Columns (1h only) ──────────────────────── */}
          {is1h && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Left: GARCH + Monte Carlo details */}
              <div className="space-y-4">
                {garch && (
                  <Card>
                    <SectionTitle>GARCH(1,1) Volatility Model</SectionTitle>
                    <p className="text-xs text-gray-500 mb-4">Conditional variance model with Student-t innovations for fat-tail capture.</p>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Horizon Vol</span>
                        <span className="text-white font-mono">{fmtPct(garch.sigma_horizon, 2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Annual Vol</span>
                        <span className="text-white font-mono">{fmtPct(garch.annualized_vol, 1)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Persistence</span>
                        <span className={`font-mono font-semibold ${(garch.persistence ?? 0) > 0.95 ? 'text-yellow-400' : 'text-white'}`}>
                          {fmtNum(garch.persistence, 4)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Tail DoF (v)</span>
                        <span className="text-white font-mono">{fmtNum(garch.garch_params?.nu, 2)}</span>
                      </div>
                    </div>
                    {garch.garch_params && (
                      <div className="mt-3 pt-3 border-t border-lexa-border/50">
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Parameters</p>
                        <div className="flex gap-4 text-xs">
                          <span className="text-gray-400">w={fmtNum(garch.garch_params.omega, 6)}</span>
                          <span className="text-gray-400">a={fmtNum(garch.garch_params.alpha, 4)}</span>
                          <span className="text-gray-400">b={fmtNum(garch.garch_params.beta, 4)}</span>
                        </div>
                      </div>
                    )}
                  </Card>
                )}

                {mc && (
                  <Card>
                    <SectionTitle>Monte Carlo Simulation</SectionTitle>
                    <p className="text-xs text-gray-500 mb-4">
                      {mc.num_paths?.toLocaleString() ?? '10,000'} price paths, Student-t(v={fmtNum(mc.nu as unknown as number, 1)}) innovations, {mc.horizon_hours}h horizon.
                    </p>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Expected Price</span>
                        <span className="text-white font-mono">{fmtUsd(mc.expected_price)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Expected Return</span>
                        <span className={`font-mono font-semibold ${(mc.expected_return_pct ?? 0) >= 0 ? 'text-neon-green' : 'text-neon-red'}`}>
                          {mc.expected_return_pct != null ? `${mc.expected_return_pct >= 0 ? '+' : ''}${mc.expected_return_pct.toFixed(2)}%` : '--'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">VaR (95%)</span>
                        <span className="text-yellow-400 font-mono">{fmtUsd(mc.var_95)}</span>
                      </div>
                    </div>
                    {mc.percentiles && (
                      <div className="mt-3 pt-3 border-t border-lexa-border/50">
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Price Distribution</p>
                        <div className="space-y-1.5">
                          {(['p5', 'p25', 'p50', 'p75', 'p95'] as const).map((pk) => {
                            const val = mc.percentiles?.[pk]
                            const pctLabel = pk.replace('p', '')
                            const width = val && s.current_price_usd
                              ? Math.max(5, Math.min(95, ((val / s.current_price_usd) * 50)))
                              : 50
                            return (
                              <div key={pk} className="flex items-center gap-2 text-xs">
                                <span className="text-gray-500 w-8 text-right">{pctLabel}th</span>
                                <div className="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                                  <div
                                    className="h-full rounded-full bg-lexa-accent/50 transition-all duration-500"
                                    style={{ width: `${width}%` }}
                                  />
                                </div>
                                <span className="text-white font-mono w-24 text-right">{fmtUsd(val)}</span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </Card>
                )}
              </div>

              {/* Right: Bayesian + Momentum + Market Data */}
              <div className="space-y-4">
                {bayesian && (
                  <Card>
                    <SectionTitle>Bayesian Updater</SectionTitle>
                    <p className="text-xs text-gray-500 mb-4">
                      Prior from MC, updated with funding rate, orderbook, L/S ratio, OI trend.
                      {bayesian.shift_capped && <span className="text-yellow-400 ml-1">(shift capped at ±10pp)</span>}
                    </p>
                    <div className="flex items-center gap-4 mb-3 text-sm">
                      <div>
                        <span className="text-gray-500 text-xs">Prior</span>
                        <p className="text-white font-mono">{fmtPct(bayesian.prior)}</p>
                      </div>
                      <span className="text-gray-600 text-lg">-{'>'}</span>
                      <div>
                        <span className="text-gray-500 text-xs">Posterior</span>
                        <p className={`font-mono font-bold ${bayesian.p_up >= 0.5 ? 'text-neon-green' : 'text-neon-red'}`}>
                          {fmtPct(bayesian.p_up)}
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-500 text-xs">Shift</span>
                        <p className={`font-mono text-sm ${(bayesian.shift ?? 0) >= 0 ? 'text-neon-green' : 'text-neon-red'}`}>
                          {fmtPp(bayesian.shift)}
                        </p>
                      </div>
                    </div>

                    {bayesian.signals && (
                      <div className="space-y-2">
                        {Object.entries(bayesian.signals).map(([name, sig]) => (
                          <div key={name} className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2 text-xs">
                            <span className="text-gray-400 capitalize">{name.replace('_', ' ')}</span>
                            <div className="flex items-center gap-3">
                              {sig.value != null && (
                                <span className="text-gray-500 font-mono">{typeof sig.value === 'number' ? sig.value.toFixed(4) : String(sig.value)}</span>
                              )}
                              {sig.oi_change_pct != null && (
                                <span className="text-gray-500 font-mono">OI: {sig.oi_change_pct.toFixed(1)}%</span>
                              )}
                              <span className={`font-mono font-semibold ${(sig.posterior_after ?? 0.5) >= 0.5 ? 'text-neon-green' : 'text-neon-red'}`}>
                                {sig.posterior_after != null ? `${(sig.posterior_after * 100).toFixed(1)}%` : '--'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                )}

                {momentum && momentum.indicators && (
                  <Card>
                    <SectionTitle>Momentum Indicators</SectionTitle>
                    <p className="text-xs text-gray-500 mb-4">RSI, MACD, EMA crossover, ROC, volume-weighted momentum.</p>
                    <div className="space-y-2">
                      {Object.entries(momentum.indicators).map(([name, ind]) => {
                        const pUp = ind.p_up ?? 0.5
                        const isUp = pUp >= 0.5
                        return (
                          <div key={name} className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-400 capitalize w-28">{name.replace('_', ' ')}</span>
                              {ind.value != null && (
                                <span className="text-xs text-gray-500 font-mono">{typeof ind.value === 'number' ? ind.value.toFixed(2) : String(ind.value)}</span>
                              )}
                              {ind.bullish_cross != null && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${ind.bullish_cross ? 'bg-neon-green/15 text-neon-green' : 'bg-neon-red/15 text-neon-red'}`}>
                                  {ind.bullish_cross ? 'BULL' : 'BEAR'}
                                </span>
                              )}
                              {ind.bullish != null && name === 'macd' && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${ind.bullish ? 'bg-neon-green/15 text-neon-green' : 'bg-neon-red/15 text-neon-red'}`}>
                                  {ind.bullish ? 'BULL' : 'BEAR'}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${isUp ? 'bg-neon-green' : 'bg-neon-red'}`}
                                  style={{ width: `${pUp * 100}%` }}
                                />
                              </div>
                              <span className={`text-xs font-mono font-semibold w-12 text-right ${isUp ? 'text-neon-green' : 'text-neon-red'}`}>
                                {(pUp * 100).toFixed(0)}%
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </Card>
                )}
              </div>
            </div>
          )}

          {/* ── Market Microstructure (both engines) ──────────────────── */}
          {data && (
            <Card>
              <SectionTitle>Market Microstructure</SectionTitle>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
                {data.orderbook_imbalance != null && (
                  <div className="flex flex-col">
                    <span className="text-gray-400 text-xs">OB Imbalance</span>
                    <span className={`font-mono ${data.orderbook_imbalance > 0 ? 'text-neon-green' : data.orderbook_imbalance < 0 ? 'text-neon-red' : 'text-gray-400'}`}>
                      {(data.orderbook_imbalance * 100).toFixed(1)}%
                    </span>
                  </div>
                )}
                {data.best_bid != null && (
                  <div className="flex flex-col">
                    <span className="text-gray-400 text-xs">Best Bid</span>
                    <span className="text-white font-mono">{fmtUsd(data.best_bid)}</span>
                  </div>
                )}
                {data.best_ask != null && (
                  <div className="flex flex-col">
                    <span className="text-gray-400 text-xs">Best Ask</span>
                    <span className="text-white font-mono">{fmtUsd(data.best_ask)}</span>
                  </div>
                )}
                {data.funding_rate != null && (
                  <div className="flex flex-col">
                    <span className="text-gray-400 text-xs">Funding Rate</span>
                    <span className={`font-mono ${data.funding_rate > 0 ? 'text-neon-green' : data.funding_rate < 0 ? 'text-neon-red' : 'text-gray-400'}`}>
                      {data.funding_rate.toFixed(6)}
                    </span>
                  </div>
                )}
                {data.open_interest != null && data.open_interest > 0 && (
                  <div className="flex flex-col">
                    <span className="text-gray-400 text-xs">Open Interest</span>
                    <span className="text-white font-mono">{data.open_interest.toLocaleString()}</span>
                  </div>
                )}
                {data.long_short_ratio != null && data.long_short_ratio > 0 && (
                  <div className="flex flex-col">
                    <span className="text-gray-400 text-xs">L/S Ratio</span>
                    <span className={`font-mono ${data.long_short_ratio > 1.2 ? 'text-neon-green' : data.long_short_ratio < 0.8 ? 'text-neon-red' : 'text-gray-400'}`}>
                      {data.long_short_ratio.toFixed(2)}
                    </span>
                  </div>
                )}
                {is15m && data.momentum_3m != null && (
                  <div className="flex flex-col">
                    <span className="text-gray-400 text-xs">Momentum 3m</span>
                    <span className={`font-mono ${data.momentum_3m > 0 ? 'text-neon-green' : data.momentum_3m < 0 ? 'text-neon-red' : 'text-gray-400'}`}>
                      {(data.momentum_3m * 100).toFixed(3)}%
                    </span>
                  </div>
                )}
                {is15m && data.volume_ratio != null && (
                  <div className="flex flex-col">
                    <span className="text-gray-400 text-xs">Vol Ratio</span>
                    <span className={`font-mono ${data.volume_ratio > 1.5 ? 'text-yellow-400' : 'text-white'}`}>
                      {data.volume_ratio.toFixed(2)}x
                    </span>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* ── Kelly + EV Detail Row ─────────────────────────────────── */}
          {kelly && ev && (
            <div>
              <SectionTitle>Position Sizing &amp; Expected Value</SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Card>
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-display font-bold text-white text-sm">Kelly Criterion</h4>
                    <SignalBadge action={ev.action} confidence={ev.confidence} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Side</span>
                      <span className={`font-semibold ${kelly.side === 'YES' ? 'text-neon-green' : kelly.side === 'NO' ? 'text-neon-red' : 'text-gray-500'}`}>
                        {kelly.side}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Has Edge</span>
                      <span className={kelly.has_edge ? 'text-neon-green font-bold' : 'text-gray-500'}>
                        {kelly.has_edge ? 'YES' : 'NO'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">1/4 Kelly</span>
                      <span className="text-lexa-accent font-mono font-bold">{(kelly.safe_kelly_fraction * 100).toFixed(2)}%</span>
                    </div>
                    {kelly.regime_kelly_fraction != null && kelly.regime_kelly_fraction !== kelly.safe_kelly_fraction && (
                      <div className="flex justify-between">
                        <span className="text-gray-400">Regime-Adj</span>
                        <span className="text-yellow-400 font-mono font-bold">{(kelly.regime_kelly_fraction * 100).toFixed(2)}%</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-400">Full Kelly</span>
                      <span className="text-gray-300 font-mono">{(kelly.raw_kelly_fraction * 100).toFixed(2)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">P(True)</span>
                      <span className="text-white font-mono">{(kelly.p_true * 100).toFixed(2)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Market</span>
                      <span className="text-white font-mono">{(kelly.market_price * 100).toFixed(2)}%</span>
                    </div>
                  </div>
                </Card>

                <Card>
                  <h4 className="font-display font-bold text-white text-sm mb-4">Expected Value Analysis</h4>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">EV Gap</span>
                      <span className={`font-mono font-bold ${(ev.ev_gap ?? 0) > 0 ? 'text-neon-green' : 'text-gray-500'}`}>
                        {ev.ev_gap > 0 ? '+' : ''}{(ev.ev_gap * 100).toFixed(2)}c / $1
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Edge</span>
                      <span className={`font-mono ${ev.edge_pct > 5 ? 'text-neon-green' : ev.edge_pct > 0 ? 'text-yellow-400' : 'text-gray-500'}`}>
                        {ev.edge_pct >= 0 ? '+' : ''}{ev.edge_pct.toFixed(2)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Mispricing</span>
                      <span className="text-lexa-accent font-mono">{ev.market_mispriced_by}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">YES EV</span>
                      <span className={`font-mono ${kelly.yes_ev > 0 ? 'text-neon-green' : 'text-neon-red'}`}>
                        {kelly.yes_ev >= 0 ? '+' : ''}{(kelly.yes_ev * 100).toFixed(2)}c
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">NO EV</span>
                      <span className={`font-mono ${kelly.no_ev > 0 ? 'text-neon-green' : 'text-neon-red'}`}>
                        {kelly.no_ev >= 0 ? '+' : ''}{(kelly.no_ev * 100).toFixed(2)}c
                      </span>
                    </div>
                  </div>

                  {/* Visual EV comparison */}
                  <div className="mt-4 pt-3 border-t border-lexa-border/50">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">EV Comparison</p>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-neon-green w-8">YES</span>
                        <div className="flex-1 h-2 rounded-full bg-gray-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${kelly.yes_ev > 0 ? 'bg-neon-green' : 'bg-neon-red/40'}`}
                            style={{ width: `${Math.max(2, Math.min(98, 50 + kelly.yes_ev * 200))}%` }}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-neon-red w-8">NO</span>
                        <div className="flex-1 h-2 rounded-full bg-gray-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${kelly.no_ev > 0 ? 'bg-neon-green' : 'bg-neon-red/40'}`}
                            style={{ width: `${Math.max(2, Math.min(98, 50 + kelly.no_ev * 200))}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          )}

          {/* ── Ensemble Weight Visualization (1h only) ────────────────── */}
          {is1h && garch && mc && bayesian && momentum && (
            <Card>
              <SectionTitle>Ensemble Contribution</SectionTitle>
              <div className="flex items-end gap-3 h-32">
                {([
                  { name: 'GARCH', w: garch.weight, p: garch.p_up, c: garch.contribution },
                  { name: 'Monte Carlo', w: mc.weight, p: mc.p_up, c: mc.contribution },
                  { name: 'Bayesian', w: bayesian.weight, p: bayesian.p_up, c: bayesian.contribution },
                  { name: 'Momentum', w: momentum.weight, p: momentum.p_up, c: momentum.contribution },
                ]).map((m) => {
                  const heightPct = Math.max(10, m.c / 0.5 * 100)
                  const isUp = m.p >= 0.5
                  return (
                    <div key={m.name} className="flex-1 flex flex-col items-center gap-1">
                      <span className={`text-xs font-mono font-bold ${isUp ? 'text-neon-green' : 'text-neon-red'}`}>
                        {(m.p * 100).toFixed(0)}%
                      </span>
                      <div className="w-full flex justify-center">
                        <div
                          className={`w-10 rounded-t-lg transition-all duration-700 ${isUp ? 'bg-gradient-to-t from-neon-green/30 to-neon-green/80' : 'bg-gradient-to-t from-neon-red/30 to-neon-red/80'}`}
                          style={{ height: `${heightPct}%`, minHeight: '12px' }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-500 text-center leading-tight">{m.name}</span>
                      <span className="text-[10px] text-gray-600 font-mono">{(m.w * 100).toFixed(0)}%w</span>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {/* ── Footer: Engine info ───────────────────────────────────── */}
          <div className="flex items-center justify-between text-[10px] text-gray-600 px-1">
            <span>
              {is15m
                ? 'Analytical boundary crossing (1m candles, microstructure adjustments)'
                : 'GARCH(1,1) + Monte Carlo (10K paths, Student-t) + Bayesian (4 signals, ±10pp cap) + Momentum (5 indicators)'}
            </span>
            <span>Data: Binance | Refresh: {is15m ? '5s' : '15s'}</span>
          </div>
        </>
      )}
    </div>
  )
}
