import { config } from '../config.js';
const baseUrl = config.synthdataApiUrl.replace(/\/$/, '');
async function fetchUpDown(path, asset) {
    const key = config.synthdataApiKey;
    if (!key)
        return null;
    const url = `${baseUrl}${path}?asset=${encodeURIComponent(asset)}`;
    try {
        const res = await fetch(url, {
            headers: { Authorization: `Apikey ${key}` },
            signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            if (res.status === 429 || res.status >= 500) {
                console.warn('[SynthData]', path, res.status, res.status === 429 ? 'rate limit' : 'server error', '— backing off');
            }
            else {
                console.warn('[SynthData]', path, res.status, text.slice(0, 80));
            }
            return null;
        }
        return (await res.json());
    }
    catch (err) {
        console.warn('[SynthData]', path, err?.message);
        return null;
    }
}
/** 15-minute up/down for BTC (and ETH, SOL per API). */
export function fetch15m(asset = 'BTC') {
    return fetchUpDown('/insights/polymarket/up-down/15min', asset);
}
/** Hourly up/down for BTC. */
export function fetchHourly(asset = 'BTC') {
    return fetchUpDown('/insights/polymarket/up-down/hourly', asset);
}
/** Daily up/down for BTC (optional; not stored every second by default). */
export function fetchDaily(asset = 'BTC') {
    return fetchUpDown('/insights/polymarket/up-down/daily', asset);
}
