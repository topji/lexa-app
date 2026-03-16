import { getPool } from './client.js'

export type WalletType = 'custodial' | 'connected'

export type WalletRow = {
  id: number
  user_id: number
  type: WalletType
  funder_address: string
  signature_type: number
  encrypted_private_key: string | null
  clob_api_key: string | null
  encrypted_clob_secret: string | null
  encrypted_clob_passphrase: string | null
  builder_proxy_address: string | null
  builder_deployed_at: Date | null
  created_at: Date
}

export async function createCustodialWallet(args: {
  userId: number
  funderAddress: string
  signatureType: number
  encryptedPrivateKey: string
}): Promise<WalletRow> {
  const pool = getPool()
  const res = await pool.query<WalletRow>(
    `INSERT INTO wallets (
      user_id, type, funder_address, signature_type, encrypted_private_key
    ) VALUES ($1, 'custodial', $2, $3, $4)
    RETURNING
      id, user_id, type, funder_address, signature_type,
      encrypted_private_key, clob_api_key, encrypted_clob_secret, encrypted_clob_passphrase,
      builder_proxy_address, builder_deployed_at,
      created_at`,
    [args.userId, args.funderAddress, args.signatureType, args.encryptedPrivateKey]
  )
  return res.rows[0]!
}

export async function getWalletById(id: number): Promise<WalletRow | null> {
  const pool = getPool()
  const res = await pool.query<WalletRow>(
    `SELECT
       id, user_id, type, funder_address, signature_type,
       encrypted_private_key, clob_api_key, encrypted_clob_secret, encrypted_clob_passphrase,
       builder_proxy_address, builder_deployed_at,
       created_at
     FROM wallets
     WHERE id = $1`,
    [id]
  )
  return res.rows[0] ?? null
}

export async function setWalletClobCreds(args: {
  walletId: number
  apiKey: string
  encryptedSecret: string
  encryptedPassphrase: string
}): Promise<void> {
  const pool = getPool()
  await pool.query(
    `UPDATE wallets
     SET clob_api_key = $2,
         encrypted_clob_secret = $3,
         encrypted_clob_passphrase = $4
     WHERE id = $1`,
    [args.walletId, args.apiKey, args.encryptedSecret, args.encryptedPassphrase]
  )
}

export async function findCustodialWalletByUserId(userId: number): Promise<WalletRow | null> {
  const pool = getPool()
  const res = await pool.query<WalletRow>(
    `SELECT
       id, user_id, type, funder_address, signature_type,
       encrypted_private_key, clob_api_key, encrypted_clob_secret, encrypted_clob_passphrase,
       builder_proxy_address, builder_deployed_at,
       created_at
     FROM wallets
     WHERE user_id = $1 AND type = 'custodial'
     ORDER BY id ASC
     LIMIT 1`,
    [userId]
  )
  return res.rows[0] ?? null
}
