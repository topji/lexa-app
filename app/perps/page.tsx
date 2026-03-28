'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWallet } from '@/contexts/WalletContext'
import {
  type PerpAsset,
  type AssetCtx,
  type AssetMeta,
  type L2Level,
  type OpenOrder,
  type AssetPosition,
  type MarginSummary,
  type UserFill,
  type HlCandle,
  type CandleInterval,
  PERP_ASSETS,
  ASSET_ICONS,
  ASSET_COLORS,
  CANDLE_INTERVALS,
  HyperliquidWs,
  hlCoinName,
  fetchMetaAndCtxs,
  fetchL2Book,
  fetchCandles,
  fetchClearinghouseState,
  fetchOpenOrders,
  fetchUserFills,
  formatPrice,
  formatSize,
  formatUsd,
  formatPct,
  formatFunding,
  pnlColor,
  sideColor,
  get24hChange,
} from '@/lib/hyperliquid'
import {
  type OrderResult,
  placeOrder,
  cancelOrders,
  updateLeverage,
  withdrawUSDC,
  transferUSDC,
  priceToWire,
  sizeToWire,
  marketSlippagePrice,
} from '@/lib/hyperliquid-exchange'

// ── Helpers ──────────────────────────────────────────────────────────────────

const num = (s: string | number | null | undefined): number => {
  if (s == null) return 0
  const n = typeof s === 'string' ? parseFloat(s) : s
  return Number.isFinite(n) ? n : 0
}

const LOOKBACK_MS: Record<CandleInterval, number> = {
  '1m': 6 * 60 * 60 * 1000,
  '5m': 24 * 60 * 60 * 1000,
  '15m': 3 * 24 * 60 * 60 * 1000,
  '1h': 7 * 24 * 60 * 60 * 1000,
  '4h': 30 * 24 * 60 * 60 * 1000,
  '1d': 180 * 24 * 60 * 60 * 1000,
}

// ── Toast System ─────────────────────────────────────────────────────────────

type Toast = { id: number; message: string; type: 'success' | 'error' | 'info'; expiry: number }
let toastId = 0

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null
  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => onDismiss(t.id)}
          className={`px-4 py-3 rounded-xl border backdrop-blur-md text-sm font-mono cursor-pointer animate-in slide-in-from-right transition-all ${
            t.type === 'success'
              ? 'bg-neon-green/10 border-neon-green/30 text-neon-green'
              : t.type === 'error'
                ? 'bg-neon-red/10 border-neon-red/30 text-neon-red'
                : 'bg-lexa-accent/10 border-lexa-accent/30 text-lexa-accent'
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}

// ── Sub-Components ───────────────────────────────────────────────────────────

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-lexa-border bg-lexa-glass ${className}`}>
      {children}
    </div>
  )
}

function AssetTab({
  asset,
  active,
  price,
  change,
  onClick,
}: {
  asset: PerpAsset
  active: boolean
  price: string
  change: number
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-display font-bold transition-all whitespace-nowrap ${
        active
          ? 'bg-lexa-glass border border-lexa-accent/40 text-white shadow-glow-lexa'
          : 'text-gray-400 hover:text-white hover:bg-lexa-glass/50 border border-transparent'
      }`}
    >
      <span style={{ color: ASSET_COLORS[asset] }} className="text-base">
        {ASSET_ICONS[asset]}
      </span>
      <span className="uppercase">{asset}</span>
      <span className="font-mono text-xs text-gray-300">${price}</span>
      <span className={`text-xs font-mono ${change >= 0 ? 'text-neon-green' : 'text-neon-red'}`}>
        {change >= 0 ? '+' : ''}{(change * 100).toFixed(2)}%
      </span>
    </button>
  )
}

function PriceBar({
  asset,
  ctx,
  meta,
}: {
  asset: PerpAsset
  ctx: AssetCtx | null
  meta: AssetMeta | null
}) {
  if (!ctx) return null
  const mark = num(ctx.markPx)
  const oracle = num(ctx.oraclePx)
  const change = get24hChange(ctx)
  const vol = num(ctx.dayNtlVlm)
  const oi = num(ctx.openInterest)
  const funding = ctx.funding

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3 border-b border-lexa-border/50">
      <div className="flex items-center gap-2">
        <span style={{ color: ASSET_COLORS[asset] }} className="text-2xl font-bold">
          {ASSET_ICONS[asset]}
        </span>
        <div>
          <h2 className="font-display text-lg font-bold text-white uppercase">
            {asset === 'GOLD' ? 'GOLD (PAXG)' : asset}-PERP
          </h2>
          <p className="text-[10px] text-gray-500">Hyperliquid Perpetual</p>
        </div>
      </div>
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Mark</p>
        <p className="text-xl font-mono font-bold text-white">${formatPrice(mark, asset)}</p>
      </div>
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Oracle</p>
        <p className="text-sm font-mono text-gray-300">${formatPrice(oracle, asset)}</p>
      </div>
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">24h Change</p>
        <p className={`text-sm font-mono font-semibold ${change >= 0 ? 'text-neon-green' : 'text-neon-red'}`}>
          {formatPct(change)}
        </p>
      </div>
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">24h Volume</p>
        <p className="text-sm font-mono text-gray-300">{formatUsd(vol)}</p>
      </div>
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Open Interest</p>
        <p className="text-sm font-mono text-gray-300">{formatSize(oi, 2)} {asset === 'GOLD' ? 'PAXG' : asset}</p>
      </div>
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Funding (1h)</p>
        <p className={`text-sm font-mono font-semibold ${num(funding) >= 0 ? 'text-neon-green' : 'text-neon-red'}`}>
          {formatFunding(funding)}
        </p>
      </div>
      {meta && (
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider">Max Leverage</p>
          <p className="text-sm font-mono text-lexa-accent">{meta.maxLeverage}x</p>
        </div>
      )}
    </div>
  )
}

// ── Candlestick Chart ────────────────────────────────────────────────────────

function CandlestickChart({
  candles,
  asset,
  interval,
  onIntervalChange,
}: {
  candles: HlCandle[]
  asset: PerpAsset
  interval: CandleInterval
  onIntervalChange: (i: CandleInterval) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<{
    chart: ReturnType<typeof import('lightweight-charts').createChart>
    candleSeries: ReturnType<ReturnType<typeof import('lightweight-charts').createChart>['addCandlestickSeries']>
    volumeSeries: ReturnType<ReturnType<typeof import('lightweight-charts').createChart>['addHistogramSeries']>
  } | null>(null)
  // Track the current asset+interval so we know when to do a full reset
  const dataKeyRef = useRef('')

  // Create chart once on mount
  useEffect(() => {
    if (typeof window === 'undefined' || !containerRef.current) return
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createChart, CrosshairMode } = require('lightweight-charts')
    const container = containerRef.current

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: 'solid', color: '#050508' },
        textColor: '#64748b',
        fontFamily: 'ui-monospace, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(95, 211, 255, 0.04)' },
        horzLines: { color: 'rgba(95, 211, 255, 0.04)' },
      },
      rightPriceScale: {
        borderColor: 'rgba(95, 211, 255, 0.15)',
        scaleMargins: { top: 0.05, bottom: 0.2 },
      },
      timeScale: {
        borderColor: 'rgba(95, 211, 255, 0.15)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 8,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(95, 211, 255, 0.3)', width: 1, style: 2 },
        horzLine: { color: 'rgba(95, 211, 255, 0.3)', width: 1, style: 2 },
      },
    })

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#00ff88',
      downColor: '#ff3366',
      borderUpColor: '#00ff88',
      borderDownColor: '#ff3366',
      wickUpColor: 'rgba(0, 255, 136, 0.5)',
      wickDownColor: 'rgba(255, 51, 102, 0.5)',
    })

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    })

    chartRef.current = { chart, candleSeries, volumeSeries }

    return () => {
      chart.remove()
      chartRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update price format when asset changes
  useEffect(() => {
    if (!chartRef.current) return
    const precision = asset === 'BTC' ? 1 : asset === 'GOLD' ? 1 : 2
    const minMove = asset === 'BTC' ? 0.1 : asset === 'GOLD' ? 0.1 : 0.01
    chartRef.current.candleSeries.applyOptions({
      priceFormat: { type: 'price', precision, minMove },
    })
  }, [asset])

  // Update candle data
  useEffect(() => {
    const ref = chartRef.current
    if (!ref || candles.length === 0) return

    const candleData = candles.map((c) => ({
      time: Math.floor(c.t / 1000) as import('lightweight-charts').UTCTimestamp,
      open: num(c.o),
      high: num(c.h),
      low: num(c.l),
      close: num(c.c),
    }))

    const volumeData = candles.map((c) => ({
      time: Math.floor(c.t / 1000) as import('lightweight-charts').UTCTimestamp,
      value: num(c.v) * num(c.c),
      color: num(c.c) >= num(c.o) ? 'rgba(0, 255, 136, 0.15)' : 'rgba(255, 51, 102, 0.15)',
    }))

    // Determine if this is a new dataset (asset/interval changed) or an incremental update
    const newKey = `${asset}:${interval}`
    const isNewDataset = newKey !== dataKeyRef.current

    if (isNewDataset) {
      // Full reset — new asset or interval
      ref.candleSeries.setData(candleData)
      ref.volumeSeries.setData(volumeData)
      ref.chart.timeScale().fitContent()
      dataKeyRef.current = newKey
    } else {
      // Incremental — update last candle + append new ones
      // setData is idempotent and handles deduplication, use it for reliability
      ref.candleSeries.setData(candleData)
      ref.volumeSeries.setData(volumeData)
    }
  }, [candles, asset, interval])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-lexa-border/30">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider mr-2">Interval</span>
        {CANDLE_INTERVALS.map((iv) => (
          <button
            key={iv}
            onClick={() => onIntervalChange(iv)}
            className={`px-2 py-1 rounded text-[10px] font-mono font-bold uppercase transition-all ${
              interval === iv
                ? 'bg-lexa-accent/15 text-lexa-accent border border-lexa-accent/30'
                : 'text-gray-500 hover:text-gray-300 border border-transparent'
            }`}
          >
            {iv}
          </button>
        ))}
      </div>
      <div className="flex-1 relative min-h-0">
        <div ref={containerRef} className="absolute inset-0" />
        {candles.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-void/80 z-10">
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <svg className="animate-spin h-4 w-4 text-lexa-accent" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading chart data...
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Order Book ───────────────────────────────────────────────────────────────

function OrderBook({
  bids,
  asks,
  markPrice,
  asset,
  onPriceClick,
}: {
  bids: L2Level[]
  asks: L2Level[]
  markPrice: number
  asset: PerpAsset
  onPriceClick: (price: string) => void
}) {
  const displayBids = bids.slice(0, 12)
  const displayAsks = asks.slice(0, 12).reverse()
  const maxSize = useMemo(() => {
    const all = [...displayBids, ...displayAsks].map((l) => num(l.sz))
    return Math.max(...all, 0.001)
  }, [displayBids, displayAsks])

  const spread = asks.length && bids.length ? num(asks[0].px) - num(bids[0].px) : 0
  const spreadPct = markPrice > 0 ? (spread / markPrice) * 100 : 0

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-lexa-border/50">
        <h3 className="text-xs font-display font-bold uppercase tracking-widest text-lexa-accent">Order Book</h3>
      </div>
      <div className="flex items-center justify-between px-3 py-1.5 text-[10px] text-gray-500 uppercase tracking-wider border-b border-lexa-border/30">
        <span className="w-24">Price</span>
        <span className="w-20 text-right">Size</span>
        <span className="w-12 text-right">Orders</span>
      </div>
      <div className="flex-1 overflow-hidden flex flex-col justify-end">
        {displayAsks.map((level, i) => {
          const sz = num(level.sz)
          const barWidth = (sz / maxSize) * 100
          return (
            <div
              key={`a-${i}`}
              className="relative flex items-center justify-between px-3 py-[3px] text-xs cursor-pointer hover:bg-white/5"
              onClick={() => onPriceClick(level.px)}
            >
              <div className="absolute right-0 top-0 bottom-0 bg-neon-red/10" style={{ width: `${Math.min(100, barWidth)}%` }} />
              <span className="font-mono text-neon-red relative z-10 w-24">{formatPrice(level.px, asset)}</span>
              <span className="font-mono text-gray-300 relative z-10 w-20 text-right">{formatSize(sz, 4)}</span>
              <span className="font-mono text-gray-500 relative z-10 w-12 text-right">{level.n}</span>
            </div>
          )
        })}
      </div>
      <div className="flex items-center justify-between px-3 py-1.5 border-y border-lexa-border/30 bg-black/30">
        <span className="text-white font-mono font-bold text-sm">${formatPrice(markPrice, asset)}</span>
        <span className="text-[10px] text-gray-500">Spread: {spreadPct.toFixed(3)}%</span>
      </div>
      <div className="flex-1 overflow-hidden">
        {displayBids.map((level, i) => {
          const sz = num(level.sz)
          const barWidth = (sz / maxSize) * 100
          return (
            <div
              key={`b-${i}`}
              className="relative flex items-center justify-between px-3 py-[3px] text-xs cursor-pointer hover:bg-white/5"
              onClick={() => onPriceClick(level.px)}
            >
              <div className="absolute right-0 top-0 bottom-0 bg-neon-green/10" style={{ width: `${Math.min(100, barWidth)}%` }} />
              <span className="font-mono text-neon-green relative z-10 w-24">{formatPrice(level.px, asset)}</span>
              <span className="font-mono text-gray-300 relative z-10 w-20 text-right">{formatSize(sz, 4)}</span>
              <span className="font-mono text-gray-500 relative z-10 w-12 text-right">{level.n}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Trade Form ───────────────────────────────────────────────────────────────

function TradeForm({
  asset,
  assetIndex,
  markPrice,
  maxLeverage,
  szDecimals,
  available,
  connected,
  onToast,
  onRefresh,
}: {
  asset: PerpAsset
  assetIndex: number
  markPrice: number
  maxLeverage: number
  szDecimals: number
  available: number
  connected: boolean
  onToast: (msg: string, type: 'success' | 'error' | 'info') => void
  onRefresh: () => void
}) {
  const [side, setSide] = useState<'long' | 'short'>('long')
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market')
  const [price, setPrice] = useState('')
  const [size, setSize] = useState('')
  const [leverage, setLeverage] = useState(10)
  const [reduceOnly, setReduceOnly] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [leverageSet, setLeverageSet] = useState(false)

  const effectivePrice = orderType === 'limit' && price ? parseFloat(price) : markPrice

  const notionalValue = useMemo(() => {
    const sz = parseFloat(size)
    if (!sz || !effectivePrice) return 0
    return sz * effectivePrice
  }, [size, effectivePrice])

  const marginRequired = useMemo(() => {
    if (!notionalValue || !leverage) return 0
    return notionalValue / leverage
  }, [notionalValue, leverage])

  const isLong = side === 'long'
  const coinLabel = asset === 'GOLD' ? 'PAXG' : asset

  // Set price from order book click
  const setPriceFromBook = useCallback((px: string) => {
    setPrice(px)
    if (orderType === 'market') setOrderType('limit')
  }, [orderType])

  // Quick size buttons (% of available margin at current leverage)
  const setPercentSize = useCallback((pct: number) => {
    if (!markPrice || !available) return
    const maxNotional = available * leverage * pct
    const maxSz = maxNotional / markPrice
    setSize(sizeToWire(maxSz, szDecimals))
  }, [markPrice, available, leverage, szDecimals])

  const handleSubmit = useCallback(async () => {
    if (!connected) {
      onToast('Connect your wallet to trade', 'error')
      return
    }
    if (assetIndex < 0) {
      onToast('Asset not found on Hyperliquid', 'error')
      return
    }
    const sz = parseFloat(size)
    if (!sz || sz <= 0) {
      onToast('Enter a valid size', 'error')
      return
    }

    // Min order value check ($10 on HL)
    const orderNotional = sz * effectivePrice
    if (orderNotional < 10) {
      onToast('Minimum order value is $10', 'error')
      return
    }

    // Balance check (not for reduce-only)
    if (!reduceOnly && marginRequired > available) {
      onToast(`Insufficient margin. Need ${formatUsd(marginRequired)}, have ${formatUsd(available)}`, 'error')
      return
    }

    setSubmitting(true)
    try {
      // Set leverage first if not yet set for this session
      if (!leverageSet) {
        await updateLeverage(assetIndex, leverage, true)
        setLeverageSet(true)
      }

      let orderPrice: string
      if (orderType === 'market') {
        // Market order: use slippage price, IOC
        const slipPrice = marketSlippagePrice(markPrice, isLong)
        // Round to reasonable precision
        orderPrice = priceToWire(slipPrice)
      } else {
        if (!price) {
          onToast('Enter a limit price', 'error')
          setSubmitting(false)
          return
        }
        orderPrice = priceToWire(parseFloat(price))
      }

      const result = await placeOrder({
        asset: assetIndex,
        isBuy: isLong,
        price: orderPrice,
        size: sizeToWire(sz, szDecimals),
        reduceOnly,
        orderType,
      }) as OrderResult

      // Parse response
      const statuses = result.response?.data?.statuses
      if (statuses && statuses.length > 0) {
        const s = statuses[0]
        if ('filled' in s) {
          onToast(`${isLong ? 'Long' : 'Short'} ${sz} ${coinLabel} filled at $${s.filled.avgPx}`, 'success')
          setSize('')
        } else if ('resting' in s) {
          onToast(`Limit order placed (OID: ${s.resting.oid})`, 'success')
          setSize('')
        } else if ('error' in s) {
          onToast(s.error, 'error')
        }
      } else if (result.status === 'ok') {
        onToast('Order submitted', 'success')
        setSize('')
      } else {
        onToast(result.error || 'Order failed', 'error')
      }

      onRefresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Order failed'
      if (msg.includes('user rejected') || msg.includes('User denied')) {
        onToast('Transaction rejected by wallet', 'info')
      } else {
        onToast(msg, 'error')
      }
    } finally {
      setSubmitting(false)
    }
  }, [connected, assetIndex, size, effectivePrice, reduceOnly, marginRequired, available, leverageSet, leverage, orderType, markPrice, isLong, price, asset, szDecimals, coinLabel, onToast, onRefresh])

  // Update leverage on server when changed
  const handleLeverageChange = useCallback(async (newLev: number) => {
    setLeverage(newLev)
    if (connected && assetIndex >= 0) {
      try {
        await updateLeverage(assetIndex, newLev, true)
        setLeverageSet(true)
      } catch {
        // silently fail — will be set before order
      }
    }
  }, [connected, assetIndex])

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b border-lexa-border/50">
        <h3 className="text-xs font-display font-bold uppercase tracking-widest text-lexa-accent">
          Trade {asset === 'GOLD' ? 'GOLD (PAXG)' : asset}-PERP
        </h3>
      </div>

      <div className="p-4 space-y-4 flex-1 overflow-y-auto">
        {/* Side Toggle */}
        <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-black/40 border border-lexa-border/30">
          <button
            onClick={() => setSide('long')}
            className={`py-2.5 rounded-md text-sm font-display font-bold uppercase tracking-wider transition-all ${
              isLong
                ? 'bg-neon-green/20 text-neon-green border border-neon-green/40 shadow-glow-green'
                : 'text-gray-500 hover:text-gray-300 border border-transparent'
            }`}
          >
            Long
          </button>
          <button
            onClick={() => setSide('short')}
            className={`py-2.5 rounded-md text-sm font-display font-bold uppercase tracking-wider transition-all ${
              !isLong
                ? 'bg-neon-red/20 text-neon-red border border-neon-red/40 shadow-glow-red'
                : 'text-gray-500 hover:text-gray-300 border border-transparent'
            }`}
          >
            Short
          </button>
        </div>

        {/* Order Type */}
        <div className="flex gap-1 p-0.5 rounded-lg bg-black/30">
          {(['market', 'limit'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setOrderType(t)}
              className={`flex-1 py-1.5 rounded-md text-xs font-display font-bold uppercase tracking-wider ${
                orderType === t
                  ? 'bg-lexa-glass text-lexa-accent border border-lexa-accent/30'
                  : 'text-gray-500 hover:text-gray-300 border border-transparent'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Price (limit only) */}
        {orderType === 'limit' && (
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1 block">Price (USD)</label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={formatPrice(markPrice, asset)}
              className="w-full rounded-lg border border-lexa-border bg-void px-3 py-2.5 text-white font-mono text-sm placeholder-gray-600 focus:outline-none focus:border-lexa-accent"
            />
          </div>
        )}

        {/* Size */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">
              Size ({coinLabel})
            </label>
            {connected && available > 0 && (
              <span className="text-[10px] text-gray-500">
                Avail: <span className="text-neon-green">{formatUsd(available)}</span>
              </span>
            )}
          </div>
          <input
            type="number"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            placeholder="0.00"
            className="w-full rounded-lg border border-lexa-border bg-void px-3 py-2.5 text-white font-mono text-sm placeholder-gray-600 focus:outline-none focus:border-lexa-accent"
          />
          {/* Quick size % buttons */}
          {connected && available > 0 && (
            <div className="flex gap-1.5 mt-1.5">
              {[0.1, 0.25, 0.5, 0.75, 1].map((pct) => (
                <button
                  key={pct}
                  onClick={() => setPercentSize(pct)}
                  className="flex-1 py-1 rounded text-[10px] font-bold bg-gray-800/50 text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 border border-transparent transition-all"
                >
                  {pct * 100}%
                </button>
              ))}
            </div>
          )}
          {notionalValue > 0 && (
            <div className="text-[10px] text-gray-500 mt-1.5 space-y-0.5">
              <p>Notional: {formatUsd(notionalValue)} | Margin: {formatUsd(marginRequired)}</p>
              {!reduceOnly && marginRequired > available && available > 0 && (
                <p className="text-neon-red">Insufficient margin</p>
              )}
            </div>
          )}
        </div>

        {/* Leverage Slider */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">Leverage</label>
            <span className="text-sm font-mono font-bold text-lexa-accent">{leverage}x</span>
          </div>
          <input
            type="range"
            min={1}
            max={maxLeverage}
            value={leverage}
            onChange={(e) => handleLeverageChange(parseInt(e.target.value))}
            className="w-full accent-lexa-accent h-1.5 rounded-full appearance-none bg-gray-800 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-gray-600 mt-1">
            <span>1x</span>
            <span>{Math.floor(maxLeverage / 4)}x</span>
            <span>{Math.floor(maxLeverage / 2)}x</span>
            <span>{maxLeverage}x</span>
          </div>
          <div className="flex gap-1.5 mt-2">
            {[1, 5, 10, 20, 50].filter((l) => l <= maxLeverage).map((l) => (
              <button
                key={l}
                onClick={() => handleLeverageChange(l)}
                className={`flex-1 py-1 rounded text-[10px] font-bold transition-all ${
                  leverage === l
                    ? 'bg-lexa-accent/20 text-lexa-accent border border-lexa-accent/40'
                    : 'bg-gray-800/50 text-gray-500 hover:text-gray-300 border border-transparent'
                }`}
              >
                {l}x
              </button>
            ))}
          </div>
        </div>

        {/* Reduce Only */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={reduceOnly}
            onChange={(e) => setReduceOnly(e.target.checked)}
            className="rounded border-gray-600 bg-void text-lexa-accent focus:ring-lexa-accent/50"
          />
          <span className="text-xs text-gray-400">Reduce Only</span>
        </label>
      </div>

      {/* Submit Button */}
      <div className="p-4 pt-0">
        <button
          disabled={submitting}
          onClick={handleSubmit}
          className={`w-full py-3.5 rounded-xl font-display font-bold uppercase tracking-wider text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
            isLong
              ? 'bg-neon-green/20 text-neon-green border border-neon-green/40 hover:bg-neon-green/30 shadow-glow-green'
              : 'bg-neon-red/20 text-neon-red border border-neon-red/40 hover:bg-neon-red/30 shadow-glow-red'
          }`}
        >
          {submitting ? 'Signing...' : `${isLong ? 'Long' : 'Short'} ${asset} — ${orderType === 'market' ? 'Market' : 'Limit'}`}
        </button>
        <p className="text-[10px] text-gray-600 text-center mt-2">
          {connected ? 'EIP-712 signing via wallet' : 'Connect wallet to trade'}
        </p>
      </div>
    </div>
  )
}

// ── Positions Table ──────────────────────────────────────────────────────────

function PositionsTable({
  positions,
  assetMetas,
  onClose,
  closing,
}: {
  positions: AssetPosition[]
  assetMetas: AssetMeta[]
  onClose: (coin: string, sz: number, isLong: boolean) => void
  closing: string | null
}) {
  const filtered = positions.filter((p) => Math.abs(num(p.position.szi)) > 0.0000001)

  if (filtered.length === 0) {
    return <p className="text-center text-gray-500 text-sm py-8">No open positions</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 uppercase tracking-wider border-b border-lexa-border/30">
            <th className="text-left py-2 px-3 font-bold">Asset</th>
            <th className="text-left py-2 px-3 font-bold">Side</th>
            <th className="text-right py-2 px-3 font-bold">Size</th>
            <th className="text-right py-2 px-3 font-bold">Entry</th>
            <th className="text-right py-2 px-3 font-bold">Liq. Price</th>
            <th className="text-right py-2 px-3 font-bold">uPnL</th>
            <th className="text-right py-2 px-3 font-bold">ROE</th>
            <th className="text-right py-2 px-3 font-bold">Margin</th>
            <th className="text-right py-2 px-3 font-bold">Lev</th>
            <th className="text-right py-2 px-3 font-bold">Action</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((ap) => {
            const p = ap.position
            const sz = num(p.szi)
            const isLong = sz > 0
            const pnl = num(p.unrealizedPnl)
            const roe = num(p.returnOnEquity)
            const displayName = p.coin === 'PAXG' ? 'GOLD' : p.coin
            return (
              <tr key={p.coin} className="border-b border-lexa-border/20 hover:bg-lexa-glass/30 transition-colors">
                <td className="py-2.5 px-3 font-display font-bold text-white">{displayName}</td>
                <td className={`py-2.5 px-3 font-bold ${isLong ? 'text-neon-green' : 'text-neon-red'}`}>
                  {isLong ? 'LONG' : 'SHORT'}
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-gray-300">{formatSize(Math.abs(sz), 4)}</td>
                <td className="py-2.5 px-3 text-right font-mono text-gray-300">${p.entryPx ?? '--'}</td>
                <td className="py-2.5 px-3 text-right font-mono text-yellow-400">
                  {p.liquidationPx ? `$${p.liquidationPx}` : '--'}
                </td>
                <td className={`py-2.5 px-3 text-right font-mono font-semibold ${pnlColor(pnl)}`}>
                  {pnl >= 0 ? '+' : ''}{formatUsd(pnl)}
                </td>
                <td className={`py-2.5 px-3 text-right font-mono font-semibold ${pnlColor(roe)}`}>
                  {formatPct(roe)}
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-gray-400">{formatUsd(p.marginUsed)}</td>
                <td className="py-2.5 px-3 text-right font-mono text-lexa-accent">{p.leverage.value}x</td>
                <td className="py-2.5 px-3 text-right">
                  <button
                    disabled={closing === p.coin}
                    onClick={() => onClose(p.coin, Math.abs(sz), isLong)}
                    className="text-neon-red/70 hover:text-neon-red text-[10px] font-bold uppercase disabled:opacity-50"
                  >
                    {closing === p.coin ? 'Closing...' : 'Close'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Orders Table ─────────────────────────────────────────────────────────────

function OrdersTable({
  orders,
  assetMetas,
  onCancel,
  cancelling,
}: {
  orders: OpenOrder[]
  assetMetas: AssetMeta[]
  onCancel: (coin: string, oid: number) => void
  cancelling: number | null
}) {
  if (orders.length === 0) {
    return <p className="text-center text-gray-500 text-sm py-8">No open orders</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 uppercase tracking-wider border-b border-lexa-border/30">
            <th className="text-left py-2 px-3 font-bold">Asset</th>
            <th className="text-left py-2 px-3 font-bold">Side</th>
            <th className="text-left py-2 px-3 font-bold">Type</th>
            <th className="text-right py-2 px-3 font-bold">Price</th>
            <th className="text-right py-2 px-3 font-bold">Size</th>
            <th className="text-right py-2 px-3 font-bold">Time</th>
            <th className="text-right py-2 px-3 font-bold">Action</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const isBuy = o.side === 'B'
            const displayName = o.coin === 'PAXG' ? 'GOLD' : o.coin
            return (
              <tr key={o.oid} className="border-b border-lexa-border/20 hover:bg-lexa-glass/30 transition-colors">
                <td className="py-2.5 px-3 font-display font-bold text-white">{displayName}</td>
                <td className={`py-2.5 px-3 font-bold ${sideColor(o.side)}`}>{isBuy ? 'BUY' : 'SELL'}</td>
                <td className="py-2.5 px-3 text-gray-400">
                  {o.isTrigger ? (o.triggerCondition === 'tp' ? 'TP' : 'SL') : o.orderType}
                  {o.reduceOnly && <span className="text-yellow-400 ml-1">R</span>}
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-gray-300">${o.limitPx}</td>
                <td className="py-2.5 px-3 text-right font-mono text-gray-300">{o.origSz}</td>
                <td className="py-2.5 px-3 text-right text-gray-500">
                  {new Date(o.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="py-2.5 px-3 text-right">
                  <button
                    disabled={cancelling === o.oid}
                    onClick={() => onCancel(o.coin, o.oid)}
                    className="text-neon-red/70 hover:text-neon-red text-[10px] font-bold uppercase disabled:opacity-50"
                  >
                    {cancelling === o.oid ? 'Cancelling...' : 'Cancel'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Fills Table ──────────────────────────────────────────────────────────────

function FillsTable({ fills }: { fills: UserFill[] }) {
  const recent = fills.slice(0, 30)
  if (recent.length === 0) {
    return <p className="text-center text-gray-500 text-sm py-8">No recent trades</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 uppercase tracking-wider border-b border-lexa-border/30">
            <th className="text-left py-2 px-3 font-bold">Asset</th>
            <th className="text-left py-2 px-3 font-bold">Side</th>
            <th className="text-right py-2 px-3 font-bold">Price</th>
            <th className="text-right py-2 px-3 font-bold">Size</th>
            <th className="text-right py-2 px-3 font-bold">PnL</th>
            <th className="text-right py-2 px-3 font-bold">Fee</th>
            <th className="text-right py-2 px-3 font-bold">Time</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((f) => {
            const pnl = num(f.closedPnl)
            return (
              <tr key={f.tid} className="border-b border-lexa-border/20 hover:bg-lexa-glass/30 transition-colors">
                <td className="py-2 px-3 font-display font-bold text-white">
                  {f.coin === 'PAXG' ? 'GOLD' : f.coin}
                </td>
                <td className={`py-2 px-3 font-bold ${f.dir.includes('Long') || f.side === 'B' ? 'text-neon-green' : 'text-neon-red'}`}>
                  {f.dir}
                </td>
                <td className="py-2 px-3 text-right font-mono text-gray-300">${f.px}</td>
                <td className="py-2 px-3 text-right font-mono text-gray-300">{f.sz}</td>
                <td className={`py-2 px-3 text-right font-mono ${pnlColor(pnl)}`}>
                  {pnl !== 0 ? `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}` : '--'}
                </td>
                <td className="py-2 px-3 text-right font-mono text-gray-500">${num(f.fee).toFixed(4)}</td>
                <td className="py-2 px-3 text-right text-gray-500">
                  {new Date(f.time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Account Bar ──────────────────────────────────────────────────────────────

function AccountBar({
  margin,
  withdrawable,
  onWithdraw,
  onTransfer,
}: {
  margin: MarginSummary | null
  withdrawable: string
  onWithdraw: () => void
  onTransfer: () => void
}) {
  if (!margin) return null
  const value = num(margin.accountValue)
  const used = num(margin.totalMarginUsed)
  const available = value - used
  const ntl = num(margin.totalNtlPos)
  const usedPct = value > 0 ? (used / value) * 100 : 0

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-2.5 border-b border-lexa-border/50 bg-black/20">
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Account Value</p>
        <p className="text-sm font-mono font-bold text-white">{formatUsd(value)}</p>
      </div>
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Available</p>
        <p className="text-sm font-mono text-neon-green">{formatUsd(available)}</p>
      </div>
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Margin Used</p>
        <p className="text-sm font-mono text-yellow-400">{formatUsd(used)}</p>
      </div>
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Notional</p>
        <p className="text-sm font-mono text-gray-300">{formatUsd(ntl)}</p>
      </div>
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Withdrawable</p>
        <p className="text-sm font-mono text-gray-300">{formatUsd(num(withdrawable))}</p>
      </div>
      <div className="flex-1 min-w-[120px]">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Margin Usage</p>
        <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              usedPct > 80 ? 'bg-neon-red' : usedPct > 50 ? 'bg-yellow-400' : 'bg-neon-green'
            }`}
            style={{ width: `${Math.min(100, usedPct)}%` }}
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onTransfer}
          className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-lexa-accent/10 text-lexa-accent border border-lexa-accent/30 hover:bg-lexa-accent/20 transition-all"
        >
          Transfer
        </button>
        <button
          onClick={onWithdraw}
          className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-neon-red/10 text-neon-red border border-neon-red/30 hover:bg-neon-red/20 transition-all"
        >
          Withdraw
        </button>
      </div>
    </div>
  )
}

// ── Modals ───────────────────────────────────────────────────────────────────

function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-lexa-border bg-void p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-display font-bold uppercase tracking-widest text-white">{title}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg">&times;</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function WithdrawModal({
  open,
  onClose,
  withdrawable,
  address,
  onToast,
  onRefresh,
}: {
  open: boolean
  onClose: () => void
  withdrawable: string
  address: string
  onToast: (msg: string, type: 'success' | 'error' | 'info') => void
  onRefresh: () => void
}) {
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const maxAmount = num(withdrawable)

  const handleWithdraw = async () => {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) {
      onToast('Enter a valid amount', 'error')
      return
    }
    if (amt > maxAmount) {
      onToast(`Max withdrawable: ${formatUsd(maxAmount)}`, 'error')
      return
    }
    setSubmitting(true)
    try {
      await withdrawUSDC(amount, address)
      onToast(`Withdrawal of $${amount} initiated. ~5 min to Arbitrum.`, 'success')
      setAmount('')
      onClose()
      onRefresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Withdrawal failed'
      onToast(msg, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Withdraw USDC to Arbitrum">
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">Amount (USDC)</label>
            <button onClick={() => setAmount(String(maxAmount))} className="text-[10px] text-lexa-accent hover:underline">
              Max: {formatUsd(maxAmount)}
            </button>
          </div>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full rounded-lg border border-lexa-border bg-black/40 px-3 py-2.5 text-white font-mono text-sm placeholder-gray-600 focus:outline-none focus:border-lexa-accent"
          />
        </div>
        <p className="text-[10px] text-gray-500">
          Destination: {address.slice(0, 10)}...{address.slice(-8)} (Arbitrum)
        </p>
        <p className="text-[10px] text-gray-500">Fee: ~$1 | Processing: ~5 minutes</p>
        <button
          disabled={submitting}
          onClick={handleWithdraw}
          className="w-full py-3 rounded-xl font-display font-bold uppercase tracking-wider text-sm bg-neon-red/20 text-neon-red border border-neon-red/40 hover:bg-neon-red/30 disabled:opacity-50 transition-all"
        >
          {submitting ? 'Signing...' : 'Withdraw'}
        </button>
      </div>
    </Modal>
  )
}

function TransferModal({
  open,
  onClose,
  onToast,
  onRefresh,
}: {
  open: boolean
  onClose: () => void
  onToast: (msg: string, type: 'success' | 'error' | 'info') => void
  onRefresh: () => void
}) {
  const [amount, setAmount] = useState('')
  const [direction, setDirection] = useState<'toPerp' | 'toSpot'>('toPerp')
  const [submitting, setSubmitting] = useState(false)

  const handleTransfer = async () => {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) {
      onToast('Enter a valid amount', 'error')
      return
    }
    setSubmitting(true)
    try {
      await transferUSDC(amount, direction === 'toPerp')
      onToast(`Transferred $${amount} ${direction === 'toPerp' ? 'Spot → Perp' : 'Perp → Spot'}`, 'success')
      setAmount('')
      onClose()
      onRefresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transfer failed'
      onToast(msg, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Transfer USDC">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-black/40 border border-lexa-border/30">
          <button
            onClick={() => setDirection('toPerp')}
            className={`py-2 rounded-md text-xs font-display font-bold uppercase tracking-wider transition-all ${
              direction === 'toPerp'
                ? 'bg-lexa-accent/20 text-lexa-accent border border-lexa-accent/30'
                : 'text-gray-500 border border-transparent'
            }`}
          >
            Spot → Perp
          </button>
          <button
            onClick={() => setDirection('toSpot')}
            className={`py-2 rounded-md text-xs font-display font-bold uppercase tracking-wider transition-all ${
              direction === 'toSpot'
                ? 'bg-lexa-accent/20 text-lexa-accent border border-lexa-accent/30'
                : 'text-gray-500 border border-transparent'
            }`}
          >
            Perp → Spot
          </button>
        </div>
        <div>
          <label className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1 block">Amount (USDC)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full rounded-lg border border-lexa-border bg-black/40 px-3 py-2.5 text-white font-mono text-sm placeholder-gray-600 focus:outline-none focus:border-lexa-accent"
          />
        </div>
        <button
          disabled={submitting}
          onClick={handleTransfer}
          className="w-full py-3 rounded-xl font-display font-bold uppercase tracking-wider text-sm bg-lexa-accent/20 text-lexa-accent border border-lexa-accent/40 hover:bg-lexa-accent/30 disabled:opacity-50 transition-all"
        >
          {submitting ? 'Signing...' : 'Transfer'}
        </button>
      </div>
    </Modal>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function PerpsPage() {
  const { address } = useWallet()
  const [asset, setAsset] = useState<PerpAsset>('BTC')
  const [candleInterval, setCandleInterval] = useState<CandleInterval>('15m')
  const [bottomTab, setBottomTab] = useState<'positions' | 'orders' | 'fills'>('positions')

  // Market data
  const [assetMetas, setAssetMetas] = useState<AssetMeta[]>([])
  const [assetCtxs, setAssetCtxs] = useState<AssetCtx[]>([])
  const [mids, setMids] = useState<Record<string, string>>({})
  const [bids, setBids] = useState<L2Level[]>([])
  const [asks, setAsks] = useState<L2Level[]>([])
  const [candles, setCandles] = useState<HlCandle[]>([])

  // User data
  const [margin, setMargin] = useState<MarginSummary | null>(null)
  const [positions, setPositions] = useState<AssetPosition[]>([])
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([])
  const [fills, setFills] = useState<UserFill[]>([])
  const [withdrawable, setWithdrawable] = useState('0')

  // UI state
  const [loading, setLoading] = useState(true)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [cancelling, setCancelling] = useState<number | null>(null)
  const [closing, setClosing] = useState<string | null>(null)
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)

  const wsRef = useRef<HyperliquidWs | null>(null)
  const prevAssetRef = useRef(asset)
  const tradeFormRef = useRef<{ setPriceFromBook: (px: string) => void } | null>(null)

  // Toast helpers
  const addToast = useCallback((message: string, type: 'success' | 'error' | 'info') => {
    const id = ++toastId
    setToasts((prev) => [...prev, { id, message, type, expiry: Date.now() + 5000 }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000)
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // ── Derive context for current asset ────────────────────────────────────
  const coin = hlCoinName(asset)
  const assetIndex = useMemo(
    () => assetMetas.findIndex((m) => m.name === coin),
    [assetMetas, coin],
  )
  const currentCtx = assetIndex >= 0 ? assetCtxs[assetIndex] ?? null : null
  const currentMeta = assetIndex >= 0 ? assetMetas[assetIndex] ?? null : null
  const markPrice = currentCtx ? num(currentCtx.markPx) : num(mids[coin])

  const available = useMemo(() => {
    if (!margin) return 0
    return num(margin.accountValue) - num(margin.totalMarginUsed)
  }, [margin])

  // ── Fetch market data ───────────────────────────────────────────────────
  const fetchMarketData = useCallback(async () => {
    try {
      const [metaCtx, book] = await Promise.all([
        fetchMetaAndCtxs(),
        fetchL2Book(coin),
      ])
      setAssetMetas(metaCtx.meta.universe)
      setAssetCtxs(metaCtx.contexts)
      if (book.levels[0]) setBids(book.levels[0])
      if (book.levels[1]) setAsks(book.levels[1])
    } catch (err) {
      console.error('[HL] market data error', err)
    } finally {
      setLoading(false)
    }
  }, [coin])

  // ── Fetch candles ───────────────────────────────────────────────────────
  const fetchCandleData = useCallback(async () => {
    try {
      const data = await fetchCandles(coin, candleInterval, LOOKBACK_MS[candleInterval])
      setCandles(data)
    } catch (err) {
      console.error('[HL] candle error', err)
    }
  }, [coin, candleInterval])

  const fetchUserData = useCallback(async () => {
    if (!address) return
    try {
      const [state, orders, userFills] = await Promise.all([
        fetchClearinghouseState(address),
        fetchOpenOrders(address),
        fetchUserFills(address),
      ])
      setMargin(state.crossMarginSummary)
      setPositions(state.assetPositions)
      setOpenOrders(orders)
      setFills(userFills)
      setWithdrawable(state.withdrawable)
    } catch (err) {
      console.error('[HL] user data error', err)
    }
  }, [address])

  // ── Initial load + polling ──────────────────────────────────────────────
  useEffect(() => {
    void fetchMarketData()
    void fetchCandleData()
    void fetchUserData()

    const dataInterval = setInterval(() => {
      void fetchMarketData()
      void fetchUserData()
    }, 5000)

    const candleRefreshMs = candleInterval === '1m' ? 5000 : candleInterval === '5m' ? 15000 : 30000
    const candleIntv = setInterval(fetchCandleData, candleRefreshMs)

    return () => {
      clearInterval(dataInterval)
      clearInterval(candleIntv)
    }
  }, [fetchMarketData, fetchCandleData, fetchUserData, candleInterval])

  // ── Clear candles and refetch when asset or interval changes ────────────
  useEffect(() => {
    setCandles([])
    void fetchCandleData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coin, candleInterval])

  // ── WebSocket for real-time updates ─────────────────────────────────────
  useEffect(() => {
    const ws = new HyperliquidWs()
    wsRef.current = ws
    ws.connect()

    ws.subscribe({ type: 'allMids' })
    ws.subscribe({ type: 'l2Book', coin })

    if (address) {
      ws.subscribe({ type: 'orderUpdates', user: address })
    }

    ws.onMessage((channel, data) => {
      if (channel === 'allMids') {
        const d = data as { mids: Record<string, string> }
        if (d.mids) setMids(d.mids)
      }

      if (channel === 'l2Book') {
        const d = data as { coin: string; levels: [L2Level[], L2Level[]] }
        if (d.coin === coin) {
          setBids(d.levels[0] ?? [])
          setAsks(d.levels[1] ?? [])
        }
      }

      if (channel === 'orderUpdates') {
        void fetchUserData()
      }
    })

    return () => ws.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coin, address])

  // ── Handle asset change (resubscribe WS) ────────────────────────────────
  useEffect(() => {
    const prevCoin = hlCoinName(prevAssetRef.current)
    if (prevCoin !== coin && wsRef.current) {
      wsRef.current.unsubscribe({ type: 'l2Book', coin: prevCoin })
      wsRef.current.subscribe({ type: 'l2Book', coin })
      prevAssetRef.current = asset
      void fetchL2Book(coin).then((book) => {
        setBids(book.levels[0] ?? [])
        setAsks(book.levels[1] ?? [])
      })
    }
  }, [asset, coin])

  // ── Order cancellation handler ──────────────────────────────────────────
  const handleCancelOrder = useCallback(async (orderCoin: string, oid: number) => {
    const idx = assetMetas.findIndex((m) => m.name === orderCoin)
    if (idx < 0) {
      addToast('Asset not found', 'error')
      return
    }
    setCancelling(oid)
    try {
      await cancelOrders([{ asset: idx, oid }], (msg) => addToast(msg, 'info'))
      addToast(`Order #${oid} cancelled`, 'success')
      void fetchUserData()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Cancel failed'
      addToast(msg, 'error')
    } finally {
      setCancelling(null)
    }
  }, [assetMetas, addToast, fetchUserData])

  // ── Position close handler (market close) ───────────────────────────────
  const handleClosePosition = useCallback(async (posCoin: string, sz: number, isLong: boolean) => {
    const idx = assetMetas.findIndex((m) => m.name === posCoin)
    if (idx < 0) {
      addToast('Asset not found', 'error')
      return
    }
    setClosing(posCoin)
    try {
      const meta = assetMetas[idx]
      // Get current mid price for the coin
      const midPx = num(mids[posCoin]) || markPrice
      const slipPrice = marketSlippagePrice(midPx, !isLong) // close = opposite side
      const result = await placeOrder({
        asset: idx,
        isBuy: !isLong, // close long = sell, close short = buy
        price: priceToWire(slipPrice),
        size: sizeToWire(sz, meta.szDecimals),
        reduceOnly: true,
        orderType: 'market',
      }, (msg) => addToast(msg, 'info')) as OrderResult

      const statuses = result.response?.data?.statuses
      if (statuses && statuses.length > 0) {
        const s = statuses[0]
        if ('filled' in s) {
          addToast(`Position closed at $${s.filled.avgPx}`, 'success')
        } else if ('error' in s) {
          addToast(s.error, 'error')
        } else {
          addToast('Close order placed', 'success')
        }
      } else {
        addToast('Close order submitted', 'success')
      }
      void fetchUserData()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Close failed'
      addToast(msg, 'error')
    } finally {
      setClosing(null)
    }
  }, [assetMetas, mids, markPrice, addToast, fetchUserData])

  // ── Order book price click → fill trade form ───────────────────────────
  const [limitPriceFromBook, setLimitPriceFromBook] = useState('')
  const handleBookPriceClick = useCallback((px: string) => {
    setLimitPriceFromBook(px)
  }, [])

  // ── Loading ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-6 lg:p-10">
        <h1 className="font-display text-2xl font-bold text-white mb-4">Perpetuals</h1>
        <Card className="p-12">
          <div className="flex items-center justify-center gap-3 text-gray-400">
            <svg className="animate-spin h-5 w-5 text-lexa-accent" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Connecting to Hyperliquid...
          </div>
        </Card>
      </div>
    )
  }

  const positionCount = positions.filter((p) => Math.abs(num(p.position.szi)) > 0.0000001).length

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] lg:h-screen overflow-hidden">
      {/* Toasts */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Modals */}
      {address && (
        <>
          <WithdrawModal
            open={showWithdraw}
            onClose={() => setShowWithdraw(false)}
            withdrawable={withdrawable}
            address={address}
            onToast={addToast}
            onRefresh={fetchUserData}
          />
          <TransferModal
            open={showTransfer}
            onClose={() => setShowTransfer(false)}
            onToast={addToast}
            onRefresh={fetchUserData}
          />
        </>
      )}

      {/* ── Asset Tabs ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-lexa-border/50 bg-void overflow-x-auto">
        <h1 className="font-display text-lg font-bold text-white mr-2 whitespace-nowrap">Perps</h1>
        <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-lexa-accent/15 text-lexa-accent border border-lexa-accent/30 mr-2 whitespace-nowrap">
          Hyperliquid
        </span>
        {PERP_ASSETS.map((a) => {
          const c = hlCoinName(a)
          const midPrice = mids[c] ?? (assetCtxs[assetMetas.findIndex((m) => m.name === c)]?.markPx ?? '0')
          const idx = assetMetas.findIndex((m) => m.name === c)
          const ctx = idx >= 0 ? assetCtxs[idx] : null
          const change = ctx ? get24hChange(ctx) : 0
          return (
            <AssetTab
              key={a}
              asset={a}
              active={asset === a}
              price={formatPrice(midPrice, a)}
              change={change}
              onClick={() => setAsset(a)}
            />
          )
        })}
      </div>

      {/* ── Price Bar ─────────────────────────────────────────────────── */}
      <PriceBar asset={asset} ctx={currentCtx} meta={currentMeta} />

      {/* ── Account Bar (if connected) ────────────────────────────────── */}
      {address && (
        <AccountBar
          margin={margin}
          withdrawable={withdrawable}
          onWithdraw={() => setShowWithdraw(true)}
          onTransfer={() => setShowTransfer(true)}
        />
      )}

      {/* ── Main Content: Chart + OrderBook + TradeForm ────────────────── */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left: Chart + Bottom Tabs */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 min-h-[300px] border-b border-lexa-border/50">
            <CandlestickChart
              candles={candles}
              asset={asset}
              interval={candleInterval}
              onIntervalChange={setCandleInterval}
            />
          </div>

          {/* Bottom Panel: Positions / Orders / Fills */}
          <div className="h-[200px] flex flex-col">
            <div className="flex items-center gap-1 px-3 py-1.5 border-b border-lexa-border/50 shrink-0">
              {([
                { key: 'positions', label: 'Positions', count: positionCount },
                { key: 'orders', label: 'Open Orders', count: openOrders.length },
                { key: 'fills', label: 'Trade History', count: null },
              ] as const).map(({ key, label, count }) => (
                <button
                  key={key}
                  onClick={() => setBottomTab(key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-display font-bold uppercase tracking-wider transition-all ${
                    bottomTab === key
                      ? 'bg-lexa-glass text-lexa-accent border border-lexa-accent/30'
                      : 'text-gray-500 hover:text-gray-300 border border-transparent'
                  }`}
                >
                  {label}
                  {count != null && count > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] bg-lexa-accent/20 text-lexa-accent">
                      {count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-auto">
              {!address ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-gray-500 text-sm">Connect wallet to view positions</p>
                </div>
              ) : (
                <>
                  {bottomTab === 'positions' && (
                    <PositionsTable
                      positions={positions}
                      assetMetas={assetMetas}
                      onClose={handleClosePosition}
                      closing={closing}
                    />
                  )}
                  {bottomTab === 'orders' && (
                    <OrdersTable
                      orders={openOrders}
                      assetMetas={assetMetas}
                      onCancel={handleCancelOrder}
                      cancelling={cancelling}
                    />
                  )}
                  {bottomTab === 'fills' && <FillsTable fills={fills} />}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right side: Order Book + Trade Form */}
        <div className="w-[580px] xl:w-[640px] flex-shrink-0 flex border-l border-lexa-border/50">
          <div className="w-[260px] border-r border-lexa-border/50 flex flex-col">
            <OrderBook bids={bids} asks={asks} markPrice={markPrice} asset={asset} onPriceClick={handleBookPriceClick} />
          </div>
          <div className="flex-1 flex flex-col">
            <TradeFormWrapper
              asset={asset}
              assetIndex={assetIndex}
              markPrice={markPrice}
              maxLeverage={currentMeta?.maxLeverage ?? 20}
              szDecimals={currentMeta?.szDecimals ?? 4}
              available={available}
              connected={!!address}
              onToast={addToast}
              onRefresh={fetchUserData}
              limitPriceFromBook={limitPriceFromBook}
            />
          </div>
        </div>
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-lexa-border/50 bg-black/40 text-[10px] text-gray-600 shrink-0">
        <span>
          Hyperliquid | {asset === 'GOLD' ? 'PAXG' : asset}-PERP | Mark: ${formatPrice(markPrice, asset)}
          {currentCtx && ` | Funding: ${formatFunding(currentCtx.funding)}`}
        </span>
        <span>
          WS: <span className={wsRef.current?.connected ? 'text-neon-green' : 'text-neon-red'}>
            {wsRef.current?.connected ? 'Connected' : 'Disconnected'}
          </span>
          {' | '}Data refreshes every 5s
        </span>
      </div>
    </div>
  )
}

// Wrapper to bridge order book price clicks into TradeForm
function TradeFormWrapper({
  limitPriceFromBook,
  ...props
}: {
  asset: PerpAsset
  assetIndex: number
  markPrice: number
  maxLeverage: number
  szDecimals: number
  available: number
  connected: boolean
  onToast: (msg: string, type: 'success' | 'error' | 'info') => void
  onRefresh: () => void
  limitPriceFromBook: string
}) {
  const [side, setSide] = useState<'long' | 'short'>('long')
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market')
  const [price, setPrice] = useState('')
  const [size, setSize] = useState('')
  const [leverage, setLeverage] = useState(10)
  const [reduceOnly, setReduceOnly] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [leverageSet, setLeverageSet] = useState(false)

  const { asset, assetIndex, markPrice, maxLeverage, szDecimals, available, connected, onToast, onRefresh } = props

  // Sync book price click
  useEffect(() => {
    if (limitPriceFromBook) {
      setPrice(limitPriceFromBook)
      setOrderType('limit')
    }
  }, [limitPriceFromBook])

  // Reset leverage tracking when asset changes
  useEffect(() => {
    setLeverageSet(false)
  }, [asset])

  const effectivePrice = orderType === 'limit' && price ? parseFloat(price) : markPrice
  const isLong = side === 'long'
  const coinLabel = asset === 'GOLD' ? 'PAXG' : asset

  const notionalValue = useMemo(() => {
    const sz = parseFloat(size)
    if (!sz || !effectivePrice) return 0
    return sz * effectivePrice
  }, [size, effectivePrice])

  const marginRequired = useMemo(() => {
    if (!notionalValue || !leverage) return 0
    return notionalValue / leverage
  }, [notionalValue, leverage])

  const setPercentSize = useCallback((pct: number) => {
    if (!markPrice || !available) return
    const maxNotional = available * leverage * pct
    const maxSz = maxNotional / markPrice
    setSize(sizeToWire(maxSz, szDecimals))
  }, [markPrice, available, leverage, szDecimals])

  const handleLeverageChange = useCallback(async (newLev: number) => {
    setLeverage(newLev)
    if (connected && assetIndex >= 0) {
      try {
        await updateLeverage(assetIndex, newLev, true, (msg) => onToast(msg, 'info'))
        setLeverageSet(true)
      } catch {
        // will set before order
      }
    }
  }, [connected, assetIndex, onToast])

  const handleSubmit = useCallback(async () => {
    if (!connected) {
      onToast('Connect your wallet to trade', 'error')
      return
    }
    if (assetIndex < 0) {
      onToast('Asset not found on Hyperliquid', 'error')
      return
    }
    const sz = parseFloat(size)
    if (!sz || sz <= 0) {
      onToast('Enter a valid size', 'error')
      return
    }
    const orderNotional = sz * effectivePrice
    if (orderNotional < 10) {
      onToast('Minimum order value is $10', 'error')
      return
    }
    if (!reduceOnly && marginRequired > available && available > 0) {
      onToast(`Insufficient margin. Need ${formatUsd(marginRequired)}, have ${formatUsd(available)}`, 'error')
      return
    }

    setSubmitting(true)
    try {
      if (!leverageSet) {
        await updateLeverage(assetIndex, leverage, true, (msg) => onToast(msg, 'info'))
        setLeverageSet(true)
      }

      let orderPrice: string
      if (orderType === 'market') {
        const slipPrice = marketSlippagePrice(markPrice, isLong)
        orderPrice = priceToWire(slipPrice)
      } else {
        if (!price) {
          onToast('Enter a limit price', 'error')
          setSubmitting(false)
          return
        }
        orderPrice = priceToWire(parseFloat(price))
      }

      const result = await placeOrder({
        asset: assetIndex,
        isBuy: isLong,
        price: orderPrice,
        size: sizeToWire(sz, szDecimals),
        reduceOnly,
        orderType,
      }, (msg) => onToast(msg, 'info')) as OrderResult

      const statuses = result.response?.data?.statuses
      if (statuses && statuses.length > 0) {
        const s = statuses[0]
        if ('filled' in s) {
          onToast(`${isLong ? 'Long' : 'Short'} ${sz} ${coinLabel} filled at $${s.filled.avgPx}`, 'success')
          setSize('')
        } else if ('resting' in s) {
          onToast(`Limit order placed (OID: ${s.resting.oid})`, 'success')
          setSize('')
        } else if ('error' in s) {
          onToast(s.error, 'error')
        }
      } else {
        onToast('Order submitted', 'success')
        setSize('')
      }
      onRefresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Order failed'
      if (msg.includes('user rejected') || msg.includes('User denied')) {
        onToast('Transaction rejected by wallet', 'info')
      } else {
        onToast(msg, 'error')
      }
    } finally {
      setSubmitting(false)
    }
  }, [connected, assetIndex, size, effectivePrice, reduceOnly, marginRequired, available, leverageSet, leverage, orderType, markPrice, isLong, price, asset, szDecimals, coinLabel, onToast, onRefresh])

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b border-lexa-border/50">
        <h3 className="text-xs font-display font-bold uppercase tracking-widest text-lexa-accent">
          Trade {asset === 'GOLD' ? 'GOLD (PAXG)' : asset}-PERP
        </h3>
      </div>

      <div className="p-4 space-y-4 flex-1 overflow-y-auto">
        {/* Side Toggle */}
        <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-black/40 border border-lexa-border/30">
          <button
            onClick={() => setSide('long')}
            className={`py-2.5 rounded-md text-sm font-display font-bold uppercase tracking-wider transition-all ${
              isLong
                ? 'bg-neon-green/20 text-neon-green border border-neon-green/40 shadow-glow-green'
                : 'text-gray-500 hover:text-gray-300 border border-transparent'
            }`}
          >
            Long
          </button>
          <button
            onClick={() => setSide('short')}
            className={`py-2.5 rounded-md text-sm font-display font-bold uppercase tracking-wider transition-all ${
              !isLong
                ? 'bg-neon-red/20 text-neon-red border border-neon-red/40 shadow-glow-red'
                : 'text-gray-500 hover:text-gray-300 border border-transparent'
            }`}
          >
            Short
          </button>
        </div>

        {/* Order Type */}
        <div className="flex gap-1 p-0.5 rounded-lg bg-black/30">
          {(['market', 'limit'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setOrderType(t)}
              className={`flex-1 py-1.5 rounded-md text-xs font-display font-bold uppercase tracking-wider ${
                orderType === t
                  ? 'bg-lexa-glass text-lexa-accent border border-lexa-accent/30'
                  : 'text-gray-500 hover:text-gray-300 border border-transparent'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Price (limit only) */}
        {orderType === 'limit' && (
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider font-bold mb-1 block">Price (USD)</label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={formatPrice(markPrice, asset)}
              className="w-full rounded-lg border border-lexa-border bg-void px-3 py-2.5 text-white font-mono text-sm placeholder-gray-600 focus:outline-none focus:border-lexa-accent"
            />
          </div>
        )}

        {/* Size */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">
              Size ({coinLabel})
            </label>
            {connected && available > 0 && (
              <span className="text-[10px] text-gray-500">
                Avail: <span className="text-neon-green">{formatUsd(available)}</span>
              </span>
            )}
          </div>
          <input
            type="number"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            placeholder="0.00"
            className="w-full rounded-lg border border-lexa-border bg-void px-3 py-2.5 text-white font-mono text-sm placeholder-gray-600 focus:outline-none focus:border-lexa-accent"
          />
          {connected && available > 0 && (
            <div className="flex gap-1.5 mt-1.5">
              {[0.1, 0.25, 0.5, 0.75, 1].map((pct) => (
                <button
                  key={pct}
                  onClick={() => setPercentSize(pct)}
                  className="flex-1 py-1 rounded text-[10px] font-bold bg-gray-800/50 text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 border border-transparent transition-all"
                >
                  {pct * 100}%
                </button>
              ))}
            </div>
          )}
          {notionalValue > 0 && (
            <div className="text-[10px] text-gray-500 mt-1.5 space-y-0.5">
              <p>Notional: {formatUsd(notionalValue)} | Margin: {formatUsd(marginRequired)}</p>
              {!reduceOnly && marginRequired > available && available > 0 && (
                <p className="text-neon-red">Insufficient margin</p>
              )}
            </div>
          )}
        </div>

        {/* Leverage Slider */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">Leverage</label>
            <span className="text-sm font-mono font-bold text-lexa-accent">{leverage}x</span>
          </div>
          <input
            type="range"
            min={1}
            max={maxLeverage}
            value={leverage}
            onChange={(e) => handleLeverageChange(parseInt(e.target.value))}
            className="w-full accent-lexa-accent h-1.5 rounded-full appearance-none bg-gray-800 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-gray-600 mt-1">
            <span>1x</span>
            <span>{Math.floor(maxLeverage / 4)}x</span>
            <span>{Math.floor(maxLeverage / 2)}x</span>
            <span>{maxLeverage}x</span>
          </div>
          <div className="flex gap-1.5 mt-2">
            {[1, 5, 10, 20, 50].filter((l) => l <= maxLeverage).map((l) => (
              <button
                key={l}
                onClick={() => handleLeverageChange(l)}
                className={`flex-1 py-1 rounded text-[10px] font-bold transition-all ${
                  leverage === l
                    ? 'bg-lexa-accent/20 text-lexa-accent border border-lexa-accent/40'
                    : 'bg-gray-800/50 text-gray-500 hover:text-gray-300 border border-transparent'
                }`}
              >
                {l}x
              </button>
            ))}
          </div>
        </div>

        {/* Reduce Only */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={reduceOnly}
            onChange={(e) => setReduceOnly(e.target.checked)}
            className="rounded border-gray-600 bg-void text-lexa-accent focus:ring-lexa-accent/50"
          />
          <span className="text-xs text-gray-400">Reduce Only</span>
        </label>
      </div>

      {/* Submit Button */}
      <div className="p-4 pt-0">
        <button
          disabled={submitting}
          onClick={handleSubmit}
          className={`w-full py-3.5 rounded-xl font-display font-bold uppercase tracking-wider text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
            isLong
              ? 'bg-neon-green/20 text-neon-green border border-neon-green/40 hover:bg-neon-green/30 shadow-glow-green'
              : 'bg-neon-red/20 text-neon-red border border-neon-red/40 hover:bg-neon-red/30 shadow-glow-red'
          }`}
        >
          {submitting ? 'Signing...' : `${isLong ? 'Long' : 'Short'} ${asset} — ${orderType === 'market' ? 'Market' : 'Limit'}`}
        </button>
        <p className="text-[10px] text-gray-600 text-center mt-2">
          {connected ? 'EIP-712 signing via wallet' : 'Connect wallet to trade'}
        </p>
      </div>
    </div>
  )
}
