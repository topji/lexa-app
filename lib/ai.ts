import { PolymarketMarket } from '@/types/polymarket'
import {
  filterMarketsByCategory,
  filterMarketsByYesRate,
  sortMarketsByVolume,
  filterMarketsByKeywords,
  filterOpenMarkets,
  sortMarketsByLatest,
} from './polymarket'
import { findInefficientMarkets, InefficiencyGroup } from './inefficiency'

function slugFromPolymarketUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined
  // Example: https://polymarket.com/event/will-trump-visit-china-by
  const match = url.match(/\/event\/([^/?#]+)/i)
  return match?.[1]
}

async function searchPolymarketMarketsViaPmxt(searchQuery: string, limit: number): Promise<PolymarketMarket[]> {
  const pmxtMod: any = await import('pmxtjs')
  const pmxt: any = pmxtMod?.default?.default ?? pmxtMod?.default ?? pmxtMod
  const PolyCtor = pmxt.PolymarketExchange ?? pmxt.Polymarket
  if (!PolyCtor) throw new Error('pmxtjs Polymarket constructor not found')

  const poly = new PolyCtor()

  const results = await poly.searchMarkets(searchQuery, { limit })

  return (results ?? []).map((m: any): PolymarketMarket => {
    const slug = slugFromPolymarketUrl(m?.url)
    const outcomes = Array.isArray(m?.outcomes)
      ? m.outcomes.map((o: any) => ({
          name: String(o?.label ?? o?.metadata?.label ?? o?.id ?? ''),
          price: typeof o?.price === 'number' ? o.price : 0,
        }))
      : []

    return {
      id: String(m?.id ?? ''),
      question: String(m?.title ?? ''),
      description: typeof m?.description === 'string' ? m.description : undefined,
      slug: slug ?? String(m?.id ?? ''),
      outcomes,
      volume: typeof m?.volume24h === 'number' ? m.volume24h : undefined,
      category: typeof m?.category === 'string' ? m.category : undefined,
      tags: Array.isArray(m?.tags) ? m.tags.map((t: any) => String(t)) : undefined,
      isOpen: true,
      closed: false,
      resolved: false,
      endDate: m?.resolutionDate ? new Date(m.resolutionDate) : undefined,
      createdAt: undefined,
    }
  }).filter((m: PolymarketMarket) => m.id && m.question && m.slug)
}

async function callNvidiaChatCompletion(systemPrompt: string, userPrompt: string): Promise<string> {
  const invokeUrl = process.env.NVIDIA_INTEGRATE_URL ?? 'https://integrate.api.nvidia.com/v1/chat/completions'
  const bearerToken = process.env.NVIDIA_BEARER_TOKEN
  if (!bearerToken) {
    throw new Error('Missing NVIDIA_BEARER_TOKEN env var')
  }

  const model = process.env.NVIDIA_MODEL ?? 'mistralai/mistral-small-4-119b-2603'

  const payload = {
    model,
    reasoning_effort: 'high',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 16384,
    temperature: 0.1,
    top_p: 1.0,
    stream: false,
  }

  const res = await fetch(invokeUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Nvidia chat completion failed: HTTP ${res.status} ${text}`)
  }

  const data: any = await res.json()
  const content =
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.text ??
    data?.output_text ??
    ''

  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Nvidia chat completion returned empty content')
  }

  return content
}

interface ParsedQuery {
  category?: string
  minYesRate?: number
  sortBy?: 'volume' | 'yesRate'
  limit?: number
  keywords?: string[]
}

function parseUserQuery(query: string): ParsedQuery {
  const lowerQuery = query.toLowerCase()
  const result: ParsedQuery = {}

  // Extract keywords from common patterns
  // Patterns like: "related to X", "markets for X", "X markets", "about X", etc.
  const keywordPatterns = [
    /(?:related to|about|for|markets? for|markets? about|markets? on)\s+([a-z\s]+?)(?:\s|$|related|markets|with|that|which|price|above|below|more|than)/i,
    /(?:give me|show me|find|list|search for)\s+(?:markets?)?\s*(?:related to|about|for)?\s*([a-z\s]+?)(?:\s|$|markets|related|with|that|which|where|price|above|below|more|than)/i,
    /markets?\s+(?:in|for|about|on)\s+([a-z\s]+?)(?:\s|$|with|that|which|where|price|above|below|more|than)/i,
  ]
  
  const extractedKeywords: string[] = []
  let extractedPhrase: string | null = null
  
  for (const pattern of keywordPatterns) {
    const match = lowerQuery.match(pattern)
    if (match && match[1]) {
      let keyword = match[1].trim().toLowerCase()
      // Remove common stop words
      const stopWords = ['the', 'all', 'me', 'my', 'give', 'show', 'find', 'list', 'search', 'markets', 'market']
      const words = keyword.split(/\s+/).filter(word => 
        word.length > 1 && !stopWords.includes(word)
      )
      if (words.length > 0) {
        // If it's a multi-word phrase (like "elon musk"), keep it as a phrase
        if (words.length > 1) {
          extractedPhrase = words.join(' ')
          extractedKeywords.push(extractedPhrase)
        } else {
          extractedKeywords.push(...words)
        }
      }
    }
  }
  
  // If no pattern match, try to extract meaningful words from the query
  if (extractedKeywords.length === 0) {
    // Remove common query words
    const stopWords = ['give', 'me', 'all', 'the', 'markets', 'related', 'to', 'about', 'for', 'in', 'with', 'that', 'which', 'where', 'show', 'find', 'list', 'search', 'price', 'above', 'below', 'over', 'under', 'more', 'than', 'rate', 'yes', 'no']
    const words = lowerQuery.split(/\s+/).filter(word => 
      word.length > 2 && !stopWords.includes(word) && !/^\d+$/.test(word)
    )
    if (words.length > 0) {
      // Try to keep multi-word names together (e.g., "elon musk")
      if (words.length >= 2) {
        // Check if first two words form a common name/entity
        const twoWordPhrase = `${words[0]} ${words[1]}`
        extractedKeywords.push(twoWordPhrase)
        // Also add individual words for broader matching
        if (words.length > 2) {
          extractedKeywords.push(...words.slice(2))
        }
      } else {
        extractedKeywords.push(...words)
      }
    }
  }
  
  // Remove duplicates and add common synonyms so "bitcoin" also matches "BTC", etc.
  if (extractedKeywords.length > 0) {
    const synonymMap: Record<string, string[]> = {
      bitcoin: ['btc'],
      btc: ['bitcoin'],
      ethereum: ['eth'],
      eth: ['ethereum'],
      solana: ['sol'],
      sol: ['solana'],
    }
    const expanded = new Set(extractedKeywords)
    extractedKeywords.forEach((kw) => {
      const lower = kw.toLowerCase()
      synonymMap[lower]?.forEach((s) => expanded.add(s))
    })
    result.keywords = Array.from(expanded)
  }

  // Extract category
  const categoryKeywords: { [key: string]: string } = {
    crypto: 'crypto',
    cryptocurrency: 'crypto',
    bitcoin: 'crypto',
    ethereum: 'crypto',
    politics: 'politics',
    political: 'politics',
    election: 'politics',
    sports: 'sports',
    technology: 'technology',
    tech: 'technology',
  }

  for (const [keyword, category] of Object.entries(categoryKeywords)) {
    if (lowerQuery.includes(keyword)) {
      result.category = category
      break
    }
  }

  // Extract Yes rate threshold
  const yesRateMatch = lowerQuery.match(/(?:yes|yes rate|probability).*?(\d+)\s*%/i)
  if (yesRateMatch) {
    result.minYesRate = parseInt(yesRateMatch[1])
  } else {
    // Look for patterns like "more than 90%" or "above 90%"
    const moreThanMatch = lowerQuery.match(/(?:more than|above|over|greater than)\s*(\d+)\s*%/i)
    if (moreThanMatch) {
      result.minYesRate = parseInt(moreThanMatch[1])
    }
  }

  // Determine sorting preference
  if (lowerQuery.includes('best') || lowerQuery.includes('top')) {
    result.sortBy = 'volume'
  }

  // Extract limit
  const limitMatch = lowerQuery.match(/(?:top|first|limit|show)\s*(\d+)/i)
  if (limitMatch) {
    result.limit = parseInt(limitMatch[1])
  }

  return result
}

/** Process an inefficiency query — find mispriced dependent markets */
async function processInefficiencyQuery(userQuery: string): Promise<{
  response: string
  markets: PolymarketMarket[]
  provider: 'nvidia' | 'fallback'
  inefficiencies?: InefficiencyGroup[]
}> {
  try {
    const groups = await findInefficientMarkets(userQuery)

    // Convert inefficiency markets to PolymarketMarket format for backward compatibility
    const markets: PolymarketMarket[] = []
    const seenIds = new Set<string>()
    for (const g of groups) {
      for (const m of g.markets) {
        if (!seenIds.has(m.marketId)) {
          seenIds.add(m.marketId)
          markets.push({
            id: m.marketId,
            question: m.title,
            slug: m.slug ?? m.marketId,
            outcomes: m.outcomes.map(o => ({ name: o.label, price: o.price })),
            volume: m.volume24h || m.volume,
            category: m.category,
            tags: m.tags,
            isOpen: true,
            closed: false,
            resolved: false,
          })
        }
      }
    }

    // Generate AI explanation
    let response: string
    if (groups.length === 0) {
      response = `I scanned markets related to your query but didn't find significant pricing inconsistencies right now. This can change quickly — try again in a few minutes or with a different topic like "AI", "crypto", "election", etc.`
    } else {
      const summaryLines = groups.slice(0, 5).map((g, i) => {
        const severityLabel = g.severity >= 60 ? 'HIGH' : g.severity >= 30 ? 'MEDIUM' : 'LOW'
        return `${i + 1}. [${severityLabel}] ${g.groupTitle} — ${g.type.replace(/_/g, ' ')}, severity ${g.severity}/100`
      })

      const systemPrompt = `You are Lexa, an AI assistant specialized in finding mispriced prediction markets on Polymarket. You help traders find arbitrage and inefficiency opportunities across related/dependent markets. Be concise and actionable.`
      const userPrompt = `User asked: "${userQuery}"

I found ${groups.length} inefficiency group(s):
${summaryLines.join('\n')}

Details:
${groups.slice(0, 3).map(g => g.explanation).join('\n\n')}

Provide a clear, actionable summary of the inefficiencies found. Explain WHY the prices are inconsistent and what a trader might do. Keep it under 200 words.`

      try {
        response = await callNvidiaChatCompletion(systemPrompt, userPrompt)
      } catch {
        const top3 = groups.slice(0, 3).map((g, i) => {
          const typeLabel = g.type === 'probability_overflow' ? 'Probability Overflow'
            : g.type === 'ranking_inconsistency' ? 'Ranking Inconsistency'
            : 'Dependent Mispricing'
          return `${i + 1}. **${typeLabel}** — ${g.groupTitle} (severity: ${g.severity}/100)`
        })
        response = `Found ${groups.length} inefficiency group(s) across ${groups.reduce((s, g) => s + g.markets.length, 0)} Polymarket markets:\n\n${top3.join('\n')}\n\nScroll down to see the full breakdown with entity probabilities and market links.`
      }
    }

    return {
      response,
      markets,
      provider: groups.length > 0 ? 'nvidia' : 'fallback',
      inefficiencies: groups.length > 0 ? groups : undefined,
    }
  } catch (error) {
    console.error('Error in processInefficiencyQuery:', error)
    return {
      response: 'I encountered an error scanning for market inefficiencies. Please try again.',
      markets: [],
      provider: 'fallback',
    }
  }
}

/** Detect if the user is asking about market inefficiencies / arbitrage */
function isInefficiencyQuery(query: string): boolean {
  const lower = query.toLowerCase()
  const patterns = [
    /inefficien/,
    /arbitrage/,
    /mispriced/,
    /mispricing/,
    /inconsisten/,
    /dependent\s+markets/,
    /related\s+markets.*(?:odds|price|prob)/,
    /probability.*(?:don.t|doesn.t|do not).*(?:add|sum|match)/,
    /overpriced.*underpriced|underpriced.*overpriced/,
    /edge.*across.*markets/,
    /find.*(?:alpha|edge|opportunity)/,
    /different\s+odds/,
    /contradicting|contradictory/,
  ]
  return patterns.some(p => p.test(lower))
}

export async function processChatQuery(userQuery: string): Promise<{
  response: string
  markets: PolymarketMarket[]
  provider: 'nvidia' | 'fallback'
  inefficiencies?: InefficiencyGroup[]
}> {
  try {
    // ── Check for inefficiency query first ──────────────────────────────
    if (isInefficiencyQuery(userQuery)) {
      return await processInefficiencyQuery(userQuery)
    }

    // Parse the user query
    const parsed = parseUserQuery(userQuery)

    // If the user message came from our UI, it may include a slug.
    const slugMatch = userQuery.match(/slug:\s*([a-zA-Z0-9-]+)/i)

    // pmxt search can be sensitive to overly-long strings (e.g. full sentences),
    // so prefer a single keyword / slug.
    const searchQuery = slugMatch?.[1]
      ? slugMatch[1]
      : parsed.keywords && parsed.keywords.length > 0
        ? parsed.keywords[0]
        : parsed.category
          ? parsed.category
          : userQuery

    // Fetch matching markets from Polymarket via pmxtjs.
    let markets = await searchPolymarketMarketsViaPmxt(searchQuery, 150)

    // Filter for open markets (by default, show only active markets)
    markets = filterOpenMarkets(markets)

    // Apply keyword filter first (most specific)
    if (parsed.keywords && parsed.keywords.length > 0) {
      markets = filterMarketsByKeywords(markets, parsed.keywords)
    }

    // Apply category filter
    if (parsed.category) {
      markets = filterMarketsByCategory(markets, parsed.category)
    }

    if (parsed.minYesRate !== undefined) {
      markets = filterMarketsByYesRate(markets, parsed.minYesRate)
    }

    // Sort markets - by latest first (newest markets), then by volume if specified
    if (parsed.sortBy === 'volume') {
      markets = sortMarketsByVolume(markets)
    } else {
      // Default: sort by latest (newest first)
      markets = sortMarketsByLatest(markets)
    }

    // Apply limit
    if (parsed.limit) {
      markets = markets.slice(0, parsed.limit)
    } else if (markets.length > 20) {
      // Default limit to 20 if not specified
      markets = markets.slice(0, 20)
    }

    // Generate AI response via Nvidia Integrate
    const systemPrompt = `You are Lexa, a helpful AI assistant that helps users find and understand Polymarket prediction markets. 
You should provide clear, concise responses about the markets you find. Be friendly and informative.`

    const userPrompt = `User asked: "${userQuery}"

I found ${markets.length} matching market(s). Here are the details:
${markets.map((m, i) => `${i + 1}. ${m.question} (Yes: ${m.outcomes?.[0]?.price ? (m.outcomes[0].price * 100).toFixed(1) : 'N/A'}%)`).join('\n')}

Please provide a helpful response to the user's query. Include the market count and summarize the results naturally.`

    try {
      const response = await callNvidiaChatCompletion(systemPrompt, userPrompt)

      return {
        response,
        markets,
        provider: 'nvidia',
      }
    } catch (aiError) {
      let response = `I found ${markets.length} market(s) matching your query.`
      if (markets.length === 0) {
        response = "I couldn't find any markets matching your criteria."
      }
      return {
        response,
        markets,
        provider: 'fallback',
      }
    }
  } catch (error) {
    console.error('Error processing chat query:', error)
    
    // Fallback response if everything fails
    return {
      response: 'I encountered an error processing your request. Please try again.',
      markets: [],
      provider: 'fallback',
    }
  }
}

