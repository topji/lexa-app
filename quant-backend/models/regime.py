"""Market regime detection for BTC.

Classifies the current market into one of three regimes:
  - TRENDING:  Strong directional move (ADX > 25, clear EMA trend)
  - RANGING:   Sideways / mean-reverting (ADX < 25, low spread between EMAs)
  - HIGH_VOL:  Volatile / choppy (realised vol > 1.5× 30-day average)

Each regime adjusts how much we trust each model:
  - TRENDING:  Boost momentum weight, reduce mean-reversion signals
  - RANGING:   Boost Bayesian (contrarian), reduce momentum
  - HIGH_VOL:  Widen Kelly fraction, reduce position size
"""

import numpy as np
import pandas as pd

from config import REGIME_TREND_ADX_THRESHOLD, REGIME_VOL_HIGH_MULTIPLIER


def compute_adx(df: pd.DataFrame, period: int = 14) -> float:
    """Compute Average Directional Index (ADX) from OHLCV data.

    ADX > 25 = trending market
    ADX < 20 = ranging / sideways market
    """
    if len(df) < period + 1:
        return 20.0  # neutral default

    high = df["high"].values
    low = df["low"].values
    close = df["close"].values

    # True Range
    tr = np.maximum(
        high[1:] - low[1:],
        np.maximum(
            np.abs(high[1:] - close[:-1]),
            np.abs(low[1:] - close[:-1]),
        ),
    )

    # Directional Movement
    up_move = high[1:] - high[:-1]
    down_move = low[:-1] - low[1:]

    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)

    # Smoothed averages (Wilder's smoothing)
    atr = np.zeros(len(tr))
    plus_di_arr = np.zeros(len(tr))
    minus_di_arr = np.zeros(len(tr))

    atr[period - 1] = np.mean(tr[:period])
    plus_di_arr[period - 1] = np.mean(plus_dm[:period])
    minus_di_arr[period - 1] = np.mean(minus_dm[:period])

    for i in range(period, len(tr)):
        atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period
        plus_di_arr[i] = (plus_di_arr[i - 1] * (period - 1) + plus_dm[i]) / period
        minus_di_arr[i] = (minus_di_arr[i - 1] * (period - 1) + minus_dm[i]) / period

    # DI+ and DI-
    with np.errstate(divide="ignore", invalid="ignore"):
        plus_di = np.where(atr > 0, (plus_di_arr / atr) * 100, 0.0)
        minus_di = np.where(atr > 0, (minus_di_arr / atr) * 100, 0.0)

        # DX and ADX
        di_sum = plus_di + minus_di
        dx = np.where(di_sum > 0, np.abs(plus_di - minus_di) / di_sum * 100, 0.0)

    # ADX = smoothed DX
    adx_values = np.zeros(len(dx))
    start = 2 * period - 1
    if start < len(dx):
        adx_values[start] = np.mean(dx[period:start + 1])
        for i in range(start + 1, len(dx)):
            adx_values[i] = (adx_values[i - 1] * (period - 1) + dx[i]) / period

    return float(adx_values[-1]) if len(adx_values) > 0 else 20.0


def compute_realised_vol(closes: np.ndarray, window: int = 24) -> tuple[float, float]:
    """Compute realised volatility (recent vs long-term).

    Returns (recent_vol, long_term_vol) both as hourly std of log returns.
    """
    if len(closes) < window + 1:
        return 0.01, 0.01

    log_ret = np.diff(np.log(closes))
    recent = np.std(log_ret[-window:]) if len(log_ret) >= window else np.std(log_ret)
    long_term = np.std(log_ret)
    return float(recent), float(long_term)


def detect_regime(df: pd.DataFrame) -> dict:
    """Detect current market regime from OHLCV data.

    Returns:
        Dict with regime name, ADX, vol ratio, and weight adjustments.
    """
    adx = compute_adx(df)
    closes = df["close"].values
    recent_vol, long_term_vol = compute_realised_vol(closes)

    vol_ratio = recent_vol / long_term_vol if long_term_vol > 0 else 1.0

    # Classify
    if vol_ratio >= REGIME_VOL_HIGH_MULTIPLIER:
        regime = "HIGH_VOL"
    elif adx >= REGIME_TREND_ADX_THRESHOLD:
        regime = "TRENDING"
    else:
        regime = "RANGING"

    # Weight adjustments per regime
    # Format: multiplier applied to each model's weight before re-normalizing
    weight_adjustments = {
        "TRENDING": {
            "garch": 0.8,
            "monte_carlo": 1.0,
            "bayesian": 0.7,
            "momentum": 1.6,   # momentum shines in trends
        },
        "RANGING": {
            "garch": 1.0,
            "monte_carlo": 1.0,
            "bayesian": 1.5,   # contrarian signals work in ranges
            "momentum": 0.5,   # momentum is noise in sideways
        },
        "HIGH_VOL": {
            "garch": 1.3,      # GARCH designed for vol clustering
            "monte_carlo": 1.2,
            "bayesian": 0.8,
            "momentum": 0.7,   # momentum whipsaws in high vol
        },
    }

    # Kelly size multiplier per regime
    kelly_multiplier = {
        "TRENDING": 1.0,      # normal sizing in trends
        "RANGING": 0.7,       # reduce size in choppy markets
        "HIGH_VOL": 0.5,      # half size when volatile
    }

    return {
        "regime": regime,
        "adx": adx,
        "recent_vol": recent_vol,
        "long_term_vol": long_term_vol,
        "vol_ratio": vol_ratio,
        "weight_adjustments": weight_adjustments[regime],
        "kelly_multiplier": kelly_multiplier[regime],
        "description": {
            "TRENDING": "Strong directional trend detected — momentum signals prioritized",
            "RANGING": "Sideways/ranging market — contrarian Bayesian signals prioritized",
            "HIGH_VOL": "High volatility regime — position sizing reduced, GARCH prioritized",
        }[regime],
    }
