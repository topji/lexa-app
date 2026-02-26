import { PolymarketMarket } from '@/types/polymarket'

// Polymarket API endpoints
const POLYMARKET_GRAPHQL_URL = 'https://api.thegraph.com/subgraphs/name/polymarket/polymarket'
const POLYMARKET_REST_URL = 'https://clob.polymarket.com/markets'

// Fallback mock data for development/testing
const getMockMarkets = (): PolymarketMarket[] => {
  const now = new Date()
  const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
  
  return [
    {
      id: '1',
      question: 'Will Bitcoin reach $100,000 by end of 2024?',
      description: 'Prediction market for Bitcoin price target',
      slug: 'bitcoin-100k-2024',
      outcomes: [
        { name: 'Yes', price: 0.65 },
        { name: 'No', price: 0.35 },
      ],
      volume: 2500000,
      category: 'Crypto',
      tags: ['bitcoin', 'crypto', 'price'],
      isOpen: true,
      closed: false,
      resolved: false,
      createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
      endDate: futureDate,
    },
    {
      id: '2',
      question: 'Will Ethereum reach $5,000 by end of 2024?',
      description: 'Ethereum price prediction market',
      slug: 'ethereum-5k-2024',
      outcomes: [
        { name: 'Yes', price: 0.72 },
        { name: 'No', price: 0.28 },
      ],
      volume: 1800000,
      category: 'Crypto',
      tags: ['ethereum', 'crypto', 'price'],
      isOpen: true,
      closed: false,
      resolved: false,
      createdAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
      endDate: futureDate,
    },
    {
      id: '3',
      question: 'Will Trump win the 2024 Presidential Election?',
      description: '2024 US Presidential Election prediction',
      slug: 'trump-2024-election',
      outcomes: [
        { name: 'Yes', price: 0.92 },
        { name: 'No', price: 0.08 },
      ],
      volume: 5000000,
      category: 'Politics',
      tags: ['trump', 'election', 'politics'],
      isOpen: true,
      closed: false,
      resolved: false,
      createdAt: new Date(now.getTime() - 5 * 60 * 60 * 1000), // 5 hours ago
      endDate: futureDate,
    },
    {
      id: '4',
      question: 'Will there be a government shutdown in 2024?',
      description: 'US government shutdown prediction',
      slug: 'government-shutdown-2024',
      outcomes: [
        { name: 'Yes', price: 0.15 },
        { name: 'No', price: 0.85 },
      ],
      volume: 1200000,
      category: 'Politics',
      tags: ['government', 'politics', 'shutdown'],
      isOpen: true,
      closed: false,
      resolved: false,
      createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
      endDate: futureDate,
    },
    {
      id: '5',
      question: 'Will the Fed cut rates by more than 0.5% in 2024?',
      description: 'Federal Reserve interest rate prediction',
      slug: 'fed-rate-cut-2024',
      outcomes: [
        { name: 'Yes', price: 0.88 },
        { name: 'No', price: 0.12 },
      ],
      volume: 3200000,
      category: 'Politics',
      tags: ['fed', 'rates', 'politics', 'economics'],
      isOpen: true,
      closed: false,
      resolved: false,
      createdAt: new Date(now.getTime() - 12 * 60 * 60 * 1000), // 12 hours ago
      endDate: futureDate,
    },
    {
      id: '6',
      question: 'Will Solana reach $200 by end of 2024?',
      description: 'Solana price prediction market',
      slug: 'solana-200-2024',
      outcomes: [
        { name: 'Yes', price: 0.58 },
        { name: 'No', price: 0.42 },
      ],
      volume: 950000,
      category: 'Crypto',
      tags: ['solana', 'crypto', 'price'],
      isOpen: true,
      closed: false,
      resolved: false,
      createdAt: new Date(now.getTime() - 6 * 60 * 60 * 1000), // 6 hours ago
      endDate: futureDate,
    },
    // Add a closed market example
    {
      id: '7',
      question: 'Will Bitcoin reach $50,000 by end of 2023?',
      description: 'Closed market example',
      slug: 'bitcoin-50k-2023-closed',
      outcomes: [
        { name: 'Yes', price: 1.0 },
        { name: 'No', price: 0.0 },
      ],
      volume: 5000000,
      category: 'Crypto',
      tags: ['bitcoin', 'crypto', 'price'],
      isOpen: false,
      closed: true,
      resolved: true,
      createdAt: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000), // 60 days ago
      endDate: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
    },
  ]
}

export async function fetchPolymarketMarkets(): Promise<PolymarketMarket[]> {
  try {
    // Try REST API first
    const response = await fetch(POLYMARKET_REST_URL, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Lexa/1.0',
      },
      next: { revalidate: 60 }, // Cache for 60 seconds
    })

    if (!response.ok) {
      throw new Error(`Polymarket API error: ${response.status}`)
    }

    const data = await response.json()
    
    // Handle different response formats
    const markets = Array.isArray(data) ? data : data.data || data.markets || []
    
    // Transform the API response to our format
    return markets.map((market: any) => {
      // Determine if market is open/active
      const isClosed = market.closed || market.resolved || market.isResolved || false
      const endDate = market.endDate || market.end_date || market.endDateTimestamp || market.resolutionDate
      const createdAt = market.createdAt || market.created_at || market.createdDate || market.startDate
      
      // Check if market has valid prices (closed markets often have 0 or 100% prices)
      const hasValidPrices = market.outcomes?.some((o: any) => {
        const price = o.price || o.lastPrice || 0
        return price > 0 && price < 1
      }) || (market.yesPrice && market.yesPrice > 0 && market.yesPrice < 1)
      
      // Market is open if not explicitly closed and has valid prices
      const isOpen = !isClosed && hasValidPrices
      
      return {
        id: market.id || market.conditionId || market.slug || market.condition_id,
        question: market.question || market.title || market.name || 'Untitled Market',
        description: market.description || market.desc || '',
        slug: market.slug || market.id || market.condition_id,
        outcomes: market.outcomes || market.tokens?.map((token: any, index: number) => ({
          name: token.outcome || token.name || (index === 0 ? 'Yes' : 'No'),
          price: token.price || token.lastPrice || 0,
        })) || (market.yesPrice ? [
          { name: 'Yes', price: market.yesPrice },
          { name: 'No', price: 1 - market.yesPrice },
        ] : []),
        volume: market.volume || market.volume24h || market.volume_24h || market.volume24 || 0,
        category: market.category || market.groupItemTitle || market.group_item_title || '',
        tags: market.tags || market.tag || [],
        isOpen,
        closed: isClosed,
        resolved: market.resolved || market.isResolved || false,
        endDate: endDate ? new Date(endDate) : undefined,
        createdAt: createdAt ? new Date(createdAt) : undefined,
      }
    })
  } catch (error) {
    console.error('Error fetching Polymarket markets:', error)
    // Return mock data as fallback for development
    console.warn('Using mock data as fallback')
    return getMockMarkets()
  }
}

export function filterMarketsByCategory(
  markets: PolymarketMarket[],
  category: string
): PolymarketMarket[] {
  const lowerCategory = category.toLowerCase()
  return markets.filter((market) => {
    const question = market.question?.toLowerCase() || ''
    const description = market.description?.toLowerCase() || ''
    const marketCategory = market.category?.toLowerCase() || ''
    const tags = market.tags?.join(' ').toLowerCase() || ''
    
    return (
      question.includes(lowerCategory) ||
      description.includes(lowerCategory) ||
      marketCategory.includes(lowerCategory) ||
      tags.includes(lowerCategory)
    )
  })
}

export function filterMarketsByYesRate(
  markets: PolymarketMarket[],
  minYesRate: number
): PolymarketMarket[] {
  return markets.filter((market) => {
    const yesOutcome = market.outcomes?.find((o) => 
      o.name.toLowerCase() === 'yes' || o.name.toLowerCase() === 'true'
    )
    if (!yesOutcome) return false
    const yesRate = yesOutcome.price * 100
    return yesRate >= minYesRate
  })
}

export function filterOpenMarkets(markets: PolymarketMarket[]): PolymarketMarket[] {
  return markets.filter((market) => {
    // Market is open if explicitly marked as open, or if not explicitly closed
    if (market.isOpen !== undefined) {
      return market.isOpen
    }
    // If closed/resolved flags exist, use them
    if (market.closed !== undefined) {
      return !market.closed
    }
    if (market.resolved !== undefined) {
      return !market.resolved
    }
    // Check if outcomes have valid prices (not 0% or 100% which indicates closed)
    if (market.outcomes && market.outcomes.length > 0) {
      return market.outcomes.some(outcome => {
        const price = outcome.price
        return price > 0 && price < 1
      })
    }
    // Default to including if we can't determine status
    return true
  })
}

export function sortMarketsByVolume(markets: PolymarketMarket[]): PolymarketMarket[] {
  return [...markets].sort((a, b) => (b.volume || 0) - (a.volume || 0))
}

export function sortMarketsByLatest(markets: PolymarketMarket[]): PolymarketMarket[] {
  return [...markets].sort((a, b) => {
    // Sort by creation date (newest first)
    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0
    
    if (dateB !== dateA) {
      return dateB - dateA
    }
    
    // If dates are equal or missing, sort by volume
    return (b.volume || 0) - (a.volume || 0)
  })
}

export function filterMarketsByKeywords(
  markets: PolymarketMarket[],
  keywords: string[]
): PolymarketMarket[] {
  if (keywords.length === 0) return markets
  
  return markets.filter((market) => {
    const question = market.question?.toLowerCase() || ''
    const description = market.description?.toLowerCase() || ''
    const marketCategory = market.category?.toLowerCase() || ''
    const tags = market.tags?.join(' ').toLowerCase() || ''
    const allText = `${question} ${description} ${marketCategory} ${tags}`
    
    // Check if any keyword matches
    return keywords.some(keyword => {
      const lowerKeyword = keyword.toLowerCase().trim()
      
      // For multi-word keywords (e.g., "elon musk"), check for phrase match first
      if (lowerKeyword.includes(' ')) {
        // Check if the full phrase appears
        if (allText.includes(lowerKeyword)) {
          return true
        }
        // Also check if all words in the phrase appear (for partial matches)
        const phraseWords = lowerKeyword.split(/\s+/)
        return phraseWords.every(word => allText.includes(word))
      } else {
        // Single word - check for exact match
        // Use word boundaries for better matching (but also allow partial for flexibility)
        const wordBoundaryRegex = new RegExp(`\\b${lowerKeyword}\\b`, 'i')
        return wordBoundaryRegex.test(allText) || allText.includes(lowerKeyword)
      }
    })
  })
}

