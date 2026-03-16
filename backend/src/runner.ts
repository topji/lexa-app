import { ClobClient, OrderType, Side, AssetType } from '@polymarket/clob-client'
import { Wallet, Contract, providers, utils } from 'ethers'
import { config } from './config.js'
import { fetchMarketInfo, type MarketInfo } from './fetch-market.js'
import { resolveSoonestBtc5mSlug } from './resolve-soonest.js'
import { getLatestOdds, type LatestOddsRow } from './db/marketOdds.js'
import { listActiveStrategies, type StrategyRow } from './db/strategies.js'
import { getWalletById, setWalletClobCreds } from './db/wallets.js'
import {
  getOpenPositionForStrategy,
  createOpenPosition,
  closePosition,
  countOpenPositionsForUser,
  type ExitReason,
} from './db/positions.js'
import { decryptString, encryptString } from './security/encryption.js'
import { createOrDeriveClobApiKey } from './polymarket/clob.js'

type MarketInfoCache = {
  fetchedAtMs: number
  info: MarketInfo
}

const marketInfoCache: Partial<Record<string, MarketInfoCache>> = {}

async function getMarketInfoFor(marketCode: string): Promise<MarketInfo> {
  const cached = marketInfoCache[marketCode]
  if (cached && Date.now() - cached.fetchedAtMs < 30_000) return cached.info

  if (marketCode === 'btc-5m') {
    const soonest = await resolveSoonestBtc5mSlug()
    const slug = soonest ?? config.marketSlug
    const info = await fetchMarketInfo(slug)
    marketInfoCache[marketCode] = { fetchedAtMs: Date.now(), info }
    return info
  }

  const info = await fetchMarketInfo(config.marketSlug)
  marketInfoCache[marketCode] = { fetchedAtMs: Date.now(), info }
  return info
}

async function ensureWalletClobCreds(walletId: number): Promise<void> {
  const w = await getWalletById(walletId)
  if (!w) throw new Error(`wallet ${walletId} not found`)
  if (w.type !== 'custodial') throw new Error(`wallet ${walletId} must be custodial`)
  if (!w.encrypted_private_key) throw new Error(`wallet ${walletId} missing private key`)
  if (w.clob_api_key && w.encrypted_clob_secret && w.encrypted_clob_passphrase) return

  const pk = decryptString(w.encrypted_private_key)
  const creds = await createOrDeriveClobApiKey(pk)
  await setWalletClobCreds({
    walletId,
    apiKey: creds.apiKey,
    encryptedSecret: encryptString(creds.secret),
    encryptedPassphrase: encryptString(creds.passphrase),
  })
}

export async function getClobClientForWallet(walletId: number): Promise<{ client: ClobClient; address: string }> {
  await ensureWalletClobCreds(walletId)
  const w = await getWalletById(walletId)
  if (!w) throw new Error(`wallet ${walletId} not found`)
  if (!w.encrypted_private_key) throw new Error(`wallet ${walletId} missing private key`)
  if (!w.clob_api_key || !w.encrypted_clob_secret || !w.encrypted_clob_passphrase) {
    throw new Error(`wallet ${walletId} missing clob creds`)
  }

  const pk = decryptString(w.encrypted_private_key)
  const signer = new Wallet(pk)
  const creds = {
    key: w.clob_api_key,
    secret: decryptString(w.encrypted_clob_secret),
    passphrase: decryptString(w.encrypted_clob_passphrase),
  }

  const funder = w.builder_proxy_address ?? w.funder_address
  // Polymarket expects signatureType 2 for proxy/gasless (maker = Safe, signer = EOA). Type 0 = EOA only.
  const signatureType = w.builder_proxy_address ? 2 : (w.signature_type as 0 | 1 | 2)
  const client = new ClobClient(
    config.clobRestUrl,
    config.polymarketChainId,
    signer,
    creds,
    signatureType,
    funder
  )

  return { client, address: signer.address }
}

const USDC_E = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
const CTF_EXCHANGE_ADDRESS = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E'
const usdcAbi = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
]

/** Fetch USDC balance and allowance for the funder (gasless Safe or EOA) from chain. Use this when the wallet has a gasless proxy so we check the Safe, not the signer. */
async function getFunderBalanceAllowance(funderAddress: string): Promise<{ balance: number; allowance: number } | null> {
  if (!funderAddress || !utils.isAddress(funderAddress)) return null
  for (const rpcUrl of config.polygonRpcUrls) {
    try {
      const provider = new providers.JsonRpcProvider(rpcUrl)
      const usdc = new Contract(USDC_E, usdcAbi, provider)
      const [balWei, allowWei] = await Promise.all([
        usdc.balanceOf(funderAddress),
        usdc.allowance(funderAddress, CTF_EXCHANGE_ADDRESS),
      ])
      const balance = parseFloat(utils.formatUnits(balWei, 6))
      const allowance = parseFloat(utils.formatUnits(allowWei, 6))
      return { balance, allowance }
    } catch {
      // try next RPC
    }
  }
  return null
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return v
  return parseFloat(String(v))
}

// Returns the signed absolute change for the given side and window.
// Positive = odds rose, negative = odds fell.
function getAbsChange(latest: LatestOddsRow, side: 'up' | 'down', windowS: number): number | null {
  const key = `${side}_abs_chg_${windowS}s` as keyof LatestOddsRow
  const raw = latest[key]
  if (raw == null) return null
  const v = toNum(raw)
  return Number.isFinite(v) ? v : null
}

// Returns the signed percentage change for the given side and window.
// ((current - prev) / prev) * 100 — positive = rose, negative = fell.
function getPctChange(latest: LatestOddsRow, side: 'up' | 'down', windowS: number): number | null {
  const key = `${side}_pct_chg_${windowS}s` as keyof LatestOddsRow
  const raw = latest[key]
  if (raw == null) return null
  const v = toNum(raw)
  return Number.isFinite(v) ? v : null
}

/** Returns null if entry is allowed, or a short reason string if not. */
function whyNotEnter(
  strategy: StrategyRow,
  odds: { up: number; down: number },
  secondsToExpiry: number | null,
  latest: LatestOddsRow
): string | null {
  if (secondsToExpiry == null) return 'no seconds_to_expiry'
  if (strategy.market === 'btc-5m') {
    if (secondsToExpiry > 280) return 'btc-5m: first 20s blocked'
    if (secondsToExpiry < 30) return 'btc-5m: last 30s blocked'
  }
  const currentOdd = strategy.entry_side === 'up' ? odds.up : odds.down
  if (secondsToExpiry <= strategy.entry_seconds_to_expiry_min) return `expiry ${secondsToExpiry}s <= min ${strategy.entry_seconds_to_expiry_min}s`
  if (strategy.entry_odd_max != null) {
    const entryOddMax = toNum(strategy.entry_odd_max)
    if (currentOdd > entryOddMax) return `odd ${currentOdd.toFixed(4)} > max ${entryOddMax}`
  }
  if (strategy.entry_odd_change_window_s != null) {
    const w = strategy.entry_odd_change_window_s
    if (w >= 1 && w <= 5) {
      if (strategy.entry_odd_change_min != null) {
        const change = getAbsChange(latest, strategy.entry_side, w)
        if (change == null) return `no abs change history for ${w}s`
        if (change < toNum(strategy.entry_odd_change_min)) return `abs change ${change} < min ${strategy.entry_odd_change_min}`
      }
      if (strategy.entry_odd_change_pct_min != null) {
        const changePct = getPctChange(latest, strategy.entry_side, w)
        const minPct = toNum(strategy.entry_odd_change_pct_min)
        if (changePct == null) return `no pct change history for ${w}s`
        // Negative min = "drop by at least X%": allow when changePct <= min (e.g. -2.1 <= -2). Positive = "rise by at least X%": allow when changePct >= min.
        if (minPct <= 0 && changePct > minPct) return `pct change ${changePct} > min ${minPct} (need drop >= ${-minPct}%)`
        if (minPct > 0 && changePct < minPct) return `pct change ${changePct} < min ${minPct}`
      }
    }
  }
  return null
}

function shouldEnter(
  strategy: StrategyRow,
  odds: { up: number; down: number },
  secondsToExpiry: number | null,
  latest: LatestOddsRow
): boolean {
  return whyNotEnter(strategy, odds, secondsToExpiry, latest) === null
}

function shouldExit(
  strategy: StrategyRow,
  positionSide: 'up' | 'down',
  odds: { up: number; down: number },
  secondsToExpiry: number | null,
  entryOdd: number | null  // needed for percentage-based exits
): { exit: boolean; reason?: ExitReason } {
  if (secondsToExpiry == null) return { exit: false }

  const currentOdd = positionSide === 'up' ? odds.up : odds.down
  const entryOddNum = entryOdd != null && Number.isFinite(entryOdd) ? entryOdd : null

  // ── Profit-take checks (checked before stop-loss so profits aren't missed) ──

  // Absolute take-profit: exit when odd >= exit_profit_odd
  if (strategy.exit_profit_odd != null) {
    const target = toNum(strategy.exit_profit_odd)
    if (Number.isFinite(target) && currentOdd >= target) {
      return { exit: true, reason: 'profit' }
    }
  }

  // Percentage take-profit: exit when odd >= entryOdd * (1 + pct/100)
  // e.g. exit_profit_pct=100 → exit at 2× the entry odd
  if (strategy.exit_profit_pct != null && entryOddNum != null) {
    const pct = toNum(strategy.exit_profit_pct)
    const target = entryOddNum * (1 + pct / 100)
    if (Number.isFinite(target) && currentOdd >= target) {
      return { exit: true, reason: 'profit' }
    }
  }

  // ── Stop-loss checks ──

  // Absolute stop-loss: exit when odd <= exit_stop_loss
  if (strategy.exit_stop_loss != null) {
    const stopLoss = toNum(strategy.exit_stop_loss)
    if (Number.isFinite(stopLoss) && currentOdd <= stopLoss) {
      return { exit: true, reason: 'stoploss' }
    }
  }

  // Percentage stop-loss: exit when odd <= entryOdd * (pct/100)
  // e.g. exit_stop_loss_pct=60 → stop out when odd falls to 60% of entry
  if (strategy.exit_stop_loss_pct != null && entryOddNum != null) {
    const pct = toNum(strategy.exit_stop_loss_pct)
    const target = entryOddNum * (pct / 100)
    if (Number.isFinite(target) && currentOdd <= target) {
      return { exit: true, reason: 'stoploss' }
    }
  }

  // ── Time exit ──
  if (secondsToExpiry < strategy.exit_seconds_to_expiry_max) {
    return { exit: true, reason: 'time' }
  }

  return { exit: false }
}

export function startRunner() {
  const enabled = process.env.RUNNER_ENABLED === '1' || process.env.RUNNER_ENABLED === 'true'
  if (!enabled) return

  const intervalMs = Math.max(500, parseInt(process.env.RUNNER_INTERVAL_MS ?? '1000', 10) || 1000)
  let busy = false
  const minUsdc = parseFloat(process.env.RUNNER_MIN_USDC ?? '1') || 1
  const minOrderUsd = parseFloat(process.env.RUNNER_MIN_ORDER_USD ?? '1') || 1
  const maxOpenPerUser = parseInt(process.env.RUNNER_MAX_OPEN_POSITIONS_PER_USER ?? '5', 10) || 5
  const maxWalletErrors = parseInt(process.env.RUNNER_MAX_WALLET_ERRORS ?? '5', 10) || 5
  const maxGlobalErrors = parseInt(process.env.RUNNER_MAX_GLOBAL_ERRORS ?? '20', 10) || 20
  const globalErrorBackoffMs = parseInt(process.env.RUNNER_GLOBAL_BACKOFF_MS ?? '10000', 10) || 10000
  const entryCooldownMs = Math.max(1000, parseInt(process.env.RUNNER_ENTRY_COOLDOWN_MS ?? '60000', 10) || 60000)

  const walletErrorCounts = new Map<number, number>()
  const lastEntryByStrategy = new Map<number, { at: number; expiryTs: string }>()
  let globalErrorStreak = 0
  let globalBackoffUntil = 0

  setInterval(async () => {
    if (busy) return
    busy = true
    try {
      if (process.env.RUNNER_PAUSE === '1' || process.env.RUNNER_PAUSE === 'true') {
        console.log('[Runner] skipped tick: RUNNER_PAUSE is set')
        busy = false
        return
      }
      if (Date.now() < globalBackoffUntil) {
        console.log('[Runner] skipped tick: global backoff until', new Date(globalBackoffUntil).toISOString())
        busy = false
        return
      }

      const strategies = await listActiveStrategies()
      const openCountByUser = new Map<number, number>()

      for (const s of strategies) {
        const latest = await getLatestOdds(s.market)
        if (!latest) {
          console.log('[Runner] skip: no latest odds for market', s.market, 'strategyId=', s.id)
          continue
        }

        const odds = { up: toNum(latest.up_odd), down: toNum(latest.down_odd) }
        const secondsToExpiry = latest.seconds_to_expiry == null ? null : Number(latest.seconds_to_expiry)

        const openPos = await getOpenPositionForStrategy(s.id)

        if (!openPos) {
          // ── Entry path ──
          const whyNot = whyNotEnter(s, odds, secondsToExpiry, latest)
          if (whyNot != null) {
            console.log('[Runner] skip entry:', whyNot, 'strategyId=', s.id, 'up=', odds.up.toFixed(4), 'down=', odds.down.toFixed(4), 'expiry_s=', secondsToExpiry)
            continue
          }

          const expiryKey = latest.expiry_ts instanceof Date ? String((latest.expiry_ts as Date).getTime()) : String(latest.expiry_ts ?? '')
          const lastEntry = lastEntryByStrategy.get(s.id)
          if (lastEntry) {
            const elapsed = Date.now() - lastEntry.at
            const sameWindow = lastEntry.expiryTs === expiryKey
            if (sameWindow && elapsed < entryCooldownMs) {
              console.log('[Runner] skip entry: cooldown (1 min or new market)', { strategyId: s.id, elapsedMs: elapsed, cooldownMs: entryCooldownMs })
              continue
            }
          }

          let userOpen = openCountByUser.get(s.user_id)
          if (userOpen == null) {
            userOpen = await countOpenPositionsForUser(s.user_id)
            openCountByUser.set(s.user_id, userOpen)
          }
          if (userOpen >= maxOpenPerUser) {
            console.log('[Runner] skip entry: max open positions', userOpen, '>=', maxOpenPerUser, 'strategyId=', s.id)
            continue
          }

          const info = await getMarketInfoFor(s.market)
          const tokenID = s.entry_side === 'up' ? info.clobTokenIds[0] : info.clobTokenIds[1]

          if ((walletErrorCounts.get(s.wallet_id) ?? 0) >= maxWalletErrors) {
            console.log('[Runner] skip entry: wallet error limit reached walletId=', s.wallet_id, 'strategyId=', s.id)
            continue
          }

          let client: ClobClient
          let clobSignerAddress: string | undefined
          try {
            const out = await getClobClientForWallet(s.wallet_id)
            client = out.client
            clobSignerAddress = out.address
          } catch (err) {
            console.error('[Runner] getClobClientForWallet failed', { strategyId: s.id, walletId: s.wallet_id, err })
            walletErrorCounts.set(s.wallet_id, (walletErrorCounts.get(s.wallet_id) ?? 0) + 1)
            if (++globalErrorStreak >= maxGlobalErrors) globalBackoffUntil = Date.now() + globalErrorBackoffMs
            continue
          }

          const wallet = await getWalletById(s.wallet_id)
          const funderAddress = wallet?.builder_proxy_address ?? wallet?.funder_address

          try {
            let usdcBal: number
            let usdcAllowance: number

            if (funderAddress && wallet?.builder_proxy_address) {
              // Gasless wallet: CLOB returns signer balance (0). Check the funder (Safe) on-chain.
              const onChain = await getFunderBalanceAllowance(funderAddress)
              if (onChain == null) {
                console.warn('[Runner] on-chain balance fetch failed for funder', { strategyId: s.id, funderAddress })
                walletErrorCounts.set(s.wallet_id, (walletErrorCounts.get(s.wallet_id) ?? 0) + 1)
                if (++globalErrorStreak >= maxGlobalErrors) globalBackoffUntil = Date.now() + globalErrorBackoffMs
                continue
              }
              usdcBal = onChain.balance
              usdcAllowance = onChain.allowance
            } else {
              // EOA or no gasless proxy: use CLOB client (reports balance for the trading address).
              const collateral = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL })
              const rawBal = (collateral as any)?.balance
              const rawAllowance = (collateral as any)?.allowance
              const rawAllowances = (collateral as any)?.allowances as Record<string, unknown> | undefined
              const NEG_RISK_EXCHANGE_ADDRESS = '0xC5d563A36AE78145C45a50134d48A1215220f80a'
              const NEG_RISK_ADAPTER_ADDRESS = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296'
              const derivedAllowance =
                rawAllowance ??
                rawAllowances?.[CTF_EXCHANGE_ADDRESS] ??
                rawAllowances?.[NEG_RISK_EXCHANGE_ADDRESS] ??
                rawAllowances?.[NEG_RISK_ADAPTER_ADDRESS]
              usdcBal = rawBal == null ? 0 : toNum(rawBal)
              usdcAllowance = derivedAllowance == null ? 0 : toNum(derivedAllowance)
            }

            const needed = Math.max(minUsdc, minOrderUsd, toNum(s.order_size_usd))
            if (!Number.isFinite(usdcBal) || !Number.isFinite(usdcAllowance) || usdcBal < needed || usdcAllowance < needed) {
              console.log('[Runner] skip entry: insufficient balance/allowance', { strategyId: s.id, usdcBal, usdcAllowance, needed, funder: funderAddress ?? 'n/a' })
              continue
            }
          } catch (err) {
            console.error('[Runner] balance/allowance check failed', { strategyId: s.id, err })
            walletErrorCounts.set(s.wallet_id, (walletErrorCounts.get(s.wallet_id) ?? 0) + 1)
            if (++globalErrorStreak >= maxGlobalErrors) globalBackoffUntil = Date.now() + globalErrorBackoffMs
            continue
          }

          const tickSize = await client.getTickSize(tokenID)
          const negRisk = await client.getNegRisk(tokenID)

          // Use entry_odd_max as worst-price limit when set; otherwise use current odd + small buffer
          const currentOdd = s.entry_side === 'up' ? odds.up : odds.down
          const worstPrice = s.entry_odd_max != null ? toNum(s.entry_odd_max) : Math.min(currentOdd * 1.05, 0.99)

          const resp = (await client.createAndPostMarketOrder(
            { tokenID, side: Side.BUY, amount: toNum(s.order_size_usd), price: worstPrice },
            { tickSize, negRisk },
            OrderType.FOK
          )) as { success: boolean; errorMsg?: string; orderID: string; makingAmount: string; takingAmount: string }

          if (!resp.success) {
            console.error('[Runner][Entry] failed', { strategyId: s.id, error: resp.errorMsg })
            walletErrorCounts.set(s.wallet_id, (walletErrorCounts.get(s.wallet_id) ?? 0) + 1)
            if (++globalErrorStreak >= maxGlobalErrors) globalBackoffUntil = Date.now() + globalErrorBackoffMs
            continue
          }

          walletErrorCounts.set(s.wallet_id, 0)
          globalErrorStreak = 0

          await createOpenPosition({
            strategyId: s.id,
            market: s.market,
            expiryTs: latest.expiry_ts,
            side: s.entry_side,
            tokenId: tokenID,
            entrySampleTs: latest.sample_ts,
            entryOdd: currentOdd,
            entryOrderId: resp.orderID,
            entryShares: resp.makingAmount,
          })

          lastEntryByStrategy.set(s.id, { at: Date.now(), expiryTs: expiryKey })
          openCountByUser.set(s.user_id, (openCountByUser.get(s.user_id) ?? 0) + 1)
          console.log('[Runner][Entry] order', { strategyId: s.id, orderId: resp.orderID, shares: resp.makingAmount })
          continue
        }

        // ── Exit path ──
        const entryOdd = openPos.entry_odd != null ? toNum(openPos.entry_odd) : null
        const exitCheck = shouldExit(s, openPos.side, odds, secondsToExpiry, entryOdd)
        if (!exitCheck.exit || !exitCheck.reason) continue

        const tokenID = openPos.token_id
        const shares = toNum(openPos.entry_shares)
        if (!tokenID || !Number.isFinite(shares) || shares <= 0) continue

        if ((walletErrorCounts.get(s.wallet_id) ?? 0) >= maxWalletErrors) continue

        const { client } = await getClobClientForWallet(s.wallet_id)

        try {
          const cond = await client.getBalanceAllowance({ asset_type: AssetType.CONDITIONAL, token_id: tokenID })
          const balShares = parseFloat(String(cond.balance))
          const allowanceShares = parseFloat(String(cond.allowance))
          if (!Number.isFinite(balShares) || !Number.isFinite(allowanceShares) || balShares < shares || allowanceShares < shares) {
            continue
          }
        } catch {
          walletErrorCounts.set(s.wallet_id, (walletErrorCounts.get(s.wallet_id) ?? 0) + 1)
          if (++globalErrorStreak >= maxGlobalErrors) globalBackoffUntil = Date.now() + globalErrorBackoffMs
          continue
        }

        const tickSize = await client.getTickSize(tokenID)
        const negRisk = await client.getNegRisk(tokenID)

        const resp = (await client.createAndPostMarketOrder(
          { tokenID, side: Side.SELL, amount: shares, price: toNum(tickSize) },
          { tickSize, negRisk },
          OrderType.FOK
        )) as { success: boolean; errorMsg?: string; orderID: string }

        if (!resp.success) {
          console.error('[Runner][Exit] failed', { strategyId: s.id, positionId: openPos.id, error: resp.errorMsg })
          walletErrorCounts.set(s.wallet_id, (walletErrorCounts.get(s.wallet_id) ?? 0) + 1)
          if (++globalErrorStreak >= maxGlobalErrors) globalBackoffUntil = Date.now() + globalErrorBackoffMs
          continue
        }

        walletErrorCounts.set(s.wallet_id, 0)
        globalErrorStreak = 0

        const exitOdd = openPos.side === 'up' ? odds.up : odds.down
        await closePosition({
          positionId: openPos.id,
          exitSampleTs: latest.sample_ts,
          exitOdd,
          exitOrderId: resp.orderID,
          exitReason: exitCheck.reason,
        })

        console.log('[Runner][Exit] order', {
          strategyId: s.id,
          positionId: openPos.id,
          orderId: resp.orderID,
          reason: exitCheck.reason,
        })
      }
    } catch (err) {
      console.error('[Runner] tick error', err)
      if (++globalErrorStreak >= maxGlobalErrors) globalBackoffUntil = Date.now() + globalErrorBackoffMs
    } finally {
      busy = false
    }
  }, intervalMs)

  console.log(`[Runner] enabled (interval=${intervalMs}ms)`)
}
