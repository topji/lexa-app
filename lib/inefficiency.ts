/**
 * Inefficient Market Detection Engine
 *
 * Finds logically dependent Polymarket events where probability distributions
 * are inconsistent — creating trading opportunities.
 *
 * Uses the Gamma API directly (not pmxt) because:
 *   - Gamma returns events with nested markets (multi-outcome structure)
 *   - Gamma includes real outcome prices and event groupings
 *   - pmxt's fetchEvents doesn't exist on Polymarket constructor
 *
 * Types of inefficiency detected:
 *   1. Within-event overpricing: Sum of mutually exclusive outcome prices != 100%
 *   2. Cross-event ranking inconsistency: Same entity in related ranking events
 *      with impossible probability combinations
 *   3. Dependent event mispricing: Same question in different contexts with
 *      contradictory odds
 */

const GAMMA_API = 'https://gamma-api.polymarket.com'

// ── Types ────────────────────────────────────────────────────────────────────

export interface MarketOutcomeInfo {
  label: string
  price: number
}

export interface EventMarketInfo {
  marketId: string
  title: string
  slug?: string
  url?: string
  outcomes: MarketOutcomeInfo[]
  volume: number
  volume24h: number
  eventId?: string
  eventTitle?: string
  eventSlug?: string
  category?: string
  tags?: string[]
}

export interface InefficiencyGroup {
  groupTitle: string
  type: 'ranking_inconsistency' | 'probability_overflow' | 'dependent_mispricing'
  severity: number
  explanation: string
  markets: EventMarketInfo[]
  entityBreakdown?: EntityProbability[]
  probabilitySum?: number
}

export interface EntityProbability {
  entity: string
  probabilities: { eventTitle: string; price: number; slug?: string }[]
  totalProbability: number
  deviation: number
}

// ── Gamma API Helpers ────────────────────────────────────────────────────────

interface GammaEvent {
  id: string
  slug: string | null
  title: string | null
  description: string | null
  volume?: number
  volume24hr?: number
  closed?: boolean
  active?: boolean
  category?: string | null
  tags?: Array<{ id: number; label?: string; slug?: string }>
  markets?: GammaMarket[]
}

interface GammaMarket {
  id: string
  question: string
  slug: string
  conditionId?: string
  outcomes?: string      // JSON string e.g. '["Anthropic", "Google", "OpenAI"]'
  outcomePrices?: string // JSON string e.g. '["0.97", "0.02", "0.005"]'
  closed?: boolean
  bestBid?: number
  bestAsk?: number
  liquidity?: string | number
  volume?: number
}

function parseGammaOutcomes(market: GammaMarket): MarketOutcomeInfo[] {
  let names: string[] = []
  let prices: number[] = []

  try {
    if (market.outcomes) names = JSON.parse(market.outcomes) as string[]
  } catch {
    names = ['Yes', 'No']
  }

  // For multi-outcome markets, outcomePrices is the only price source
  try {
    if (market.outcomePrices) {
      prices = (JSON.parse(market.outcomePrices) as string[]).map(p => parseFloat(p))
    }
  } catch {
    // fall through
  }

  // For binary markets, prefer bestBid/bestAsk when available
  if (names.length === 2) {
    const bid = typeof market.bestBid === 'number' ? market.bestBid : parseFloat(String(market.bestBid))
    const ask = typeof market.bestAsk === 'number' ? market.bestAsk : parseFloat(String(market.bestAsk))
    if (!Number.isNaN(bid) && !Number.isNaN(ask) && bid > 0 && ask > 0 && bid <= 1 && ask <= 1) {
      const yesPrice = (bid + ask) / 2
      prices = [yesPrice, 1 - yesPrice]
    }
  }

  if (prices.length !== names.length || prices.some(p => Number.isNaN(p))) {
    prices = names.map(() => 0.5)
  }

  return names.map((name, i) => ({
    label: name,
    price: Math.max(0, Math.min(1, prices[i] ?? 0.5)),
  }))
}

function gammaEventToMarkets(event: GammaEvent): EventMarketInfo[] {
  const eventSlug = event.slug || event.id
  const category = event.category || event.tags?.[0]?.label || undefined
  const tags = event.tags?.map(t => t.label || t.slug).filter((x): x is string => Boolean(x))

  if (!event.markets || event.markets.length === 0) return []

  return event.markets
    .filter(m => !m.closed)
    .map(m => ({
      marketId: m.id,
      title: m.question,
      slug: eventSlug,
      url: `https://polymarket.com/event/${eventSlug}`,
      outcomes: parseGammaOutcomes(m),
      volume: typeof m.volume === 'number' ? m.volume : (event.volume ?? 0),
      volume24h: event.volume24hr ?? 0,
      eventId: event.id,
      eventTitle: event.title ?? undefined,
      eventSlug,
      category,
      tags,
    }))
}

/** Fetch active events from Gamma, paginated. Returns up to `pages * pageSize` events. */
async function fetchGammaEventsPaginated(pages = 3, pageSize = 200): Promise<GammaEvent[]> {
  const allEvents: GammaEvent[] = []
  const fetches: Promise<GammaEvent[]>[] = []

  for (let page = 0; page < pages; page++) {
    const params = new URLSearchParams({
      closed: 'false',
      order: 'volume24hr',
      ascending: 'false',
      limit: String(pageSize),
      offset: String(page * pageSize),
    })

    fetches.push(
      fetch(`${GAMMA_API}/events?${params}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
        .then(r => r.ok ? r.json() as Promise<GammaEvent[]> : [])
        .catch(() => [] as GammaEvent[])
    )
  }

  const results = await Promise.all(fetches)
  for (const batch of results) {
    allEvents.push(...batch)
  }
  return allEvents
}

/** Use Gamma's public-search endpoint to find events matching a query */
async function searchGammaEvents(query: string): Promise<GammaEvent[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      limit_per_type: '20',
    })
    const res = await fetch(`${GAMMA_API}/public-search?${params}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) return []
    const data = (await res.json()) as { events?: Array<{ id: string; slug: string; title: string; [k: string]: unknown }> }
    if (!data.events || data.events.length === 0) return []

    // public-search doesn't include nested markets, so fetch each event by ID
    const eventFetches = data.events.slice(0, 10).map(ev =>
      fetch(`${GAMMA_API}/events/${ev.id}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
        .then(r => r.ok ? r.json() as Promise<GammaEvent> : null)
        .catch(() => null)
    )
    const results = await Promise.all(eventFetches)
    return results.filter((e): e is GammaEvent => e !== null)
  } catch (e) {
    console.error('[Inefficiency] searchGammaEvents error:', e)
    return []
  }
}

// ── Search Helpers ───────────────────────────────────────────────────────────

function extractSearchTerms(query: string): string[] {
  const lower = query.toLowerCase()
  const cleaned = lower
    .replace(/\b(find|show|get|search|inefficien\w*|arbitrage|mispriced|dependent|markets?|opportunities|what|are|the|some|similar|me)\b/g, '')
    .trim()
  if (cleaned.length < 2) return []
  return cleaned.split(/\s+/).filter(t => t.length > 2)
}

function matchesQuery(text: string, terms: string[]): boolean {
  if (terms.length === 0) return true
  const lower = text.toLowerCase()
  return terms.some(t => lower.includes(t))
}

function normalizeEntityName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
}

function titleSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2))
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2))
  if (wordsA.size === 0 || wordsB.size === 0) return 0
  let common = 0
  Array.from(wordsA).forEach(w => { if (wordsB.has(w)) common++ })
  return common / Math.max(wordsA.size, wordsB.size)
}

const RANKING_PATTERNS = [
  /\b(best|1st|first|top|#1|number one)\b/i,
  /\b(second best|2nd|second|runner.?up|#2|number two)\b/i,
  /\b(third best|3rd|third|#3|number three)\b/i,
  /\b(fourth|4th|#4)\b/i,
  /\b(fifth|5th|#5)\b/i,
  /\b(worst|last|bottom)\b/i,
  /\b(most|least|highest|lowest)\b/i,
]

function stripRankingTerms(title: string): string {
  let stripped = title
  for (const pattern of RANKING_PATTERNS) {
    stripped = stripped.replace(pattern, '')
  }
  return stripped.replace(/\s+/g, ' ').trim().toLowerCase()
}

// ── Event Structure Classification ──────────────────────────────────────────

/**
 * Classify whether an event's markets represent mutually exclusive outcomes
 * (only one can be true) vs independent questions (many can be true).
 *
 * MUTUALLY EXCLUSIVE examples:
 *   - "Which company has the best AI model?" → [Google, Anthropic, OpenAI] — only 1 wins
 *   - "Who will win the election?" → [Candidate A, B, C] — only 1 wins
 *   - Single market: "Will X happen?" → [Yes, No] — always sums to 100%
 *
 * INDEPENDENT examples:
 *   - UFC fight event with: "Who wins?", "KO?", "Submission?", "O/U 2.5 rounds"
 *     → These are different questions about the same fight, not exclusive outcomes
 *   - "IPOs before 2027?" with: "SpaceX IPO?", "Stripe IPO?", "Anthropic IPO?"
 *     → Every company can independently IPO, so summing > 100% is expected
 *   - "BTC above $80K?", "BTC above $90K?", "BTC above $100K?"
 *     → Cumulative thresholds, not exclusive
 */
function classifyEventStructure(ev: GammaEvent): 'mutually_exclusive' | 'independent' | 'single_multi_outcome' {
  if (!ev.markets) return 'independent'
  const markets = ev.markets.filter(m => !m.closed)
  if (markets.length < 2) return 'independent'

  // Check if the event has a SINGLE market with 3+ outcomes (like "Who wins?" with multiple candidates)
  // That's always mutually exclusive — the outcomes within one market must sum to 100%
  const multiOutcome = markets.find(m => {
    try {
      const names = m.outcomes ? JSON.parse(m.outcomes) as string[] : []
      return names.length >= 3
    } catch {
      return false
    }
  })
  if (multiOutcome && markets.length === 1) return 'single_multi_outcome'

  const title = (ev.title ?? '').toLowerCase()
  const questions = markets.map(m => m.question.toLowerCase())

  // Pattern 1: Each market is a YES/NO question about a different entity doing the same thing
  // e.g. "SpaceX IPO?", "Stripe IPO?", "Anthropic IPO?" → independent
  // Detection: all questions follow "Will [entity] [verb]?" pattern with different entities
  const ipo = questions.every(q => /\bipo\b/.test(q))
  if (ipo) return 'independent'

  // Pattern 2: Sports/fighting events with multiple bet types
  // Detection: mix of O/U, spread, method of victory, distance questions
  const sportPatterns = [/o\/u\s+\d/i, /spread/i, /distance/i, /\bko\b|\btko\b/i, /submission/i, /\bwin by\b/i, /\bwon by\b/i]
  const sportMatchCount = sportPatterns.filter(p => questions.some(q => p.test(q))).length
  if (sportMatchCount >= 2) return 'independent'  // Multiple bet types = independent questions

  // Pattern 3: Price threshold markets ("above $X", "hit $X", "at least X")
  const thresholdPatterns = [/\babove\s+\$?\d/i, /\bhit\s/i, /\bat least\b/i, /\bbelow\s+\$?\d/i, /\bunder\s+\$?\d/i]
  if (questions.some(q => thresholdPatterns.some(p => p.test(q)))) return 'independent'

  // Pattern 4: Cumulative date markets ("by end of March", "by June")
  const dateThreshold = [/\bby\s+(end of|march|april|may|june|july|august|september|october|november|december|2026|2027)/i, /\bbefore\b/i]
  if (questions.some(q => dateThreshold.some(p => p.test(q)))) return 'independent'

  // Pattern 5: "Which" / "Who will" events where each market is one candidate's binary bet
  // e.g. "Which company has the best AI model?" → markets: "Google?", "Anthropic?", "OpenAI?"
  // These ARE mutually exclusive — only one company can be "the best"
  if (/\b(which|who will)\b/i.test(title)) return 'mutually_exclusive'

  // Pattern 6: "Winner of" / championship events
  if (/\b(winner|champion|win the)\b/i.test(title)) return 'mutually_exclusive'

  // Default: if all markets are binary Yes/No with similar structure, likely independent
  // (conservative — we'd rather miss an overflow than flag a false positive)
  return 'independent'
}

// ── Core Detection ───────────────────────────────────────────────────────────

export async function findInefficientMarkets(
  query?: string,
): Promise<InefficiencyGroup[]> {
  const groups: InefficiencyGroup[] = []
  const searchTerms = query ? extractSearchTerms(query) : []

  // Fetch events from Gamma API — paginated bulk fetch + targeted search
  const [paginatedEvents, searchedEvents] = await Promise.all([
    fetchGammaEventsPaginated(3, 200),  // 600 events across 3 pages
    searchTerms.length > 0
      ? searchGammaEvents(searchTerms.join(' '))
      : Promise.resolve([]),
  ])

  // Merge and deduplicate events
  const eventMap = new Map<string, GammaEvent>()
  for (const ev of [...paginatedEvents, ...searchedEvents]) {
    const eid = ev.id ?? ev.slug
    if (eid && !eventMap.has(eid)) eventMap.set(eid, ev)
  }
  const allEvents = Array.from(eventMap.values())

  // Filter by query if provided
  const relevantEvents = searchTerms.length > 0
    ? allEvents.filter(ev => {
        const text = `${ev.title ?? ''} ${ev.description ?? ''} ${ev.category ?? ''} ${ev.tags?.map(t => t.label).join(' ') ?? ''}`
        return matchesQuery(text, searchTerms)
      })
    : allEvents

  // Convert to our market format
  const allMarkets: EventMarketInfo[] = []
  for (const ev of (relevantEvents.length > 0 ? relevantEvents : allEvents)) {
    allMarkets.push(...gammaEventToMarkets(ev))
  }

  // ── Detection 1: Multi-outcome probability overflow ────────────────────
  // Only flag events where markets represent MUTUALLY EXCLUSIVE outcomes.
  // Skip events with independent questions (UFC bets, IPOs, price thresholds).

  for (const ev of (relevantEvents.length > 0 ? relevantEvents : allEvents)) {
    if (!ev.markets || ev.markets.length < 3) continue

    const structure = classifyEventStructure(ev)

    // Only check overflow for mutually exclusive events
    if (structure === 'independent') continue

    const markets = ev.markets.filter(m => !m.closed)
    if (markets.length < 3) continue

    const outcomeProbs: { name: string; price: number }[] = []
    for (const m of markets) {
      const outcomes = parseGammaOutcomes(m)
      const yesOutcome = outcomes.find(o =>
        o.label.toLowerCase() === 'yes' || o.label.toLowerCase() === 'true'
      )
      const price = yesOutcome?.price ?? outcomes[0]?.price ?? 0
      outcomeProbs.push({ name: m.question, price })
    }

    // Filter out outcomes with default/stale pricing (exactly 0.50)
    const realPriced = outcomeProbs.filter(o => Math.abs(o.price - 0.5) > 0.005)
    if (realPriced.length < 3) continue

    const sum = realPriced.reduce((s, o) => s + o.price, 0)
    const overflow = Math.abs(sum - 1.0)

    if (overflow > 0.08) {
      const eventMarkets = gammaEventToMarkets(ev)
      groups.push({
        groupTitle: ev.title ?? 'Multi-outcome Event',
        type: 'probability_overflow',
        severity: Math.min(100, Math.round(overflow * 200)),
        explanation: `This event has ${realPriced.length} real-priced outcomes (of ${markets.length} total) summing to ${(sum * 100).toFixed(1)}% (should be ~100%). ` +
          `${sum > 1 ? `Overpriced by ${(overflow * 100).toFixed(1)}pp — selling all outcomes locks profit.` : `Underpriced by ${(overflow * 100).toFixed(1)}pp — buying all outcomes is cheap.`}\n\n` +
          `Top outcomes: ${realPriced.sort((a, b) => b.price - a.price).slice(0, 5).map(o => `${o.name.replace(ev.title ?? '', '').trim() || o.name}: ${(o.price * 100).toFixed(1)}%`).join(', ')}`,
        markets: eventMarkets,
        probabilitySum: sum,
      })
    }
  }

  // ── Detection 2: Related event ranking inconsistencies ─────────────────
  // Group events by title similarity ONLY for events that have ranking terms
  const hasRankingTerm = (title: string) =>
    RANKING_PATTERNS.some(p => p.test(title))

  const eventGroups = new Map<string, GammaEvent[]>()
  for (const ev of allEvents) {
    if (!ev.title) continue
    if (!hasRankingTerm(ev.title)) continue
    const stripped = stripRankingTerms(ev.title)
    if (stripped.length < 8) continue

    let bestKey: string | null = null
    let bestSim = 0
    for (const key of Array.from(eventGroups.keys())) {
      const sim = titleSimilarity(stripped, key)
      if (sim > bestSim && sim > 0.6) {
        bestSim = sim
        bestKey = key
      }
    }

    if (bestKey) {
      eventGroups.get(bestKey)!.push(ev)
    } else {
      eventGroups.set(stripped, [ev])
    }
  }

  // For each group of related ranking events, check entity consistency
  for (const [, relatedEvents] of Array.from(eventGroups.entries())) {
    if (relatedEvents.length < 2) continue

    const entityMap = new Map<string, EntityProbability>()

    for (const ev of relatedEvents) {
      if (!ev.markets) continue
      for (const m of ev.markets) {
        if (m.closed) continue
        const outcomes = parseGammaOutcomes(m)
        if (outcomes.length === 2) {
          const yesPrice = outcomes.find(o => o.label.toLowerCase() === 'yes')?.price ?? outcomes[0]?.price ?? 0
          const entityName = normalizeEntityName(m.question.replace(ev.title ?? '', '').trim() || m.question)
          if (!entityName || entityName.length < 2) continue

          if (!entityMap.has(entityName)) {
            entityMap.set(entityName, { entity: entityName, probabilities: [], totalProbability: 0, deviation: 0 })
          }
          const ep = entityMap.get(entityName)!
          ep.probabilities.push({ eventTitle: ev.title ?? '', price: yesPrice, slug: ev.slug ?? undefined })
          ep.totalProbability += yesPrice
        } else {
          for (const o of outcomes) {
            const entityName = normalizeEntityName(o.label)
            if (!entityName || entityName === 'yes' || entityName === 'no') continue

            if (!entityMap.has(entityName)) {
              entityMap.set(entityName, { entity: entityName, probabilities: [], totalProbability: 0, deviation: 0 })
            }
            const ep = entityMap.get(entityName)!
            ep.probabilities.push({ eventTitle: ev.title ?? '', price: o.price, slug: ev.slug ?? undefined })
            ep.totalProbability += o.price
          }
        }
      }
    }

    const entities = Array.from(entityMap.values())
    const inconsistent = entities.filter(e => {
      e.deviation = Math.abs(e.totalProbability - 1.0)
      const hasRealPrices = e.probabilities.some(p => Math.abs(p.price - 0.5) > 0.01)
      return e.probabilities.length >= 2 && e.deviation > 0.15 && hasRealPrices
    }).sort((a, b) => b.deviation - a.deviation)

    if (inconsistent.length > 0) {
      const topEntity = inconsistent[0]
      const severity = Math.min(100, Math.round(topEntity.deviation * 150))

      const entityLines = inconsistent.slice(0, 4).map(e => {
        const probs = e.probabilities.map(p => {
          const short = p.eventTitle.length > 45 ? p.eventTitle.slice(0, 45) + '...' : p.eventTitle
          return `${(p.price * 100).toFixed(0)}% in "${short}"`
        }).join(', ')
        return `${e.entity}: ${probs} (sum: ${(e.totalProbability * 100).toFixed(0)}%)`
      }).join('\n')

      const relatedMarkets: EventMarketInfo[] = []
      for (const ev of relatedEvents) {
        relatedMarkets.push(...gammaEventToMarkets(ev))
      }

      groups.push({
        groupTitle: relatedEvents[0].title ?? 'Related Events',
        type: 'ranking_inconsistency',
        severity,
        explanation: `These related ranking events have inconsistent probabilities:\n\n${entityLines}\n\nAn entity's probability across mutually exclusive ranking positions should sum close to 100%, but they don't — indicating mispricing.`,
        markets: relatedMarkets,
        entityBreakdown: inconsistent,
      })
    }
  }

  // ── Detection 3: Similar binary markets with different odds ────────────
  // Only flag when two markets ask the SAME question about the SAME entity/subject
  // AND are from DIFFERENT events.
  //
  // Key safeguards:
  //   - Require same subject entity (NVIDIA ≠ Microsoft)
  //   - Require same date reference (March ≠ June)
  //   - Require different events (same event = already captured by overflow)
  //   - Skip generic titles that appear in many events (UFC bet types)
  //   - Skip ranking-different titles ("largest" ≠ "second-largest")

  /** Titles that are too generic — they appear in many unrelated events */
  const GENERIC_TITLES = new Set([
    'o/u 0.5 rounds', 'o/u 1.5 rounds', 'o/u 2.5 rounds', 'o/u 3.5 rounds', 'o/u 4.5 rounds',
    'fight to go the distance?', 'will the fight be won by ko or tko?',
    'will the fight be won by submission?', 'will the fight be won by decision?',
  ])

  function isGenericTitle(title: string): boolean {
    return GENERIC_TITLES.has(title.toLowerCase().trim())
  }

  /** Extract the full question template (not just the subject) for comparison.
   *  Two markets are "the same question" only if the template matches after removing
   *  entity names. This prevents "largest" from matching "second-largest". */
  function extractQuestionTemplate(title: string): string {
    // Remove entity names (proper nouns, company names) to get the template
    // Keep ranking terms, dates, and question structure
    return title
      .toLowerCase()
      .replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g, '[ENTITY]') // Remove proper nouns
      .replace(/\s+/g, ' ')
      .trim()
  }

  /** Extract the varying subject/entity from a templated market title. */
  function extractSubject(title: string): string {
    const willMatch = title.match(/^will\s+(?:the\s+)?(.+?)\s+(?:be|have|win|become|hit|reach|pass|get|make|post|say|sign)/i)
    if (willMatch) return willMatch[1].toLowerCase().trim()
    const byMatch = title.match(/^(.+?)\s+by\s+/i)
    if (byMatch) return byMatch[1].toLowerCase().trim()
    return title.toLowerCase().trim()
  }

  /** Extract date/time reference from title */
  function extractDateRef(title: string): string {
    const dateMatch = title.match(
      /(?:on|by|end of|before|after|in)\s+((?:january|february|march|april|may|june|july|august|september|october|november|december)\s*\d*(?:\s*,?\s*\d{4})?|(?:march|june|q[1-4])\s*\d*|20\d{2}|\d{1,2}\/\d{1,2})/i
    )
    return dateMatch ? dateMatch[1].toLowerCase().trim() : ''
  }

  /** Check if titles differ only by ranking position (largest vs second-largest) */
  function differsOnlyByRank(a: string, b: string): boolean {
    const stripA = stripRankingTerms(a)
    const stripB = stripRankingTerms(b)
    // If stripping ranking terms makes them identical but originals differ, they differ by rank
    return titleSimilarity(stripA, stripB) > 0.9 && titleSimilarity(a, b) < 0.95
  }

  const binaryMarkets = allMarkets.filter(m => m.outcomes.length === 2)
  const usedPairs = new Set<string>()

  for (let i = 0; i < binaryMarkets.length && i < 200; i++) {
    for (let j = i + 1; j < binaryMarkets.length && j < 200; j++) {
      const a = binaryMarkets[i]
      const b = binaryMarkets[j]

      // Must be from different events
      if (a.eventId && a.eventId === b.eventId) continue

      // Skip generic titles that appear across many unrelated events
      if (isGenericTitle(a.title) || isGenericTitle(b.title)) continue

      const sim = titleSimilarity(a.title, b.title)
      if (sim < 0.7) continue

      // Skip if titles differ only by ranking position ("largest" vs "second-largest")
      if (differsOnlyByRank(a.title, b.title)) continue

      // Extract subjects — if they differ, these are independent questions
      const subjectA = extractSubject(a.title)
      const subjectB = extractSubject(b.title)
      if (subjectA !== subjectB) continue

      // Extract dates — if they differ, these are independent time windows
      const dateA = extractDateRef(a.title)
      const dateB = extractDateRef(b.title)
      if (dateA && dateB && dateA !== dateB) continue

      const pairKey = [a.marketId, b.marketId].sort().join('-')
      if (usedPairs.has(pairKey)) continue
      usedPairs.add(pairKey)

      const aYes = a.outcomes.find(o => o.label.toLowerCase() === 'yes')?.price ?? a.outcomes[0]?.price ?? 0.5
      const bYes = b.outcomes.find(o => o.label.toLowerCase() === 'yes')?.price ?? b.outcomes[0]?.price ?? 0.5
      const diff = Math.abs(aYes - bYes)

      // Require 15pp+ spread to be actionable
      if (diff > 0.15) {
        groups.push({
          groupTitle: 'Same question, different odds',
          type: 'dependent_mispricing',
          severity: Math.min(100, Math.round(diff * 200)),
          explanation: `"${a.title}" is at ${(aYes * 100).toFixed(0)}% Yes, but "${b.title}" is at ${(bYes * 100).toFixed(0)}% Yes — a ${(diff * 100).toFixed(0)}pp spread on what appears to be the same question.`,
          markets: [a, b],
        })
      }
    }
  }

  // Sort by severity and cap results
  groups.sort((a, b) => b.severity - a.severity)

  // Filter: require minimum severity of 10 and cap at 15 results
  return groups.filter(g => g.severity >= 10).slice(0, 15)
}
