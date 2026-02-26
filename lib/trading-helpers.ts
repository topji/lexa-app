'use client'

import { ethers } from 'ethers'
import type { Transaction } from '@polymarket/builder-relayer-client/dist/types'
import { deriveSafe } from '@polymarket/builder-relayer-client/dist/builder/derive'
import { getContractConfig } from '@polymarket/builder-relayer-client/dist/config'

// Core Polymarket contracts (Polygon)
export const USDC_E_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
export const CTF_ADDRESS = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045'
export const CTF_EXCHANGE_ADDRESS = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E'
export const NEG_RISK_EXCHANGE_ADDRESS = '0xC5d563A36AE78145C45a50134d48A1215220f80a'
export const NEG_RISK_ADAPTER_ADDRESS = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296'

const erc20Interface = new ethers.utils.Interface([
  'function approve(address spender, uint256 amount) external returns (bool)',
])

const erc1155Interface = new ethers.utils.Interface([
  'function setApprovalForAll(address operator, bool approved) external',
  'function balanceOf(address account, uint256 id) view returns (uint256)',
])

const ctfRedeemInterface = new ethers.utils.Interface([
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets) external',
])

/** Outcome token amounts use 6 decimals (same as USDC). */
const OUTCOME_DECIMALS = 6

const MAX_UINT256 = ethers.constants.MaxUint256.toString()

/** Deterministically derive the Safe address for an EOA on Polygon. */
export function deriveSafeAddress(eoaAddress: string): string {
  const config = getContractConfig(137)
  return deriveSafe(eoaAddress, config.SafeContracts.SafeFactory)
}

/** Build Safe transaction payloads for all required USDC.e & CTF approvals. */
export function createApprovalTransactions(): Transaction[] {
  const txs: Transaction[] = []

  // USDC.e ERC-20 approvals
  const erc20Spenders = [
    CTF_ADDRESS,
    CTF_EXCHANGE_ADDRESS,
    NEG_RISK_EXCHANGE_ADDRESS,
    NEG_RISK_ADAPTER_ADDRESS,
  ]

  for (const spender of erc20Spenders) {
    const data = erc20Interface.encodeFunctionData('approve', [spender, MAX_UINT256])
    txs.push({
      to: USDC_E_ADDRESS,
      data,
      value: '0',
    })
  }

  // ERC-1155 setApprovalForAll on CTF for all relevant operators
  const erc1155Operators = [
    CTF_EXCHANGE_ADDRESS,
    NEG_RISK_EXCHANGE_ADDRESS,
    NEG_RISK_ADAPTER_ADDRESS,
  ]

  for (const operator of erc1155Operators) {
    const data = erc1155Interface.encodeFunctionData('setApprovalForAll', [operator, true])
    txs.push({
      to: CTF_ADDRESS,
      data,
      value: '0',
    })
  }

  return txs
}

/**
 * Fetch ERC1155 outcome token balances for a wallet (e.g. Safe) from the CTF contract.
 * Returns amounts in human-readable form (6 decimals).
 */
export async function getOutcomeBalances(
  provider: ethers.providers.Provider,
  owner: string,
  upTokenId: string,
  downTokenId: string
): Promise<{ up: number; down: number }> {
  const ctf = new ethers.Contract(CTF_ADDRESS, ['function balanceOf(address,uint256) view returns (uint256)'], provider)
  const [upRaw, downRaw] = await Promise.all([
    ctf.balanceOf(owner, upTokenId),
    ctf.balanceOf(owner, downTokenId),
  ])
  return {
    up: Number(ethers.utils.formatUnits(upRaw.toString(), OUTCOME_DECIMALS)),
    down: Number(ethers.utils.formatUnits(downRaw.toString(), OUTCOME_DECIMALS)),
  }
}

const PARENT_COLLECTION_ID = '0x0000000000000000000000000000000000000000000000000000000000000000'
/** Binary outcome index sets: Up = 1, Down = 2 */
const BINARY_INDEX_SETS = [1, 2]

/**
 * Build a transaction to redeem winning outcome tokens for USDC after resolution.
 * Call from the Safe (or EOA) that holds the tokens.
 */
export function buildRedeemPositionsTx(conditionId: string): { to: string; data: string; value: string } {
  const conditionIdBytes32 = conditionId.startsWith('0x') ? conditionId : `0x${conditionId}`
  const data = ctfRedeemInterface.encodeFunctionData('redeemPositions', [
    USDC_E_ADDRESS,
    PARENT_COLLECTION_ID,
    conditionIdBytes32,
    BINARY_INDEX_SETS,
  ])
  return {
    to: CTF_ADDRESS,
    data,
    value: '0',
  }
}

