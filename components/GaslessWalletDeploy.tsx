'use client'

import { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { useWallet, POLYGON_CHAIN_ID_EXPORT } from '@/contexts/WalletContext'
import { createRelayClient } from '@/lib/relayer-client'
import { USDC_E_ADDRESS, deriveSafeAddress } from '@/lib/trading-helpers'

const SAFE_CACHE_KEY = 'lexa_gasless_safe_address'

const RELAYER_NETWORK_MSG =
  'Could not reach Polymarket relayer (connection timed out). Try again, use a different network, or disable VPN if one is active.'

function normalizeRelayerError(msg: string): string {
  if (!msg) return RELAYER_NETWORK_MSG
  const lower = msg.toLowerCase()
  if (
    lower.includes('connection_timed_out') ||
    lower.includes('err_connection_timed_out') ||
    lower.includes('etimedout') ||
    lower.includes('timeout') ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('net::')
  ) {
    return RELAYER_NETWORK_MSG
  }
  if (lower.includes('request error') || lower.includes('[object object]')) return RELAYER_NETWORK_MSG
  return msg
}

function getStoredSafeAddress(walletAddress: string | null): string | null {
  if (!walletAddress || typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem(`${SAFE_CACHE_KEY}_${walletAddress.toLowerCase()}`)
  } catch {
    return null
  }
}

function setStoredSafeAddress(walletAddress: string, safeAddress: string) {
  try {
    sessionStorage.setItem(`${SAFE_CACHE_KEY}_${walletAddress.toLowerCase()}`, safeAddress)
  } catch {
    // ignore
  }
}

export function GaslessWalletDeploy() {
  const { address, chainId } = useWallet()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [safeAddress, setSafeAddress] = useState<string | null>(null)
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showHowTo, setShowHowTo] = useState(false)
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [withdrawLoading, setWithdrawLoading] = useState(false)
  const [withdrawError, setWithdrawError] = useState<string | null>(null)
  const [withdrawSuccess, setWithdrawSuccess] = useState<string | null>(null)

  const onPolygon = chainId === POLYGON_CHAIN_ID_EXPORT
  const canDeploy = !!address && onPolygon

  const refreshBalance = async (addr: string) => {
    if (!onPolygon || !addr || typeof window === 'undefined') return
    setBalanceLoading(true)
    try {
      const win = window as unknown as { ethereum?: unknown }
      if (!win.ethereum) return
      const provider = new ethers.providers.Web3Provider(win.ethereum as ethers.providers.ExternalProvider)
      const erc20 = new ethers.Contract(
        USDC_E_ADDRESS,
        ['function balanceOf(address) view returns (uint256)'],
        provider
      )
      const raw = await erc20.balanceOf(addr)
      const formatted = Number(ethers.utils.formatUnits(raw, 6)) // USDC.e has 6 decimals
      setUsdcBalance(formatted)
    } catch {
      // best-effort only
    } finally {
      setBalanceLoading(false)
    }
  }

  useEffect(() => {
    const cached = getStoredSafeAddress(address)
    setSafeAddress((prev) => cached ?? prev)
    if (cached && onPolygon) {
      void refreshBalance(cached)
    }
  }, [address, onPolygon])

  const deploy = async () => {
    if (!canDeploy) return
    setLoading(true)
    setError(null)
    try {
      const client = await createRelayClient()
      const response = await client.deploy()
      const result = await response.wait()
      if (result?.proxyAddress) {
        setSafeAddress(result.proxyAddress)
        if (address) setStoredSafeAddress(address, result.proxyAddress)
        if (onPolygon) {
          void refreshBalance(result.proxyAddress)
        }
      } else if (result?.transactionHash) {
        setError('Deploy submitted. Refresh in a moment to see your gasless wallet.')
      } else {
        setError('Deploy submitted; check status and try again.')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.toLowerCase().includes('already deployed')) {
        const cached = address ? getStoredSafeAddress(address) : null
        if (cached) {
          setSafeAddress(cached)
        } else if (address) {
          // Safe is deterministic from EOA; restore address and cache it
          const derived = deriveSafeAddress(address)
          setSafeAddress(derived)
          setStoredSafeAddress(address, derived)
          setError(null)
          if (onPolygon) void refreshBalance(derived)
        } else {
          setError('Gasless wallet already deployed (address not cached).')
        }
      } else {
        setError(normalizeRelayerError(msg) || 'Deploy failed')
      }
    } finally {
      setLoading(false)
    }
  }

  const withdraw = async () => {
    if (!safeAddress || !address || !onPolygon) return
    const amount = withdrawAmount.trim()
    if (!amount || Number(amount) <= 0) {
      setWithdrawError('Enter a valid amount')
      return
    }
    setWithdrawLoading(true)
    setWithdrawError(null)
    setWithdrawSuccess(null)
    try {
      const amountWei = ethers.utils.parseUnits(amount, 6).toString()
      const iface = new ethers.utils.Interface([
        'function transfer(address to, uint256 amount) returns (bool)',
      ])
      const data = iface.encodeFunctionData('transfer', [address, amountWei])
      const client = await createRelayClient()
      const response = await client.execute(
        [{ to: USDC_E_ADDRESS, data, value: '0' }],
        'Withdraw USDC.e'
      )
      await response.wait()
      setWithdrawSuccess('Withdrawal submitted. Balance will update shortly.')
      setWithdrawAmount('')
      void refreshBalance(safeAddress)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const normalized = normalizeRelayerError(msg)
      setWithdrawError(normalized)
    } finally {
      setWithdrawLoading(false)
    }
  }

  const setMaxWithdraw = () => {
    if (usdcBalance != null && usdcBalance > 0) {
      setWithdrawAmount(usdcBalance.toString())
    }
  }

  if (!address) return null

  return (
    <div className="mt-2 space-y-1.5">
      {!onPolygon && (
        <p className="text-xs text-amber-400/90">Switch to Polygon to deploy gasless wallet.</p>
      )}
      {onPolygon && (
        <>
          <button
            type="button"
            onClick={deploy}
            disabled={loading || !!safeAddress}
            className="rounded-lg border border-[#334155] bg-[#1e293b]/80 px-3 py-2 text-xs font-medium text-gray-300 hover:bg-[#334155] hover:text-white disabled:opacity-50 transition-colors w-full"
          >
            {loading ? 'Deploying…' : safeAddress ? 'Gasless wallet ready' : 'Deploy gasless wallet'}
          </button>
          {safeAddress && (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-green-400/90 truncate" title={safeAddress}>
                  Safe: {safeAddress.slice(0, 8)}…{safeAddress.slice(-6)}
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(safeAddress)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1500)
                    } catch {
                      // ignore
                    }
                  }}
                  className="text-[10px] px-1.5 py-0.5 rounded border border-[#334155] text-gray-400 hover:text-white hover:border-[#475569]"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="text-[11px] text-gray-400">
                USDC.e:{' '}
                {balanceLoading
                  ? '…'
                  : usdcBalance != null
                  ? `$${usdcBalance.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
                  : '—'}
              </p>
            </div>
          )}
          {error && (
            <p className="text-xs text-red-400" role="alert">
              {error}
            </p>
          )}
          {safeAddress && (
            <div className="pt-1 space-y-2">
              <div>
                <button
                  type="button"
                  onClick={() => setShowHowTo((v) => !v)}
                  className="text-[11px] text-blue-400 hover:text-blue-300 underline"
                >
                  {showHowTo ? 'Hide add funds instructions' : 'Add funds'}
                </button>
                {showHowTo && (
                  <div className="mt-1 text-[11px] text-gray-400 space-y-1.5">
                    <p>To fund this gasless wallet:</p>
                    <ul className="list-disc list-inside space-y-0.5">
                      <li>
                        Send <span className="text-gray-200">USDC.e on Polygon</span> to the Safe address above.
                      </li>
                      <li>
                        From your normal wallet, choose token{' '}
                        <span className="text-gray-200">USDC.e (Polygon)</span> and paste the Safe address.
                      </li>
                      <li className="text-[10px]">
                        USDC.e contract:{' '}
                        <span className="font-mono">0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174</span>
                      </li>
                    </ul>
                  </div>
                )}
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setShowWithdraw((v) => !v)
                    setWithdrawError(null)
                    setWithdrawSuccess(null)
                  }}
                  className="text-[11px] text-blue-400 hover:text-blue-300 underline"
                >
                  {showWithdraw ? 'Hide withdraw' : 'Withdraw'}
                </button>
                {showWithdraw && (
                  <div className="mt-1.5 text-[11px] space-y-1.5">
                    <p className="text-gray-400">Send USDC.e from your gasless wallet to your connected wallet.</p>
                    <div className="flex gap-1.5 items-center">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="Amount"
                        value={withdrawAmount}
                        onChange={(e) => setWithdrawAmount(e.target.value)}
                        className="rounded border border-[#334155] bg-[#1e293b]/80 px-2 py-1.5 text-gray-200 w-24 font-mono"
                      />
                      <button
                        type="button"
                        onClick={setMaxWithdraw}
                        className="text-[10px] px-1.5 py-1 rounded border border-[#334155] text-gray-400 hover:text-white hover:border-[#475569]"
                      >
                        Max
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={withdraw}
                      disabled={withdrawLoading || !withdrawAmount.trim()}
                      className="rounded border border-[#334155] bg-[#1e293b]/80 px-2 py-1.5 text-[11px] text-gray-300 hover:bg-[#334155] hover:text-white disabled:opacity-50 transition-colors"
                    >
                      {withdrawLoading ? 'Withdrawing…' : 'Withdraw to my wallet'}
                    </button>
                    {withdrawError && (
                      <p className="text-red-400" role="alert">{withdrawError}</p>
                    )}
                    {withdrawSuccess && (
                      <p className="text-green-400" role="status">{withdrawSuccess}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
