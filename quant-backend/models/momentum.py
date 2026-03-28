"""Momentum and technical indicators for BTC.

Computes:
  - RSI (Relative Strength Index)
  - MACD (Moving Average Convergence Divergence)
  - EMA crossover signals
  - Volume-weighted momentum
  - Rate of change (ROC)

All computed from OHLCV data, converted into a directional P(up) signal.
"""

import numpy as np
import pandas as pd


def compute_rsi(closes: np.ndarray, period: int = 14) -> float:
    """Compute RSI for the most recent bar.

    RSI = 100 - 100 / (1 + RS)
    RS = avg_gain / avg_loss over `period` bars.
    """
    if len(closes) < period + 1:
        return 50.0  # neutral if insufficient data

    deltas = np.diff(closes[-(period + 1):])
    gains = np.where(deltas > 0, deltas, 0)
    losses = np.where(deltas < 0, -deltas, 0)

    avg_gain = np.mean(gains)
    avg_loss = np.mean(losses)

    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return float(100.0 - 100.0 / (1.0 + rs))


def compute_ema(values: np.ndarray, span: int) -> np.ndarray:
    """Compute EMA using pandas for accuracy."""
    s = pd.Series(values)
    return s.ewm(span=span, adjust=False).mean().values


def compute_macd(closes: np.ndarray) -> dict:
    """Compute MACD indicator.

    MACD line = EMA(12) - EMA(26)
    Signal line = EMA(9) of MACD line
    Histogram = MACD - Signal

    Returns dict with current values.
    """
    if len(closes) < 26:
        return {"macd": 0.0, "signal": 0.0, "histogram": 0.0, "bullish": False}

    ema_12 = compute_ema(closes, 12)
    ema_26 = compute_ema(closes, 26)
    macd_line = ema_12 - ema_26
    signal_line = compute_ema(macd_line, 9)
    histogram = macd_line - signal_line

    return {
        "macd": float(macd_line[-1]),
        "signal": float(signal_line[-1]),
        "histogram": float(histogram[-1]),
        "bullish": float(histogram[-1]) > 0,
    }


def compute_ema_crossover(closes: np.ndarray, fast: int = 9, slow: int = 21) -> dict:
    """Detect EMA crossover.

    Returns whether fast EMA is above slow EMA, and the spread.
    """
    if len(closes) < slow:
        return {"bullish_cross": False, "spread_pct": 0.0}

    ema_fast = compute_ema(closes, fast)
    ema_slow = compute_ema(closes, slow)

    spread = ema_fast[-1] - ema_slow[-1]
    spread_pct = (spread / ema_slow[-1]) * 100 if ema_slow[-1] != 0 else 0

    return {
        "bullish_cross": float(spread) > 0,
        "spread_pct": float(spread_pct),
        "ema_fast": float(ema_fast[-1]),
        "ema_slow": float(ema_slow[-1]),
    }


def compute_roc(closes: np.ndarray, period: int = 12) -> float:
    """Rate of change: (current - N periods ago) / N periods ago * 100."""
    if len(closes) < period + 1:
        return 0.0
    return float((closes[-1] - closes[-(period + 1)]) / closes[-(period + 1)] * 100)


def compute_volume_momentum(volumes: np.ndarray, closes: np.ndarray, period: int = 12) -> float:
    """Volume-weighted momentum.

    Positive when recent volume confirms price direction.
    Returns a score in [-1, 1].
    """
    if len(volumes) < period or len(closes) < period:
        return 0.0

    recent_vol = volumes[-period:]
    recent_close = closes[-period:]
    price_changes = np.diff(recent_close)

    if len(price_changes) == 0:
        return 0.0

    # Volume-weighted sum of price direction
    vol_weights = recent_vol[1:] / np.sum(recent_vol[1:]) if np.sum(recent_vol[1:]) > 0 else np.ones(len(price_changes)) / len(price_changes)
    direction = np.sign(price_changes)
    score = float(np.sum(vol_weights * direction))

    return max(-1.0, min(1.0, score))


def momentum_probability_up(df: pd.DataFrame) -> dict:
    """Compute aggregate momentum P(up) from all indicators.

    Combines RSI, MACD, EMA crossover, ROC, and volume momentum
    into a single directional probability.

    Args:
        df: OHLCV DataFrame with columns: close, volume.

    Returns:
        Dict with p_up, individual indicators, and model name.
    """
    closes = df["close"].values
    volumes = df["volume"].values

    # Individual indicators
    rsi = compute_rsi(closes)
    macd = compute_macd(closes)
    ema_cross = compute_ema_crossover(closes)
    roc = compute_roc(closes)
    vol_mom = compute_volume_momentum(volumes, closes)

    # Convert each indicator to a [0, 1] probability
    signals = []

    # RSI: 30-70 range maps to 0-1, extremes are contrarian
    if rsi < 30:
        rsi_p = 0.65 + (30 - rsi) / 100  # oversold → bullish
    elif rsi > 70:
        rsi_p = 0.35 - (rsi - 70) / 100  # overbought → bearish
    else:
        rsi_p = 0.35 + (rsi - 30) / 100  # linear scale in normal range
    rsi_p = max(0.1, min(0.9, rsi_p))
    signals.append(("rsi", rsi_p, 0.25))

    # MACD histogram direction
    if macd["histogram"] > 0:
        macd_p = 0.5 + min(abs(macd["histogram"]) / closes[-1] * 1000, 0.3)
    else:
        macd_p = 0.5 - min(abs(macd["histogram"]) / closes[-1] * 1000, 0.3)
    macd_p = max(0.1, min(0.9, macd_p))
    signals.append(("macd", macd_p, 0.25))

    # EMA crossover
    ema_p = 0.6 if ema_cross["bullish_cross"] else 0.4
    ema_p += ema_cross["spread_pct"] * 0.02  # bonus for strong spread
    ema_p = max(0.1, min(0.9, ema_p))
    signals.append(("ema_crossover", ema_p, 0.20))

    # ROC: positive = bullish momentum
    roc_p = 0.5 + roc * 0.02  # 1% ROC → 0.52
    roc_p = max(0.1, min(0.9, roc_p))
    signals.append(("roc", roc_p, 0.15))

    # Volume momentum
    vol_p = 0.5 + vol_mom * 0.2
    vol_p = max(0.1, min(0.9, vol_p))
    signals.append(("volume_momentum", vol_p, 0.15))

    # Weighted average
    total_weight = sum(w for _, _, w in signals)
    p_up = sum(p * w for _, p, w in signals) / total_weight

    return {
        "p_up": float(p_up),
        "p_down": 1.0 - float(p_up),
        "indicators": {
            "rsi": {"value": rsi, "p_up": rsi_p},
            "macd": {**macd, "p_up": macd_p},
            "ema_crossover": {**ema_cross, "p_up": ema_p},
            "roc": {"value": roc, "p_up": roc_p},
            "volume_momentum": {"value": vol_mom, "p_up": vol_p},
        },
        "model": "MomentumEnsemble",
    }
