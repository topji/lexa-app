'use client'

import React, { createContext, useCallback, useContext, useState } from 'react'
import type { ClobClient } from '@polymarket/clob-client'
import type { RelayClient } from '@polymarket/builder-relayer-client'
import { useWallet, POLYGON_CHAIN_ID_EXPORT } from '@/contexts/WalletContext'
import { createRelayClient } from '@/lib/relayer-client'
import { createClobClient, type ApiCreds, createSafeClobClient } from '@/lib/clob-client'
import { deriveSafeAddress, createApprovalTransactions } from '@/lib/trading-helpers'

interface TradingSession {
  eoaAddress: string
  safeAddress: string | null
  apiCreds: ApiCreds | null
  approvalsDone: boolean
}

interface TradingContextValue {
  session: TradingSession | null
  clobClient: ClobClient | null
  relayClient: RelayClient | null
  /** Address that holds positions (Safe when using gasless; use for balance/claim). */
  tradingAddress: string | null
  initializing: boolean
  step: string | null
  error: string | null
  initialize: () => Promise<void>
}

const TradingContext = createContext<TradingContextValue | null>(null)

const SESSION_KEY = 'lexa_trading_session'

function loadStoredSession(eoa: string | null): TradingSession | null {
  if (!eoa || typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(`${SESSION_KEY}_${eoa.toLowerCase()}`)
    if (!raw) return null
    return JSON.parse(raw) as TradingSession
  } catch {
    return null
  }
}

function saveStoredSession(session: TradingSession) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(`${SESSION_KEY}_${session.eoaAddress.toLowerCase()}`, JSON.stringify(session))
  } catch {
    // ignore
  }
}

export function TradingProvider({ children }: { children: React.ReactNode }) {
  const { address, chainId } = useWallet()
  const [session, setSession] = useState<TradingSession | null>(() => loadStoredSession(address))
  const [clobClient, setClobClient] = useState<ClobClient | null>(null)
  const [relayClient, setRelayClient] = useState<RelayClient | null>(null)
  const [initializing, setInitializing] = useState(false)
  const [step, setStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const initialize = useCallback(async () => {
    if (!address) {
      setError('Connect your wallet first.')
      return
    }
    if (chainId !== POLYGON_CHAIN_ID_EXPORT) {
      setError('Switch to Polygon to trade.')
      return
    }
    if (initializing) return

    setInitializing(true)
    setError(null)
    setStep('Preparing trading session…')

    try {
      // 1. Try to re-use existing session and clob client
      if (session && clobClient) {
        return
      }

      let nextSession: TradingSession | null = session && session.eoaAddress === address ? session : null

      // 2. Ensure RelayClient
      setStep('Connecting to relayer…')
      const relayer = await createRelayClient()
      setRelayClient(relayer)

      // 3. Ensure Safe
      setStep('Ensuring gasless Safe wallet…')
      const safeAddress = nextSession?.safeAddress ?? deriveSafeAddress(address)
      const deployed = await relayer.getDeployed(safeAddress)
      if (!deployed) {
        const resp = await relayer.deploy()
        await resp.wait()
      }

      // 4. Ensure user API credentials (L2)
      setStep('Deriving user API credentials…')
      const baseClient = await createClobClient()
      // createClobClient already derives/loads ApiCreds and stores them; we can re-read from its config
      // For simplicity, load from storage using address
      const creds: ApiCreds | null = (() => {
        try {
          const raw = typeof window !== 'undefined'
            ? sessionStorage.getItem(`lexa_polymarket_api_creds_${address.toLowerCase()}`)
            : null
          return raw ? (JSON.parse(raw) as ApiCreds) : null
        } catch {
          return null
        }
      })()

      if (!creds) {
        throw new Error('Failed to load user API credentials.')
      }

      // 5. Ensure approvals via RelayClient (best-effort; ignore if they already exist)
      setStep('Setting token approvals…')
      const approvalTxs = createApprovalTransactions()
      if (approvalTxs.length > 0) {
        const resp = await relayer.execute(approvalTxs, 'Set trading approvals')
        await resp.wait()
      }

      nextSession = {
        eoaAddress: address,
        safeAddress,
        apiCreds: creds,
        approvalsDone: true,
      }
      setSession(nextSession)
      saveStoredSession(nextSession)

      // 6. Create authenticated Safe-based CLOB client
      setStep('Finalizing trading client…')
      const safeClob = await createSafeClobClient(creds, safeAddress)
      setClobClient(safeClob)
      setStep(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg || 'Failed to initialize trading session.')
      console.error('Trading session error:', e)
    } finally {
      setInitializing(false)
    }
  }, [address, chainId, initializing, session, clobClient])

  const tradingAddress =
    session?.safeAddress ?? (address ? deriveSafeAddress(address) : null)

  const value: TradingContextValue = {
    session,
    clobClient,
    relayClient,
    tradingAddress,
    initializing,
    step,
    error,
    initialize,
  }

  return (
    <TradingContext.Provider value={value}>
      {children}
    </TradingContext.Provider>
  )
}

export function useTrading() {
  const ctx = useContext(TradingContext)
  if (!ctx) throw new Error('useTrading must be used within TradingProvider')
  return ctx
}

