import { BedrockRuntimeClient, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime'
import { PolymarketMarket } from '@/types/polymarket'
import {
  filterMarketsByCategory,
  filterMarketsByYesRate,
  sortMarketsByVolume,
  filterMarketsByKeywords,
  filterOpenMarkets,
  sortMarketsByLatest,
} from './polymarket'
import { fetchGammaEvents, fetchGammaEventsEndingSoon } from './gamma'

const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'us-east-1',
})

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

export async function processChatQuery(userQuery: string): Promise<{
  response: string
  markets: PolymarketMarket[]
  provider: 'bedrock' | 'fallback'
}> {
  try {
    // Parse the user query
    const parsed = parseUserQuery(userQuery)

    const wantsShortInterval = /\b(5m|5\s*min|15m|15\s*min)\b/i.test(userQuery)

    // Fetch active markets from Gamma (same source as /markets page and crypto soonest)
    // For crypto short-interval queries, prefer "ending soon" windows (current/next) rather than generic newest events.
    let markets = wantsShortInterval
      ? await fetchGammaEventsEndingSoon({
          endDateMin: new Date().toISOString(),
          endDateMax: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          limit: 150,
          noCache: true,
        })
      : await fetchGammaEvents({ limit: 150, closed: false, noCache: true })

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

    // Generate AI response via AWS Bedrock
    const systemPrompt = `You are Lexa, a helpful AI assistant that helps users find and understand Polymarket prediction markets. 
You should provide clear, concise responses about the markets you find. Be friendly and informative.`

    const userPrompt = `User asked: "${userQuery}"

I found ${markets.length} matching market(s). Here are the details:
${markets.map((m, i) => `${i + 1}. ${m.question} (Yes: ${m.outcomes?.[0]?.price ? (m.outcomes[0].price * 100).toFixed(1) : 'N/A'}%)`).join('\n')}

Please provide a helpful response to the user's query. Include the market count and summarize the results naturally.`

    try {
      const modelId =
        process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-haiku-4-5-20251001-v1:0'

      const bedrockResponse = await bedrockClient.send(
        new ConverseStreamCommand({
          modelId,
          system: [{ text: systemPrompt }],
          messages: [
            {
              role: 'user',
              content: [{ text: userPrompt }],
            },
          ],
          inferenceConfig: {
            maxTokens: 500,
            temperature: 0.7,
          },
        })
      )

      let responseText = ''
      if (!bedrockResponse.stream) {
        throw new Error('No stream in Bedrock response')
      }

      for await (const event of bedrockResponse.stream) {
        if (event.contentBlockDelta?.delta?.text) {
          responseText += event.contentBlockDelta.delta.text
        }
      }

      const response =
        responseText.trim() ||
        `I found ${markets.length} market(s) matching your query.`

      return {
        response,
        markets,
        provider: 'bedrock',
      }
    } catch (aiError) {
      console.error('Bedrock AI error:', aiError)
      // Fallback to non-AI response
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

