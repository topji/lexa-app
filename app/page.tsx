'use client'

import ChatInterface from '@/components/ChatInterface'
import { CryptoPriceTicker } from '@/components/CryptoPriceTicker'

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-4xl">
        <CryptoPriceTicker />
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-white mb-2">Chat</h1>
          <p className="text-gray-400 text-base">
            Ask about Polymarket markets — crypto, politics, or search by keyword.
          </p>
        </div>
        <ChatInterface />
      </div>
    </div>
  )
}

