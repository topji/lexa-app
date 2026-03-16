import { ClobClient } from '@polymarket/clob-client'
import { Wallet } from 'ethers'
import { config } from '../config.js'

export type ClobApiCreds = {
  apiKey: string
  secret: string
  passphrase: string
}

export async function createOrDeriveClobApiKey(privateKey: string): Promise<ClobApiCreds> {
  const signer = new Wallet(privateKey)
  const client = new ClobClient(config.clobRestUrl, config.polymarketChainId, signer)
  const raw = (await client.createOrDeriveApiKey()) as { key?: string; secret?: string; passphrase?: string }
  const creds: ClobApiCreds = { apiKey: raw.key ?? '', secret: raw.secret ?? '', passphrase: raw.passphrase ?? '' }
  if (!creds.apiKey || !creds.secret || !creds.passphrase) {
    throw new Error('Failed to create/derive CLOB API credentials')
  }
  return creds
}

