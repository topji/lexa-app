/**
 * Polymarket CLOB client for browser (wallet signer).
 * Follows "Placing Your First Order": https://docs.polymarket.com/quickstart/first-order
 *
 * Step 1: Initialize with signer (we use window.ethereum → ethers Web3Provider, not private key).
 * Step 2: createOrDeriveApiKey() to get User API credentials (key, secret, passphrase).
 * Step 3: Signature type 0 = EOA, funder = EOA wallet address (type 1/2 = Polymarket proxy).
 * Step 4: Reinitialize ClobClient with signer, userApiCreds, signatureType, funderAddress.
 *
 * We also attach a BuilderConfig (remote signing) so all L2 methods
 * include builder headers for order attribution when builder creds are set.
 */

import { ClobClient } from '@polymarket/clob-client'
import { BuilderConfig } from '@polymarket/builder-signing-sdk'
import { ethers } from 'ethers'

const CLOB_HOST = 'https://clob.polymarket.com'
const CHAIN_ID = 137 // Polygon mainnet

const API_CREDS_KEY = 'lexa_polymarket_api_creds'

/** L2 API credentials (key name required by ClobClient) */
export interface ApiCreds {
  key: string
  secret: string
  passphrase: string
}

function loadStoredCreds(address: string): ApiCreds | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(`${API_CREDS_KEY}_${address?.toLowerCase()}`)
    if (!raw) return null
    return JSON.parse(raw) as ApiCreds
  } catch {
    return null
  }
}

function saveStoredCreds(address: string, creds: ApiCreds) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(`${API_CREDS_KEY}_${address.toLowerCase()}`, JSON.stringify(creds))
  } catch {
    // ignore
  }
}

/** Get ethers v5 signer from window.ethereum (MetaMask etc). */
export async function getSigner(): Promise<ethers.Signer> {
  const win = typeof window !== 'undefined' ? (window as unknown as { ethereum?: unknown }) : undefined
  const provider = win?.ethereum
  if (!provider) throw new Error('No wallet found. Install MetaMask or connect a wallet.')
  const ethersProvider = new ethers.providers.Web3Provider(provider as ethers.providers.ExternalProvider)
  await ethersProvider.send('eth_requestAccounts', [])
  return ethersProvider.getSigner()
}

function getBuilderSignUrl(): string | null {
  if (typeof window === 'undefined') return null
  return `${window.location.origin}/api/relayer/sign`
}

/**
 * Create CLOB client with full auth (Step 4). Derives User API credentials via L1 if not stored.
 * EOA: signatureType 0, funder = signer address. Do not use Builder API credentials here.
 */
export async function createClobClient(): Promise<ClobClient> {
  const signer = await getSigner()
  const address = await signer.getAddress()

  const jsonRpcSigner = signer as ethers.providers.JsonRpcSigner
  let apiCreds = loadStoredCreds(address)
  if (!apiCreds) {
    const tempClient = new ClobClient(CLOB_HOST, CHAIN_ID, jsonRpcSigner)
    apiCreds = await tempClient.createOrDeriveApiKey()
    saveStoredCreds(address, apiCreds)
  }

  const signatureType = 0 // EOA (MetaMask)
  const funder = address // EOA trades from own address
  const signUrl = getBuilderSignUrl()
  const builderConfig = signUrl
    ? new BuilderConfig({ remoteBuilderConfig: { url: signUrl } })
    : undefined

  // Attach builderConfig when available for builder order attribution.
  return new ClobClient(
    CLOB_HOST,
    CHAIN_ID,
    jsonRpcSigner,
    apiCreds,
    signatureType,
    funder,
    undefined,
    false,
    builderConfig
  )
}

/** Create a CLOB client configured to trade via a Safe (signatureType = 2, funder = Safe address). */
export async function createSafeClobClient(apiCreds: ApiCreds, safeAddress: string): Promise<ClobClient> {
  const signer = await getSigner()
  const jsonRpcSigner = signer as ethers.providers.JsonRpcSigner
  const signUrl = getBuilderSignUrl()
  const builderConfig = signUrl
    ? new BuilderConfig({ remoteBuilderConfig: { url: signUrl } })
    : undefined

  return new ClobClient(
    CLOB_HOST,
    CHAIN_ID,
    jsonRpcSigner,
    apiCreds,
    2, // GNOSIS_SAFE
    safeAddress,
    undefined,
    false,
    builderConfig
  )
}

