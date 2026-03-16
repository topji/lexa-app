import { config } from './config.js';
/**
 * Resolve the slug of the BTC 5m Up/Down market that ends soonest (the currently active or next window).
 * Uses Gamma API so we ingest the market that has real trading, not a future 50/50 window.
 */
export async function resolveSoonestBtc5mSlug() {
    const now = new Date();
    const nowMs = now.getTime();
    const oneHourLater = new Date(nowMs + 60 * 60 * 1000);
    const oneDayLater = new Date(nowMs + 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({
        closed: 'false',
        end_date_min: now.toISOString(),
        end_date_max: oneHourLater.toISOString(),
        order: 'endDate',
        ascending: 'true',
        limit: '50',
    });
    let res = await fetch(`${config.gammaApiBase}/events?${params}`, {
        headers: { Accept: 'application/json' },
    });
    let events = [];
    if (res.ok) {
        events = (await res.json());
    }
    if (events.length === 0) {
        const paramsDay = new URLSearchParams({
            closed: 'false',
            end_date_min: now.toISOString(),
            end_date_max: oneDayLater.toISOString(),
            order: 'endDate',
            ascending: 'true',
            limit: '50',
        });
        res = await fetch(`${config.gammaApiBase}/events?${paramsDay}`, {
            headers: { Accept: 'application/json' },
        });
        if (res.ok) {
            events = (await res.json());
        }
    }
    const search = 'bitcoin';
    const suffix = '5m';
    const candidates = [];
    for (const event of events) {
        const slug = event.slug ?? '';
        const title = (event.title ?? '').toLowerCase();
        if (!slug.toLowerCase().includes(suffix))
            continue;
        if (!title.includes(search))
            continue;
        const endDate = event.endDate;
        if (!endDate)
            continue;
        const endMs = new Date(endDate).getTime();
        if (endMs <= nowMs)
            continue;
        if (!event.markets?.[0]?.clobTokenIds)
            continue;
        candidates.push({ slug, endMs });
    }
    if (candidates.length === 0)
        return null;
    candidates.sort((a, b) => a.endMs - b.endMs);
    return candidates[0].slug;
}
/**
 * Resolve the slug of the BTC 15m Up/Down market that ends soonest (the currently active or next window).
 */
export async function resolveSoonestBtc15mSlug() {
    return resolveSoonestSlug('bitcoin', '15m');
}
/**
 * Resolve the slug of the soonest-ending Up/Down market for the given asset and horizon.
 * asset: 'bitcoin' | 'ethereum' | 'solana' (title search); horizon: '15m' | '1h' (slug suffix).
 */
export async function resolveSoonestSlug(asset, horizon) {
    const now = new Date();
    const nowMs = now.getTime();
    const windowMs = horizon === '1h' ? 3 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000;
    const endMax = new Date(nowMs + windowMs);
    const params = new URLSearchParams({
        closed: 'false',
        end_date_min: now.toISOString(),
        end_date_max: endMax.toISOString(),
        order: 'endDate',
        ascending: 'true',
        limit: '50',
    });
    const res = await fetch(`${config.gammaApiBase}/events?${params}`, {
        headers: { Accept: 'application/json' },
    });
    let events = [];
    if (res.ok) {
        events = (await res.json());
    }
    const search = asset.toLowerCase();
    const slugMatch = (s) => {
        const lower = s.toLowerCase();
        if (horizon === '1h')
            return lower.includes('1h') || lower.includes('1-h');
        return lower.includes(horizon);
    };
    const candidates = [];
    for (const event of events) {
        const slug = event.slug ?? '';
        const title = (event.title ?? '').toLowerCase();
        if (!slugMatch(slug))
            continue;
        if (!title.includes(search))
            continue;
        const endDate = event.endDate;
        if (!endDate)
            continue;
        const endMs = new Date(endDate).getTime();
        if (endMs <= nowMs)
            continue;
        if (!event.markets?.[0]?.clobTokenIds)
            continue;
        candidates.push({ slug, endMs });
    }
    if (candidates.length === 0)
        return null;
    candidates.sort((a, b) => a.endMs - b.endMs);
    return candidates[0].slug;
}
