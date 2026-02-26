'use client'

import { PolymarketMarket } from '@/types/polymarket'

interface MarketCardProps {
  market: PolymarketMarket
}

export default function MarketCard({ market }: MarketCardProps) {
  const polymarketUrl = `https://polymarket.com/event/${market.slug}`
  
  const handleClick = () => {
    window.open(polymarketUrl, '_blank', 'noopener,noreferrer')
  }

  const formatOutcome = (outcome: { name: string; price: number }, index: number) => {
    const price = outcome.price
    const percentage = (price * 100).toFixed(2)
    const isYes = outcome.name.toLowerCase() === 'yes' || outcome.name.toLowerCase() === 'true'
    const isNo = outcome.name.toLowerCase() === 'no' || outcome.name.toLowerCase() === 'false'
    const colorClass = isYes ? 'text-neon-green' : isNo ? 'text-neon-red' : 'text-gray-400'
    const borderClass = isYes ? 'border-neon-green/30 bg-neon-green/10' : isNo ? 'border-neon-red/30 bg-neon-red/10' : 'border-void-border bg-void-card/50'

    return (
      <div key={index} className={`flex items-center justify-between py-2.5 px-3 rounded-xl border ${borderClass}`}>
        <span className={`font-sans font-medium text-sm ${colorClass}`}>{outcome.name}</span>
        <div className="text-right">
          <div className={`font-mono font-bold text-lg tabular-nums ${colorClass}`}>{percentage}%</div>
          <div className="text-xs text-gray-500">${price.toFixed(4)}</div>
        </div>
      </div>
    )
  }

  return (
    <div
      onClick={handleClick}
      className="rounded-2xl border border-void-border bg-void-card/80 p-5 hover:border-neon-cyan/40 hover:bg-void-card transition-all cursor-pointer group card-glow"
    >
      <div className="mb-4">
        <div className="flex items-start justify-between mb-2">
          <h4 className="font-sans font-semibold text-base text-white group-hover:text-neon-cyan transition-colors pr-2 flex-1">
            {market.question}
          </h4>
          {market.category && (
            <span className="px-2.5 py-0.5 text-xs font-display font-semibold bg-neon-cyan/20 text-neon-cyan rounded-lg whitespace-nowrap ml-2 uppercase tracking-wide">
              {market.category}
            </span>
          )}
        </div>
        {market.description && (
          <p className="font-sans text-sm text-gray-500 mt-2 line-clamp-2">{market.description}</p>
        )}
      </div>

      {market.outcomes && market.outcomes.length > 0 && (
        <div className="mb-4">
          <h5 className="font-display text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
            Outcomes
          </h5>
          <div className="space-y-2">
            {market.outcomes.map((outcome, index) => formatOutcome(outcome, index))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-4 border-t border-void-border">
        <div className="flex items-center space-x-4 text-xs text-gray-500 font-sans">
          {market.volume != null && (
            <span>
              Vol ${market.volume >= 1_000_000 ? (market.volume / 1_000_000).toFixed(2) + 'M' : market.volume >= 1000 ? (market.volume / 1000).toFixed(1) + 'K' : market.volume.toFixed(0)}
            </span>
          )}
          {market.tags && market.tags.length > 0 && (
            <span>{market.tags.slice(0, 2).join(', ')}</span>
          )}
        </div>
        <span className="text-neon-cyan group-hover:text-neon-cyan/90 font-display font-semibold text-sm inline-flex items-center gap-1 uppercase tracking-wide">
          View on Polymarket
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </span>
      </div>
    </div>
  )
}

