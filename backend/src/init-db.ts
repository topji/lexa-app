import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { getPool } from './db/client.js'
import { config } from './config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function main() {
  const sqlPath = join(__dirname, '..', 'schema.sql')
  const sql = readFileSync(sqlPath, 'utf-8')
  const pool = getPool()
  await pool.query(sql)
  console.log('Schema applied successfully.')
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
