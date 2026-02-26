'use client'

import { useState } from 'react'
import { useWallet, POLYGON_CHAIN_ID_EXPORT } from '@/contexts/WalletContext'
import { useTrading } from '@/contexts/TradingContext'
import { OrderType, Side, AssetType } from '@polymarket/clob-client'

type OrderMode = 'market' | 'limit'

interface PlaceOrderPanelProps {
  upTokenId: string
  downTokenId: string
  upPrice: number | null
  downPrice: number | null
  polymarketUrl: string
}

export function PlaceOrderPanel({
  upTokenId,
  downTokenId,
  upPrice,
  downPrice,
  polymarketUrl,
}: PlaceOrderPanelProps) {
  const { address, chainId, switchToPolygon } = useWallet()
  const { clobClient, initialize, initializing, step, error: tradingError } = useTrading()
  const [orderMode, setOrderMode] = useState<OrderMode>('market')
  const [amount, setAmount] = useState('')
  const [limitPrice, setLimitPrice] = useState('')
  const [limitSize, setLimitSize] = useState('')
  const [loading, setLoading] = useState<'up' | 'down' | null>(null)
  const [switching, setSwitching] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const onPolygon = chainId === POLYGON_CHAIN_ID_EXPORT
  const isConnected = !!address
  const amountNum = parseFloat(amount) || 0
  const limitPriceNum = parseFloat(limitPrice) || 0
  const limitSizeNum = parseFloat(limitSize) || 0
  const canPlaceMarket = isConnected && onPolygon && amountNum >= 1
  const canPlaceLimit = isConnected && onPolygon && limitPriceNum > 0 && limitPriceNum <= 1 && limitSizeNum >= 1

  const orderErrorMessage = (err: string): string => {
    if (/not enough balance|allowance/i.test(err)) {
      return 'Your gasless wallet needs more USDC.e or completed approvals. Fund it in the sidebar and run trading setup, then try again.'
    }
    return err
  }

  const placeMarketOrder = async (side: 'up' | 'down') => {
    if (!clobClient) {
      await initialize()
    }
    if (!clobClient) return
    if (!canPlaceMarket || amountNum < 1) return
    const tokenId = side === 'up' ? upTokenId : downTokenId
    const price = side === 'up' ? upPrice : downPrice
    if (!tokenId) {
      setMessage({ type: 'error', text: 'Missing market data' })
      return
    }
    setLoading(side)
    setMessage(null)
    try {
      await clobClient.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL }).catch(() => {})
      const market = await clobClient.getMarket(tokenId)
      const tickSize = market?.tickSize ?? '0.01'
      const negRisk = market?.negRisk ?? false
      const res = await clobClient.createAndPostMarketOrder(
        {
          tokenID: tokenId,
          amount: amountNum,
          side: Side.BUY,
          price: price ?? 0.5,
          // Omit feeRateBps so the client uses the market's required fee (e.g. 1000 bps for builder markets)
        },
        { tickSize, negRisk },
        OrderType.FOK
      )
      if (res?.success) {
        setMessage({ type: 'success', text: `Order filled. Order ID: ${res.orderID || '—'}` })
        setAmount('')
      } else {
        setMessage({ type: 'error', text: res?.errorMsg || 'Order failed' })
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      setMessage({ type: 'error', text: orderErrorMessage(err) })
    } finally {
      setLoading(null)
    }
  }

  const placeLimitOrder = async (side: 'up' | 'down') => {
    if (!clobClient) {
      await initialize()
    }
    if (!clobClient) return
    if (!canPlaceLimit) return
    const tokenId = side === 'up' ? upTokenId : downTokenId
    if (!tokenId) {
      setMessage({ type: 'error', text: 'Missing market data' })
      return
    }
    setLoading(side)
    setMessage(null)
    try {
      await clobClient.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL }).catch(() => {})
      const market = await clobClient.getMarket(tokenId)
      const tickSize = market?.tickSize ?? '0.01'
      const negRisk = market?.negRisk ?? false
      const res = await clobClient.createAndPostOrder(
        {
          tokenID: tokenId,
          price: limitPriceNum,
          size: limitSizeNum,
          side: Side.BUY,
        },
        { tickSize, negRisk },
        OrderType.GTC
      )
      if (res?.orderID) {
        setMessage({ type: 'success', text: `Limit order placed. Order ID: ${res.orderID}` })
        setLimitSize('')
      } else {
        setMessage({ type: 'error', text: res?.errorMsg || 'Order failed' })
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      setMessage({ type: 'error', text: orderErrorMessage(err) })
    } finally {
      setLoading(null)
    }
  }

  const handleSwitchToPolygon = async () => {
    setSwitching(true)
    try {
      await switchToPolygon()
    } finally {
      setSwitching(false)
    }
  }

  if (!isConnected) {
    return (
      <div className="rounded-2xl border border-lexa-border bg-lexa-glass p-4 text-center">
        <p className="font-sans text-gray-500 text-sm mb-2">Connect your wallet to place orders</p>
        <a href={polymarketUrl} target="_blank" rel="noopener noreferrer" className="text-lexa-accent hover:underline text-sm font-display font-semibold uppercase tracking-wide">
          Or trade on Polymarket →
        </a>
      </div>
    )
  }

  if (!onPolygon) {
    return (
      <div className="rounded-2xl border border-lexa-border bg-lexa-glass p-4 text-center">
        <p className="font-sans text-gray-500 text-sm mb-2">Switch to Polygon to trade</p>
        <button
          type="button"
          onClick={handleSwitchToPolygon}
          disabled={switching}
          className="rounded-xl bg-lexa-gradient text-white px-4 py-2 text-sm font-display font-bold uppercase tracking-wide hover:opacity-90 disabled:opacity-50 transition-colors"
        >
          {switching ? 'Switching…' : 'Switch to Polygon'}
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-lexa-border bg-lexa-glass p-5 space-y-4">
      {initializing && (
        <p className="text-xs text-lexa-accent font-sans">
          {step || 'Preparing trading session…'}
        </p>
      )}
      {!initializing && tradingError && (
        <p className="text-xs text-neon-red font-sans" role="alert">
          {tradingError}
        </p>
      )}
      <div className="flex rounded-xl border border-lexa-border p-0.5 bg-void">
        <button
          type="button"
          onClick={() => setOrderMode('market')}
          className={`flex-1 rounded-lg px-3 py-2 text-xs font-display font-semibold uppercase tracking-wide transition-colors ${orderMode === 'market' ? 'bg-lexa-accent/20 text-white' : 'text-gray-500 hover:text-gray-300'}`}
        >
          Market
        </button>
        <button
          type="button"
          onClick={() => setOrderMode('limit')}
          className={`flex-1 rounded-lg px-3 py-2 text-xs font-display font-semibold uppercase tracking-wide transition-colors ${orderMode === 'limit' ? 'bg-lexa-accent/20 text-white' : 'text-gray-500 hover:text-gray-300'}`}
        >
          Limit (GTC)
        </button>
      </div>

      {orderMode === 'market' ? (
        <div>
          <label className="font-display text-gray-500 text-xs font-semibold uppercase tracking-widest block mb-1">
            Amount (USD)
          </label>
          <input
            type="number"
            min={1}
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="input-glow w-full rounded-xl border border-lexa-border bg-void px-4 py-3 text-white font-mono placeholder-gray-600 focus:outline-none focus:border-lexa-accent"
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="font-display text-gray-500 text-xs font-semibold uppercase tracking-widest block mb-1">
              Price (0–1)
            </label>
            <input
              type="number"
              min={0.01}
              max={0.99}
              step={0.01}
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder="0.50"
              className="input-glow w-full rounded-xl border border-lexa-border bg-void px-4 py-3 text-white font-mono placeholder-gray-600 focus:outline-none focus:border-lexa-accent"
            />
          </div>
          <div>
            <label className="font-display text-gray-500 text-xs font-semibold uppercase tracking-widest block mb-1">
              Size (shares)
            </label>
            <input
              type="number"
              min={1}
              step={1}
              value={limitSize}
              onChange={(e) => setLimitSize(e.target.value)}
              placeholder="10"
              className="input-glow w-full rounded-xl border border-lexa-border bg-void px-4 py-3 text-white font-mono placeholder-gray-600 focus:outline-none focus:border-lexa-accent"
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => (orderMode === 'market' ? placeMarketOrder('up') : placeLimitOrder('up'))}
          disabled={loading !== null || (orderMode === 'market' ? !canPlaceMarket : !canPlaceLimit)}
          className="rounded-xl bg-neon-green/20 border-2 border-neon-green/50 hover:border-neon-green hover:bg-neon-green/30 p-3 text-center transition-colors disabled:opacity-50"
        >
          <div className="text-neon-green font-display font-semibold text-sm uppercase tracking-wide">Buy Up</div>
          <div className="text-lg font-mono font-bold text-white tabular-nums">
            {upPrice != null ? `${Math.round(upPrice * 100)}¢` : '—'}
          </div>
          {loading === 'up' && <div className="text-xs text-gray-400 mt-1 font-sans">Placing…</div>}
        </button>
        <button
          type="button"
          onClick={() => (orderMode === 'market' ? placeMarketOrder('down') : placeLimitOrder('down'))}
          disabled={loading !== null || (orderMode === 'market' ? !canPlaceMarket : !canPlaceLimit)}
          className="rounded-xl bg-lexa-glass border-2 border-lexa-border hover:border-neon-red/50 hover:bg-neon-red/10 p-3 text-center transition-colors disabled:opacity-50"
        >
          <div className="text-neon-red font-display font-semibold text-sm uppercase tracking-wide">Buy Down</div>
          <div className="text-lg font-mono font-bold text-white tabular-nums">
            {downPrice != null ? `${Math.round(downPrice * 100)}¢` : '—'}
          </div>
          {loading === 'down' && <div className="text-xs text-gray-400 mt-1 font-sans">Placing…</div>}
        </button>
      </div>

      {message && (
        <p className={`font-sans text-sm ${message.type === 'success' ? 'text-neon-green' : 'text-neon-red'}`}>
          {message.text}
        </p>
      )}

      <p className="font-sans text-gray-500 text-xs">
        {orderMode === 'market'
          ? 'Market orders (FOK) execute immediately at best available price. Min $1. You need USDC.e on Polygon.'
          : 'Limit orders (GTC) rest in the book until filled or cancelled. Get market info from Gamma API.'}
      </p>
    </div>
  )
}
