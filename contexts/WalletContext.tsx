'use client'

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'

const POLYGON_CHAIN_ID = 137

interface WalletContextValue {
  address: string | null
  chainId: number | null
  isConnecting: boolean
  connectionError: string | null
  connect: () => Promise<void>
  disconnect: () => void
  switchToPolygon: () => Promise<void>
  hasProvider: boolean
}

const WalletContext = createContext<WalletContextValue | null>(null)

type EthereumProvider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }

function getEthereum(): EthereumProvider | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    ethereum?: EthereumProvider | { providers?: EthereumProvider[]; request?: EthereumProvider['request'] }
  }
  const eth = w.ethereum
  if (!eth) return null
  // Multiple wallets (e.g. MetaMask + Coinbase): use first provider that has request
  if (Array.isArray((eth as { providers?: EthereumProvider[] }).providers)) {
    const first = (eth as { providers: EthereumProvider[] }).providers[0]
    return first && typeof first.request === 'function' ? first : null
  }
  return typeof (eth as EthereumProvider).request === 'function' ? (eth as EthereumProvider) : null
}

function parseChainId(id: string | number | undefined): number | null {
  if (id == null) return null
  if (typeof id === 'number') return Number.isFinite(id) ? id : null
  const s = String(id).toLowerCase()
  if (s.startsWith('0x')) return parseInt(s, 16) || null
  return parseInt(s, 10) || null
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null)
  const [chainId, setChainId] = useState<number | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [hasProvider, setHasProvider] = useState(false)

  useEffect(() => {
    const check = () => setHasProvider((p) => p || !!getEthereum())
    check()
    const t = setTimeout(check, 1500)
    return () => clearTimeout(t)
  }, [])

  const updateChainId = useCallback(async () => {
    const eth = getEthereum()
    if (!eth) return
    try {
      const id = await eth.request({ method: 'eth_chainId' })
      setChainId(parseChainId(id as string | number))
    } catch {
      setChainId(null)
    }
  }, [])

  const connect = useCallback(async () => {
    setConnectionError(null)
    const eth = getEthereum()
    if (!eth) {
      setConnectionError('No wallet found. Install MetaMask or another Web3 wallet.')
      return
    }
    setIsConnecting(true)
    try {
      const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[]
      const acc = accounts?.[0]
      if (acc) {
        setAddress(acc)
        await updateChainId()
      } else {
        setConnectionError('No accounts returned.')
      }
    } catch (e) {
      let code: number | undefined
      let message: string | undefined
      if (typeof e === 'object' && e) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyErr = e as any
        if (typeof anyErr.code === 'number') code = anyErr.code
        if (typeof anyErr.message === 'string') message = anyErr.message
      }
      if (!message) {
        message = e instanceof Error ? e.message : String(e)
      }
      const lower = message.toLowerCase()
      if (code === 4001 || lower.includes('reject') || lower.includes('denied') || lower.includes('user denied')) {
        setConnectionError('Connection rejected.')
      } else if (code === 4100 || lower.includes('dapp interaction is disabled')) {
        setConnectionError(
          'DApp connections are disabled for this site in your wallet. Enable this site in your wallet settings and try again.'
        )
      } else {
        setConnectionError(message || 'Failed to connect.')
      }
      console.error('Wallet connect error:', e)
    } finally {
      setIsConnecting(false)
    }
  }, [updateChainId])

  const disconnect = useCallback(() => {
    setAddress(null)
    setChainId(null)
    setConnectionError(null)
  }, [])

  const switchToPolygon = useCallback(async () => {
    const eth = getEthereum()
    if (!eth) return
    try {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${POLYGON_CHAIN_ID.toString(16)}` }],
      })
      await updateChainId()
    } catch (e) {
      console.error(e)
    }
  }, [updateChainId])

  useEffect(() => {
    if (!address) return
    updateChainId()
  }, [address, updateChainId])

  const value: WalletContextValue = {
    address,
    chainId,
    isConnecting,
    connectionError,
    connect,
    disconnect,
    switchToPolygon,
    hasProvider,
  }

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used within WalletProvider')
  return ctx
}

export const POLYGON_CHAIN_ID_EXPORT = POLYGON_CHAIN_ID
