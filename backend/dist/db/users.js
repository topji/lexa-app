import { getPool } from './client.js';
export async function createUser(walletAddress) {
    const pool = getPool();
    const wa = walletAddress ?? null;
    if (wa) {
        const existing = await pool.query(`SELECT id, wallet_address, created_at FROM users WHERE wallet_address = $1`, [wa]);
        if (existing.rows[0])
            return existing.rows[0];
    }
    const inserted = await pool.query(`INSERT INTO users (wallet_address)
     VALUES ($1)
     RETURNING id, wallet_address, created_at`, [wa]);
    return inserted.rows[0];
}
export async function getUserById(id) {
    const pool = getPool();
    const res = await pool.query(`SELECT id, wallet_address, created_at FROM users WHERE id = $1`, [id]);
    return res.rows[0] ?? null;
}
export async function setUserWalletAddress(userId, walletAddress) {
    const pool = getPool();
    const res = await pool.query(`UPDATE users
     SET wallet_address = $2
     WHERE id = $1
     RETURNING id, wallet_address, created_at`, [userId, walletAddress]);
    return res.rows[0] ?? null;
}
