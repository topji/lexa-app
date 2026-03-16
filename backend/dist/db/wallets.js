import { getPool } from './client.js';
export async function createCustodialWallet(args) {
    const pool = getPool();
    const res = await pool.query(`INSERT INTO wallets (
      user_id, type, funder_address, signature_type, encrypted_private_key
    ) VALUES ($1, 'custodial', $2, $3, $4)
    RETURNING
      id, user_id, type, funder_address, signature_type,
      encrypted_private_key, clob_api_key, encrypted_clob_secret, encrypted_clob_passphrase,
      builder_proxy_address, builder_deployed_at,
      created_at`, [args.userId, args.funderAddress, args.signatureType, args.encryptedPrivateKey]);
    return res.rows[0];
}
export async function getWalletById(id) {
    const pool = getPool();
    const res = await pool.query(`SELECT
       id, user_id, type, funder_address, signature_type,
       encrypted_private_key, clob_api_key, encrypted_clob_secret, encrypted_clob_passphrase,
       builder_proxy_address, builder_deployed_at,
       created_at
     FROM wallets
     WHERE id = $1`, [id]);
    return res.rows[0] ?? null;
}
export async function setWalletClobCreds(args) {
    const pool = getPool();
    await pool.query(`UPDATE wallets
     SET clob_api_key = $2,
         encrypted_clob_secret = $3,
         encrypted_clob_passphrase = $4
     WHERE id = $1`, [args.walletId, args.apiKey, args.encryptedSecret, args.encryptedPassphrase]);
}
export async function findCustodialWalletByUserId(userId) {
    const pool = getPool();
    const res = await pool.query(`SELECT
       id, user_id, type, funder_address, signature_type,
       encrypted_private_key, clob_api_key, encrypted_clob_secret, encrypted_clob_passphrase,
       builder_proxy_address, builder_deployed_at,
       created_at
     FROM wallets
     WHERE user_id = $1 AND type = 'custodial'
     ORDER BY id ASC
     LIMIT 1`, [userId]);
    return res.rows[0] ?? null;
}
