import Fastify from 'fastify';
import cors from '@fastify/cors';
import { getPool } from './db/client.js';
import { createUser } from './db/users.js';
import { createCustodialWallet, getWalletById, setWalletClobCreds, findCustodialWalletByUserId } from './db/wallets.js';
import { createStrategy, getStrategyById, listStrategiesByUser, updateStrategy, } from './db/strategies.js';
import { encryptString, decryptString } from './security/encryption.js';
import { Wallet, Contract, providers, utils } from 'ethers';
import jwt from 'jsonwebtoken';
import { createOrDeriveClobApiKey } from './polymarket/clob.js';
import { startRunner } from './runner.js';
import { listPositionsForStrategy, countOpenPositionsForUser, listAllPositionsForUser } from './db/positions.js';
import { getLatestSynthdataInsights } from './db/synthdataInsights.js';
import { getEdgeTradingByUserId, upsertEdgeTradingStart, setEdgeTradingStop, getAllEnabledEdgeTrading, setEdgeTradingLastEntered, hasEnteredSlug, recordEnteredSlug, listEdgeTradingEntriesByUserId, ensureEdgeTradingEnteredSlugsTable, ensureEdgeTradingMarketsColumn, } from './db/edgeTrading.js';
import { getClobClientForWallet } from './runner.js';
import { fetchMarketInfo } from './fetch-market.js';
import { resolveSoonestSlug } from './resolve-soonest.js';
import { AssetType, OrderType, Side } from '@polymarket/clob-client';
import { RelayClient, RelayerTxType } from '@polymarket/builder-relayer-client';
import { BuilderConfig } from '@polymarket/builder-signing-sdk';
import { config } from './config.js';
import { ensureBuilderProxyForWallet } from './polymarket/builder.js';
import { upsertClobTrades, listClobTradesByUserId, getDistinctTokenIdsByUserId, getTokenIdToMarketSlug, ensureUserClobTradesTable, } from './db/userClobTrades.js';
import { ensureCopyTradingTables, upsertCopySubscription, disableCopySubscription, getEnabledCopySubscriptions, listCopySubscriptionsByUser, updateLastSeenTimestamp, isTxHashCopied, recordCopyTrade, listCopyHistoryByUser, getCopyPositionShares, } from './db/copyTrading.js';
const port = parseInt(process.env.API_PORT ?? '3001', 10);
// In-memory nonce store: checksummed-address → { nonce, expiresAt }
const nonceStore = new Map();
function requireAuth(req, reply) {
    const auth = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) {
        void reply.code(401).send({ error: 'authentication required' });
        return null;
    }
    try {
        const payload = jwt.verify(auth.slice(7), config.jwtSecret);
        // Coerce IDs to numbers — pg BIGSERIAL returns strings, older JWTs may have string IDs
        return { ...payload, userId: Number(payload.userId), walletId: Number(payload.walletId) };
    }
    catch {
        void reply.code(401).send({ error: 'invalid or expired token' });
        return null;
    }
}
/** Normalize position row for JSON and add outcome (won/lost/closed). */
function formatPositionForResponse(row) {
    const exitReason = row.exit_reason != null ? String(row.exit_reason) : null;
    const status = row.status != null ? String(row.status) : '';
    let outcome = 'closed';
    if (status === 'open' || status === 'closing')
        outcome = 'open';
    else if (exitReason === 'profit')
        outcome = 'won';
    else if (exitReason === 'stoploss')
        outcome = 'lost';
    else
        outcome = 'closed'; // time, manual, or null
    const toIso = (v) => (v instanceof Date ? v.toISOString() : v != null ? String(v) : null);
    return {
        id: Number(row.id),
        strategy_id: Number(row.strategy_id),
        market: String(row.market ?? ''),
        expiry_ts: toIso(row.expiry_ts),
        side: String(row.side ?? ''),
        token_id: row.token_id != null ? String(row.token_id) : null,
        entry_sample_ts: toIso(row.entry_sample_ts),
        entry_odd: row.entry_odd != null ? String(row.entry_odd) : null,
        entry_order_id: row.entry_order_id != null ? String(row.entry_order_id) : null,
        entry_shares: row.entry_shares != null ? String(row.entry_shares) : null,
        exit_sample_ts: toIso(row.exit_sample_ts),
        exit_odd: row.exit_odd != null ? String(row.exit_odd) : null,
        exit_order_id: row.exit_order_id != null ? String(row.exit_order_id) : null,
        exit_reason: exitReason,
        status,
        outcome,
        created_at: toIso(row.created_at),
        updated_at: toIso(row.updated_at),
    };
}
/** Normalize copy subscription row for JSON. */
function formatCopySubscription(row) {
    return {
        id: Number(row.id),
        leaderAddress: row.leader_address,
        orderSizeUsd: Number(row.order_size_usd),
        copySells: row.copy_sells,
        maxTradeUsd: row.max_trade_usd != null ? Number(row.max_trade_usd) : null,
        enabled: row.enabled,
        lastSeenTimestamp: Number(row.last_seen_timestamp),
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    };
}
/** Normalize strategy row for JSON: pg returns BIGINT/NUMERIC as strings. */
function formatStrategyForResponse(row) {
    const n = (v) => (v == null ? null : Number(v));
    const num = (v) => (v == null ? 0 : Number(v));
    return {
        id: num(row.id),
        user_id: num(row.user_id),
        wallet_id: num(row.wallet_id),
        name: row.name,
        market: row.market,
        active: Boolean(row.active),
        entry_side: row.entry_side,
        entry_odd_max: row.entry_odd_max != null ? String(row.entry_odd_max) : null,
        entry_seconds_to_expiry_min: num(row.entry_seconds_to_expiry_min),
        entry_odd_change_window_s: n(row.entry_odd_change_window_s),
        entry_odd_change_min: row.entry_odd_change_min != null ? String(row.entry_odd_change_min) : null,
        entry_odd_change_pct_min: row.entry_odd_change_pct_min != null ? String(row.entry_odd_change_pct_min) : null,
        exit_stop_loss: row.exit_stop_loss != null ? String(row.exit_stop_loss) : null,
        exit_stop_loss_pct: row.exit_stop_loss_pct != null ? String(row.exit_stop_loss_pct) : null,
        exit_seconds_to_expiry_max: num(row.exit_seconds_to_expiry_max),
        exit_profit_odd: row.exit_profit_odd != null ? String(row.exit_profit_odd) : null,
        exit_profit_pct: row.exit_profit_pct != null ? String(row.exit_profit_pct) : null,
        order_size_usd: row.order_size_usd != null ? String(row.order_size_usd) : '0',
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}
async function main() {
    const app = Fastify({ logger: true });
    await app.register(cors, {
        origin: true,
        methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    });
    app.get('/health', async () => {
        const pool = getPool();
        await pool.query('SELECT 1 as ok');
        return { ok: true };
    });
    app.get('/insights/synthdata/latest', async (req, reply) => {
        const auth = requireAuth(req, reply);
        if (!auth)
            return;
        const insights = await getLatestSynthdataInsights();
        return { insights };
    });
    // ── Edge trading (BTC 15m only): enter Up when edge >= 8 pp, Down when edge <= -8 pp. Cooldown per market (slug).
    app.get('/edge-trading/status', async (req, reply) => {
        const auth = requireAuth(req, reply);
        if (!auth)
            return;
        const row = await getEdgeTradingByUserId(auth.userId);
        if (!row)
            return { enabled: false, orderSizeUsd: null, lastEnteredSlug: null, lastEnteredAt: null, markets: null };
        return {
            enabled: Boolean(row.enabled),
            orderSizeUsd: row.order_size_usd != null ? Number(row.order_size_usd) : null,
            lastEnteredSlug: row.last_entered_slug ?? null,
            lastEnteredAt: row.last_entered_at instanceof Date ? row.last_entered_at.toISOString() : (row.last_entered_at ?? null),
            markets: Array.isArray(row.markets) ? row.markets : null,
        };
    });
    app.get('/edge-trading/entries', async (req, reply) => {
        const auth = requireAuth(req, reply);
        if (!auth)
            return;
        const limit = Math.min(Math.max(parseInt(req.query.limit ?? '50', 10) || 50, 1), 200);
        const rows = await listEdgeTradingEntriesByUserId(auth.userId, limit);
        return {
            entries: rows.map((r) => ({
                slug: r.slug,
                market: r.market ?? null,
                side: r.side ?? null,
                orderSizeUsd: r.order_size_usd != null ? Number(r.order_size_usd) : null,
                enteredAt: r.entered_at instanceof Date ? r.entered_at.toISOString() : String(r.entered_at),
                polymarketEventUrl: `https://polymarket.com/event/${encodeURIComponent(r.slug)}`,
            })),
        };
    });
    app.post('/edge-trading/start', async (req, reply) => {
        const auth = requireAuth(req, reply);
        if (!auth)
            return;
        const body = (req.body ?? {});
        const orderSizeUsd = body.orderSizeUsd != null ? Number(body.orderSizeUsd) : NaN;
        if (!Number.isFinite(orderSizeUsd) || orderSizeUsd < 1) {
            return reply.code(400).send({ error: 'orderSizeUsd required and must be >= 1' });
        }
        const validMarkets = EDGE_MARKETS.map((m) => m.market);
        const markets = Array.isArray(body.markets) ? body.markets : null;
        if (markets != null && markets.length > 0) {
            const invalid = markets.filter((m) => typeof m !== 'string' || !validMarkets.includes(m));
            if (invalid.length > 0) {
                return reply.code(400).send({ error: `Invalid markets: ${invalid.join(', ')}. Valid: ${validMarkets.join(', ')}` });
            }
        }
        const row = await upsertEdgeTradingStart({
            userId: auth.userId,
            walletId: auth.walletId,
            orderSizeUsd,
            markets: markets ?? undefined,
        });
        return {
            ok: true,
            enabled: true,
            orderSizeUsd: Number(row.order_size_usd),
            markets: Array.isArray(row.markets) ? row.markets : null,
        };
    });
    app.post('/edge-trading/stop', async (req, reply) => {
        const auth = requireAuth(req, reply);
        if (!auth)
            return;
        await setEdgeTradingStop(auth.userId);
        return { ok: true, enabled: false };
    });
    // ── Auth: nonce request ──
    app.get('/auth/nonce', async (req, reply) => {
        const address = req.query.address;
        if (!address || !utils.isAddress(address)) {
            return reply.code(400).send({ error: 'valid Ethereum address required' });
        }
        const normalized = utils.getAddress(address);
        const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
        nonceStore.set(normalized, { nonce, expiresAt: Date.now() + 5 * 60 * 1000 });
        return { nonce, message: `Sign in to Lexa\nNonce: ${nonce}` };
    });
    // ── Auth: verify signature, issue JWT ──
    app.post('/auth/login', async (req, reply) => {
        const body = (req.body ?? {});
        if (!body.address || !body.signature) {
            return reply.code(400).send({ error: 'address and signature required' });
        }
        if (!utils.isAddress(body.address))
            return reply.code(400).send({ error: 'invalid address' });
        const normalized = utils.getAddress(body.address);
        const stored = nonceStore.get(normalized);
        if (!stored || stored.expiresAt < Date.now()) {
            return reply.code(401).send({ error: 'nonce expired or not found, request a new one' });
        }
        const message = `Sign in to Lexa\nNonce: ${stored.nonce}`;
        let recovered;
        try {
            recovered = utils.verifyMessage(message, body.signature);
        }
        catch {
            return reply.code(401).send({ error: 'invalid signature' });
        }
        if (utils.getAddress(recovered) !== normalized) {
            return reply.code(401).send({ error: 'signature mismatch' });
        }
        nonceStore.delete(normalized);
        // Find or create user
        const user = await createUser(normalized);
        // Find or create custodial wallet
        let wallet = await findCustodialWalletByUserId(user.id);
        if (!wallet) {
            const w = Wallet.createRandom();
            wallet = await createCustodialWallet({
                userId: user.id,
                funderAddress: w.address,
                signatureType: 0,
                encryptedPrivateKey: encryptString(w.privateKey),
            });
        }
        const payload = { userId: user.id, walletId: wallet.id, address: normalized };
        const token = jwt.sign(payload, config.jwtSecret, { expiresIn: '30d' });
        return { token, userId: user.id, walletId: wallet.id, walletAddress: wallet.funder_address };
    });
    // ── Auth: get current session ──
    app.get('/auth/me', async (req, reply) => {
        const auth = requireAuth(req, reply);
        if (!auth)
            return;
        const wallet = await getWalletById(auth.walletId);
        if (!wallet)
            return reply.code(404).send({ error: 'wallet not found' });
        return {
            userId: auth.userId,
            walletId: auth.walletId,
            address: auth.address,
            walletAddress: wallet.funder_address,
            gaslessAddress: wallet.builder_proxy_address ?? null,
        };
    });
    app.post('/wallets/custodial', async (req, reply) => {
        const auth = requireAuth(req, reply);
        if (!auth)
            return;
        const body = (req.body ?? {});
        if (!body.userId)
            return reply.code(400).send({ error: 'userId required' });
        if (auth.userId !== body.userId)
            return reply.code(403).send({ error: 'forbidden' });
        const w = Wallet.createRandom();
        const encryptedPrivateKey = encryptString(w.privateKey);
        const row = await createCustodialWallet({
            userId: body.userId,
            funderAddress: w.address,
            signatureType: 0,
            encryptedPrivateKey,
        });
        return { wallet: { id: row.id, user_id: row.user_id, address: row.funder_address, type: row.type } };
    });
    // Derive and store Polymarket CLOB L2 creds for an existing custodial wallet
    app.post('/wallets/:walletId/clob/derive', async (req, reply) => {
        const auth = requireAuth(req, reply);
        if (!auth)
            return;
        const walletId = parseInt(req.params.walletId, 10);
        if (!Number.isFinite(walletId))
            return reply.code(400).send({ error: 'invalid walletId' });
        if (auth.walletId !== walletId)
            return reply.code(403).send({ error: 'forbidden' });
        const wallet = await getWalletById(walletId);
        if (!wallet)
            return reply.code(404).send({ error: 'wallet not found' });
        if (wallet.type !== 'custodial')
            return reply.code(400).send({ error: 'wallet must be custodial' });
        if (!wallet.encrypted_private_key)
            return reply.code(400).send({ error: 'wallet missing private key' });
        const privateKey = decryptString(wallet.encrypted_private_key);
        const creds = await createOrDeriveClobApiKey(privateKey);
        await setWalletClobCreds({
            walletId,
            apiKey: creds.apiKey,
            encryptedSecret: encryptString(creds.secret),
            encryptedPassphrase: encryptString(creds.passphrase),
        });
        return { ok: true };
    });
    // Reveal custodial EOA private key (e.g. to import into Polymarket). Requires ?confirm=yes. Only your wallet.
    app.get('/wallets/:walletId/reveal-key', async (req, reply) => {
        const auth = requireAuth(req, reply);
        if (!auth)
            return;
        const walletId = parseInt(req.params.walletId, 10);
        if (!Number.isFinite(walletId) || auth.walletId !== walletId)
            return reply.code(403).send({ error: 'forbidden' });
        const confirm = req.query.confirm;
        if (confirm !== 'yes')
            return reply.code(400).send({ error: 'Add ?confirm=yes to reveal the private key. Never share it.' });
        const wallet = await getWalletById(walletId);
        if (!wallet)
            return reply.code(404).send({ error: 'wallet not found' });
        if (!wallet.encrypted_private_key)
            return reply.code(400).send({ error: 'wallet missing private key' });
        const privateKey = decryptString(wallet.encrypted_private_key);
        req.log.warn({ walletId }, 'Custodial private key revealed via /reveal-key');
        return {
            privateKey,
            address: wallet.funder_address,
            warning: 'Never share this key. Anyone with it controls the wallet. Delete this response after importing.',
        };
    });
    app.get('/wallets/:walletId/balance', async (req, reply) => {
        const auth = requireAuth(req, reply);
        if (!auth)
            return;
        const walletId = auth.walletId;
        const wallet = await getWalletById(walletId);
        if (!wallet)
            return reply.code(404).send({ error: 'wallet not found' });
        if (wallet.type !== 'custodial')
            return reply.code(400).send({ error: 'wallet must be custodial' });
        // Address to query: gasless Safe if deployed, otherwise custodial EOA
        const address = (wallet.builder_proxy_address ?? wallet.funder_address)?.trim();
        if (!address || !utils.isAddress(address)) {
            return reply.code(200).send({
                collateral: { balance: '0', allowance: '0' },
                error: 'No valid wallet address to query',
            });
        }
        const USDC_E = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
        const CTF_EXCHANGE_ADDRESS = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
        const usdcAbi = [
            'function balanceOf(address) view returns (uint256)',
            'function allowance(address owner, address spender) view returns (uint256)',
        ];
        const rpcUrls = config.polygonRpcUrls;
        let lastErr;
        for (const rpcUrl of rpcUrls) {
            try {
                const provider = new providers.JsonRpcProvider(rpcUrl);
                const usdc = new Contract(USDC_E, usdcAbi, provider);
                const [balWei, allowWei] = await Promise.all([
                    usdc.balanceOf(address),
                    usdc.allowance(address, CTF_EXCHANGE_ADDRESS),
                ]);
                const balance = typeof balWei === 'bigint' ? utils.formatUnits(balWei, 6) : utils.formatUnits(String(balWei), 6);
                const allowance = typeof allowWei === 'bigint' ? utils.formatUnits(allowWei, 6) : utils.formatUnits(String(allowWei), 6);
                return { collateral: { balance, allowance } };
            }
            catch (err) {
                lastErr = err;
                req.log.warn({ err, rpcUrl, walletId }, 'Balance/allowance fetch failed for RPC');
            }
        }
        req.log.warn({ lastErr, walletId, address }, 'Balance/allowance fetch failed for all RPCs');
        return reply.code(200).send({
            collateral: { balance: '0', allowance: '0' },
            error: 'Could not fetch balance from chain',
        });
    });
    // Deploy or fetch gasless proxy (builder wallet) for this custodial wallet
    app.post('/wallets/:walletId/deploy-gasless', async (req, reply) => {
        const auth = requireAuth(req, reply);
        if (!auth)
            return;
        // Always operate on the authenticated wallet, ignore mismatched path IDs.
        const walletId = auth.walletId;
        const proxyAddress = await ensureBuilderProxyForWallet(walletId);
        return { ok: true, proxyAddress };
    });
    // Approve Polymarket CTF Exchange to spend USDC.e from the custodial wallet
    app.post('/wallets/:walletId/approve-usdc', async (req, reply) => {
        const auth = requireAuth(req, reply);
        if (!auth)
            return;
        const walletId = auth.walletId;
        const body = (req.body ?? {});
        if (body.amountUsdc == null || body.amountUsdc <= 0) {
            return reply.code(400).send({ error: 'amountUsdc must be > 0' });
        }
        const wallet = await getWalletById(walletId);
        if (!wallet)
            return reply.code(404).send({ error: 'wallet not found' });
        if (wallet.type !== 'custodial')
            return reply.code(400).send({ error: 'wallet must be custodial' });
        if (!wallet.encrypted_private_key)
            return reply.code(400).send({ error: 'wallet missing private key' });
        const privateKey = decryptString(wallet.encrypted_private_key);
        const provider = new providers.JsonRpcProvider(config.polygonRpcUrl);
        const signer = new Wallet(privateKey, provider);
        // Ensure gasless wallet exists; approvals should be executed from the gasless Safe.
        const proxyAddress = await ensureBuilderProxyForWallet(walletId);
        const relayerUrl = process.env.POLY_BUILDER_RELAYER_URL ?? 'https://relayer-v2.polymarket.com';
        const builderConfig = new BuilderConfig({
            localBuilderCreds: {
                key: config.polyBuilderApiKey,
                secret: config.polyBuilderSecret,
                passphrase: config.polyBuilderPassphrase,
            },
        });
        const relayer = new RelayClient(relayerUrl, config.polymarketChainId, signer, builderConfig, RelayerTxType.SAFE);
        // Contracts (Polygon)
        const USDC_E = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
        const CTF_ADDRESS = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045';
        const CTF_EXCHANGE_ADDRESS = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
        const NEG_RISK_EXCHANGE_ADDRESS = '0xC5d563A36AE78145C45a50134d48A1215220f80a';
        const NEG_RISK_ADAPTER_ADDRESS = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296';
        const erc20Interface = new utils.Interface([
            'function approve(address spender, uint256 amount) external returns (bool)',
        ]);
        const erc1155Interface = new utils.Interface([
            'function setApprovalForAll(address operator, bool approved) external',
        ]);
        const max = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
        const txs = [
            ...[CTF_ADDRESS, CTF_EXCHANGE_ADDRESS, NEG_RISK_EXCHANGE_ADDRESS, NEG_RISK_ADAPTER_ADDRESS].map((spender) => ({
                to: USDC_E,
                data: erc20Interface.encodeFunctionData('approve', [spender, max]),
                value: '0',
            })),
            ...[CTF_EXCHANGE_ADDRESS, NEG_RISK_EXCHANGE_ADDRESS, NEG_RISK_ADAPTER_ADDRESS].map((op) => ({
                to: CTF_ADDRESS,
                data: erc1155Interface.encodeFunctionData('setApprovalForAll', [op, true]),
                value: '0',
            })),
        ];
        const response = await relayer.execute(txs, 'Lexa: approvals');
        const result = await response.wait();
        const txHash = result?.transactionHash ??
            response.transactionHash ??
            response.hash;
        return { ok: true, txHash, proxyAddress };
    });
    // Withdraw USDC.e from custodial wallet to any address
    app.post('/wallets/:walletId/withdraw-usdc', async (req, reply) => {
        const auth = requireAuth(req, reply);
        if (!auth)
            return;
        const walletId = auth.walletId;
        const body = (req.body ?? {});
        if (!body.toAddress)
            return reply.code(400).send({ error: 'toAddress required' });
        if (body.amountUsdc == null || body.amountUsdc <= 0) {
            return reply.code(400).send({ error: 'amountUsdc must be > 0' });
        }
        // Validate destination address
        let toAddress;
        try {
            if (!utils.isAddress(body.toAddress))
                return reply.code(400).send({ error: 'invalid toAddress' });
            toAddress = utils.getAddress(body.toAddress); // EIP-55 checksummed
        }
        catch {
            return reply.code(400).send({ error: 'invalid toAddress' });
        }
        const wallet = await getWalletById(walletId);
        if (!wallet)
            return reply.code(404).send({ error: 'wallet not found' });
        if (wallet.type !== 'custodial')
            return reply.code(400).send({ error: 'wallet must be custodial' });
        if (!wallet.encrypted_private_key)
            return reply.code(400).send({ error: 'wallet missing private key' });
        const privateKey = decryptString(wallet.encrypted_private_key);
        const provider = new providers.JsonRpcProvider(config.polygonRpcUrl);
        const signer = new Wallet(privateKey, provider);
        const USDC_E = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
        const amountWei = String(Math.round(body.amountUsdc * 1_000_000)); // 6 decimals
        const erc20Interface = new utils.Interface([
            'function transfer(address to, uint256 amount) returns (bool)',
            'function balanceOf(address) view returns (uint256)',
        ]);
        // Try relayer (gasless Safe) first; fall back to direct EOA transfer if not available
        let txHash;
        let proxyAddress = wallet.builder_proxy_address ?? null;
        if (!proxyAddress)
            proxyAddress = await ensureBuilderProxyForWallet(walletId);
        // Check which address has sufficient balance
        const provider2 = new providers.JsonRpcProvider(config.polygonRpcUrl);
        const usdcCheck = new Contract(USDC_E, erc20Interface, provider2);
        const safeBalWei = await usdcCheck.balanceOf(proxyAddress);
        const eoaBalWei2 = await usdcCheck.balanceOf(wallet.funder_address);
        const hasSafeBal = BigInt(safeBalWei.toString()) >= BigInt(amountWei);
        const hasEoaBal = BigInt(eoaBalWei2.toString()) >= BigInt(amountWei);
        if (!hasSafeBal && !hasEoaBal) {
            const safeUsdc = (Number(safeBalWei.toString()) / 1_000_000).toFixed(2);
            const eoaUsdc = (Number(eoaBalWei2.toString()) / 1_000_000).toFixed(2);
            return reply.code(400).send({
                error: `Insufficient balance. Safe: ${safeUsdc} USDC, EOA: ${eoaUsdc} USDC`,
            });
        }
        try {
            if (!hasSafeBal)
                throw new Error('no Safe balance — use EOA fallback');
            const relayerUrl = process.env.POLY_BUILDER_RELAYER_URL ?? 'https://relayer-v2.polymarket.com';
            const builderConfig = new BuilderConfig({
                localBuilderCreds: {
                    key: config.polyBuilderApiKey,
                    secret: config.polyBuilderSecret,
                    passphrase: config.polyBuilderPassphrase,
                },
            });
            const relayer = new RelayClient(relayerUrl, config.polymarketChainId, signer, builderConfig, RelayerTxType.SAFE);
            const data = erc20Interface.encodeFunctionData('transfer', [toAddress, amountWei]);
            const response = await relayer.execute([{ to: USDC_E, data, value: '0' }], 'Lexa: withdraw');
            const result = await response.wait();
            txHash =
                result?.transactionHash ??
                    response.transactionHash ??
                    response.hash;
        }
        catch {
            // Relayer unavailable or Safe has no balance — fall back to direct EOA transfer
            if (!hasEoaBal) {
                return reply.code(400).send({
                    error: `Funds are in the gasless Safe (${(Number(safeBalWei.toString()) / 1_000_000).toFixed(2)} USDC) but the relayer is unavailable. Ensure valid POLY_BUILDER credentials to withdraw from the Safe.`,
                });
            }
            const usdc = new Contract(USDC_E, erc20Interface, signer);
            const tx = await usdc.transfer(toAddress, amountWei);
            const receipt = await tx.wait();
            txHash = receipt.transactionHash;
        }
        return { ok: true, txHash, proxyAddress };
    });
    app.post('/strategies', async (req, reply) => {
        const auth = requireAuth(req, reply);
        if (!auth)
            return;
        const body = (req.body ?? {});
        // Required base fields (use session so new strategies always match current login)
        const userId = auth.userId;
        const walletId = auth.walletId;
        if (!body.name || !body.market)
            return reply.code(400).send({ error: 'name and market required' });
        if (!body.entrySide)
            return reply.code(400).send({ error: 'entrySide required' });
        if (body.orderSizeUsd == null)
            return reply.code(400).send({ error: 'orderSizeUsd required' });
        if (body.entrySecondsToExpiryMin == null || body.exitSecondsToExpiryMax == null) {
            return reply.code(400).send({ error: 'entrySecondsToExpiryMin and exitSecondsToExpiryMax required' });
        }
        // Entry: odd max required
        if (body.entryOddMax == null)
            return reply.code(400).send({ error: 'entryOddMax required' });
        // Entry: odd change window + at least one change filter required
        if (body.entryOddChangeWindowS == null) {
            return reply.code(400).send({ error: 'entryOddChangeWindowS required' });
        }
        if (body.entryOddChangeMin == null && body.entryOddChangePctMin == null) {
            return reply.code(400).send({ error: 'At least one of entryOddChangeMin or entryOddChangePctMin required' });
        }
        // Exit: at least one stop-loss required
        if (body.exitStopLoss == null && body.exitStopLossPct == null) {
            return reply.code(400).send({ error: 'At least one of exitStopLoss or exitStopLossPct required' });
        }
        // Exit: at least one take-profit required
        if (body.exitProfitOdd == null && body.exitProfitPct == null) {
            return reply.code(400).send({ error: 'At least one of exitProfitOdd or exitProfitPct required' });
        }
        // Range checks
        if (body.orderSizeUsd <= 0)
            return reply.code(400).send({ error: 'orderSizeUsd must be > 0' });
        if (body.entrySecondsToExpiryMin < 0 || body.exitSecondsToExpiryMax < 0) {
            return reply.code(400).send({ error: 'entrySecondsToExpiryMin and exitSecondsToExpiryMax must be >= 0' });
        }
        if (body.entryOddMax <= 0 || body.entryOddMax >= 1) {
            return reply.code(400).send({ error: 'entryOddMax must be between 0 and 1' });
        }
        if (body.entryOddChangeWindowS < 1 || body.entryOddChangeWindowS > 5) {
            return reply.code(400).send({ error: 'entryOddChangeWindowS must be 1–5' });
        }
        if (body.exitStopLoss != null && (body.exitStopLoss <= 0 || body.exitStopLoss >= 1)) {
            return reply.code(400).send({ error: 'exitStopLoss must be between 0 and 1' });
        }
        if (body.exitStopLossPct != null && (body.exitStopLossPct <= 0 || body.exitStopLossPct >= 100)) {
            return reply.code(400).send({ error: 'exitStopLossPct must be between 0 and 100 (exclusive)' });
        }
        if (body.exitProfitOdd != null && (body.exitProfitOdd <= 0 || body.exitProfitOdd >= 1)) {
            return reply.code(400).send({ error: 'exitProfitOdd must be between 0 and 1' });
        }
        if (body.exitProfitPct != null && body.exitProfitPct <= 0) {
            return reply.code(400).send({ error: 'exitProfitPct must be > 0' });
        }
        const s = await createStrategy({
            userId,
            walletId,
            name: body.name,
            market: body.market,
            entrySide: body.entrySide,
            entryOddMax: body.entryOddMax ?? null,
            entrySecondsToExpiryMin: body.entrySecondsToExpiryMin,
            entryOddChangeWindowS: body.entryOddChangeWindowS ?? null,
            entryOddChangeMin: body.entryOddChangeMin ?? null,
            entryOddChangePctMin: body.entryOddChangePctMin ?? null,
            exitStopLoss: body.exitStopLoss ?? null,
            exitStopLossPct: body.exitStopLossPct ?? null,
            exitSecondsToExpiryMax: body.exitSecondsToExpiryMax,
            exitProfitOdd: body.exitProfitOdd ?? null,
            exitProfitPct: body.exitProfitPct ?? null,
            orderSizeUsd: body.orderSizeUsd,
        });
        return { strategy: formatStrategyForResponse(s) };
    });
    app.get('/users/:userId/strategies', async (req, reply) => {
        const auth = requireAuth(req, reply);
        if (!auth)
            return;
        const userId = parseInt(req.params.userId, 10);
        if (!Number.isFinite(userId))
            return reply.code(400).send({ error: 'invalid userId' });
        if (auth.userId !== userId)
            return reply.code(403).send({ error: 'forbidden' });
        const strategies = await listStrategiesByUser(userId);
        return { strategies: strategies.map((s) => formatStrategyForResponse(s)) };
    });
    // Allow access if strategy belongs to the session's user or custodial wallet. IDs may be numbers or strings (pg BIGSERIAL).
    function strategyAllowed(strategy, auth) {
        const uid = Number(strategy.user_id);
        const wid = Number(strategy.wallet_id);
        return (Number.isFinite(uid) && uid === auth.userId) || (Number.isFinite(wid) && wid === auth.walletId);
    }
    const strategyForbiddenMessage = 'This strategy is tied to a different sign-in account. Use the same MetaMask address you used when you created it.';
    app.get('/strategies/:strategyId', async (req, reply) => {
        const auth = requireAuth(req, reply);
        if (!auth)
            return;
        const strategyId = parseInt(req.params.strategyId, 10);
        if (!Number.isFinite(strategyId))
            return reply.code(400).send({ error: 'invalid strategyId' });
        const strategy = await getStrategyById(strategyId);
        if (!strategy)
            return reply.code(404).send({ error: 'strategy not found' });
        if (!strategyAllowed(strategy, auth))
            return reply.code(403).send({ error: strategyForbiddenMessage });
        return { strategy: formatStrategyForResponse(strategy) };
    });
    app.patch('/strategies/:strategyId', async (req, reply) => {
        const auth = requireAuth(req, reply);
        if (!auth)
            return;
        const strategyId = parseInt(req.params.strategyId, 10);
        if (!Number.isFinite(strategyId))
            return reply.code(400).send({ error: 'invalid strategyId' });
        {
            const existing = await getStrategyById(strategyId);
            if (!existing)
                return reply.code(404).send({ error: 'strategy not found' });
            if (!strategyAllowed(existing, auth))
                return reply.code(403).send({ error: strategyForbiddenMessage });
        }
        const body = (req.body ?? {});
        const fields = {};
        if (body.name != null)
            fields.name = body.name;
        if (body.market != null)
            fields.market = body.market;
        if (body.entrySide != null)
            fields.entry_side = body.entrySide;
        if ('entryOddMax' in body)
            fields.entry_odd_max = body.entryOddMax ?? null;
        if (body.entrySecondsToExpiryMin != null)
            fields.entry_seconds_to_expiry_min = body.entrySecondsToExpiryMin;
        if ('entryOddChangeWindowS' in body)
            fields.entry_odd_change_window_s = body.entryOddChangeWindowS ?? null;
        if ('entryOddChangeMin' in body)
            fields.entry_odd_change_min = body.entryOddChangeMin ?? null;
        if ('entryOddChangePctMin' in body)
            fields.entry_odd_change_pct_min = body.entryOddChangePctMin ?? null;
        if ('exitStopLoss' in body)
            fields.exit_stop_loss = body.exitStopLoss ?? null;
        if ('exitStopLossPct' in body)
            fields.exit_stop_loss_pct = body.exitStopLossPct ?? null;
        if (body.exitSecondsToExpiryMax != null)
            fields.exit_seconds_to_expiry_max = body.exitSecondsToExpiryMax;
        if ('exitProfitOdd' in body)
            fields.exit_profit_odd = body.exitProfitOdd ?? null;
        if ('exitProfitPct' in body)
            fields.exit_profit_pct = body.exitProfitPct ?? null;
        if (body.orderSizeUsd != null)
            fields.order_size_usd = body.orderSizeUsd;
        // If toggling active -> true, enforce wallet health and risk limits
        if (body.active === true) {
            const strategy = await getStrategyById(strategyId);
            if (!strategy)
                return reply.code(404).send({ error: 'strategy not found' });
            const wallet = await getWalletById(strategy.wallet_id);
            if (!wallet)
                return reply.code(400).send({ error: 'wallet not found for strategy' });
            if (wallet.type !== 'custodial')
                return reply.code(400).send({ error: 'wallet must be custodial' });
            if (!wallet.encrypted_private_key) {
                return reply.code(400).send({ error: 'custodial wallet missing private key' });
            }
            // Basic risk limit: cap open positions per user
            const maxOpenPerUser = parseInt(process.env.RUNNER_MAX_OPEN_POSITIONS_PER_USER ?? '5', 10) || 5;
            const openCount = await countOpenPositionsForUser(strategy.user_id);
            if (openCount >= maxOpenPerUser) {
                return reply
                    .code(400)
                    .send({ error: `user has ${openCount} open positions; max allowed is ${maxOpenPerUser}` });
            }
            fields.active = true;
        }
        else if (body.active === false) {
            fields.active = false;
        }
        const updated = await updateStrategy(strategyId, fields);
        if (!updated)
            return reply.code(404).send({ error: 'strategy not found' });
        return { strategy: formatStrategyForResponse(updated) };
    });
    app.get('/strategies/:strategyId/positions', async (req, reply) => {
        const auth = requireAuth(req, reply);
        if (!auth)
            return;
        const strategyId = parseInt(req.params.strategyId, 10);
        if (!Number.isFinite(strategyId))
            return reply.code(400).send({ error: 'invalid strategyId' });
        const strategy = await getStrategyById(strategyId);
        if (!strategy)
            return reply.code(404).send({ error: 'strategy not found' });
        if (!strategyAllowed(strategy, auth))
            return reply.code(403).send({ error: strategyForbiddenMessage });
        const limitQ = req.query.limit;
        const limit = Math.min(Math.max(parseInt(limitQ ?? '20', 10) || 20, 1), 200);
        const rows = await listPositionsForStrategy(strategyId, limit);
        const positions = rows.map((r) => formatPositionForResponse(r));
        return { positions };
    });
    // ── CLOB: user trades (sync from Data API by address, then CLOB fallback), open orders, positions ──
    app.get('/clob/trades', async (req, reply) => {
        const auth = requireAuth(req, reply);
        if (!auth)
            return;
        const limit = Math.min(Math.max(parseInt(req.query.limit ?? '100', 10) || 100, 1), 500);
        const wallet = await getWalletById(auth.walletId);
        const tradingAddress = wallet?.builder_proxy_address ?? wallet?.funder_address;
        let synced = false;
        if (tradingAddress) {
            try {
                const res = await fetch(`https://data-api.polymarket.com/trades?user=${encodeURIComponent(tradingAddress)}&limit=200&takerOnly=false`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
                if (res.ok) {
                    const data = (await res.json());
                    const arr = Array.isArray(data) ? data : [];
                    const asRecords = arr.map((t, i) => {
                        const r = typeof t === 'object' && t !== null ? t : {};
                        const tx = r.transactionHash ?? r.transaction_hash;
                        const aid = r.asset ?? r.asset_id;
                        const ts = r.timestamp;
                        if (!r.id && (tx ?? aid ?? ts) != null) {
                            r.id = `${tx ?? 'na'}-${aid ?? ''}-${ts ?? ''}-${i}`;
                        }
                        return r;
                    });
                    await upsertClobTrades(auth.walletId, auth.userId, asRecords);
                    synced = true;
                }
            }
            catch (err) {
                console.error('[CLOB] Data API trades failed', { userId: auth.userId, err: err?.message });
            }
        }
        if (!synced) {
            try {
                const { client } = await getClobClientForWallet(auth.walletId);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const rawTrades = await client.getTrades({}, true);
                const arr = Array.isArray(rawTrades) ? rawTrades : [];
                const asRecords = arr.map((t) => (typeof t === 'object' && t !== null ? t : { id: String(t) }));
                await upsertClobTrades(auth.walletId, auth.userId, asRecords);
            }
            catch (err) {
                console.error('[CLOB] getTrades failed', { userId: auth.userId, err: err?.message });
            }
        }
        const rows = await listClobTradesByUserId(auth.userId, limit);
        return {
            trades: rows.map((r) => ({
                id: r.id,
                tradeId: r.trade_id,
                tokenId: r.token_id ?? null,
                side: r.side ?? null,
                price: r.price != null ? Number(r.price) : null,
                size: r.size != null ? Number(r.size) : null,
                amountUsd: r.amount_usd != null ? Number(r.amount_usd) : null,
                tradeTimestamp: r.trade_timestamp instanceof Date ? r.trade_timestamp.toISOString() : (r.trade_timestamp ?? null),
                marketSlug: r.market_slug ?? null,
                polymarketEventUrl: r.market_slug ? `https://polymarket.com/event/${encodeURIComponent(r.market_slug)}` : null,
            })),
        };
    });
    app.get('/clob/orders', async (req, reply) => {
        const auth = requireAuth(req, reply);
        if (!auth)
            return;
        try {
            const { client } = await getClobClientForWallet(auth.walletId);
            const orders = await client.getOpenOrders({}, true);
            const arr = Array.isArray(orders) ? orders : [];
            return { orders: arr };
        }
        catch (err) {
            console.error('[CLOB] getOpenOrders failed', { userId: auth.userId, err: err?.message });
            return reply.code(502).send({ error: 'Failed to fetch open orders from CLOB' });
        }
    });
    app.get('/clob/positions', async (req, reply) => {
        const auth = requireAuth(req, reply);
        if (!auth)
            return;
        const tokenIds = await getDistinctTokenIdsByUserId(auth.userId);
        if (tokenIds.length === 0)
            return { positions: [] };
        const slugByToken = await getTokenIdToMarketSlug(auth.userId);
        try {
            const { client } = await getClobClientForWallet(auth.walletId);
            const positions = [];
            for (const tokenId of tokenIds.slice(0, 50)) {
                try {
                    const bal = await client.getBalanceAllowance({
                        asset_type: AssetType.CONDITIONAL,
                        token_id: tokenId,
                    });
                    const balance = bal?.balance != null ? parseFloat(String(bal.balance)) : 0;
                    if (balance > 0) {
                        const marketSlug = slugByToken.get(tokenId) ?? null;
                        positions.push({ tokenId, balance, marketSlug });
                    }
                }
                catch {
                    // skip
                }
            }
            return {
                positions: positions.map((p) => ({
                    ...p,
                    polymarketEventUrl: p.marketSlug ? `https://polymarket.com/event/${encodeURIComponent(p.marketSlug)}` : null,
                })),
            };
        }
        catch (err) {
            console.error('[CLOB] positions failed', { userId: auth.userId, err: err?.message });
            return reply.code(502).send({ error: 'Failed to fetch positions from CLOB' });
        }
    });
    // ── Dashboard: aggregated snapshot for authenticated user ──
    app.get('/dashboard', async (req, reply) => {
        const auth = requireAuth(req, reply);
        if (!auth)
            return;
        const getVal = (r) => r.status === 'fulfilled' ? r.value : null;
        // Parallel: wallet meta + balance + all DB data
        const wallet = await getWalletById(auth.walletId);
        const tradingAddress = (wallet?.builder_proxy_address ?? wallet?.funder_address)?.trim() ?? null;
        const [strategiesRes, allPositionsRes, edgeStatusRes, edgeEntriesRes, copySubs, copyHistoryRes, clobTradesRes, insightsRes, usdcRes,] = await Promise.allSettled([
            listStrategiesByUser(auth.userId),
            listAllPositionsForUser(auth.userId, 50),
            getEdgeTradingByUserId(auth.userId),
            listEdgeTradingEntriesByUserId(auth.userId, 20),
            listCopySubscriptionsByUser(auth.userId),
            listCopyHistoryByUser(auth.userId, 30),
            listClobTradesByUserId(auth.userId, 30),
            getLatestSynthdataInsights(),
            // on-chain USDC balance
            (async () => {
                if (!tradingAddress || !utils.isAddress(tradingAddress))
                    return null;
                const USDC_E = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
                const CTF = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
                const abi = [
                    'function balanceOf(address) view returns (uint256)',
                    'function allowance(address,address) view returns (uint256)',
                ];
                for (const rpcUrl of config.polygonRpcUrls) {
                    try {
                        const provider = new providers.JsonRpcProvider(rpcUrl);
                        const usdc = new Contract(USDC_E, abi, provider);
                        const [bal, allow] = await Promise.all([
                            usdc.balanceOf(tradingAddress),
                            usdc.allowance(tradingAddress, CTF),
                        ]);
                        return JSON.stringify({
                            balance: utils.formatUnits(typeof bal === 'bigint' ? bal : String(bal), 6),
                            allowance: utils.formatUnits(typeof allow === 'bigint' ? allow : String(allow), 6),
                        });
                    }
                    catch { /* try next */ }
                }
                return null;
            })(),
        ]);
        const strategies = getVal(strategiesRes) ?? [];
        const allPositions = getVal(allPositionsRes) ?? [];
        const edgeRow = getVal(edgeStatusRes);
        const edgeEntries = getVal(edgeEntriesRes) ?? [];
        const copySubRows = getVal(copySubs) ?? [];
        const copyHistory = getVal(copyHistoryRes) ?? [];
        const clobTradesRows = getVal(clobTradesRes) ?? [];
        const insights = getVal(insightsRes) ?? [];
        const usdcRaw = getVal(usdcRes);
        const usdcParsed = usdcRaw ? (() => { try {
            return JSON.parse(usdcRaw);
        }
        catch {
            return null;
        } })() : null;
        // Build position lookup by strategy
        const positionsByStrategy = new Map();
        for (const pos of allPositions) {
            const sid = Number(pos.strategy_id);
            if (!positionsByStrategy.has(sid))
                positionsByStrategy.set(sid, []);
            positionsByStrategy.get(sid).push(pos);
        }
        const toIso = (v) => (v instanceof Date ? v.toISOString() : v != null ? String(v) : null);
        const formatPos = (p) => {
            const entryOdd = p.entry_odd != null ? Number(p.entry_odd) : null;
            const exitOdd = p.exit_odd != null ? Number(p.exit_odd) : null;
            const entryShares = p.entry_shares != null ? Number(p.entry_shares) : null;
            let pnlUsd = null;
            if (entryOdd != null && exitOdd != null && entryShares != null) {
                pnlUsd = (exitOdd - entryOdd) * entryShares;
            }
            return {
                id: Number(p.id),
                strategy_id: Number(p.strategy_id),
                market: p.market,
                side: p.side,
                status: p.status,
                entry_odd: entryOdd,
                exit_odd: exitOdd,
                exit_reason: p.exit_reason ?? null,
                entry_shares: entryShares,
                entry_sample_ts: toIso(p.entry_sample_ts),
                exit_sample_ts: toIso(p.exit_sample_ts),
                expiry_ts: toIso(p.expiry_ts),
                pnl_usd: pnlUsd,
            };
        };
        // Copy trading per-leader stats
        const leaderStats = {};
        for (const h of copyHistory) {
            const addr = h.leader_address;
            if (!leaderStats[addr])
                leaderStats[addr] = { executed: 0, failed: 0, skipped: 0, totalUsd: 0 };
            leaderStats[addr][h.status]++;
            if (h.status === 'executed' && h.amount_usd != null)
                leaderStats[addr].totalUsd += Number(h.amount_usd);
        }
        return {
            wallet: {
                address: tradingAddress,
                custodialAddress: wallet?.funder_address ?? null,
                gaslessAddress: wallet?.builder_proxy_address ?? null,
                usdcBalance: usdcParsed?.balance ?? null,
                usdcAllowance: usdcParsed?.allowance ?? null,
            },
            strategies: strategies.map((s) => {
                const positions = (positionsByStrategy.get(Number(s.id)) ?? []).map(formatPos);
                const open = positions.filter((p) => p.status === 'open' || p.status === 'closing');
                const won = positions.filter((p) => p.exit_reason === 'profit');
                const lost = positions.filter((p) => p.exit_reason === 'stoploss');
                const pnl = positions.reduce((sum, p) => sum + (p.pnl_usd ?? 0), 0);
                return {
                    ...formatStrategyForResponse(s),
                    positions,
                    openCount: open.length,
                    wonCount: won.length,
                    lostCount: lost.length,
                    pnlUsd: pnl,
                };
            }),
            edgeTrading: {
                enabled: edgeRow ? Boolean(edgeRow.enabled) : false,
                orderSizeUsd: edgeRow?.order_size_usd != null ? Number(edgeRow.order_size_usd) : null,
                markets: Array.isArray(edgeRow?.markets) ? edgeRow.markets : null,
                lastEnteredSlug: edgeRow?.last_entered_slug ?? null,
                lastEnteredAt: toIso(edgeRow?.last_entered_at),
                entries: edgeEntries.map((e) => ({
                    slug: e.slug,
                    market: e.market ?? null,
                    side: e.side ?? null,
                    orderSizeUsd: e.order_size_usd != null ? Number(e.order_size_usd) : null,
                    enteredAt: toIso(e.entered_at),
                    polymarketEventUrl: e.slug ? `https://polymarket.com/event/${encodeURIComponent(e.slug)}` : null,
                })),
                insights: insights.map((i) => ({
                    market: i.market,
                    slug: i.slug ?? null,
                    currentOutcome: i.current_outcome ?? null,
                    synthProbUp: i.synth_probability_up ?? null,
                    polyProbUp: i.polymarket_probability_up ?? null,
                    edgePp: i.synth_probability_up != null && i.polymarket_probability_up != null
                        ? (i.synth_probability_up - i.polymarket_probability_up) * 100
                        : null,
                    sampleTs: toIso(i.sample_ts),
                    bestBid: i.best_bid_price ?? null,
                    bestAsk: i.best_ask_price ?? null,
                    lastTradePrice: i.polymarket_last_trade_price ?? null,
                    lastTradeTs: toIso(i.polymarket_last_trade_time),
                })),
            },
            copyTrading: {
                subscriptions: copySubRows.map(formatCopySubscription),
                history: copyHistory.map((h) => ({
                    id: Number(h.id),
                    leaderAddress: h.leader_address,
                    leaderTxHash: h.leader_tx_hash,
                    tokenId: h.token_id ?? null,
                    marketSlug: h.market_slug ?? null,
                    outcome: h.outcome ?? null,
                    side: h.side ?? null,
                    price: h.price != null ? Number(h.price) : null,
                    size: h.size != null ? Number(h.size) : null,
                    amountUsd: h.amount_usd != null ? Number(h.amount_usd) : null,
                    status: h.status,
                    errorMessage: h.error_message ?? null,
                    executedAt: toIso(h.executed_at),
                    polymarketEventUrl: h.market_slug ? `https://polymarket.com/event/${encodeURIComponent(h.market_slug)}` : null,
                })),
                leaderStats,
            },
            clobTrades: clobTradesRows.map((r) => ({
                id: r.id,
                tradeId: r.trade_id,
                side: r.side ?? null,
                price: r.price != null ? Number(r.price) : null,
                size: r.size != null ? Number(r.size) : null,
                amountUsd: r.amount_usd != null ? Number(r.amount_usd) : null,
                tradeTimestamp: toIso(r.trade_timestamp),
                marketSlug: r.market_slug ?? null,
                polymarketEventUrl: r.market_slug ? `https://polymarket.com/event/${encodeURIComponent(r.market_slug)}` : null,
            })),
        };
    });
    // ── Copy Trading: fetch public Polymarket user data ──
    app.get('/copy-trading/user', async (req, reply) => {
        const address = req.query.address;
        if (!address) {
            return reply.code(400).send({ error: 'address query parameter is required' });
        }
        if (!utils.isAddress(address)) {
            return reply.code(400).send({ error: 'invalid Ethereum address' });
        }
        const normalized = utils.getAddress(address);
        const DATA_API = 'https://data-api.polymarket.com';
        const headers = { Accept: 'application/json' };
        const signal = AbortSignal.timeout(15_000);
        const safeJson = async (res) => {
            if (!res.ok)
                return null;
            try {
                return await res.json();
            }
            catch {
                return null;
            }
        };
        // Fetch Polymarket Data API + on-chain USDC.e balance in parallel
        const USDC_E = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
        const usdcAbi = ['function balanceOf(address) view returns (uint256)'];
        // Paginate trades: fetch pages of 500 until the API returns fewer than PAGE_SIZE
        const fetchAllTrades = async () => {
            const PAGE_SIZE = 500;
            const all = [];
            let offset = 0;
            for (;;) {
                const pageSignal = AbortSignal.timeout(20_000);
                const url = `${DATA_API}/trades?user=${encodeURIComponent(normalized)}&limit=${PAGE_SIZE}&offset=${offset}&takerOnly=false`;
                let page;
                try {
                    const res = await fetch(url, { headers, signal: pageSignal });
                    page = await safeJson(res);
                }
                catch {
                    break;
                }
                if (!Array.isArray(page) || page.length === 0)
                    break;
                all.push(...page);
                if (page.length < PAGE_SIZE)
                    break;
                offset += PAGE_SIZE;
            }
            return all;
        };
        const [positionsRes, tradesRes, usdcBal] = await Promise.allSettled([
            // sizeThreshold=0 fetches ALL positions (including redeemable/tiny), limit=500 covers them in one page
            fetch(`${DATA_API}/positions?user=${encodeURIComponent(normalized)}&sizeThreshold=0&limit=500`, { headers, signal }).then(safeJson),
            fetchAllTrades(),
            (async () => {
                for (const rpcUrl of config.polygonRpcUrls) {
                    try {
                        const provider = new providers.JsonRpcProvider(rpcUrl);
                        const usdc = new Contract(USDC_E, usdcAbi, provider);
                        const bal = await usdc.balanceOf(normalized);
                        return utils.formatUnits(typeof bal === 'bigint' ? bal : String(bal), 6);
                    }
                    catch { /* try next RPC */ }
                }
                return null;
            })(),
        ]);
        const get = (r) => r.status === 'fulfilled' ? r.value : null;
        return {
            address: normalized,
            positions: get(positionsRes),
            trades: get(tradesRes),
            usdcBalance: get(usdcBal),
        };
    });
    // ── Copy Trading: subscribe / unsubscribe / list / history ──
    app.post('/copy-trading/subscribe', async (req, reply) => {
        const auth = requireAuth(req, reply);
        if (!auth)
            return;
        const body = (req.body ?? {});
        if (!body.leaderAddress || !utils.isAddress(body.leaderAddress)) {
            return reply.code(400).send({ error: 'valid leaderAddress required' });
        }
        const orderSizeUsd = Number(body.orderSizeUsd);
        if (!Number.isFinite(orderSizeUsd) || orderSizeUsd < 1) {
            return reply.code(400).send({ error: 'orderSizeUsd must be >= 1' });
        }
        const wallet = await getWalletById(auth.walletId);
        if (!wallet)
            return reply.code(404).send({ error: 'wallet not found' });
        if (!wallet.encrypted_private_key) {
            return reply.code(400).send({ error: 'Custodial wallet not set up. Complete wallet setup first.' });
        }
        if (!wallet.builder_proxy_address) {
            return reply.code(400).send({ error: 'Gasless wallet not deployed. Deploy it from the sidebar first.' });
        }
        const row = await upsertCopySubscription({
            userId: auth.userId,
            walletId: auth.walletId,
            leaderAddress: body.leaderAddress,
            orderSizeUsd,
            copySells: body.copySells ?? false,
            maxTradeUsd: body.maxTradeUsd ?? null,
        });
        return {
            ok: true,
            subscription: formatCopySubscription(row),
        };
    });
    app.post('/copy-trading/unsubscribe', async (req, reply) => {
        const auth = requireAuth(req, reply);
        if (!auth)
            return;
        const body = (req.body ?? {});
        if (!body.leaderAddress)
            return reply.code(400).send({ error: 'leaderAddress required' });
        await disableCopySubscription(auth.userId, body.leaderAddress);
        return { ok: true };
    });
    app.get('/copy-trading/subscriptions', async (req, reply) => {
        const auth = requireAuth(req, reply);
        if (!auth)
            return;
        const rows = await listCopySubscriptionsByUser(auth.userId);
        return { subscriptions: rows.map(formatCopySubscription) };
    });
    app.get('/copy-trading/history', async (req, reply) => {
        const auth = requireAuth(req, reply);
        if (!auth)
            return;
        const limit = Math.min(Math.max(parseInt(req.query.limit ?? '50', 10) || 50, 1), 200);
        const rows = await listCopyHistoryByUser(auth.userId, limit);
        return {
            history: rows.map((r) => ({
                id: r.id,
                leaderAddress: r.leader_address,
                leaderTxHash: r.leader_tx_hash,
                tokenId: r.token_id ?? null,
                marketSlug: r.market_slug ?? null,
                outcome: r.outcome ?? null,
                side: r.side ?? null,
                price: r.price != null ? Number(r.price) : null,
                size: r.size != null ? Number(r.size) : null,
                amountUsd: r.amount_usd != null ? Number(r.amount_usd) : null,
                status: r.status,
                errorMessage: r.error_message ?? null,
                executedAt: r.executed_at instanceof Date ? r.executed_at.toISOString() : String(r.executed_at),
                polymarketEventUrl: r.market_slug ? `https://polymarket.com/event/${encodeURIComponent(r.market_slug)}` : null,
            })),
        };
    });
    await app.listen({ port, host: '0.0.0.0' });
    await ensureEdgeTradingEnteredSlugsTable().catch((err) => console.error('[Server] ensureEdgeTradingEnteredSlugsTable failed', err?.message));
    await ensureEdgeTradingMarketsColumn().catch((err) => console.error('[Server] ensureEdgeTradingMarketsColumn failed', err?.message));
    await ensureUserClobTradesTable().catch((err) => console.error('[Server] ensureUserClobTradesTable failed', err?.message));
    await ensureCopyTradingTables().catch((err) => console.error('[Server] ensureCopyTradingTables failed', err?.message));
    startRunner();
    startEdgeRunner();
    startCopyRunner();
}
const EDGE_ENTRY_THRESHOLD_UP = 8; // percentage points: enter Up when edge >= 8
const EDGE_ENTRY_THRESHOLD_DOWN = -8; // enter Down when edge <= -8
/** Do not buy when odd (price) is above this — poor risk/reward (pay 75¢+ to win 25¢). */
const EDGE_MAX_ENTRY_ODD = 0.75;
/** Do not buy when odd is below 30¢ (too cheap / low conviction). */
const EDGE_MIN_ENTRY_ODD = 0.3;
const EDGE_RUNNER_INTERVAL_MS = 30_000;
/** Only use an insight if it was stored within this many ms (worker polls every 5s). */
const EDGE_INSIGHT_MAX_AGE_MS = 2 * 60 * 1000;
const EDGE_MARKETS = [
    { market: 'btc-15m', asset: 'bitcoin', horizon: '15m' },
    { market: 'btc-1h', asset: 'bitcoin', horizon: '1h' },
    { market: 'eth-15m', asset: 'ethereum', horizon: '15m' },
    { market: 'eth-1h', asset: 'ethereum', horizon: '1h' },
    { market: 'sol-15m', asset: 'solana', horizon: '15m' },
    { market: 'sol-1h', asset: 'solana', horizon: '1h' },
];
async function runEdgeTradingLoop() {
    const rows = await getAllEnabledEdgeTrading();
    if (rows.length === 0)
        return;
    const insights = await getLatestSynthdataInsights();
    const byMarket = new Map(insights.map((i) => [i.market, i]));
    for (const { market, asset, horizon } of EDGE_MARKETS) {
        const resolvedSlug = await resolveSoonestSlug(asset, horizon);
        if (!resolvedSlug)
            continue;
        const insight = byMarket.get(market);
        if (!insight?.slug)
            continue;
        if (insight.slug !== resolvedSlug)
            continue;
        const sampleTs = insight.sample_ts ? new Date(insight.sample_ts).getTime() : 0;
        if (Number.isNaN(sampleTs) || Date.now() - sampleTs > EDGE_INSIGHT_MAX_AGE_MS)
            continue;
        const synthUp = insight.synth_probability_up ?? NaN;
        const polyUp = insight.polymarket_probability_up ?? NaN;
        if (!Number.isFinite(synthUp) || !Number.isFinite(polyUp))
            continue;
        const edgePp = (synthUp - polyUp) * 100;
        let side = null;
        if (edgePp >= EDGE_ENTRY_THRESHOLD_UP)
            side = 'up';
        else if (edgePp <= EDGE_ENTRY_THRESHOLD_DOWN)
            side = 'down';
        if (side === null)
            continue;
        // Require signal outcome to match direction: only buy UP when outcome is Up, only buy DOWN when outcome is Down
        const outcome = (insight.current_outcome ?? '').trim().toLowerCase();
        if (side === 'up' && outcome !== 'up')
            continue;
        if (side === 'down' && outcome !== 'down')
            continue;
        // Do not enter when odd is outside 20–75%: above 75% is poor risk/reward; below 20% is too cheap
        const entryOdd = side === 'up' ? polyUp : 1 - polyUp;
        if (!Number.isFinite(entryOdd) || entryOdd < EDGE_MIN_ENTRY_ODD || entryOdd > EDGE_MAX_ENTRY_ODD)
            continue;
        let info;
        try {
            info = await fetchMarketInfo(resolvedSlug);
        }
        catch (err) {
            console.error('[EdgeRunner] fetchMarketInfo failed', { market, slug: resolvedSlug, err });
            continue;
        }
        if (info.endDate) {
            const endMs = new Date(info.endDate).getTime();
            if (Number.isFinite(endMs) && endMs <= Date.now())
                continue;
            const secondsToExpiry = Math.floor((endMs - Date.now()) / 1000);
            if (horizon === '15m' && secondsToExpiry < 2 * 60)
                continue; // do not enter 15m in last 2 min
            if (horizon === '1h' && secondsToExpiry < 5 * 60)
                continue; // do not enter 1h in last 5 min
        }
        const slug = resolvedSlug;
        const tokenID = side === 'up' ? info.clobTokenIds[0] : info.clobTokenIds[1];
        for (const row of rows) {
            const userMarkets = row.markets && row.markets.length > 0 ? row.markets : null;
            if (userMarkets != null && !userMarkets.includes(market))
                continue;
            const alreadyEntered = await hasEnteredSlug(row.user_id, slug);
            if (alreadyEntered)
                continue;
            const orderSizeUsd = Number(row.order_size_usd);
            if (!Number.isFinite(orderSizeUsd) || orderSizeUsd < 1)
                continue;
            try {
                const { client } = await getClobClientForWallet(row.wallet_id);
                const tickSize = await client.getTickSize(tokenID);
                const negRisk = await client.getNegRisk(tokenID);
                const worstPrice = 0.99;
                const resp = (await client.createAndPostMarketOrder({ tokenID, side: Side.BUY, amount: orderSizeUsd, price: worstPrice }, { tickSize, negRisk }, OrderType.FOK));
                if (!resp.success) {
                    console.error('[EdgeRunner] order failed', { userId: row.user_id, market, slug, error: resp.errorMsg });
                    continue;
                }
                await recordEnteredSlug({
                    userId: row.user_id,
                    slug,
                    market,
                    side,
                    orderSizeUsd,
                });
                await setEdgeTradingLastEntered({ userId: row.user_id, slug });
                console.log('[EdgeRunner] entered', { userId: row.user_id, market, slug, side, edgePp: edgePp.toFixed(2) });
            }
            catch (err) {
                console.error('[EdgeRunner] error', { userId: row.user_id, market, slug, err });
            }
        }
    }
}
function startEdgeRunner() {
    setInterval(() => {
        runEdgeTradingLoop().catch((err) => console.error('[EdgeRunner] loop error', err));
    }, EDGE_RUNNER_INTERVAL_MS);
    console.log('[EdgeRunner] started (interval %d ms)', EDGE_RUNNER_INTERVAL_MS);
}
// ── Copy Trading Runner ──────────────────────────────────────────────────────
const COPY_RUNNER_INTERVAL_MS = 2_500; // poll every 2.5 seconds per leader
async function fetchLeaderTradesSince(leaderAddress, sinceTs) {
    const url = `https://data-api.polymarket.com/activity?user=${encodeURIComponent(leaderAddress)}&type=TRADE&limit=100&sortBy=TIMESTAMP&sortDirection=DESC&start=${sinceTs}`;
    try {
        const res = await fetch(url, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok)
            return [];
        const data = await res.json();
        if (!Array.isArray(data))
            return [];
        return data.map((item) => ({
            transactionHash: String(item.transactionHash ?? item.txHash ?? ''),
            tokenId: String(item.asset ?? item.tokenId ?? item.conditionId ?? ''),
            marketSlug: item.market_slug != null ? String(item.market_slug) : (item.slug != null ? String(item.slug) : null),
            outcome: item.outcome != null ? String(item.outcome) : null,
            side: String(item.side ?? item.type ?? 'BUY').toUpperCase(),
            price: Number(item.price ?? 0),
            size: Number(item.size ?? item.amount ?? 0),
            timestamp: Number(item.timestamp ?? item.ts ?? 0),
        })).filter((t) => t.transactionHash.length > 0);
    }
    catch {
        return [];
    }
}
async function runCopyTradingLoop() {
    const subscriptions = await getEnabledCopySubscriptions();
    if (subscriptions.length === 0)
        return;
    const nowSec = Math.floor(Date.now() / 1000);
    // Max trades we will execute per subscription per poll cycle — safety cap
    const MAX_TRADES_PER_CYCLE = 2;
    for (const sub of subscriptions) {
        try {
            // First run (last_seen_timestamp = 0): just anchor to now and skip all historical trades.
            // This prevents backfilling all trades the leader made before the user subscribed.
            if (Number(sub.last_seen_timestamp) === 0) {
                await updateLastSeenTimestamp(sub.id, nowSec);
                console.log('[CopyRunner] anchored new subscription', { subId: sub.id, leader: sub.leader_address, nowSec });
                continue;
            }
            const sinceTs = Number(sub.last_seen_timestamp);
            const trades = await fetchLeaderTradesSince(sub.leader_address, sinceTs);
            if (trades.length === 0)
                continue;
            // Sort oldest-first so we process in order
            trades.sort((a, b) => a.timestamp - b.timestamp);
            let latestTs = sinceTs;
            let tradesExecutedThisCycle = 0;
            for (const trade of trades) {
                if (trade.timestamp <= sinceTs)
                    continue;
                // Hard cap: never execute more than MAX_TRADES_PER_CYCLE per poll tick.
                // If the leader fired a burst, we'll catch remaining trades next tick.
                if (tradesExecutedThisCycle >= MAX_TRADES_PER_CYCLE) {
                    console.warn('[CopyRunner] cycle cap hit, deferring remaining trades', {
                        subId: sub.id, leader: sub.leader_address, deferred: trades.length,
                    });
                    break;
                }
                // Skip sells if not configured to copy sells
                if (!sub.copy_sells && trade.side === 'SELL') {
                    latestTs = Math.max(latestTs, trade.timestamp);
                    continue;
                }
                // Deduplicate by tx hash
                const alreadyCopied = await isTxHashCopied(sub.user_id, trade.transactionHash);
                if (alreadyCopied) {
                    latestTs = Math.max(latestTs, trade.timestamp);
                    continue;
                }
                // ── Position-aware filtering ──────────────────────────────────────────
                // We only hold ONE position per token at a time. This prevents copying
                // every individual trade the leader makes on the same market token.
                if (trade.tokenId) {
                    const openShares = await getCopyPositionShares(sub.user_id, trade.tokenId);
                    const isBuy = trade.side !== 'SELL';
                    const isSell = trade.side === 'SELL';
                    if (isBuy && openShares > 0) {
                        // Already long this token — skip additional buys (leader is adding to their position,
                        // but we only copy the initial entry).
                        await recordCopyTrade({
                            userId: sub.user_id, walletId: sub.wallet_id,
                            leaderAddress: sub.leader_address, leaderTxHash: trade.transactionHash,
                            tokenId: trade.tokenId, marketSlug: trade.marketSlug,
                            outcome: trade.outcome, side: trade.side,
                            price: trade.price, size: trade.size,
                            amountUsd: trade.price * trade.size,
                            status: 'skipped',
                            errorMessage: 'already have open position in this token — skipping additional buy',
                        });
                        latestTs = Math.max(latestTs, trade.timestamp);
                        continue;
                    }
                    if (isSell && openShares === 0) {
                        // We never bought this token — nothing to close, skip.
                        await recordCopyTrade({
                            userId: sub.user_id, walletId: sub.wallet_id,
                            leaderAddress: sub.leader_address, leaderTxHash: trade.transactionHash,
                            tokenId: trade.tokenId, marketSlug: trade.marketSlug,
                            outcome: trade.outcome, side: trade.side,
                            price: trade.price, size: trade.size,
                            amountUsd: trade.price * trade.size,
                            status: 'skipped',
                            errorMessage: 'no open position to close for this token',
                        });
                        latestTs = Math.max(latestTs, trade.timestamp);
                        continue;
                    }
                }
                // ─────────────────────────────────────────────────────────────────────
                // Enforce order size
                const orderSizeUsd = Number(sub.order_size_usd);
                const maxTradeUsd = sub.max_trade_usd != null ? Number(sub.max_trade_usd) : null;
                const effectiveSize = maxTradeUsd != null ? Math.min(orderSizeUsd, maxTradeUsd) : orderSizeUsd;
                if (!trade.tokenId) {
                    await recordCopyTrade({
                        userId: sub.user_id,
                        walletId: sub.wallet_id,
                        leaderAddress: sub.leader_address,
                        leaderTxHash: trade.transactionHash,
                        tokenId: null,
                        marketSlug: trade.marketSlug,
                        outcome: trade.outcome,
                        side: trade.side,
                        price: trade.price,
                        size: trade.size,
                        amountUsd: trade.price * trade.size,
                        status: 'skipped',
                        errorMessage: 'no tokenId in leader trade',
                    });
                    latestTs = Math.max(latestTs, trade.timestamp);
                    continue;
                }
                // Execute the copy trade
                try {
                    const { client } = await getClobClientForWallet(sub.wallet_id);
                    const tickSize = await client.getTickSize(trade.tokenId);
                    const negRisk = await client.getNegRisk(trade.tokenId);
                    const side = trade.side === 'SELL' ? Side.SELL : Side.BUY;
                    const worstPrice = side === Side.BUY ? 0.99 : 0.01;
                    const resp = (await client.createAndPostMarketOrder({ tokenID: trade.tokenId, side, amount: effectiveSize, price: worstPrice }, { tickSize, negRisk }, OrderType.FOK));
                    if (resp.success) {
                        tradesExecutedThisCycle++;
                        await recordCopyTrade({
                            userId: sub.user_id,
                            walletId: sub.wallet_id,
                            leaderAddress: sub.leader_address,
                            leaderTxHash: trade.transactionHash,
                            tokenId: trade.tokenId,
                            marketSlug: trade.marketSlug,
                            outcome: trade.outcome,
                            side: trade.side,
                            price: trade.price,
                            size: trade.size,
                            amountUsd: effectiveSize,
                            status: 'executed',
                        });
                        console.log('[CopyRunner] copied trade', {
                            userId: sub.user_id,
                            leader: sub.leader_address,
                            txHash: trade.transactionHash,
                            side: trade.side,
                            tokenId: trade.tokenId,
                            amountUsd: effectiveSize,
                        });
                    }
                    else {
                        await recordCopyTrade({
                            userId: sub.user_id,
                            walletId: sub.wallet_id,
                            leaderAddress: sub.leader_address,
                            leaderTxHash: trade.transactionHash,
                            tokenId: trade.tokenId,
                            marketSlug: trade.marketSlug,
                            outcome: trade.outcome,
                            side: trade.side,
                            price: trade.price,
                            size: trade.size,
                            amountUsd: effectiveSize,
                            status: 'failed',
                            errorMessage: resp.errorMsg ?? 'order rejected',
                        });
                        console.error('[CopyRunner] order failed', { userId: sub.user_id, error: resp.errorMsg });
                    }
                }
                catch (execErr) {
                    await recordCopyTrade({
                        userId: sub.user_id,
                        walletId: sub.wallet_id,
                        leaderAddress: sub.leader_address,
                        leaderTxHash: trade.transactionHash,
                        tokenId: trade.tokenId,
                        marketSlug: trade.marketSlug,
                        outcome: trade.outcome,
                        side: trade.side,
                        price: trade.price,
                        size: trade.size,
                        amountUsd: effectiveSize,
                        status: 'failed',
                        errorMessage: execErr?.message ?? 'unknown error',
                    }).catch(() => { });
                    console.error('[CopyRunner] exec error', { userId: sub.user_id, err: execErr });
                }
                latestTs = Math.max(latestTs, trade.timestamp);
            }
            // Update last seen timestamp
            if (latestTs > Number(sub.last_seen_timestamp)) {
                await updateLastSeenTimestamp(sub.id, latestTs);
            }
        }
        catch (err) {
            console.error('[CopyRunner] sub error', { subId: sub.id, leader: sub.leader_address, err });
        }
    }
}
function startCopyRunner() {
    setInterval(() => {
        runCopyTradingLoop().catch((err) => console.error('[CopyRunner] loop error', err));
    }, COPY_RUNNER_INTERVAL_MS);
    console.log('[CopyRunner] started (interval %d ms)', COPY_RUNNER_INTERVAL_MS);
}
main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
});
