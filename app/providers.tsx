'use client'

import { WalletProvider } from '@/contexts/WalletContext'
import { TradingProvider } from '@/contexts/TradingContext'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <TradingProvider>{children}</TradingProvider>
    </WalletProvider>
  )
}
