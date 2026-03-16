import { RelayClient, RelayerTxType } from '@polymarket/builder-relayer-client';
import { BuilderConfig } from '@polymarket/builder-signing-sdk';
import { deriveSafe } from '@polymarket/builder-relayer-client/dist/builder/derive.js';
import { getContractConfig } from '@polymarket/builder-relayer-client/dist/config/index.js';
import { Wallet, providers } from 'ethers';
import { config } from '../config.js';
import { getWalletById } from '../db/wallets.js';
import { decryptString } from '../security/encryption.js';
import { getPool } from '../db/client.js';
function getRelayerUrl() {
    // Keep env override, but default to the same URL used by the frontend.
    return process.env.POLY_BUILDER_RELAYER_URL ?? 'https://relayer-v2.polymarket.com';
}
function deriveSafeAddress(eoaAddress) {
    const cfg = getContractConfig(config.polymarketChainId);
    return deriveSafe(eoaAddress, cfg.SafeContracts.SafeFactory);
}
function getLocalBuilderConfig() {
    const key = config.polyBuilderApiKey;
    const secret = config.polyBuilderSecret;
    const passphrase = config.polyBuilderPassphrase;
    return new BuilderConfig({
        localBuilderCreds: { key, secret, passphrase },
    });
}
export async function ensureBuilderProxyForWallet(walletId) {
    const wallet = await getWalletById(walletId);
    if (!wallet)
        throw new Error(`wallet ${walletId} not found`);
    if (wallet.type !== 'custodial')
        throw new Error(`wallet ${walletId} must be custodial`);
    if (!wallet.encrypted_private_key)
        throw new Error(`wallet ${walletId} missing private key`);
    if (wallet.builder_proxy_address)
        return wallet.builder_proxy_address;
    const pk = decryptString(wallet.encrypted_private_key);
    const provider = new providers.JsonRpcProvider(config.polygonRpcUrl);
    const signer = new Wallet(pk, provider);
    const relayerUrl = getRelayerUrl();
    const builderConfig = getLocalBuilderConfig();
    const client = new RelayClient(relayerUrl, config.polymarketChainId, signer, builderConfig, RelayerTxType.SAFE);
    let proxyAddress = null;
    try {
        const response = await client.deploy();
        const result = await response.wait();
        proxyAddress = result?.proxyAddress ?? null;
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const statusCode = e.statusCode ??
            e.status ??
            0;
        // Fall back to deterministic derivation: already deployed, or builder creds not yet authorized (403/401)
        if (/already deployed/i.test(msg) || statusCode === 403 || statusCode === 401 || /forbidden|unauthorized/i.test(msg)) {
            proxyAddress = deriveSafeAddress(wallet.funder_address);
        }
        else {
            throw e;
        }
    }
    if (!proxyAddress) {
        // Best-effort fallback: Safe address is deterministic from the EOA.
        proxyAddress = deriveSafeAddress(wallet.funder_address);
    }
    const pool = getPool();
    await pool.query(`UPDATE wallets
     SET builder_proxy_address = $2,
         builder_deployed_at = NOW()
     WHERE id = $1`, [walletId, proxyAddress]);
    return proxyAddress;
}
