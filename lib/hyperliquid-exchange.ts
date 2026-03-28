/**
 * Hyperliquid Exchange API — order placement, cancellation, leverage, withdrawal.
 *
 * SIGNING STRATEGY — Agent Wallet Pattern:
 *
 * MetaMask enforces that the EIP-712 domain chainId matches the active network
 * for eth_signTypedData_v4, and has removed eth_sign entirely in recent versions.
 * Hyperliquid L1 actions use domain chainId 1337, which will never match any
 * real network, so MetaMask will always reject direct signing of L1 actions.
 *
 * Solution (same as Hyperliquid's official frontend):
 *   1. Generate a random ephemeral keypair (agent wallet) in the browser.
 *   2. User approves the agent once via `approveAgent` — this uses chainId 42161
 *      (Arbitrum), so we switch the user to Arbitrum for this one signature.
 *   3. All L1 actions (orders, cancels, leverage) are signed locally by the agent
 *      wallet using ethers.Wallet._signTypedData — pure crypto, no MetaMask,
 *      no chainId check, no gas.
 *   4. The agent key is stored in localStorage scoped to the user's address.
 *
 * User-signed actions (withdraw, transfer) use chainId 42161 so they work
 * normally with eth_signTypedData_v4 on Arbitrum.
 *
 * Requires: ethers v5, @msgpack/msgpack
 */

import { ethers } from 'ethers'
import { encode } from '@msgpack/msgpack'

// ── Constants ────────────────────────────────────────────────────────────────

const HL_EXCHANGE_URL = '/api/perps/exchange'

const PHANTOM_DOMAIN = {
  name: 'Exchange',
  version: '1',
  chainId: 1337,
  verifyingContract: '0x0000000000000000000000000000000000000000',
}

const AGENT_TYPES = {
  Agent: [
    { name: 'source', type: 'string' },
    { name: 'connectionId', type: 'bytes32' },
  ],
}

const USER_SIGNED_DOMAIN = {
  name: 'HyperliquidSignTransaction',
  version: '1',
  chainId: 42161, // Arbitrum — required for user-signed actions
  verifyingContract: '0x0000000000000000000000000000000000000000',
}

const APPROVE_AGENT_TYPES = {
  'HyperliquidTransaction:ApproveAgent': [
    { name: 'hyperliquidChain', type: 'string' },
    { name: 'agentAddress', type: 'address' },
    { name: 'agentName', type: 'string' },
    { name: 'nonce', type: 'uint64' },
  ],
}

const ARBITRUM_CHAIN_ID = '0xa4b1' // 42161

// ── Types ────────────────────────────────────────────────────────────────────

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripTrailingZeros(s: string): string {
  if (!s.includes('.')) return s
  let r = s.replace(/0+$/, '')
  if (r.endsWith('.')) r = r.slice(0, -1)
  return r
}

/**
 * Convert a price to Hyperliquid wire format.
 * Hyperliquid requires prices to have at most 5 significant figures.
 * Formula: decimals = max(0, 4 - floor(log10(price)))
 *   BTC  ~$95,000 → 0 decimals  (95432)
 *   GOLD ~$4,400  → 1 decimal   (4432.5)
 *   ETH  ~$3,500  → 1 decimal   (3456.8)
 *   SOL  ~$145    → 2 decimals  (145.68)
 */
export function priceToWire(price: number): string {
  if (!price || price <= 0) throw new Error('Invalid price: ' + price)
  const magnitude = Math.floor(Math.log10(price))
  const decimals = Math.max(0, 4 - magnitude)
  return stripTrailingZeros(price.toFixed(decimals))
}

/** @deprecated Use priceToWire instead */
export function toWire(n: number, decimals: number): string {
  return stripTrailingZeros(n.toFixed(Math.max(decimals, 0)))
}

export function sizeToWire(n: number, szDecimals: number): string {
  return stripTrailingZeros(n.toFixed(szDecimals))
}

async function getEthereum(): Promise<{ provider: EthereumProvider; account: string }> {
  const win = typeof window !== 'undefined' ? (window as unknown as { ethereum?: EthereumProvider }) : undefined
  const provider = win?.ethereum
  if (!provider) throw new Error('No wallet found. Install MetaMask or connect a wallet.')
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[]
  if (!accounts.length) throw new Error('No account connected.')
  return { provider, account: accounts[0] }
}

/** Request MetaMask to switch to Arbitrum. Adds the network if not present. */
async function switchToArbitrum(provider: EthereumProvider): Promise<void> {
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: ARBITRUM_CHAIN_ID }],
    })
  } catch (err: unknown) {
    // Error code 4902 = chain not added yet
    if ((err as { code?: number }).code === 4902) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: ARBITRUM_CHAIN_ID,
          chainName: 'Arbitrum One',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: ['https://arb1.arbitrum.io/rpc'],
          blockExplorerUrls: ['https://arbiscan.io'],
        }],
      })
    } else {
      throw err
    }
  }
}

/** Get the currently active chainId from the wallet. */
async function getChainId(provider: EthereumProvider): Promise<number> {
  const hex = (await provider.request({ method: 'eth_chainId' })) as string
  return parseInt(hex, 16)
}

// ── Agent Wallet (localStorage) ──────────────────────────────────────────────

const AGENT_KEY_PREFIX = 'hl_agent_key_'
const AGENT_APPROVED_PREFIX = 'hl_agent_approved_'

/** Load or create an agent wallet for the given user address. */
function getOrCreateAgentWallet(userAddress: string): ethers.Wallet {
  if (typeof window === 'undefined') throw new Error('Browser only')
  const key = AGENT_KEY_PREFIX + userAddress.toLowerCase()
  let pk = localStorage.getItem(key)
  if (!pk) {
    pk = ethers.Wallet.createRandom().privateKey
    localStorage.setItem(key, pk)
  }
  return new ethers.Wallet(pk)
}

/** Check if the agent has been approved on Hyperliquid. */
function isAgentApproved(userAddress: string): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(AGENT_APPROVED_PREFIX + userAddress.toLowerCase()) === '1'
}

/** Mark the agent as approved. */
function setAgentApproved(userAddress: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(AGENT_APPROVED_PREFIX + userAddress.toLowerCase(), '1')
  }
}

/**
 * Ensure an agent wallet exists and is approved on Hyperliquid.
 * If not approved, prompts the user to switch to Arbitrum and sign approveAgent.
 * Returns the agent wallet.
 */
export async function ensureAgentApproved(
  onStatusUpdate?: (msg: string) => void,
): Promise<ethers.Wallet> {
  const { provider, account } = await getEthereum()
  const agentWallet = getOrCreateAgentWallet(account)

  if (isAgentApproved(account)) {
    return agentWallet
  }

  // Need to approve agent — requires Arbitrum (chainId 42161)
  const currentChain = await getChainId(provider)
  if (currentChain !== 42161) {
    onStatusUpdate?.('Switching to Arbitrum to approve trading agent (one-time)...')
    await switchToArbitrum(provider)
  }

  onStatusUpdate?.('Sign to approve trading agent (one-time setup)...')

  const nonce = Date.now()
  const approveAction = {
    hyperliquidChain: 'Mainnet',
    agentAddress: agentWallet.address,
    agentName: 'Lexa',
    nonce,
  }

  // Sign with user's MetaMask on Arbitrum (chainId 42161) — this works fine
  const payload = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      ...APPROVE_AGENT_TYPES,
    },
    primaryType: 'HyperliquidTransaction:ApproveAgent',
    domain: USER_SIGNED_DOMAIN,
    message: approveAction,
  }

  const rawSig = (await provider.request({
    method: 'eth_signTypedData_v4',
    params: [account, JSON.stringify(payload)],
  })) as string

  const { r, s, v } = ethers.utils.splitSignature(rawSig)

  const result = await postExchange({
    action: {
      type: 'approveAgent',
      hyperliquidChain: 'Mainnet',
      signatureChainId: '0xa4b1',
      agentAddress: agentWallet.address,
      agentName: 'Lexa',
      nonce,
    },
    nonce,
    signature: { r, s, v },
  })

  if ((result as { status?: string }).status !== 'ok') {
    throw new Error(`Agent approval failed: ${JSON.stringify(result)}`)
  }

  setAgentApproved(account)
  onStatusUpdate?.('Agent approved! You can now trade on any network.')
  return agentWallet
}

// ── Signing ──────────────────────────────────────────────────────────────────

function hashAction(
  action: Record<string, unknown>,
  vaultAddress: string | null,
  nonce: number,
): string {
  const msgPackBytes = encode(action)
  const additionalBytesLength = vaultAddress === null ? 9 : 29
  const data = new Uint8Array(msgPackBytes.length + additionalBytesLength)
  data.set(msgPackBytes)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  view.setBigUint64(msgPackBytes.length, BigInt(nonce))
  if (vaultAddress === null) {
    view.setUint8(msgPackBytes.length + 8, 0)
  } else {
    view.setUint8(msgPackBytes.length + 8, 1)
    const addrBytes = ethers.utils.arrayify(vaultAddress)
    data.set(addrBytes, msgPackBytes.length + 9)
  }
  return ethers.utils.keccak256(data)
}

/** Sign an L1 action with the local agent wallet (no MetaMask, no chainId check). */
async function signL1Action(
  agentWallet: ethers.Wallet,
  action: Record<string, unknown>,
  nonce: number,
  vaultAddress: string | null = null,
): Promise<{ r: string; s: string; v: number }> {
  const connectionId = hashAction(action, vaultAddress, nonce)
  const phantomAgent = { source: 'a', connectionId }
  const signature = await agentWallet._signTypedData(PHANTOM_DOMAIN, AGENT_TYPES, phantomAgent)
  const { r, s, v } = ethers.utils.splitSignature(signature)
  return { r, s, v }
}

/** Sign a user action with MetaMask (requires Arbitrum). */
async function signUserAction(
  provider: EthereumProvider,
  account: string,
  action: Record<string, unknown>,
  types: Record<string, Array<{ name: string; type: string }>>,
  primaryType: string,
): Promise<{ r: string; s: string; v: number }> {
  // Ensure on Arbitrum for user-signed actions
  const currentChain = await getChainId(provider)
  if (currentChain !== 42161) {
    await switchToArbitrum(provider)
  }

  const payload = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      ...types,
    },
    primaryType,
    domain: USER_SIGNED_DOMAIN,
    message: action,
  }

  const signature = (await provider.request({
    method: 'eth_signTypedData_v4',
    params: [account, JSON.stringify(payload)],
  })) as string

  const { r, s, v } = ethers.utils.splitSignature(signature)
  return { r, s, v }
}

// ── Exchange HTTP ─────────────────────────────────────────────────────────────

async function postExchange(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const resp = await fetch(HL_EXCHANGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await resp.json()
  if (!resp.ok) {
    throw new Error(data?.detail || data?.error || `Exchange error: ${resp.status}`)
  }
  return data as Record<string, unknown>
}

// ── Public API ────────────────────────────────────────────────────────────────

export type OrderResult = {
  status: 'ok' | 'err'
  response?: {
    type: string
    data: {
      statuses: Array<
        | { resting: { oid: number } }
        | { filled: { totalSz: string; avgPx: string; oid: number } }
        | { error: string }
      >
    }
  }
  error?: string
}

export type OrderParams = {
  asset: number
  isBuy: boolean
  price: string
  size: string
  reduceOnly: boolean
  orderType: 'market' | 'limit'
  tif?: 'Gtc' | 'Ioc' | 'Alo'
  cloid?: string
}

export async function placeOrder(
  params: OrderParams,
  onStatus?: (msg: string) => void,
): Promise<OrderResult> {
  const agentWallet = await ensureAgentApproved(onStatus)
  const nonce = Date.now()

  const orderWire = {
    a: params.asset,
    b: params.isBuy,
    p: params.price,
    s: params.size,
    r: params.reduceOnly,
    t: params.orderType === 'market'
      ? { limit: { tif: 'Ioc' as const } }
      : { limit: { tif: (params.tif ?? 'Gtc') as string } },
    ...(params.cloid ? { c: params.cloid } : {}),
  }

  const action: Record<string, unknown> = {
    type: 'order',
    orders: [orderWire],
    grouping: 'na',
  }

  const signature = await signL1Action(agentWallet, action, nonce)

  return postExchange({
    action,
    nonce,
    signature,
    vaultAddress: null,
  }) as Promise<OrderResult>
}

export async function cancelOrders(
  cancels: Array<{ asset: number; oid: number }>,
  onStatus?: (msg: string) => void,
): Promise<Record<string, unknown>> {
  const agentWallet = await ensureAgentApproved(onStatus)
  const nonce = Date.now()

  const action: Record<string, unknown> = {
    type: 'cancel',
    cancels: cancels.map((c) => ({ a: c.asset, o: c.oid })),
  }

  const signature = await signL1Action(agentWallet, action, nonce)

  return postExchange({ action, nonce, signature, vaultAddress: null })
}

export async function updateLeverage(
  asset: number,
  leverage: number,
  isCross: boolean = true,
  onStatus?: (msg: string) => void,
): Promise<Record<string, unknown>> {
  const agentWallet = await ensureAgentApproved(onStatus)
  const nonce = Date.now()

  const action: Record<string, unknown> = {
    type: 'updateLeverage',
    asset,
    isCross,
    leverage,
  }

  const signature = await signL1Action(agentWallet, action, nonce)

  return postExchange({ action, nonce, signature, vaultAddress: null })
}

export async function withdrawUSDC(
  amount: string,
  destination: string,
): Promise<Record<string, unknown>> {
  const { provider, account } = await getEthereum()
  const nonce = Date.now()

  const action = {
    type: 'withdraw3',
    hyperliquidChain: 'Mainnet',
    signatureChainId: '0xa4b1',
    destination,
    amount,
    time: nonce,
  }

  const types = {
    'HyperliquidTransaction:Withdraw': [
      { name: 'hyperliquidChain', type: 'string' },
      { name: 'destination', type: 'string' },
      { name: 'amount', type: 'string' },
      { name: 'time', type: 'uint64' },
    ],
  }

  const signature = await signUserAction(
    provider,
    account,
    { hyperliquidChain: action.hyperliquidChain, destination: action.destination, amount: action.amount, time: action.time },
    types,
    'HyperliquidTransaction:Withdraw',
  )

  return postExchange({ action, nonce, signature })
}

export async function transferUSDC(
  amount: string,
  toPerp: boolean,
): Promise<Record<string, unknown>> {
  const { provider, account } = await getEthereum()
  const nonce = Date.now()

  const action = {
    type: 'usdClassTransfer',
    hyperliquidChain: 'Mainnet',
    signatureChainId: '0xa4b1',
    amount,
    toPerp,
    nonce,
  }

  const types = {
    'HyperliquidTransaction:UsdClassTransfer': [
      { name: 'hyperliquidChain', type: 'string' },
      { name: 'amount', type: 'string' },
      { name: 'toPerp', type: 'bool' },
      { name: 'nonce', type: 'uint64' },
    ],
  }

  const signature = await signUserAction(
    provider,
    account,
    { hyperliquidChain: action.hyperliquidChain, amount: action.amount, toPerp: action.toPerp, nonce: action.nonce },
    types,
    'HyperliquidTransaction:UsdClassTransfer',
  )

  return postExchange({ action, nonce, signature })
}

export function marketSlippagePrice(
  markPrice: number,
  isBuy: boolean,
  slippageBps: number = 50,
): number {
  const factor = slippageBps / 10000
  return isBuy
    ? markPrice * (1 + factor)
    : markPrice * (1 - factor)
}
