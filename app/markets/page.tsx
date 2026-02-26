'use client'

import { useState, useCallback } from 'react'
import MarketCard from '@/components/MarketCard'
import { PolymarketMarket } from '@/types/polymarket'

export default function MarketsPage() {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [markets, setMarkets] = useState<PolymarketMarket[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  const fetchMarkets = useCallback(async (keyword: string) => {
    setLoading(true)
    setSearched(true)
    try {
      const params = new URLSearchParams()
      if (keyword.trim()) {
        params.set('search', keyword.trim())
      }
      const res = await fetch(`/api/markets?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setMarkets(data.markets ?? [])
    } catch {
      setMarkets([])
    } finally {
      setLoading(false)
    }
  }, [])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setQuery(search)
    fetchMarkets(search)
  }

  const handleClear = () => {
    setSearch('')
    setQuery('')
    setMarkets([])
    setSearched(false)
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-white mb-1">Markets</h1>
          <p className="text-gray-500 text-sm mb-6">
            Search active Polymarket markets. Enter a keyword to find relevant markets.
          </p>

          <form onSubmit={handleSearch} className="flex gap-2 flex-wrap">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="e.g. Bitcoin, Trump, Fed, Oscars..."
              className="flex-1 min-w-[200px] rounded-xl border border-[#1e293b] bg-[#0f172a]/80 px-4 py-3 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              aria-label="Search markets"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-blue-600 px-5 py-3 font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Searching…' : 'Search'}
            </button>
            {searched && (
              <button
                type="button"
                onClick={handleClear}
                className="rounded-xl border border-[#1e293b] px-4 py-3 text-gray-400 hover:bg-[#0f172a]/80 transition-colors"
              >
                Clear
              </button>
            )}
          </form>
        </div>

        {loading && (
          <div className="rounded-xl border border-gray-600 bg-gray-800/50 p-12 text-center">
            <p className="text-gray-400">Loading markets…</p>
          </div>
        )}

        {!loading && searched && (
          <>
            <div className="mb-4 text-gray-400">
              {query
                ? `Showing ${markets.length} market${markets.length !== 1 ? 's' : ''} for “${query}”.`
                : `Showing ${markets.length} active market${markets.length !== 1 ? 's' : ''} (newest first).`}
            </div>

            {markets.length === 0 ? (
              <div className="rounded-xl border border-gray-600 bg-gray-800/50 p-12 text-center">
                <p className="text-gray-400 mb-2">No markets found.</p>
                <p className="text-sm text-gray-500">
                  Try a different keyword or search without a term to browse latest active markets.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {markets.map((market) => (
                  <MarketCard key={market.id} market={market} />
                ))}
              </div>
            )}
          </>
        )}

        {!loading && !searched && (
          <div className="rounded-xl border border-gray-600 bg-gray-800/50 p-12 text-center">
            <p className="text-gray-400 mb-2">Enter a keyword and click Search</p>
            <p className="text-sm text-gray-500">
              Results are from the Polymarket Gamma API (active markets only). Leave the search empty and click Search to browse latest markets.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
