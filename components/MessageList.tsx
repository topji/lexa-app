'use client'

import { Message } from '@/types/chat'
import MarketCard from './MarketCard'

interface MessageListProps {
  messages: Message[]
  isLoading: boolean
}

export default function MessageList({ messages, isLoading }: MessageListProps) {
  return (
    <div className="space-y-6">
      {messages.map((message) => (
        <div
          key={message.id}
          className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`max-w-[82%] rounded-2xl px-5 py-4 ${
              message.role === 'user'
                ? 'bg-gradient-to-br from-neon-cyan/20 to-neon-magenta/20 border border-neon-cyan/30 text-white shadow-glow-cyan'
                : 'bg-void-card/80 border border-void-border text-gray-200'
            }`}
          >
            <p className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed">{message.content}</p>
            {message.markets && message.markets.length > 0 && (
              <div className="mt-4 space-y-3">
                <p className="font-display text-xs font-semibold uppercase tracking-wider text-neon-cyan mb-2">Markets</p>
                {message.markets.map((market) => (
                  <MarketCard key={market.id} market={market} />
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
      {isLoading && (
        <div className="flex justify-start">
          <div className="rounded-2xl border border-void-border bg-void-card/80 px-5 py-4">
            <div className="flex space-x-2">
              <div className="w-2.5 h-2.5 bg-neon-cyan rounded-full animate-bounce opacity-90" style={{ animationDelay: '0ms' }} />
              <div className="w-2.5 h-2.5 bg-neon-magenta rounded-full animate-bounce opacity-90" style={{ animationDelay: '150ms' }} />
              <div className="w-2.5 h-2.5 bg-neon-cyan rounded-full animate-bounce opacity-90" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
