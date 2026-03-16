'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
    }
  }
}

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3100'

type Strategy = {
  id: number
  user_id: number
  wallet_id: number
  name: string
  market: string
  active: boolean
  entry_side: 'up' | 'down'
  entry_odd_max: string | null
  entry_seconds_to_expiry_min: number
  entry_odd_change_window_s: number | null
  entry_odd_change_min: string | null
  entry_odd_change_pct_min: string | null
  exit_stop_loss: string | null
  exit_stop_loss_pct: string | null
  exit_seconds_to_expiry_max: number
  exit_profit_odd: string | null
  exit_profit_pct: string | null
  order_size_usd: string
}

type Position = {
  id: number
  strategy_id: number
  market: string
  expiry_ts: string
  side: 'up' | 'down'
  entry_sample_ts: string | null
  entry_odd: string | null
  entry_shares: string | null
  exit_sample_ts: string | null
  exit_odd: string | null
  status: string
  exit_reason: string | null
  outcome?: 'open' | 'won' | 'lost' | 'closed'
}

const EDGE_MARKET_OPTIONS = ['btc-15m', 'btc-1h', 'eth-15m', 'eth-1h', 'sol-15m', 'sol-1h'] as const
type EdgeStatus = { enabled: boolean; orderSizeUsd: number | null; lastEnteredSlug: string | null; lastEnteredAt: string | null; markets: string[] | null }
type EdgeEntry = { slug: string; market: string | null; side: string | null; orderSizeUsd: number | null; enteredAt: string; polymarketEventUrl: string }
type ClobTrade = { id: number; tradeId: string; side: string | null; price: number | null; size: number | null; amountUsd: number | null; tradeTimestamp: string | null; marketSlug: string | null; polymarketEventUrl: string | null }

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('lexa_token') : null
  const hasBody = options?.body != null
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {}),
    },
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

export default function StrategiesPage() {
  const initOnceRef = useRef(false)
  const [userId, setUserId] = useState<number | null>(null)
  const [walletId, setWalletId] = useState<number | null>(null)
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [gaslessAddress, setGaslessAddress] = useState<string | null>(null)
  const [gaslessLoading, setGaslessLoading] = useState(false)
  const [gaslessError, setGaslessError] = useState<string | null>(null)
  const [walletUsdc, setWalletUsdc] = useState<number | null>(null)
  const [walletAllowanceUsdc, setWalletAllowanceUsdc] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [selectedStrategyId, setSelectedStrategyId] = useState<number | null>(null)
  const [positions, setPositions] = useState<Position[]>([])
  const [creating, setCreating] = useState(false)
  const [savingStrategyId, setSavingStrategyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [approveAmount, setApproveAmount] = useState(50)
  const [approving, setApproving] = useState(false)
  const [approveTxHash, setApproveTxHash] = useState<string | null>(null)
  const [withdrawTo, setWithdrawTo] = useState('')
  const [withdrawAmount, setWithdrawAmount] = useState(10)
  const [withdrawing, setWithdrawing] = useState(false)
  const [withdrawTxHash, setWithdrawTxHash] = useState<string | null>(null)
  const [exportKeyLoading, setExportKeyLoading] = useState(false)
  const [revealedKey, setRevealedKey] = useState<{ privateKey: string; address: string; warning: string } | null>(null)
  const [edgeStatus, setEdgeStatus] = useState<EdgeStatus | null>(null)
  const [edgeEntries, setEdgeEntries] = useState<EdgeEntry[]>([])
  const [edgeModalOpen, setEdgeModalOpen] = useState(false)
  const [edgeOrderSizeInput, setEdgeOrderSizeInput] = useState('')
  const [edgeSelectedMarkets, setEdgeSelectedMarkets] = useState<string[]>(() => [...EDGE_MARKET_OPTIONS])
  const [edgeActionLoading, setEdgeActionLoading] = useState(false)
  const [clobTrades, setClobTrades] = useState<ClobTrade[]>([])
  const [clobOrders, setClobOrders] = useState<Record<string, unknown>[]>([])
  const [clobLoading, setClobLoading] = useState(false)

  const refreshBalance = async () => {
    if (!walletId) return
    try {
      const { collateral } = await api<{ collateral: { balance: string; allowance?: string } }>(`/wallets/${walletId}/balance`)
      setWalletUsdc(Number(collateral.balance) || null)
      setWalletAllowanceUsdc(collateral.allowance != null ? Number(collateral.allowance) : null)
    } catch {
      // ignore
    }
  }

  const fetchEdgeStatus = async () => {
    try {
      const data = await api<EdgeStatus>('/edge-trading/status')
      setEdgeStatus(data)
    } catch {
      setEdgeStatus(null)
    }
  }
  const fetchEdgeEntries = async () => {
    try {
      const { entries } = await api<{ entries: EdgeEntry[] }>('/edge-trading/entries?limit=20')
      setEdgeEntries(entries ?? [])
    } catch {
      setEdgeEntries([])
    }
  }
  const fetchClobData = async () => {
    setClobLoading(true)
    try {
      const [tradesRes, ordersRes] = await Promise.all([
        api<{ trades: ClobTrade[] }>('/clob/trades?limit=50').catch(() => ({ trades: [] })),
        api<{ orders: Record<string, unknown>[] }>('/clob/orders').catch(() => ({ orders: [] })),
      ])
      setClobTrades(tradesRes.trades ?? [])
      setClobOrders(ordersRes.orders ?? [])
    } catch {
      setClobTrades([])
      setClobOrders([])
    } finally {
      setClobLoading(false)
    }
  }

  const ensureGaslessWallet = async (wid: number): Promise<string | null> => {
    setGaslessError(null)
    setGaslessLoading(true)
    try {
      const { proxyAddress } = await api<{ ok: boolean; proxyAddress: string }>(`/wallets/${wid}/deploy-gasless`, {
        method: 'POST',
      })
      if (proxyAddress) setGaslessAddress(proxyAddress)
      else setGaslessError('Gasless wallet address not returned. Try again.')
      return proxyAddress ?? null
    } catch (e) {
      setGaslessError(e instanceof Error ? e.message : 'Failed to deploy gasless wallet')
      return null
    } finally {
      setGaslessLoading(false)
    }
  }

  const [form, setForm] = useState({
    name: '',
    market: 'btc-5m',
    entrySide: 'up' as 'up' | 'down',
    entryOddMax: 0.2,
    entrySecondsToExpiryMin: 200,
    entryOddChangeWindowS: 3,
    entryOddChangeMin: null as number | null,
    entryOddChangePctMin: -25 as number | null,
    exitStopLoss: null as number | null,
    exitStopLossPct: 60 as number | null,
    exitSecondsToExpiryMax: 75,
    exitProfitOdd: null as number | null,
    exitProfitPct: 100 as number | null,
    orderSizeUsd: 10,
  })

  useEffect(() => {
    if (initOnceRef.current) return
    initOnceRef.current = true

    const init = async () => {
      try {
        setError(null)
        const token = localStorage.getItem('lexa_token')
        if (!token) {
          setLoading(false)
          return
        }

        // Hydrate session from backend (source of truth), not localStorage IDs.
        const me = await api<{
          userId: number
          walletId: number
          address: string
          walletAddress: string
          gaslessAddress: string | null
        }>('/auth/me')

        setUserId(me.userId)
        setWalletId(me.walletId)
        setWalletAddress(me.walletAddress)
        setGaslessAddress(me.gaslessAddress)
        setIsLoggedIn(true)

        const { strategies } = await api<{ strategies: Strategy[] }>(`/users/${me.userId}/strategies`)
        setStrategies(strategies)
        if (strategies.length > 0) setSelectedStrategyId(strategies[0].id)

        // Ensure gasless wallet exists and is shown as the funding target by default.
        await ensureGaslessWallet(me.walletId)

        const { collateral } = await api<{ collateral: { balance: string; allowance?: string } }>(`/wallets/${me.walletId}/balance`)
        const bal = Number(collateral.balance)
        const allow = collateral.allowance != null ? Number(collateral.allowance) : null
        setWalletUsdc(Number.isFinite(bal) ? bal : null)
        setWalletAllowanceUsdc(allow != null && Number.isFinite(allow) ? allow : null)
        await Promise.all([fetchEdgeStatus(), fetchEdgeEntries(), fetchClobData()])
      } catch (e) {
        // If 401, clear token
        if (e instanceof Error && e.message.includes('401')) {
          localStorage.removeItem('lexa_token')
          localStorage.removeItem('lexa_user_id')
          localStorage.removeItem('lexa_wallet_id')
          localStorage.removeItem('lexa_wallet_address')
        }
        setError(e instanceof Error ? e.message : 'Failed to initialize')
      } finally {
        setLoading(false)
      }
    }

    void init()
  }, [])

  useEffect(() => {
    if (!selectedStrategyId) {
      setPositions([])
      return
    }
    const load = async () => {
      try {
        const { positions } = await api<{ positions: Position[] }>(
          `/strategies/${selectedStrategyId}/positions?limit=20`
        )
        setPositions(positions)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load positions')
      }
    }
    void load()
  }, [selectedStrategyId])

  // Auto-refresh positions every 15s so executed trades show up
  useEffect(() => {
    if (!selectedStrategyId) return
    const interval = setInterval(async () => {
      try {
        const { positions: next } = await api<{ positions: Position[] }>(
          `/strategies/${selectedStrategyId}/positions?limit=20`
        )
        setPositions(next)
      } catch {
        // ignore
      }
    }, 15_000)
    return () => clearInterval(interval)
  }, [selectedStrategyId])

  const handleCreate = async () => {
    if (!userId || !walletId) return
    setCreating(true)
    setError(null)
    try {
      const { strategy } = await api<{ strategy: Strategy }>('/strategies', {
        method: 'POST',
        body: JSON.stringify({
          userId,
          walletId,
          name: form.name || 'My Strategy',
          market: form.market,
          entrySide: form.entrySide,
          entryOddMax: form.entryOddMax,
          entrySecondsToExpiryMin: form.entrySecondsToExpiryMin,
          entryOddChangeWindowS: form.entryOddChangeWindowS,
          entryOddChangeMin: form.entryOddChangeMin,
          entryOddChangePctMin: form.entryOddChangePctMin,
          exitStopLoss: form.exitStopLoss,
          exitStopLossPct: form.exitStopLossPct,
          exitSecondsToExpiryMax: form.exitSecondsToExpiryMax,
          exitProfitOdd: form.exitProfitOdd,
          exitProfitPct: form.exitProfitPct,
          orderSizeUsd: form.orderSizeUsd,
        }),
      })
      setStrategies((prev) => [strategy, ...prev])
      setSelectedStrategyId(strategy.id)
      setForm((f) => ({ ...f, name: '' }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create strategy')
    } finally {
      setCreating(false)
    }
  }

  const handleToggleActive = async (strategy: Strategy) => {
    setSavingStrategyId(strategy.id)
    setError(null)
    try {
      const { strategy: updated } = await api<{ strategy: Strategy }>(`/strategies/${strategy.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !strategy.active }),
      })
      setStrategies((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update strategy')
    } finally {
      setSavingStrategyId(null)
    }
  }

  const handleDeploy = async (strategy: Strategy) => {
    setSavingStrategyId(strategy.id)
    setError(null)
    try {
      const { strategy: updated } = await api<{ strategy: Strategy }>(`/strategies/${strategy.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: true }),
      })
      setStrategies((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to deploy strategy')
    } finally {
      setSavingStrategyId(null)
    }
  }

  const handleApprove = async () => {
    if (!walletId) return
    setApproving(true)
    setError(null)
    setApproveTxHash(null)
    try {
      const { txHash } = await api<{ ok: boolean; txHash: string }>(`/wallets/${walletId}/approve-usdc`, {
        method: 'POST',
        body: JSON.stringify({ amountUsdc: approveAmount }),
      })
      setApproveTxHash(txHash)
      const { collateral } = await api<{ collateral: { balance: string; allowance?: string } }>(`/wallets/${walletId}/balance`)
      const bal = Number(collateral.balance)
      const allow = collateral.allowance != null ? Number(collateral.allowance) : null
      setWalletUsdc(Number.isFinite(bal) ? bal : null)
      setWalletAllowanceUsdc(allow != null && Number.isFinite(allow) ? allow : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approval failed')
    } finally {
      setApproving(false)
    }
  }

  const handleWithdraw = async () => {
    if (!walletId || !withdrawTo) return
    setWithdrawing(true)
    setError(null)
    setWithdrawTxHash(null)
    try {
      const { txHash } = await api<{ ok: boolean; txHash: string }>(`/wallets/${walletId}/withdraw-usdc`, {
        method: 'POST',
        body: JSON.stringify({ toAddress: withdrawTo.trim(), amountUsdc: withdrawAmount }),
      })
      setWithdrawTxHash(txHash)
      // Refresh balance
      const { collateral } = await api<{ collateral: { balance: string; allowance?: string } }>(`/wallets/${walletId}/balance`)
      const bal = Number(collateral.balance)
      const allow = collateral.allowance != null ? Number(collateral.allowance) : null
      setWalletUsdc(Number.isFinite(bal) ? bal : null)
      setWalletAllowanceUsdc(allow != null && Number.isFinite(allow) ? allow : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Withdrawal failed')
    } finally {
      setWithdrawing(false)
    }
  }

  const handleConnect = async () => {
    if (!window.ethereum) {
      setError('MetaMask not detected. Please install it and refresh.')
      return
    }
    setConnecting(true)
    setError(null)
    try {
      const accounts = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as string[]
      const address = accounts[0]
      if (!address) throw new Error('No account selected')

      const { nonce, message } = await api<{ nonce: string; message: string }>(
        `/auth/nonce?address=${encodeURIComponent(address)}`
      )

      const signature = (await window.ethereum.request({
        method: 'personal_sign',
        params: [message, address],
      })) as string

      const { token, userId, walletId, walletAddress } = await api<{
        token: string
        userId: number
        walletId: number
        walletAddress: string
      }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ address, signature }),
      })

      localStorage.setItem('lexa_token', token)
      // Stop persisting userId/walletId/walletAddress; hydrate from /auth/me on refresh.
      localStorage.removeItem('lexa_user_id')
      localStorage.removeItem('lexa_wallet_id')
      localStorage.removeItem('lexa_wallet_address')

      setUserId(userId)
      setWalletId(walletId)
      setWalletAddress(walletAddress)
      setIsLoggedIn(true)

      const { strategies } = await api<{ strategies: Strategy[] }>(`/users/${userId}/strategies`)
      setStrategies(strategies)
      if (strategies.length > 0) setSelectedStrategyId(strategies[0].id)

      await ensureGaslessWallet(walletId)

      const { collateral } = await api<{ collateral: { balance: string; allowance?: string } }>(`/wallets/${walletId}/balance`)
      const bal = Number(collateral.balance)
      const allow = collateral.allowance != null ? Number(collateral.allowance) : null
      setWalletUsdc(Number.isFinite(bal) ? bal : null)
      setWalletAllowanceUsdc(allow != null && Number.isFinite(allow) ? allow : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect wallet')
    } finally {
      setConnecting(false)
    }
  }

  const selectedStrategy = useMemo(
    () => strategies.find((s) => s.id === selectedStrategyId) ?? null,
    [strategies, selectedStrategyId]
  )

  const [showFunding, setShowFunding] = useState(false)
  const [copied, setCopied] = useState(false)
  const [keyCopied, setKeyCopied] = useState(false)
  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  const handleExportKey = async () => {
    if (!walletId) return
    const ok = typeof window !== 'undefined' && window.confirm(
      'Reveal your custodial EOA private key? Anyone with it can control this wallet. Only use to import into Polymarket or MetaMask. Continue?'
    )
    if (!ok) return
    setExportKeyLoading(true)
    setRevealedKey(null)
    try {
      const data = await api<{ privateKey: string; address: string; warning: string }>(
        `/wallets/${walletId}/reveal-key?confirm=yes`
      )
      setRevealedKey(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load key')
    } finally {
      setExportKeyLoading(false)
    }
  }
  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key).then(() => {
      setKeyCopied(true)
      setTimeout(() => setKeyCopied(false), 2000)
    })
  }

  const handleStartEdge = async () => {
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
      await api<{ ok: boolean }>('/edge-trading/start', { method: 'POST', body: JSON.stringify({ orderSizeUsd: num, markets: edgeSelectedMarkets }) })
      setEdgeModalOpen(false)
      setEdgeOrderSizeInput('')
      await Promise.all([fetchEdgeStatus(), fetchEdgeEntries()])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start edge trading')
    } finally {
      setEdgeActionLoading(false)
    }
  }
  const handleStopEdge = async () => {
    setEdgeActionLoading(true)
    setError(null)
    try {
      await api<{ ok: boolean }>('/edge-trading/stop', { method: 'POST', body: JSON.stringify({}) })
      await Promise.all([fetchEdgeStatus(), fetchEdgeEntries()])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to stop')
    } finally {
      setEdgeActionLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-void text-white bg-grid">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Title */}
        <div className="mb-6">
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white">Strategies</h1>
          <p className="text-slate-400 text-sm mt-0.5">Auto-trade with rules based on live odds.</p>
        </div>

        {/* USDC balance bar at top */}
        {isLoggedIn && walletAddress && (
          <div className="flex flex-wrap items-center gap-4 mb-6 p-4 rounded-2xl border border-white/15 bg-white/5 backdrop-blur-sm">
            <div className="flex items-baseline gap-2">
              <span className="text-slate-400 text-sm">USDC balance</span>
              <span className="font-mono text-2xl font-bold text-white">
                {walletUsdc != null ? `$${walletUsdc.toFixed(2)}` : '—'}
              </span>
            </div>
            <div className="h-4 w-px bg-white/20" />
            <div className="flex items-baseline gap-2">
              <span className="text-slate-400 text-sm">Approved for trading</span>
              <span className="font-mono text-lg font-semibold text-slate-200">
                {walletAllowanceUsdc != null ? `$${walletAllowanceUsdc.toFixed(2)}` : '—'}
              </span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => void refreshBalance()}
                className="rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/10"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={() => setShowFunding((v) => !v)}
                className="rounded-lg border border-lexa-border bg-lexa-glass px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/10"
              >
                {showFunding ? 'Hide funding' : 'Funding & approvals'}
              </button>
            </div>
          </div>
        )}

        {/* Funding & approvals (collapsible) */}
        {isLoggedIn && walletAddress && showFunding && (
          <section className="mb-8 rounded-2xl border border-white/15 bg-slate-900/50 backdrop-blur-sm overflow-hidden card-glow">
            <div className="px-6 py-4 border-b border-white/10 bg-white/5">
              <h2 className="text-base font-semibold text-white">Funding & approvals</h2>
              <p className="text-sm text-slate-400 mt-0.5">
                Fund your gasless wallet, approve USDC for trading, and withdraw when needed. All on Polygon.
              </p>
            </div>
            <div className="p-6 space-y-6">
              {/* 1. Fund wallet */}
              <div className="rounded-xl border border-white/10 bg-black/30 p-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="flex items-center justify-center w-7 h-7 rounded-full bg-lexa-accent/20 text-lexa-accent text-sm font-bold">1</span>
                  <h3 className="text-sm font-semibold text-white">Fund your gasless wallet</h3>
                </div>
                <p className="text-sm text-slate-400 mb-3">
                  Send <strong className="text-slate-300">USDC.e on Polygon</strong> to the address below. This is the wallet that executes trades.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="flex-1 min-w-0 rounded-lg bg-black/50 px-3 py-2.5 text-sm font-mono text-slate-200 break-all border border-white/10">
                    {gaslessAddress ?? (gaslessLoading ? 'Deploying…' : 'Not deployed')}
                  </code>
                  {gaslessAddress && (
                    <button
                      type="button"
                      onClick={() => copyAddress(gaslessAddress)}
                      className="shrink-0 rounded-lg border border-white/20 bg-white/5 px-3 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
                    >
                      {copied ? 'Copied' : 'Copy address'}
                    </button>
                  )}
                  {!gaslessAddress && walletId && (
                    <button
                      type="button"
                      onClick={() => void ensureGaslessWallet(walletId)}
                      disabled={gaslessLoading}
                      className="shrink-0 rounded-lg bg-lexa-gradient px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {gaslessLoading ? 'Deploying…' : 'Deploy gasless wallet'}
                    </button>
                  )}
                </div>
                {gaslessError && <p className="mt-2 text-sm text-red-400" role="alert">{gaslessError}</p>}
                <p className="mt-2 text-xs text-slate-500">
                  Custodial EOA (reference only): <span className="font-mono text-slate-400">{walletAddress.slice(0, 10)}…{walletAddress.slice(-8)}</span>
                </p>
              </div>

              {/* 2. Approve for trading */}
              <div className="rounded-xl border border-white/10 bg-black/30 p-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="flex items-center justify-center w-7 h-7 rounded-full bg-lexa-accent/20 text-lexa-accent text-sm font-bold">2</span>
                  <h3 className="text-sm font-semibold text-white">Approve USDC for trading</h3>
                </div>
                <p className="text-sm text-slate-400 mb-3">
                  Allow the exchange to spend USDC from your gasless wallet. Current approval:{' '}
                  <strong className="text-white">{walletAllowanceUsdc != null ? `$${walletAllowanceUsdc.toFixed(2)}` : '—'} USDC</strong>.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    step={10}
                    className="w-28 rounded-lg border border-white/15 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-lexa-accent"
                    value={approveAmount}
                    onChange={(e) => setApproveAmount(Math.max(1, Number(e.target.value) || 1))}
                  />
                  <span className="text-sm text-slate-500">USDC</span>
                  <button
                    type="button"
                    onClick={handleApprove}
                    disabled={approving}
                    className="rounded-lg bg-lexa-gradient px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {approving ? 'Approving…' : 'Approve'}
                  </button>
                </div>
                {approveTxHash && <p className="mt-2 text-xs text-emerald-400">Transaction submitted: {approveTxHash.slice(0, 22)}…</p>}
              </div>

              {/* 3. Withdraw */}
              <div className="rounded-xl border border-white/10 bg-black/30 p-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="flex items-center justify-center w-7 h-7 rounded-full bg-lexa-accent/20 text-lexa-accent text-sm font-bold">3</span>
                  <h3 className="text-sm font-semibold text-white">Withdraw USDC</h3>
                </div>
                <p className="text-sm text-slate-400 mb-3">
                  Send USDC from your gasless wallet to any address (e.g. your own wallet).
                </p>
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder="Destination address (0x…)"
                    className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2.5 text-sm font-mono outline-none focus:border-lexa-accent placeholder:text-slate-600"
                    value={withdrawTo}
                    onChange={(e) => setWithdrawTo(e.target.value)}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      min={0.01}
                      step={1}
                      className="w-28 rounded-lg border border-white/15 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-lexa-accent"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(Math.max(0.01, Number(e.target.value) || 0.01))}
                    />
                    <span className="text-sm text-slate-500">USDC</span>
                    <button
                      type="button"
                      onClick={handleWithdraw}
                      disabled={withdrawing || !withdrawTo.trim()}
                      className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-40"
                    >
                      {withdrawing ? 'Sending…' : 'Withdraw'}
                    </button>
                  </div>
                </div>
                {withdrawTxHash && <p className="mt-2 text-xs text-emerald-400">Transaction submitted: {withdrawTxHash.slice(0, 22)}…</p>}
              </div>

              {/* Export custodial EOA private key */}
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
                <h3 className="text-sm font-semibold text-amber-200 mb-1">Export custodial EOA private key</h3>
                <p className="text-sm text-slate-400 mb-3">
                  Use this to import the wallet into Polymarket or MetaMask to view positions. Never share the key.
                </p>
                <button
                  type="button"
                  onClick={handleExportKey}
                  disabled={exportKeyLoading}
                  className="rounded-lg border border-amber-500/50 bg-amber-500/20 px-4 py-2.5 text-sm font-medium text-amber-200 hover:bg-amber-500/30 disabled:opacity-50"
                >
                  {exportKeyLoading ? 'Loading…' : 'Export private key'}
                </button>
                {revealedKey && (
                  <div className="mt-4 rounded-lg border border-amber-500/30 bg-black/40 p-4 space-y-3">
                    <p className="text-xs text-amber-200/90">{revealedKey.warning}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="flex-1 min-w-0 rounded bg-black/60 px-3 py-2 text-xs font-mono text-slate-200 break-all">
                        {revealedKey.privateKey}
                      </code>
                      <button
                        type="button"
                        onClick={() => copyKey(revealedKey.privateKey)}
                        className="shrink-0 rounded border border-amber-500/40 bg-amber-500/20 px-3 py-2 text-xs font-medium text-amber-200 hover:bg-amber-500/30"
                      >
                        {keyCopied ? 'Copied' : 'Copy key'}
                      </button>
                    </div>
                    <p className="text-xs text-slate-500">Address: <span className="font-mono text-slate-400">{revealedKey.address}</span></p>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {error && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <span className="text-slate-500">Loading…</span>
          </div>
        ) : !isLoggedIn ? (
          <div className="flex flex-col items-center justify-center py-24 gap-5 max-w-md mx-auto text-center">
            <h2 className="text-xl font-semibold text-white">Connect wallet</h2>
            <p className="text-slate-400 text-sm leading-relaxed">
              Sign in with MetaMask to create strategies and run auto-trading with your custodial wallet.
            </p>
            <button
              type="button"
              onClick={handleConnect}
              disabled={connecting}
              className="rounded-xl bg-lexa-gradient px-8 py-3.5 text-sm font-semibold text-white shadow-lg hover:opacity-90 disabled:opacity-60 transition-opacity"
            >
              {connecting ? 'Connecting…' : 'Connect MetaMask'}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-8">
            {/* Left: Edge + Create form + strategy list */}
            <div className="space-y-6">
              {/* Edge trading */}
              <section className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-6 card-glow">
                <h2 className="text-base font-semibold text-white mb-2">Edge trading</h2>
                <p className="text-xs text-slate-500 mb-4">BTC/ETH/SOL 15m & 1h. Enters when edge ≥ +8 or ≤ −8 pp. One entry per market.</p>
                {edgeStatus?.enabled ? (
                  <div className="space-y-2">
                    <p className="text-sm text-emerald-400">On · ${edgeStatus.orderSizeUsd ?? '—'}/order</p>
                    {edgeStatus.markets?.length ? (
                      <p className="text-xs text-slate-400">Markets: {edgeStatus.markets.join(', ')}</p>
                    ) : (
                      <p className="text-xs text-slate-500">Markets: all (BTC/ETH/SOL 15m & 1h)</p>
                    )}
                    {edgeStatus.lastEnteredSlug && (
                      <p className="text-xs text-slate-500 truncate">Last: {edgeStatus.lastEnteredSlug}</p>
                    )}
                    <button
                      type="button"
                      onClick={handleStopEdge}
                      disabled={edgeActionLoading}
                      className="w-full rounded-lg bg-red-500/20 text-red-300 border border-red-500/40 py-2 text-sm font-medium disabled:opacity-50"
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
                    className="w-full rounded-lg bg-lexa-accent/20 text-lexa-accent border border-lexa-accent/50 py-2.5 text-sm font-medium hover:bg-lexa-accent/30 disabled:opacity-50"
                  >
                    Start edge trading
                  </button>
                )}
                {edgeEntries.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-white/10">
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Recent edge entries</p>
                    <ul className="space-y-1.5 max-h-28 overflow-y-auto">
                      {edgeEntries.slice(0, 5).map((e) => (
                        <li key={e.slug} className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-slate-400 truncate">{e.market ?? e.slug}</span>
                          <a href={e.polymarketEventUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-lexa-accent">View</a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-6 card-glow">
                <h2 className="text-base font-semibold text-white mb-5">New strategy</h2>
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1.5">Name</label>
                    <input
                      className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-lexa-accent focus:ring-1 focus:ring-lexa-accent/50"
                      placeholder="e.g. BTC 5m Up"
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-400 mb-1.5">Market</label>
                      <select
                        className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2.5 text-sm text-white outline-none focus:border-lexa-accent"
                        value={form.market}
                        onChange={(e) => setForm((f) => ({ ...f, market: e.target.value }))}
                      >
                        <option value="btc-5m">BTC 5m</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-400 mb-1.5">Side</label>
                      <select
                        className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2.5 text-sm text-white outline-none focus:border-lexa-accent"
                        value={form.entrySide}
                        onChange={(e) => setForm((f) => ({ ...f, entrySide: e.target.value as 'up' | 'down' }))}
                      >
                        <option value="up">Up</option>
                        <option value="down">Down</option>
                      </select>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-white/10">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Entry</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Entry odd max</label>
                        <input
                          type="number"
                          step={0.01}
                          min={0}
                          max={1}
                          className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm outline-none focus:border-lexa-accent"
                          value={form.entryOddMax}
                          onChange={(e) => setForm((f) => ({ ...f, entryOddMax: Number(e.target.value) || 0 }))}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Min expiry (s)</label>
                        <input
                          type="number"
                          className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm outline-none focus:border-lexa-accent"
                          value={form.entrySecondsToExpiryMin}
                          onChange={(e) => setForm((f) => ({ ...f, entrySecondsToExpiryMin: Number(e.target.value) || 0 }))}
                        />
                      </div>
                    </div>
                    <div className="mt-3">
                      <label className="block text-xs text-slate-500 mb-1">Odd change window</label>
                      <select
                        className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm outline-none focus:border-lexa-accent"
                        value={form.entryOddChangeWindowS}
                        onChange={(e) => setForm((f) => ({ ...f, entryOddChangeWindowS: Number(e.target.value) }))}
                      >
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>{n}s</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Min Δ (opt)</label>
                        <input
                          type="number"
                          step={0.01}
                          placeholder="-0.05"
                          className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm outline-none focus:border-lexa-accent placeholder:text-slate-600"
                          value={form.entryOddChangeMin ?? ''}
                          onChange={(e) => setForm((f) => ({ ...f, entryOddChangeMin: e.target.value !== '' ? Number(e.target.value) : null }))}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Min % (opt)</label>
                        <input
                          type="number"
                          placeholder="-25"
                          className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm outline-none focus:border-lexa-accent placeholder:text-slate-600"
                          value={form.entryOddChangePctMin ?? ''}
                          onChange={(e) => setForm((f) => ({ ...f, entryOddChangePctMin: e.target.value !== '' ? Number(e.target.value) : null }))}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-white/10">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Exit</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Stop-loss odd (opt)</label>
                        <input
                          type="number"
                          step={0.01}
                          min={0}
                          max={1}
                          placeholder="0.10"
                          className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm outline-none focus:border-lexa-accent placeholder:text-slate-600"
                          value={form.exitStopLoss ?? ''}
                          onChange={(e) => setForm((f) => ({ ...f, exitStopLoss: e.target.value !== '' ? Number(e.target.value) : null }))}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Stop-loss % (opt)</label>
                        <input
                          type="number"
                          step={1}
                          min={0}
                          max={100}
                          placeholder="60"
                          className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm outline-none focus:border-lexa-accent placeholder:text-slate-600"
                          value={form.exitStopLossPct ?? ''}
                          onChange={(e) => setForm((f) => ({ ...f, exitStopLossPct: e.target.value !== '' ? Number(e.target.value) : null }))}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Take-profit odd (opt)</label>
                        <input
                          type="number"
                          step={0.01}
                          min={0}
                          max={1}
                          placeholder="0.80"
                          className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm outline-none focus:border-lexa-accent placeholder:text-slate-600"
                          value={form.exitProfitOdd ?? ''}
                          onChange={(e) => setForm((f) => ({ ...f, exitProfitOdd: e.target.value !== '' ? Number(e.target.value) : null }))}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Take-profit % (opt)</label>
                        <input
                          type="number"
                          step={1}
                          min={0}
                          placeholder="100"
                          className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm outline-none focus:border-lexa-accent placeholder:text-slate-600"
                          value={form.exitProfitPct ?? ''}
                          onChange={(e) => setForm((f) => ({ ...f, exitProfitPct: e.target.value !== '' ? Number(e.target.value) : null }))}
                        />
                      </div>
                    </div>
                    <div className="mt-3">
                      <label className="block text-xs text-slate-500 mb-1">Exit when expiry ≤ (s)</label>
                      <input
                        type="number"
                        className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm outline-none focus:border-lexa-accent"
                        value={form.exitSecondsToExpiryMax}
                        onChange={(e) => setForm((f) => ({ ...f, exitSecondsToExpiryMax: Number(e.target.value) || 0 }))}
                      />
                    </div>
                  </div>
                  <div className="pt-2 border-t border-white/10">
                    <label className="block text-sm font-medium text-slate-400 mb-1.5">Order size (USD)</label>
                    <input
                      type="number"
                      step={1}
                      min={1}
                      className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2.5 text-sm outline-none focus:border-lexa-accent"
                      value={form.orderSizeUsd}
                      onChange={(e) => setForm((f) => ({ ...f, orderSizeUsd: Number(e.target.value) || 0 }))}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={creating}
                    className="w-full rounded-xl bg-lexa-gradient py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    {creating ? 'Creating…' : 'Create strategy'}
                  </button>
                </div>
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-6 card-glow">
                <h2 className="text-base font-semibold text-white mb-4">Your strategies</h2>
                {strategies.length === 0 ? (
                  <p className="text-sm text-slate-500 py-4">No strategies yet. Create one above.</p>
                ) : (
                  <ul className="space-y-2 max-h-[320px] overflow-y-auto">
                    {strategies.map((s) => {
                      const isSelected = s.id === selectedStrategyId
                      return (
                        <li key={s.id}>
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelectedStrategyId(s.id)}
                            onKeyDown={(e) => e.key === 'Enter' && setSelectedStrategyId(s.id)}
                            className={`rounded-xl border px-4 py-3 transition-colors cursor-pointer ${
                              isSelected ? 'border-lexa-accent bg-lexa-accent/10' : 'border-white/10 bg-black/20 hover:border-white/20'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-medium text-white truncate">{s.name}</p>
                                <p className="text-xs text-slate-500 mt-0.5">
                                  {s.market} · {s.entry_side} · ${Number(s.order_size_usd).toFixed(0)}/order
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (s.active) void handleToggleActive(s)
                                  else void handleDeploy(s)
                                }}
                                disabled={savingStrategyId === s.id}
                                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity disabled:opacity-50 ${
                                  s.active
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                    : 'bg-slate-500/20 text-slate-300 border border-slate-500/40 hover:bg-slate-500/30'
                                }`}
                              >
                                {savingStrategyId === s.id ? '…' : s.active ? 'Pause' : 'Deploy'}
                              </button>
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            </div>

            {/* Right: Positions + Open orders + Trade history */}
            <div className="space-y-6">
              {/* Strategy positions */}
              <section className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-6 card-glow">
                <h2 className="text-base font-semibold text-white mb-1">Positions</h2>
                {selectedStrategy && <p className="text-sm text-slate-500 mb-4">{selectedStrategy.name}</p>}
                {!selectedStrategy && <p className="text-sm text-slate-500 py-6">Select a strategy to see positions.</p>}
                {selectedStrategy && positions.length === 0 && <p className="text-sm text-slate-500 py-6">No positions yet.</p>}
                {selectedStrategy && positions.length > 0 && (
                  <div className="overflow-x-auto -mx-1">
                    <table className="w-full min-w-[480px] text-sm">
                      <thead>
                        <tr className="border-b border-white/10 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                          <th className="pb-3 pr-4">Expiry</th>
                          <th className="pb-3 pr-4">Side</th>
                          <th className="pb-3 pr-4 text-right">Entry</th>
                          <th className="pb-3 pr-4 text-right">Exit</th>
                          <th className="pb-3 pr-4 text-right">Shares</th>
                          <th className="pb-3 pr-4">Outcome</th>
                          <th className="pb-3 pl-4">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {positions.map((p) => (
                          <tr key={p.id} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                            <td className="py-3 pr-4 font-mono text-xs text-slate-300">{new Date(p.expiry_ts).toLocaleTimeString()}</td>
                            <td className="py-3 pr-4"><span className={p.side === 'up' ? 'text-emerald-400' : 'text-red-400'}>{p.side}</span></td>
                            <td className="py-3 pr-4 text-right font-mono text-slate-300">{p.entry_odd ? Number(p.entry_odd).toFixed(3) : '—'}</td>
                            <td className="py-3 pr-4 text-right font-mono text-slate-300">{p.exit_odd ? Number(p.exit_odd).toFixed(3) : '—'}</td>
                            <td className="py-3 pr-4 text-right font-mono text-slate-400">{p.entry_shares ? Number(p.entry_shares).toFixed(2) : '—'}</td>
                            <td className="py-3 pr-4">
                              {p.outcome === 'won' && <span className="text-emerald-400 font-medium">Won</span>}
                              {p.outcome === 'lost' && <span className="text-red-400 font-medium">Lost</span>}
                              {p.outcome === 'closed' && <span className="text-slate-400">Closed</span>}
                              {p.outcome === 'open' && <span className="text-amber-400">Open</span>}
                              {!p.outcome && <span className="text-slate-500">—</span>}
                            </td>
                            <td className="py-3 pl-4">
                              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${p.status === 'open' ? 'bg-emerald-500/20 text-emerald-300' : p.status === 'closed' ? 'bg-slate-500/20 text-slate-400' : 'bg-amber-500/20 text-amber-300'}`}>
                                {p.status}{p.exit_reason && <span className="ml-1 text-slate-500">· {p.exit_reason}</span>}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Open orders */}
              <section className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-6 card-glow">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-semibold text-white">Open orders</h2>
                  <button type="button" onClick={() => void fetchClobData()} disabled={clobLoading} className="text-xs text-slate-400 hover:text-white disabled:opacity-50">Refresh</button>
                </div>
                {clobOrders.length === 0 && <p className="text-sm text-slate-500 py-4">No open orders.</p>}
                {clobOrders.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10 text-left text-xs text-slate-500 uppercase">
                          <th className="pb-2 pr-3">Side</th>
                          <th className="pb-2 pr-3">Price</th>
                          <th className="pb-2 pr-3">Size</th>
                          <th className="pb-2">Token</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clobOrders.slice(0, 15).map((o, i) => (
                          <tr key={i} className="border-b border-white/5 text-slate-300">
                            <td className="py-2 pr-3">{String((o as Record<string, unknown>).side ?? '—')}</td>
                            <td className="py-2 pr-3 font-mono">{(o as Record<string, unknown>).price != null ? Number((o as Record<string, unknown>).price).toFixed(3) : '—'}</td>
                            <td className="py-2 pr-3 font-mono">{(o as Record<string, unknown>).size != null ? Number((o as Record<string, unknown>).size).toFixed(2) : '—'}</td>
                            <td className="py-2 font-mono text-xs truncate max-w-[120px]">{String((o as Record<string, unknown>).asset_id ?? (o as Record<string, unknown>).token_id ?? '—')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Trade history */}
              <section className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-6 card-glow">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-semibold text-white">Trade history</h2>
                  <button type="button" onClick={() => void fetchClobData()} disabled={clobLoading} className="text-xs text-slate-400 hover:text-white disabled:opacity-50">Refresh</button>
                </div>
                {clobTrades.length === 0 && <p className="text-sm text-slate-500 py-4">No trades yet. Refresh to sync.</p>}
                {clobTrades.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10 text-left text-xs text-slate-500 uppercase">
                          <th className="pb-2 pr-3">Time</th>
                          <th className="pb-2 pr-3">Market</th>
                          <th className="pb-2 pr-3">Side</th>
                          <th className="pb-2 pr-3 text-right">Price</th>
                          <th className="pb-2 pr-3 text-right">Size</th>
                          <th className="pb-2 pr-3 text-right">Amount</th>
                          <th className="pb-2">Link</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clobTrades.slice(0, 25).map((t) => (
                          <tr key={t.id} className="border-b border-white/5 text-slate-300">
                            <td className="py-2 pr-3 whitespace-nowrap text-xs">{t.tradeTimestamp ? new Date(t.tradeTimestamp).toLocaleString() : '—'}</td>
                            <td className="py-2 pr-3 truncate max-w-[100px]">{t.marketSlug ?? '—'}</td>
                            <td className="py-2 pr-3">{t.side ?? '—'}</td>
                            <td className="py-2 pr-3 text-right font-mono">{t.price != null ? t.price.toFixed(3) : '—'}</td>
                            <td className="py-2 pr-3 text-right font-mono">{t.size != null ? t.size.toFixed(2) : '—'}</td>
                            <td className="py-2 pr-3 text-right font-mono">{t.amountUsd != null ? `$${t.amountUsd.toFixed(2)}` : '—'}</td>
                            <td className="py-2">{t.polymarketEventUrl ? <a href={t.polymarketEventUrl} target="_blank" rel="noopener noreferrer" className="text-lexa-accent text-xs">View</a> : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          </div>
        )}

        {/* Edge start modal */}
        {edgeModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => !edgeActionLoading && setEdgeModalOpen(false)}>
            <div className="rounded-xl border border-white/20 bg-slate-900 p-6 w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-semibold text-lg text-white mb-2">Start edge trading</h3>
              <p className="text-sm text-slate-400 mb-3">Order size in USD. Enters when edge ≥ +8 or ≤ −8 pp. One entry per market.</p>
              <input
                type="number"
                min={1}
                step={1}
                placeholder="Order size (USD)"
                value={edgeOrderSizeInput}
                onChange={(e) => setEdgeOrderSizeInput(e.target.value)}
                className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2.5 text-white placeholder:text-slate-500 mb-3"
              />
              <p className="text-xs text-slate-400 mb-2">Markets to trade</p>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {EDGE_MARKET_OPTIONS.map((m) => (
                  <label key={m} className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 cursor-pointer hover:bg-white/5">
                    <input
                      type="checkbox"
                      checked={edgeSelectedMarkets.includes(m)}
                      onChange={(e) => {
                        if (e.target.checked) setEdgeSelectedMarkets((prev) => [...prev, m])
                        else setEdgeSelectedMarkets((prev) => prev.filter((x) => x !== m))
                      }}
                      className="rounded border-white/20 text-lexa-accent focus:ring-lexa-accent"
                    />
                    <span className="text-sm text-white">{m}</span>
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={handleStartEdge} disabled={edgeActionLoading} className="flex-1 rounded-lg bg-lexa-accent py-2.5 text-sm font-medium text-white disabled:opacity-50">Start</button>
                <button type="button" onClick={() => !edgeActionLoading && setEdgeModalOpen(false)} disabled={edgeActionLoading} className="rounded-lg border border-white/20 py-2.5 px-4 text-sm text-slate-300">Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

