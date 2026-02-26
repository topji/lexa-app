'use client'

import ChatInterface from '@/components/ChatInterface'
import { CryptoPriceTicker } from '@/components/CryptoPriceTicker'

export default function Home() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-6 sm:p-6 md:p-8 bg-void bg-grid">
      {/* Ambient gradient orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-neon-cyan/10 blur-[100px]" />
        <div className="absolute top-1/2 -left-40 h-72 w-72 rounded-full bg-neon-magenta/10 blur-[100px]" />
      </div>

      <div className="relative w-full max-w-4xl flex flex-col min-h-0">
        <CryptoPriceTicker />
        <div className="mb-4 sm:mb-6 md:mb-8 text-center">
          <h1 className="font-display text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-white mb-1 sm:mb-2">
            <span className="text-glow-cyan">CHAT</span>
          </h1>
          <p className="font-sans text-sm sm:text-base md:text-lg text-gray-400 tracking-wide px-1">
            Ask about Polymarket — <span className="text-neon-cyan">crypto</span>, <span className="text-neon-magenta">politics</span>, or search by keyword.
          </p>
        </div>
        <ChatInterface />
      </div>
    </div>
  )
}
