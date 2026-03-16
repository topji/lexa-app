import { getPool } from './client.js'

export type UserRow = {
  id: number
  wallet_address: string | null
  created_at: Date
}

export async function createUser(walletAddress?: string | null): Promise<UserRow> {
  const pool = getPool()
  const wa = walletAddress ?? null

  if (wa) {
    const existing = await pool.query<UserRow>(
      `SELECT id, wallet_address, created_at FROM users WHERE wallet_address = $1`,
      [wa]
    )
    if (existing.rows[0]) return existing.rows[0]
  }

  const inserted = await pool.query<UserRow>(
    `INSERT INTO users (wallet_address)
     VALUES ($1)
     RETURNING id, wallet_address, created_at`,
    [wa]
  )
  return inserted.rows[0]!
}

export async function getUserById(id: number): Promise<UserRow | null> {
  const pool = getPool()
  const res = await pool.query<UserRow>(`SELECT id, wallet_address, created_at FROM users WHERE id = $1`, [id])
  return res.rows[0] ?? null
}

export async function setUserWalletAddress(userId: number, walletAddress: string): Promise<UserRow | null> {
  const pool = getPool()
  const res = await pool.query<UserRow>(
    `UPDATE users
     SET wallet_address = $2
     WHERE id = $1
     RETURNING id, wallet_address, created_at`,
    [userId, walletAddress]
  )
  return res.rows[0] ?? null
}

