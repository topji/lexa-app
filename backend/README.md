# Lexa odds backend

Ingestion service that stores **Up/Down odds** (and BTC price) every second for the Polymarket BTC 5min market, with percentage changes over the last 1–5 seconds.

## Setup

1. **Environment**

   ```bash
   cp .env.example .env
   ```

   Set in `.env`:

   - `DATABASE_URL` – PostgreSQL connection URL (required).
   - `MARKET_SLUG` – optional; defaults to `btc-updown-5m-1771880100`.

2. **Database**

   ```bash
   npm run init-db
   ```

   This creates the `btc5m_odds` table and indexes.

3. **Run ingestion**

   ```bash
   npm run dev
   ```

   The worker connects to Polymarket CLOB and RTDS WebSockets, samples every 1 second, and inserts rows with `window_ts` (nearest 5‑minute mark), `sample_ts`, BTC price, up/down odds, and 1–5s % changes.

## Scripts

- `npm run init-db` – apply schema (run once).
- `npm run dev` – run worker with tsx (development).
- `npm run build` && `npm run start` – build and run worker (production).
- `npm run query [slug] [window_ts] [limit]` – print latest rows (default slug from env, limit 20). Pass an ISO `window_ts` to filter by 5‑minute window.

## Data

- **Table:** `btc5m_odds`
- **Fields:** `market_slug`, `market_name`, `window_ts`, `sample_ts`, `btc_price`, `up_odd`, `down_odd`, `up_pct_chg_1s` … `up_pct_chg_5s`, `down_pct_chg_1s` … `down_pct_chg_5s`, `created_at`.
