import { ClobClient } from '@polymarket/clob-client';
import { Wallet } from 'ethers';
import { config } from '../config.js';
export async function createOrDeriveClobApiKey(privateKey) {
    const signer = new Wallet(privateKey);
    const client = new ClobClient(config.clobRestUrl, config.polymarketChainId, signer);
    const raw = (await client.createOrDeriveApiKey());
    const creds = { apiKey: raw.key ?? '', secret: raw.secret ?? '', passphrase: raw.passphrase ?? '' };
    if (!creds.apiKey || !creds.secret || !creds.passphrase) {
        throw new Error('Failed to create/derive CLOB API credentials');
    }
    return creds;
}
