'use client'

import { useState, KeyboardEvent } from 'react'

interface MessageInputProps {
  onSendMessage: (message: string) => void
  disabled: boolean
}

export default function MessageInput({ onSendMessage, disabled }: MessageInputProps) {
  const [input, setInput] = useState('')

  const handleSend = () => {
    if (input.trim() && !disabled) {
      onSendMessage(input)
      setInput('')
    }
  }

  const handleKeyPress = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="border-t border-void-border p-3 sm:p-4 bg-void-card/95 shrink-0">
      <div className="flex gap-2 sm:gap-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Ask about Polymarket markets..."
          className="input-glow flex-1 min-w-0 resize-none rounded-lg sm:rounded-xl border border-void-border bg-void px-3 py-2.5 sm:px-4 sm:py-3 font-sans text-sm sm:text-[15px] text-white placeholder:text-gray-500 focus:outline-none focus:border-neon-cyan disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          rows={1}
          disabled={disabled}
        />
        <button
          onClick={handleSend}
          disabled={disabled || !input.trim()}
          className={`shrink-0 px-4 py-2.5 sm:px-6 sm:py-3 rounded-lg sm:rounded-xl bg-neon-cyan text-void font-display font-bold text-xs sm:text-sm uppercase tracking-wider hover:bg-neon-cyan/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-glow-cyan ${!(disabled || !input.trim()) ? 'animate-pulse-glow' : ''}`}
        >
          Send
        </button>
      </div>
    </div>
  )
}
