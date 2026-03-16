import { getPool } from './client.js';
export async function getOpenPositionForStrategy(strategyId) {
    const pool = getPool();
    const res = await pool.query(`SELECT *
     FROM strategy_positions
     WHERE strategy_id = $1 AND status IN ('open', 'closing')
     ORDER BY id DESC
     LIMIT 1`, [strategyId]);
    return res.rows[0] ?? null;
}
export async function createOpenPosition(args) {
    const pool = getPool();
    const res = await pool.query(`INSERT INTO strategy_positions (
      strategy_id, market, expiry_ts, side, token_id,
      entry_sample_ts, entry_odd, entry_order_id, entry_shares,
      status, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open', NOW())
    RETURNING *`, [
        args.strategyId,
        args.market,
        args.expiryTs,
        args.side,
        args.tokenId,
        args.entrySampleTs,
        args.entryOdd,
        args.entryOrderId,
        args.entryShares,
    ]);
    return res.rows[0];
}
export async function markPositionClosing(args) {
    const pool = getPool();
    await pool.query(`UPDATE strategy_positions
     SET status = 'closing', exit_reason = $2, updated_at = NOW()
     WHERE id = $1`, [args.positionId, args.exitReason]);
}
export async function closePosition(args) {
    const pool = getPool();
    await pool.query(`UPDATE strategy_positions
     SET status = 'closed',
         exit_sample_ts = $2,
         exit_odd = $3,
         exit_order_id = $4,
         exit_reason = $5,
         updated_at = NOW()
     WHERE id = $1`, [args.positionId, args.exitSampleTs, args.exitOdd, args.exitOrderId, args.exitReason]);
}
export async function listPositionsForStrategy(strategyId, limit) {
    const pool = getPool();
    const res = await pool.query(`SELECT *
     FROM strategy_positions
     WHERE strategy_id = $1
     ORDER BY created_at DESC
     LIMIT $2`, [strategyId, limit]);
    return res.rows;
}
export async function listAllPositionsForUser(userId, limit) {
    const pool = getPool();
    const res = await pool.query(`SELECT p.*
     FROM strategy_positions p
     JOIN strategies s ON p.strategy_id = s.id
     WHERE s.user_id = $1
     ORDER BY p.created_at DESC
     LIMIT $2`, [userId, limit]);
    return res.rows;
}
export async function countOpenPositionsForUser(userId) {
    const pool = getPool();
    const res = await pool.query(`SELECT COUNT(*)::text AS count
     FROM strategy_positions p
     JOIN strategies s ON p.strategy_id = s.id
     WHERE s.user_id = $1
       AND p.status IN ('open', 'closing')`, [userId]);
    const raw = res.rows[0]?.count;
    const n = raw != null ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
}
