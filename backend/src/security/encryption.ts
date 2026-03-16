import crypto from 'crypto'

type EncryptedPayload = {
  v: 1
  alg: 'aes-256-gcm'
  iv_b64: string
  tag_b64: string
  ct_b64: string
}

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) {
    throw new Error('Missing env: ENCRYPTION_KEY (base64-encoded 32 bytes)')
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to 32 bytes (base64)')
  }
  return key
}

export function encryptString(plaintext: string): string {
  const key = getKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()])
  const tag = cipher.getAuthTag()

  const payload: EncryptedPayload = {
    v: 1,
    alg: 'aes-256-gcm',
    iv_b64: iv.toString('base64'),
    tag_b64: tag.toString('base64'),
    ct_b64: ct.toString('base64'),
  }
  return JSON.stringify(payload)
}

export function decryptString(payloadJson: string): string {
  const key = getKey()
  const payload = JSON.parse(payloadJson) as EncryptedPayload
  if (payload.v !== 1 || payload.alg !== 'aes-256-gcm') throw new Error('Unsupported encrypted payload')
  const iv = Buffer.from(payload.iv_b64, 'base64')
  const tag = Buffer.from(payload.tag_b64, 'base64')
  const ct = Buffer.from(payload.ct_b64, 'base64')

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return pt.toString('utf8')
}

