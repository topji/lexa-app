import { getPool, closePool } from './db/client.js'
import { config } from './config.js'

async function main() {
  const slug = process.argv[2] ?? config.marketSlug
  const windowArg = process.argv[3]
  const limit = Math.min(parseInt(process.argv[4] ?? '20', 10) || 20, 500)

  const pool = getPool()
  let result
  if (windowArg) {
    const windowTs = new Date(windowArg)
    if (Number.isNaN(windowTs.getTime())) {
      console.error('Invalid window_ts (use ISO string)')
      process.exit(1)
    }
    result = await pool.query(
      `SELECT sample_ts, btc_price, up_odd, down_odd,
         up_pct_chg_1s, up_pct_chg_2s, up_pct_chg_3s, up_pct_chg_4s, up_pct_chg_5s,
         down_pct_chg_1s, down_pct_chg_2s, down_pct_chg_3s, down_pct_chg_4s, down_pct_chg_5s
       FROM btc5m_odds
       WHERE market_slug = $1 AND window_ts = $2
       ORDER BY sample_ts DESC
       LIMIT $3`,
      [slug, windowTs, limit]
    )
  } else {
    result = await pool.query(
      `SELECT window_ts, sample_ts, btc_price, up_odd, down_odd,
         up_pct_chg_1s, up_pct_chg_2s, up_pct_chg_3s, up_pct_chg_4s, up_pct_chg_5s,
         down_pct_chg_1s, down_pct_chg_2s, down_pct_chg_3s, down_pct_chg_4s, down_pct_chg_5s
       FROM btc5m_odds
       WHERE market_slug = $1
       ORDER BY sample_ts DESC
       LIMIT $2`,
      [slug, limit]
    )
  }
  console.log(JSON.stringify(result.rows, null, 2))
  await closePool()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
