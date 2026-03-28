'use client'

import Link from 'next/link'
import { InefficiencyGroup } from '@/lib/inefficiency'

interface InefficiencyCardProps {
  group: InefficiencyGroup
}

const TYPE_LABELS: Record<string, string> = {
  ranking_inconsistency: 'Ranking Inconsistency',
  probability_overflow: 'Probability Overflow',
  dependent_mispricing: 'Dependent Mispricing',
}

const TYPE_COLORS: Record<string, { border: string; bg: string; text: string }> = {
  ranking_inconsistency: { border: 'border-yellow-500/40', bg: 'bg-yellow-500/10', text: 'text-yellow-400' },
  probability_overflow: { border: 'border-orange-500/40', bg: 'bg-orange-500/10', text: 'text-orange-400' },
  dependent_mispricing: { border: 'border-purple-500/40', bg: 'bg-purple-500/10', text: 'text-purple-400' },
}

function SeverityBar({ severity }: { severity: number }) {
  const color =
    severity >= 60 ? 'bg-neon-red' :
    severity >= 30 ? 'bg-yellow-400' :
    'bg-neon-green'
  const label =
    severity >= 60 ? 'HIGH' :
    severity >= 30 ? 'MEDIUM' :
    'LOW'

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-gray-800 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${severity}%` }}
        />
      </div>
      <span className={`text-xs font-mono font-bold ${
        severity >= 60 ? 'text-neon-red' : severity >= 30 ? 'text-yellow-400' : 'text-neon-green'
      }`}>
        {label} ({severity})
      </span>
    </div>
  )
}

export default function InefficiencyCard({ group }: InefficiencyCardProps) {
  const colors = TYPE_COLORS[group.type] ?? TYPE_COLORS.ranking_inconsistency

  return (
    <div className={`rounded-2xl border ${colors.border} bg-lexa-glass p-5 space-y-4`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`px-2.5 py-0.5 text-[10px] font-display font-bold uppercase tracking-wider rounded-lg ${colors.bg} ${colors.text} border ${colors.border}`}>
              {TYPE_LABELS[group.type] ?? group.type}
            </span>
            {group.probabilitySum != null && (
              <span className="text-[10px] font-mono text-gray-500">
                Sum: {(group.probabilitySum * 100).toFixed(1)}%
              </span>
            )}
          </div>
          <h4 className="font-sans font-semibold text-white text-base leading-snug">
            {group.groupTitle}
          </h4>
        </div>
      </div>

      {/* Severity */}
      <SeverityBar severity={group.severity} />

      {/* Explanation */}
      <p className="text-sm text-gray-400 leading-relaxed whitespace-pre-line">
        {group.explanation}
      </p>

      {/* Entity Breakdown for ranking inconsistencies */}
      {group.entityBreakdown && group.entityBreakdown.length > 0 && (
        <div className="space-y-2">
          <h5 className="font-display text-xs font-semibold text-gray-500 uppercase tracking-widest">
            Entity Breakdown
          </h5>
          <div className="space-y-2">
            {group.entityBreakdown.slice(0, 5).map((entity) => (
              <div key={entity.entity} className="rounded-xl border border-lexa-border bg-void/30 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-sans font-semibold text-white text-sm capitalize">
                    {entity.entity}
                  </span>
                  <span className={`text-xs font-mono font-bold ${
                    entity.deviation > 0.3 ? 'text-neon-red' :
                    entity.deviation > 0.15 ? 'text-yellow-400' :
                    'text-gray-500'
                  }`}>
                    Sum: {(entity.totalProbability * 100).toFixed(0)}%
                    {entity.totalProbability > 1 ? ' (overpriced)' : entity.totalProbability < 0.8 ? ' (underpriced)' : ''}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {entity.probabilities.map((p, i) => {
                    const shortTitle = p.eventTitle.length > 35
                      ? p.eventTitle.slice(0, 35) + '...'
                      : p.eventTitle
                    return (
                      <div
                        key={i}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-800/60 border border-gray-700/50"
                      >
                        <span className="text-[11px] text-gray-400 truncate max-w-[160px]">{shortTitle}</span>
                        <span className={`text-xs font-mono font-bold ${
                          p.price >= 0.5 ? 'text-neon-green' : 'text-gray-300'
                        }`}>
                          {(p.price * 100).toFixed(0)}%
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Markets involved */}
      <div className="space-y-2">
        <h5 className="font-display text-xs font-semibold text-gray-500 uppercase tracking-widest">
          Markets ({group.markets.length})
        </h5>
        {group.markets.map((market) => {
          const eventSlug = market.slug ?? market.eventSlug
          const polyUrl = eventSlug
            ? `https://polymarket.com/event/${eventSlug}`
            : market.url
          const tradeHref = eventSlug ? `/market/${encodeURIComponent(eventSlug)}` : null
          return (
            <div
              key={market.marketId}
              className="rounded-xl border border-lexa-border bg-void/20 p-3 hover:border-lexa-accent/40 transition-colors group"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="font-sans font-medium text-white text-sm group-hover:text-lexa-accent transition-colors flex-1 min-w-0">
                  {market.title}
                </span>
                <div className="flex flex-shrink-0 items-center gap-2">
                  {tradeHref && (
                    <Link
                      href={tradeHref}
                      className="inline-flex items-center rounded-md bg-lexa-accent/20 px-2 py-1 text-[10px] font-display font-bold uppercase tracking-wide text-lexa-accent border border-lexa-accent/40 hover:bg-lexa-accent/30"
                    >
                      Trade
                    </Link>
                  )}
                  {polyUrl && (
                    <a
                      href={polyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-display font-semibold uppercase tracking-wide text-gray-500 hover:text-lexa-accent"
                    >
                      Poly ↗
                    </a>
                  )}
                  {market.volume24h > 0 && (
                    <span className="text-[10px] text-gray-600 font-mono whitespace-nowrap">
                      Vol ${market.volume24h >= 1000 ? (market.volume24h / 1000).toFixed(1) + 'K' : market.volume24h.toFixed(0)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {market.outcomes.slice(0, 6).map((o, i) => {
                  const isHigh = o.price >= 0.5
                  return (
                    <div
                      key={i}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs border ${
                        isHigh
                          ? 'border-neon-green/30 bg-neon-green/10'
                          : 'border-gray-700/50 bg-gray-800/40'
                      }`}
                    >
                      <span className={`font-sans ${isHigh ? 'text-neon-green' : 'text-gray-400'}`}>
                        {o.label}
                      </span>
                      <span className={`font-mono font-bold ${isHigh ? 'text-neon-green' : 'text-gray-500'}`}>
                        {(o.price * 100).toFixed(0)}%
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
