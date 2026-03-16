import pg from 'pg';
import { Pool as NeonPool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { config } from '../config.js';
const { Pool: PgPool } = pg;
neonConfig.webSocketConstructor = ws;
// RDS often presents a cert chain Node doesn't trust; force skip TLS verification for this process (worker + API).
if (/rds\.amazonaws\.com|amazonaws\.com.*rds/i.test(config.databaseUrl)) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}
let pool = null;
function clearPool() {
    pool = null;
}
/** Remove sslmode/gssencmode from URL so Pool's ssl option (rejectUnauthorized: false) is used for RDS. */
function connectionStringWithoutSslParams(url) {
    let out = url.replace(/[?&](sslmode|gssencmode)=[^&]*/gi, (m) => (m.startsWith('?') ? '?' : ''));
    out = out.replace(/\?&+/, '?').replace(/\?$/, '');
    return out;
}
function getPoolRaw() {
    if (!pool) {
        const isNeon = config.databaseUrl.includes('neon.tech');
        if (isNeon) {
            pool = new NeonPool({ connectionString: config.databaseUrl, max: 2 });
        }
        else {
            // RDS: no sslmode in URL so our ssl option controls TLS and skips cert verification (avoids SELF_SIGNED_CERT_IN_CHAIN)
            const connectionString = connectionStringWithoutSslParams(config.databaseUrl);
            const idleMs = Math.min(60_000, parseInt(process.env.DB_IDLE_TIMEOUT_MS ?? '60000', 10) || 60_000);
            const connectMs = Math.min(60_000, parseInt(process.env.DB_CONNECTION_TIMEOUT_MS ?? '30000', 10) || 30_000);
            const p = new PgPool({
                connectionString,
                max: 2,
                idleTimeoutMillis: idleMs,
                connectionTimeoutMillis: connectMs,
                ssl: { rejectUnauthorized: false },
                keepAlive: true,
            });
            p.on('error', (err) => {
                console.error('[db] pool error, will reconnect on next request:', err?.message ?? err);
                clearPool();
            });
            pool = p;
        }
    }
    return pool;
}
export function getPool() {
    const raw = getPoolRaw();
    return new Proxy(raw, {
        get(target, prop) {
            if (prop === 'query') {
                return function (...args) {
                    return queryWithRetry((p) => p.query.apply(p, args));
                };
            }
            return target[prop];
        },
    });
}
function isConnectionError(err) {
    const e = err;
    const code = e?.code;
    if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'EPIPE' || code === 'ETIMEDOUT' || code === 'SELF_SIGNED_CERT_IN_CHAIN')
        return true;
    const msg = (e?.message ?? '').toLowerCase();
    if (msg.includes('connection terminated') || msg.includes('connection timeout') || msg.includes('connection closed') || msg.includes('terminating connection') || msg.includes('self-signed certificate') || msg.includes('timeout exceeded when trying to connect'))
        return true;
    return false;
}
async function queryWithRetry(run) {
    try {
        return await run(getPoolRaw());
    }
    catch (err) {
        if (isConnectionError(err)) {
            console.warn('[db] connection error, clearing pool and retrying:', err?.code, err?.message);
            clearPool();
            return await run(getPoolRaw());
        }
        throw err;
    }
}
export async function insertOdds(row) {
    const client = getPool();
    await client.query(`INSERT INTO market_odds (
      market, expiry_ts, seconds_to_expiry, sample_ts, price, up_odd, down_odd,
      up_pct_chg_1s, up_pct_chg_2s, up_pct_chg_3s, up_pct_chg_4s, up_pct_chg_5s,
      down_pct_chg_1s, down_pct_chg_2s, down_pct_chg_3s, down_pct_chg_4s, down_pct_chg_5s,
      up_abs_chg_1s, up_abs_chg_2s, up_abs_chg_3s, up_abs_chg_4s, up_abs_chg_5s,
      down_abs_chg_1s, down_abs_chg_2s, down_abs_chg_3s, down_abs_chg_4s, down_abs_chg_5s
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11, $12,
      $13, $14, $15, $16, $17,
      $18, $19, $20, $21, $22,
      $23, $24, $25, $26, $27
    )`, [
        row.market,
        row.expiry_ts,
        row.seconds_to_expiry,
        row.sample_ts,
        row.price,
        row.up_odd,
        row.down_odd,
        row.up_pct_chg_1s,
        row.up_pct_chg_2s,
        row.up_pct_chg_3s,
        row.up_pct_chg_4s,
        row.up_pct_chg_5s,
        row.down_pct_chg_1s,
        row.down_pct_chg_2s,
        row.down_pct_chg_3s,
        row.down_pct_chg_4s,
        row.down_pct_chg_5s,
        row.up_abs_chg_1s,
        row.up_abs_chg_2s,
        row.up_abs_chg_3s,
        row.up_abs_chg_4s,
        row.up_abs_chg_5s,
        row.down_abs_chg_1s,
        row.down_abs_chg_2s,
        row.down_abs_chg_3s,
        row.down_abs_chg_4s,
        row.down_abs_chg_5s
    ]);
}
export async function closePool() {
    if (pool) {
        await pool.end();
        pool = null;
    }
}
