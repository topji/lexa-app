import { PolymarketMarket } from './polymarket'
import { InefficiencyGroup } from '@/lib/inefficiency'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  markets?: PolymarketMarket[]
  inefficiencies?: InefficiencyGroup[]
}
