'use client'

import { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { useWallet, POLYGON_CHAIN_ID_EXPORT } from '@/contexts/WalletContext'
import { useTrading } from '@/contexts/TradingContext'
import { createRelayClient } from '@/lib/relayer-client'
import { getOutcomeBalances, buildRedeemPositionsTx } from '@/lib/trading-helpers'

interface MarketPositionAndClaimProps {
  conditionId: string | null
  upTokenId: string
  downTokenId: string
  isResolved: boolean
  polymarketUrl: string
}

export function MarketPositionAndClaim({
  conditionId,
  upTokenId,
  downTokenId,
  isResolved,
  polymarketUrl,
}: MarketPositionAndClaimProps) {
  const { address, chainId } = useWallet()
  const { tradingAddress } = useTrading()
  const [position, setPosition] = useState<{ up: number; down: number } | null>(null)
  const [positionLoading, setPositionLoading] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)
  const [claimSuccess, setClaimSuccess] = useState(false)

  const onPolygon = chainId === POLYGON_CHAIN_ID_EXPORT
  const owner = tradingAddress ?? address ?? null
  const hasPosition = position != null && (position.up > 0 || position.down > 0)

  useEffect(() => {
    if (!owner || !upTokenId || !downTokenId || typeof window === 'undefined' || !onPolygon) {
      setPosition(null)
      return
    }
    setPositionLoading(true)
    const win = window as unknown as { ethereum?: unknown }
    if (!win.ethereum) {
      setPositionLoading(false)
      return
    }
    const provider = new ethers.providers.Web3Provider(win.ethereum as ethers.providers.ExternalProvider)
    getOutcomeBalances(provider, owner, upTokenId, downTokenId)
      .then(setPosition)
      .catch(() => setPosition({ up: 0, down: 0 }))
      .finally(() => setPositionLoading(false))
  }, [owner, upTokenId, downTokenId, onPolygon])

  const handleClaim = async () => {
    if (!conditionId || !owner || !onPolygon) return
    setClaiming(true)
    setClaimError(null)
    setClaimSuccess(false)
    try {
      const client = await createRelayClient()
      const tx = buildRedeemPositionsTx(conditionId)
      const response = await client.execute([tx], 'Claim winnings')
      await response.wait()
      setClaimSuccess(true)
      setPosition((prev) => (prev ? { up: 0, down: 0 } : null))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setClaimError(msg || 'Claim failed')
    } finally {
      setClaiming(false)
    }
  }

  if (!address) return null

  return (
    <div className="mt-4 pt-4 border-t border-[#334155]">
      <div className="text-gray-500 text-xs font-medium uppercase tracking-wider mb-2">
        Your position
      </div>

      {!onPolygon && (
        <p className="text-xs text-amber-400/90">Switch to Polygon to view position and claim.</p>
      )}

      {onPolygon && (
        <>
          {positionLoading ? (
            <p className="text-xs text-gray-400">Loading…</p>
          ) : position != null ? (
            <div className="text-xs text-gray-300 space-y-1">
              <div className="flex gap-4">
                <span className="text-green-400">
                  Up: {position.up.toLocaleString('en-US', { maximumFractionDigits: 2 })} sh
                </span>
                <span className="text-red-400">
                  Down: {position.down.toLocaleString('en-US', { maximumFractionDigits: 2 })} sh
                </span>
              </div>
              {!hasPosition && (
                <p className="text-gray-500">No position in this market.</p>
              )}
            </div>
          ) : null}

          {onPolygon && hasPosition && !isResolved && (
            <p className="text-xs text-gray-500 mt-2">
              To exit before resolution,{' '}
              <a href={polymarketUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                sell your tokens on Polymarket
              </a>
              .
            </p>
          )}

          {onPolygon && isResolved && hasPosition && conditionId && (
            <div className="mt-3 space-y-2">
              <button
                type="button"
                onClick={handleClaim}
                disabled={claiming}
                className="w-full rounded-xl border border-green-500/50 bg-green-500/20 text-green-400 hover:bg-green-500/30 py-2 text-sm font-medium transition-colors disabled:opacity-50"
              >
                {claiming ? 'Claiming…' : 'Claim winnings'}
              </button>
              {claimError && (
                <p className="text-xs text-red-400" role="alert">{claimError}</p>
              )}
              {claimSuccess && (
                <p className="text-xs text-green-400" role="status">Winnings claimed. USDC sent to your gasless wallet.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
