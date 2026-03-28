"""Configuration for quant-backend signal engine."""

# Binance public API (no key needed)
# Uses Binance US (api.binance.us) as primary — Binance.com is geo-restricted in the US
BINANCE_BASE = "https://api.binance.us"
BINANCE_FUTURES_BASE = "https://fapi.binance.com"  # futures data fallback — may not be available

# Symbol config
BTC_SYMBOL = "BTCUSDT"

# GARCH parameters
GARCH_LOOKBACK_HOURS = 168  # 7 days of hourly candles
GARCH_P = 1
GARCH_Q = 1

# Monte Carlo parameters
MC_NUM_PATHS = 10_000
MC_HORIZON_HOURS = 1  # forecast horizon — MUST match Polymarket 1h market window
MC_DF = 5  # Student-t degrees of freedom (fat tails)

# Bayesian parameters
BAYESIAN_PRIOR_WEIGHT = 0.6  # weight given to MC prior vs evidence
FUNDING_RATE_THRESHOLD = 0.0005  # extreme funding rate signal
BAYESIAN_MAX_SHIFT = 0.10  # cap total Bayesian shift to ±10pp

# Signal aggregation weights
WEIGHT_GARCH = 0.30
WEIGHT_MC = 0.35
WEIGHT_BAYESIAN = 0.20
WEIGHT_MOMENTUM = 0.15

# Kelly / EV
KELLY_FRACTION = 0.25  # quarter-Kelly for safety
EV_MIN_EDGE = 0.05  # minimum edge to signal a trade

# ── Filters & Risk Controls ──────────────────────────────────────────

# Probability calibration: p_calibrated = CALIB_SLOPE * p + CALIB_INTERCEPT
# Shrinks overconfident signals toward 0.50.  Tune after 50+ samples.
CALIB_SLOPE = 0.90
CALIB_INTERCEPT = 0.05  # so 0→0.05, 0.5→0.50, 1.0→0.95

# Model agreement filter: block trade if std_dev of model probs > this
MODEL_AGREEMENT_MAX_STD = 0.04  # 4 percentage points

# Volatility filter: skip trade when recent realised vol is below this
# (flat market = random outcomes in short-horizon prediction markets)
MIN_HOURLY_VOL = 0.0015  # ~0.15% per hour ≈ 1.3% daily

# Market regime detection
REGIME_TREND_ADX_THRESHOLD = 25     # ADX > 25 = trending
REGIME_VOL_HIGH_MULTIPLIER = 1.5    # vol > 1.5× 30-day avg = high-vol regime

# Daily drawdown stop
MAX_DAILY_DRAWDOWN_PCT = 20  # stop trading if bankroll drops 20%

# API server
API_HOST = "0.0.0.0"
API_PORT = 8100

# Cache TTL
SIGNAL_CACHE_SECONDS = 30
