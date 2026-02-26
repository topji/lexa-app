/** 15-minute crypto Up or Down market slugs (Polymarket event slugs) */
export const CRYPTO_15M_SLUGS = [
  'btc-updown-15m-1771286400',
  'eth-updown-15m-1771287300',
  'sol-updown-15m-1771287300',
  'xrp-updown-15m-1771287300',
] as const

export type Crypto15mSlug = (typeof CRYPTO_15M_SLUGS)[number]

/** Hub: BTC has 5m + 15m; others only 15m. id is route slug (btc-5m, btc-15m) or concrete slug. */
export const CRYPTO_HUB_ITEMS: Array<{
  id: string
  label: string
  window: '5m' | '15m'
  slug: string | null
  symbol: string
  resolutionUrl: string
}> = [
  { id: 'btc-5m', label: 'Bitcoin', window: '5m', slug: null, symbol: 'btc/usd', resolutionUrl: 'https://data.chain.link/streams/btc-usd' },
  { id: 'btc-15m', label: 'Bitcoin', window: '15m', slug: null, symbol: 'btc/usd', resolutionUrl: 'https://data.chain.link/streams/btc-usd' },
  { id: 'eth-updown-15m-1771287300', label: 'Ethereum', window: '15m', slug: 'eth-updown-15m-1771287300', symbol: 'eth/usd', resolutionUrl: 'https://data.chain.link/streams/eth-usd' },
  { id: 'sol-updown-15m-1771287300', label: 'Solana', window: '15m', slug: 'sol-updown-15m-1771287300', symbol: 'sol/usd', resolutionUrl: 'https://data.chain.link/streams/sol-usd' },
  { id: 'xrp-updown-15m-1771287300', label: 'XRP', window: '15m', slug: 'xrp-updown-15m-1771287300', symbol: 'xrp/usd', resolutionUrl: 'https://data.chain.link/streams/xrp-usd' },
]

/** Map event slug to RTDS Chainlink symbol and label (concrete slugs + virtual btc-5m/btc-15m) */
export const CRYPTO_SYMBOL_MAP: Record<string, { symbol: string; label: string; resolutionUrl: string }> = {
  'btc-5m': { symbol: 'btc/usd', label: 'Bitcoin (5m)', resolutionUrl: 'https://data.chain.link/streams/btc-usd' },
  'btc-15m': { symbol: 'btc/usd', label: 'Bitcoin (15m)', resolutionUrl: 'https://data.chain.link/streams/btc-usd' },
  'btc-updown-15m-1771286400': {
    symbol: 'btc/usd',
    label: 'Bitcoin',
    resolutionUrl: 'https://data.chain.link/streams/btc-usd',
  },
  'eth-updown-15m-1771287300': {
    symbol: 'eth/usd',
    label: 'Ethereum',
    resolutionUrl: 'https://data.chain.link/streams/eth-usd',
  },
  'sol-updown-15m-1771287300': {
    symbol: 'sol/usd',
    label: 'Solana',
    resolutionUrl: 'https://data.chain.link/streams/sol-usd',
  },
  'xrp-updown-15m-1771287300': {
    symbol: 'xrp/usd',
    label: 'XRP',
    resolutionUrl: 'https://data.chain.link/streams/xrp-usd',
  },
}

export function getCryptoConfig(slug: string) {
  // Prefer explicit mapping when we know the exact event slug
  const mapped = CRYPTO_SYMBOL_MAP[slug]
  if (mapped) return mapped

  // Fallback: infer symbol/label from slug prefix so new rotating slugs still map correctly
  const s = slug.toLowerCase()
  if (s.startsWith('btc-')) {
    return {
      symbol: 'btc/usd',
      label: 'Bitcoin',
      resolutionUrl: 'https://data.chain.link/streams/btc-usd',
    }
  }
  if (s.startsWith('eth-')) {
    return {
      symbol: 'eth/usd',
      label: 'Ethereum',
      resolutionUrl: 'https://data.chain.link/streams/eth-usd',
    }
  }
  if (s.startsWith('sol-')) {
    return {
      symbol: 'sol/usd',
      label: 'Solana',
      resolutionUrl: 'https://data.chain.link/streams/sol-usd',
    }
  }
  if (s.startsWith('xrp-')) {
    return {
      symbol: 'xrp/usd',
      label: 'XRP',
      resolutionUrl: 'https://data.chain.link/streams/xrp-usd',
    }
  }

  // Default: treat as BTC if unknown (should be rare)
  return { symbol: 'btc/usd', label: slug, resolutionUrl: 'https://data.chain.link/streams/btc-usd' }
}

/** For virtual slugs btc-5m / btc-15m, return interval in minutes for soonest API. */
export function getIntervalMinutes(slug: string): number | null {
  const s = slug.toLowerCase()
  if (s === 'btc-5m') return 5
  if (s === 'btc-15m') return 15
  return null
}

/** Derive asset search term from slug so we can find all markets for this asset (e.g. btc-updown-5m-* -> Bitcoin) */
export function getAssetSearchFromSlug(slug: string): string {
  const s = slug.toLowerCase()
  if (s.startsWith('btc-')) return 'Bitcoin'
  if (s.startsWith('eth-')) return 'Ethereum'
  if (s.startsWith('sol-')) return 'Solana'
  if (s.startsWith('xrp-')) return 'XRP'
  return 'Bitcoin'
}
