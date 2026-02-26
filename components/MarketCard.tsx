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
    const colorClass = isYes ? 'text-green-400' : isNo ? 'text-red-400' : 'text-gray-400'
    const borderClass = isYes ? 'border-green-500/30 bg-green-500/10' : isNo ? 'border-red-500/30 bg-red-500/10' : 'border-[#1e293b] bg-[#0f172a]/50'

    return (
      <div key={index} className={`flex items-center justify-between py-2.5 px-3 rounded-lg border ${borderClass}`}>
        <span className={`font-medium text-sm ${colorClass}`}>{outcome.name}</span>
        <div className="text-right">
          <div className={`font-bold text-lg tabular-nums ${colorClass}`}>{percentage}%</div>
          <div className="text-xs text-gray-500">${price.toFixed(4)}</div>
        </div>
      </div>
    )
  }

  return (
    <div
      onClick={handleClick}
      className="rounded-xl border border-[#1e293b] bg-[#0f172a]/80 p-5 hover:border-[#334155] hover:bg-[#0f172a] transition-all cursor-pointer group"
    >
      <div className="mb-4">
        <div className="flex items-start justify-between mb-2">
          <h4 className="font-semibold text-base text-white group-hover:text-blue-400 transition-colors pr-2 flex-1">
            {market.question}
          </h4>
          {market.category && (
            <span className="px-2.5 py-0.5 text-xs font-medium bg-blue-500/20 text-blue-400 rounded-full whitespace-nowrap ml-2">
              {market.category}
            </span>
          )}
        </div>
        {market.description && (
          <p className="text-sm text-gray-500 mt-2 line-clamp-2">{market.description}</p>
        )}
      </div>

      {market.outcomes && market.outcomes.length > 0 && (
        <div className="mb-4">
          <h5 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
            Outcomes
          </h5>
          <div className="space-y-2">
            {market.outcomes.map((outcome, index) => formatOutcome(outcome, index))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-4 border-t border-[#1e293b]">
        <div className="flex items-center space-x-4 text-xs text-gray-500">
          {market.volume != null && (
            <span>
              Vol ${market.volume >= 1_000_000 ? (market.volume / 1_000_000).toFixed(2) + 'M' : market.volume >= 1000 ? (market.volume / 1000).toFixed(1) + 'K' : market.volume.toFixed(0)}
            </span>
          )}
          {market.tags && market.tags.length > 0 && (
            <span>{market.tags.slice(0, 2).join(', ')}</span>
          )}
        </div>
        <span className="text-blue-400 group-hover:text-blue-300 font-medium text-sm inline-flex items-center gap-1">
          View on Polymarket
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </span>
      </div>
    </div>
  )
}

