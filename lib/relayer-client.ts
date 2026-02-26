/**
 * Polymarket Relayer Client for gasless transactions (Safe deploy, CTF ops).
 * Uses remote signing so Builder API credentials stay on the server.
 * @see https://docs.polymarket.com/developers/builders/relayer-client
 */

import { RelayClient, RelayerTxType } from '@polymarket/builder-relayer-client'
import { BuilderConfig } from '@polymarket/builder-signing-sdk'
import { getSigner } from '@/lib/clob-client'
import { ethers } from 'ethers'

const RELAYER_URL = 'https://relayer-v2.polymarket.com'
const CHAIN_ID = 137 // Polygon

/** Get the remote signer URL for the current origin (must be same origin as the app). */
export function getRelayerSignUrl(): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}/api/relayer/sign`
}

/**
 * Create a RelayClient with remote Builder signing. Requires env POLY_BUILDER_* on the server.
 * Uses the connected wallet (ethers JsonRpcSigner) as the signer.
 */
export async function createRelayClient(): Promise<RelayClient> {
  const signer = await getSigner()
  const jsonRpcSigner = signer as ethers.providers.JsonRpcSigner
  const signUrl = getRelayerSignUrl()
  if (!signUrl) throw new Error('Relayer sign URL not available')
  const builderConfig = new BuilderConfig({
    remoteBuilderConfig: { url: signUrl },
  })
  return new RelayClient(
    RELAYER_URL,
    CHAIN_ID,
    jsonRpcSigner,
    builderConfig,
    RelayerTxType.SAFE
  )
}
