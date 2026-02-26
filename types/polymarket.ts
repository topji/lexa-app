export interface PolymarketMarket {
  id: string
  question: string
  description?: string
  slug: string
  outcomes?: Array<{
    name: string
    price: number
  }>
  volume?: number
  category?: string
  tags?: string[]
  isOpen?: boolean
  startDate?: string | Date
  endDate?: string | Date
  createdAt?: string | Date
  closed?: boolean
  resolved?: boolean
}

