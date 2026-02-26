'use client'

const MOCK_STATS = {
  totalVolume: 1_247_392,
  totalPredictions: 184_392,
  users: 12_847,
  volume24h: 1_247_392,
  chatRequests: 56_203,
}

const MOCK_LEADERBOARD = [
  { rank: 1, username: 'crypto_whale', volume: 124_520, predictions: 892 },
  { rank: 2, username: 'alpha_trader', volume: 98_340, predictions: 756 },
  { rank: 3, username: 'poly_bull', volume: 87_102, predictions: 634 },
  { rank: 4, username: 'moon_shot', volume: 76_445, predictions: 521 },
  { rank: 5, username: 'defi_maxi', volume: 65_230, predictions: 488 },
  { rank: 6, username: 'lexa_fan', volume: 58_901, predictions: 412 },
  { rank: 7, username: 'odds_master', volume: 52_334, predictions: 387 },
  { rank: 8, username: 'signal_seeker', volume: 48_120, predictions: 356 },
  { rank: 9, username: 'btc_diamond', volume: 44_567, predictions: 298 },
  { rank: 10, username: 'prediction_pro', volume: 41_203, predictions: 267 },
]

function StatCard({
  label,
  value,
  sub,
  className = '',
}: {
  label: string
  value: string
  sub?: string
  className?: string
}) {
  return (
    <div className={`rounded-2xl border border-void-border bg-void-card/90 p-5 sm:p-6 card-glow ${className}`}>
      <p className="font-display text-xs font-semibold uppercase tracking-widest text-gray-500 mb-1">{label}</p>
      <p className="font-mono text-2xl sm:text-3xl font-bold text-white tabular-nums">{value}</p>
      {sub != null && <p className="font-sans text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  )
}

export default function DashboardPage() {
  const formatVol = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : n.toLocaleString()

  return (
    <div className="min-h-screen bg-void text-white bg-grid">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="mb-8">
          <h1 className="font-display text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white">
            <span className="text-glow-cyan">DASHBOARD</span>
          </h1>
          <p className="font-sans text-gray-500 text-sm mt-1 tracking-wide">Platform overview and top traders</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 sm:gap-5 mb-10">
          <StatCard label="Total Volume" value={`$${formatVol(MOCK_STATS.totalVolume)}`} sub="All-time" />
          <StatCard label="Total Predictions" value={MOCK_STATS.totalPredictions.toLocaleString()} sub="Markets resolved" />
          <StatCard label="Users" value={MOCK_STATS.users.toLocaleString()} sub="Registered wallets" />
          <StatCard label="Volume (24H)" value={`$${formatVol(MOCK_STATS.volume24h)}`} sub="Last 24 hours" />
          <StatCard
            label="Chat Requests"
            value={MOCK_STATS.chatRequests.toLocaleString()}
            sub="AI assistant queries"
            className="sm:col-span-2 lg:col-span-1"
          />
        </div>

        <div className="rounded-2xl border border-void-border bg-void-card/90 overflow-hidden card-glow">
          <div className="p-4 sm:p-5 border-b border-void-border">
            <h2 className="font-display text-lg sm:text-xl font-bold text-white uppercase tracking-wide">
              Leaderboard
            </h2>
            <p className="font-sans text-gray-500 text-sm mt-0.5">Top 10 users by volume</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[400px]">
              <thead>
                <tr className="border-b border-void-border">
                  <th className="text-left font-display text-xs font-semibold uppercase tracking-widest text-gray-500 py-3 px-4 sm:px-5">#</th>
                  <th className="text-left font-display text-xs font-semibold uppercase tracking-widest text-gray-500 py-3 px-4 sm:px-5">Username</th>
                  <th className="text-right font-display text-xs font-semibold uppercase tracking-widest text-gray-500 py-3 px-4 sm:px-5">Volume</th>
                  <th className="text-right font-display text-xs font-semibold uppercase tracking-widest text-gray-500 py-3 px-4 sm:px-5 hidden sm:table-cell">Predictions</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_LEADERBOARD.map((row) => (
                  <tr
                    key={row.rank}
                    className="border-b border-void-border last:border-b-0 hover:bg-void-border/30 transition-colors"
                  >
                    <td className="py-3 px-4 sm:px-5">
                      <span
                        className={`inline-flex w-7 h-7 sm:w-8 sm:h-8 items-center justify-center rounded-lg font-display font-bold text-sm ${
                          row.rank === 1
                            ? 'bg-amber-500/20 text-amber-400'
                            : row.rank === 2
                              ? 'bg-gray-400/20 text-gray-300'
                              : row.rank === 3
                                ? 'bg-amber-700/30 text-amber-600'
                                : 'bg-void-border text-gray-400'
                        }`}
                      >
                        {row.rank}
                      </span>
                    </td>
                    <td className="py-3 px-4 sm:px-5 font-sans text-sm font-medium text-white">{row.username}</td>
                    <td className="py-3 px-4 sm:px-5 text-right font-mono font-semibold text-neon-cyan tabular-nums">
                      ${row.volume.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 sm:px-5 text-right font-mono text-sm text-gray-400 tabular-nums hidden sm:table-cell">
                      {row.predictions.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
