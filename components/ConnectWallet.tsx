'use client'

import { useWallet } from '@/contexts/WalletContext'

export function ConnectWallet() {
  const { address, isConnecting, connectionError, hasProvider, connect, disconnect } = useWallet()

  if (address) {
    return (
      <button
        type="button"
        onClick={() => disconnect()}
        className="rounded-lg border border-[#1e293b] bg-[#0f172a]/80 px-3 py-2 text-xs font-medium text-gray-300 hover:bg-[#1e293b] hover:text-white transition-colors"
        title={address}
      >
        {address.slice(0, 6)}…{address.slice(-4)}
      </button>
    )
  }

  return (
    <div className="space-y-1.5">
      {!hasProvider && (
        <p className="text-xs text-amber-400/90">
          No Web3 wallet detected. Install{' '}
          <a
            href="https://metamask.io/download/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-amber-300"
          >
            MetaMask
          </a>
          , then refresh.
        </p>
      )}
      <button
        type="button"
        onClick={() => connect()}
        disabled={isConnecting || !hasProvider}
        className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors w-full"
      >
        {isConnecting ? 'Connecting…' : 'Connect wallet'}
      </button>
      {connectionError && (
        <p className="text-xs text-red-400" role="alert">
          {connectionError}
        </p>
      )}
    </div>
  )
}
