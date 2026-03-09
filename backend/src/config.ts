import 'dotenv/config'

const required = (key: string): string => {
  const v = process.env[key]
  if (v == null || v === '') throw new Error(`Missing env: ${key}`)
  return v
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  marketSlug: process.env.MARKET_SLUG ?? 'btc-updown-5m-1771880100',
  clobWsUrl: 'wss://ws-subscriptions-clob.polymarket.com/ws/market',
  rtdsWsUrl: 'wss://ws-live-data.polymarket.com',
  gammaApiBase: 'https://gamma-api.polymarket.com',
  sampleIntervalMs: 1000,
  historySeconds: 5,
  // Logical market code for our own schema: btc-5m, btc-15m, eth-5m, eth-15m, sol-5m, sol-15m
  marketCode: process.env.MARKET_CODE ?? 'btc-5m',
} as const
