# Lexa — Project Memory

## What is Lexa
Automated trading co-pilot for Polymarket, focused on BTC 5-minute up/down markets.
Users define strategies (entry/exit odds rules), fund a custodial wallet, and Lexa auto-executes 24/7 with safety guardrails.

## Architecture
- **Frontend**: Next.js 14 (`app/` dir), React 18, Tailwind — `localhost:3000`
- **Backend**: Node/TypeScript Fastify API — `localhost:3001` (env: `API_PORT`)
  - Ingestion worker (`worker.ts`) — separate process, samples Polymarket CLOB WS + RTDS WS every 1s
  - HTTP API server (`server.ts`) — Fastify, also starts runner
  - Strategy runner (`runner.ts`) — `setInterval` 1s, auto-executes strategies
- **DB**: Postgres (supports Neon via `@neondatabase/serverless` or standard `pg`)
- **Env var**: `NEXT_PUBLIC_BACKEND_URL` (frontend → backend), `DATABASE_URL`, `ENCRYPTION_KEY` (base64 32 bytes), `RUNNER_ENABLED=1`

## Key File Paths
| File | Purpose |
|------|---------|
| `backend/src/config.ts` | Env config, market slugs, endpoints |
| `backend/src/server.ts` | Fastify HTTP API + calls startRunner() |
| `backend/src/runner.ts` | Strategy execution engine (1s tick) |
| `backend/src/worker.ts` | Odds ingestion from CLOB WS + RTDS WS |
| `backend/src/db/client.ts` | Postgres pool + insertOdds() |
| `backend/src/db/strategies.ts` | CRUD for strategies table |
| `backend/src/db/positions.ts` | CRUD for strategy_positions table |
| `backend/src/db/wallets.ts` | CRUD for wallets table |
| `backend/src/db/users.ts` | CRUD for users table |
| `backend/src/db/marketOdds.ts` | getLatestOdds(market) |
| `backend/src/security/encryption.ts` | AES-256-GCM encrypt/decryptString |
| `backend/src/polymarket/clob.ts` | createOrDeriveClobApiKey() |
| `backend/src/fetch-market.ts` | Gamma API → MarketInfo |
| `backend/src/resolve-soonest.ts` | Finds soonest BTC 5m market slug |
| `backend/schema.sql` | Full DB schema |
| `app/strategies/page.tsx` | Main strategies UI (create/deploy/positions) |
| `components/SideNav.tsx` | Nav: Chat / Dashboard / Crypto / Strategies |
| `app/layout.tsx` | Root layout with Orbitron + Rajdhani fonts |

## DB Tables
- `market_odds` — per-second odds samples (market, expiry_ts, seconds_to_expiry, up/down odds, price, pct/abs changes)
- `users` — id, wallet_address
- `wallets` — custodial wallets; encrypted_private_key, clob creds all AES-256-GCM encrypted
- `strategies` — user rules: entry_side, entry_odd_max, entry_seconds_to_expiry_min, exit_stop_loss, exit_seconds_to_expiry_max, order_size_usd, active
- `strategy_positions` — trade lifecycle: open → closing → closed/failed; entry/exit odds, order IDs, shares

## API Endpoints (backend port 3001)
- `GET /health`
- `POST /users`, `PATCH /users/:userId`
- `POST /wallets/custodial`, `POST /wallets/:id/clob/derive`, `GET /wallets/:id/balance`
- `POST /strategies`, `GET /users/:userId/strategies`, `GET /strategies/:id`, `PATCH /strategies/:id`
- `GET /strategies/:id/positions?limit=20`

## Runner Logic
- `shouldEnter`: BTC-5m timing gate (no entry if ste > 280 or < 30), strategy entry_odd_max, entry_seconds_to_expiry_min
- `shouldExit`: stoploss (odd <= exit_stop_loss) or time (ste < exit_seconds_to_expiry_max)
- Guards: USDC balance+allowance check, per-user open position cap, per-wallet error count, global error streak + backoff
- Orders: `createAndPostMarketOrder` FOK via `@polymarket/clob-client`

## Frontend State (strategies page)
- localStorage keys: `lexa_user_id`, `lexa_wallet_id`, `lexa_wallet_address`
- Auto-onboards: creates user → custodial wallet → derives CLOB creds on first visit
- Form defaults: market=btc-5m, side=up, entryOddMax=0.2, entrySecondsToExpiryMin=200, exitStopLoss=0.1, exitSecondsToExpiryMax=75, orderSizeUsd=10

## Design System
- Fonts: Orbitron (display/headings), Rajdhani (body/sans)
- CSS classes: `bg-void`, `text-lexa-gradient`, `bg-lexa-gradient`, `bg-lexa-glass`, `border-lexa-border`, `lexa-accent`, `shadow-glow-lexa`, `card-glow`, `bg-grid`
- Color scheme: dark void background, neon/gradient accent

## Security
- Private keys + CLOB creds never sent to frontend
- All sensitive fields encrypted with AES-256-GCM before DB storage
- `ENCRYPTION_KEY` env var = base64-encoded 32 bytes
