import { getPool, closePool } from './db/client.js';
import { config } from './config.js';
async function main() {
    const market = process.argv[2] ?? config.marketCode;
    const expiryArg = process.argv[3];
    const limit = Math.min(parseInt(process.argv[4] ?? '20', 10) || 20, 500);
    const pool = getPool();
    let result;
    if (expiryArg) {
        const expiryTs = new Date(expiryArg);
        if (Number.isNaN(expiryTs.getTime())) {
            console.error('Invalid expiry_ts (use ISO string)');
            process.exit(1);
        }
        result = await pool.query(`SELECT sample_ts, seconds_to_expiry, price, up_odd, down_odd,
         up_pct_chg_1s, up_pct_chg_2s, up_pct_chg_3s, up_pct_chg_4s, up_pct_chg_5s,
         down_pct_chg_1s, down_pct_chg_2s, down_pct_chg_3s, down_pct_chg_4s, down_pct_chg_5s,
         up_abs_chg_1s, up_abs_chg_2s, up_abs_chg_3s, up_abs_chg_4s, up_abs_chg_5s,
         down_abs_chg_1s, down_abs_chg_2s, down_abs_chg_3s, down_abs_chg_4s, down_abs_chg_5s
       FROM market_odds
       WHERE market = $1 AND expiry_ts = $2
       ORDER BY sample_ts DESC
       LIMIT $3`, [market, expiryTs, limit]);
    }
    else {
        result = await pool.query(`SELECT market, expiry_ts, sample_ts, seconds_to_expiry, price, up_odd, down_odd,
         up_pct_chg_1s, up_pct_chg_2s, up_pct_chg_3s, up_pct_chg_4s, up_pct_chg_5s,
         down_pct_chg_1s, down_pct_chg_2s, down_pct_chg_3s, down_pct_chg_4s, down_pct_chg_5s,
         up_abs_chg_1s, up_abs_chg_2s, up_abs_chg_3s, up_abs_chg_4s, up_abs_chg_5s,
         down_abs_chg_1s, down_abs_chg_2s, down_abs_chg_3s, down_abs_chg_4s, down_abs_chg_5s
       FROM market_odds
       WHERE market = $1
       ORDER BY sample_ts DESC
       LIMIT $2`, [market, limit]);
    }
    console.log(JSON.stringify(result.rows, null, 2));
    await closePool();
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
