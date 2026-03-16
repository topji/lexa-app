import { getPool } from './client.js';
export async function createStrategy(input) {
    const pool = getPool();
    const res = await pool.query(`INSERT INTO strategies (
      user_id, wallet_id, name, market, active, entry_side,
      entry_odd_max, entry_seconds_to_expiry_min,
      entry_odd_change_window_s, entry_odd_change_min, entry_odd_change_pct_min,
      exit_stop_loss, exit_stop_loss_pct, exit_seconds_to_expiry_max,
      exit_profit_odd, exit_profit_pct, order_size_usd
    ) VALUES ($1,$2,$3,$4,false,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    RETURNING *`, [
        input.userId,
        input.walletId,
        input.name,
        input.market,
        input.entrySide,
        input.entryOddMax ?? null,
        input.entrySecondsToExpiryMin,
        input.entryOddChangeWindowS ?? null,
        input.entryOddChangeMin ?? null,
        input.entryOddChangePctMin ?? null,
        input.exitStopLoss ?? null,
        input.exitStopLossPct ?? null,
        input.exitSecondsToExpiryMax,
        input.exitProfitOdd ?? null,
        input.exitProfitPct ?? null,
        input.orderSizeUsd,
    ]);
    return res.rows[0];
}
export async function listStrategiesByUser(userId) {
    const pool = getPool();
    const res = await pool.query(`SELECT * FROM strategies WHERE user_id = $1 ORDER BY id DESC`, [userId]);
    return res.rows;
}
export async function listActiveStrategies() {
    const pool = getPool();
    const res = await pool.query(`SELECT * FROM strategies WHERE active = true ORDER BY id ASC`);
    return res.rows;
}
export async function getStrategyById(id) {
    const pool = getPool();
    const res = await pool.query(`SELECT * FROM strategies WHERE id = $1`, [id]);
    return res.rows[0] ?? null;
}
export async function updateStrategy(id, fields) {
    const pool = getPool();
    const keys = Object.keys(fields);
    if (keys.length === 0)
        return getStrategyById(id);
    const sets = keys.map((k, idx) => `${k} = $${idx + 2}`);
    const values = keys.map((k) => fields[k]);
    const res = await pool.query(`UPDATE strategies SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`, [id, ...values]);
    return res.rows[0] ?? null;
}
