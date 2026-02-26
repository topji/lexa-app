import { PolymarketMarket } from './polymarket'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  markets?: PolymarketMarket[]
}

