import { PolymarketMarket } from '@/types/polymarket'

/**
 * Dummy data: selected markets to show on the /markets page.
 * Replace with real data (e.g. from API or user selections) later.
 */
export const selectedMarkets: PolymarketMarket[] = [
  {
    id: 'sel-1',
    question: 'Will Bitcoin reach $100,000 by end of 2025?',
    description: 'Prediction market for Bitcoin price target. Resolves Yes if BTC trades at or above $100k on any major exchange by Dec 31, 2025.',
    slug: 'bitcoin-100k-2025',
    outcomes: [
      { name: 'Yes', price: 0.42 },
      { name: 'No', price: 0.58 },
    ],
    volume: 3200000,
    category: 'Crypto',
    tags: ['bitcoin', 'crypto', 'price'],
    isOpen: true,
  },
  {
    id: 'sel-2',
    question: 'Will Ethereum ETF be approved by SEC in 2025?',
    description: 'Resolves Yes if the SEC approves a spot Ethereum ETF for trading in the US by December 31, 2025.',
    slug: 'ethereum-etf-2025',
    outcomes: [
      { name: 'Yes', price: 0.78 },
      { name: 'No', price: 0.22 },
    ],
    volume: 2100000,
    category: 'Crypto',
    tags: ['ethereum', 'etf', 'sec', 'crypto'],
    isOpen: true,
  },
  {
    id: 'sel-3',
    question: 'Will Trump win the 2024 Presidential Election?',
    description: 'Resolves to Yes if Donald Trump wins the 2024 US Presidential Election. Official resolution from certified results.',
    slug: 'trump-2024-election',
    outcomes: [
      { name: 'Yes', price: 0.94 },
      { name: 'No', price: 0.06 },
    ],
    volume: 8500000,
    category: 'Politics',
    tags: ['trump', 'election', 'politics', '2024'],
    isOpen: true,
  },
  {
    id: 'sel-4',
    question: 'Will the Fed cut rates by more than 0.5% in 2025?',
    description: 'Federal Reserve interest rate prediction. Yes if the Fed funds rate is cut by more than 50 basis points from current level by end of 2025.',
    slug: 'fed-rate-cut-2025',
    outcomes: [
      { name: 'Yes', price: 0.65 },
      { name: 'No', price: 0.35 },
    ],
    volume: 1800000,
    category: 'Politics',
    tags: ['fed', 'rates', 'economics'],
    isOpen: true,
  },
  {
    id: 'sel-5',
    question: 'Will SpaceX launch Starship to orbit in 2025?',
    description: 'Resolves Yes if a SpaceX Starship completes at least one full orbit around Earth before January 1, 2026.',
    slug: 'spacex-starship-orbit-2025',
    outcomes: [
      { name: 'Yes', price: 0.55 },
      { name: 'No', price: 0.45 },
    ],
    volume: 920000,
    category: 'Science',
    tags: ['spacex', 'starship', 'space'],
    isOpen: true,
  },
  {
    id: 'sel-6',
    question: 'Will OpenAI release GPT-5 in 2025?',
    description: 'Resolves Yes if OpenAI publicly releases a model named GPT-5 (or equivalent next flagship) in 2025.',
    slug: 'openai-gpt5-2025',
    outcomes: [
      { name: 'Yes', price: 0.72 },
      { name: 'No', price: 0.28 },
    ],
    volume: 450000,
    category: 'Technology',
    tags: ['openai', 'gpt', 'ai', 'technology'],
    isOpen: true,
  },
]
