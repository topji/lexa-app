import 'dotenv/config';
const required = (key) => {
    const v = process.env[key];
    if (v == null || v === '')
        throw new Error(`Missing env: ${key}`);
    return v;
};
export const config = {
    databaseUrl: required('DATABASE_URL'),
    jwtSecret: required('JWT_SECRET'),
    marketSlug: process.env.MARKET_SLUG ?? 'btc-updown-5m-1771880100',
    clobWsUrl: 'wss://ws-subscriptions-clob.polymarket.com/ws/market',
    clobRestUrl: 'https://clob.polymarket.com',
    polymarketChainId: 137,
    polygonRpcUrl: process.env.POLYGON_RPC_URL ?? 'https://polygon-rpc.com',
    /** Ordered list of Polygon RPC URLs; first is primary, rest are fallbacks for balance/allowance reads. */
    polygonRpcUrls: [
        ...(process.env.POLYGON_RPC_URL ? [process.env.POLYGON_RPC_URL] : []),
        'https://polygon-rpc.com',
        'https://rpc.ankr.com/polygon',
        'https://polygon-bor-rpc.publicnode.com',
        'https://1rpc.io/matic',
        'https://polygon.drpc.org',
    ].filter(Boolean),
    polyBuilderApiKey: required('POLY_BUILDER_API_KEY'),
    polyBuilderSecret: required('POLY_BUILDER_SECRET'),
    polyBuilderPassphrase: required('POLY_BUILDER_PASSPHRASE'),
    rtdsWsUrl: 'wss://ws-live-data.polymarket.com',
    gammaApiBase: 'https://gamma-api.polymarket.com',
    sampleIntervalMs: 1000,
    historySeconds: 5,
    // Logical market code for our own schema: btc-5m, btc-15m, eth-5m, eth-15m, sol-5m, sol-15m
    marketCode: process.env.MARKET_CODE ?? 'btc-5m',
    /** SynthData API (optional). Set SYNTHDATA_ENABLED=1 and SYNTHDATA_API_KEY to poll 15m+1h and store in synthdata_insights. */
    synthdataApiUrl: process.env.SYNTHDATA_API_URL ?? 'https://api.synthdata.co',
    synthdataApiKey: process.env.SYNTHDATA_API_KEY ?? '',
    synthdataEnabled: process.env.SYNTHDATA_ENABLED === '1' || process.env.SYNTHDATA_ENABLED === 'true',
    /** Poll interval (ms). Default 30s to avoid SynthData rate limits (429). */
    synthdataPollIntervalMs: parseInt(process.env.SYNTHDATA_POLL_INTERVAL_MS ?? '30000', 10) || 30000,
};
