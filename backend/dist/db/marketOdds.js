import { getPool } from './client.js';
export async function getLatestOdds(market) {
    const pool = getPool();
    const res = await pool.query(`SELECT market, expiry_ts, seconds_to_expiry, sample_ts, price, up_odd, down_odd,
            up_pct_chg_1s, up_pct_chg_2s, up_pct_chg_3s, up_pct_chg_4s, up_pct_chg_5s,
            down_pct_chg_1s, down_pct_chg_2s, down_pct_chg_3s, down_pct_chg_4s, down_pct_chg_5s,
            up_abs_chg_1s, up_abs_chg_2s, up_abs_chg_3s, up_abs_chg_4s, up_abs_chg_5s,
            down_abs_chg_1s, down_abs_chg_2s, down_abs_chg_3s, down_abs_chg_4s, down_abs_chg_5s
     FROM market_odds
     WHERE market = $1
     ORDER BY sample_ts DESC
     LIMIT 1`, [market]);
    return res.rows[0] ?? null;
}
