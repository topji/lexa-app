"""15-Minute Analytical Engine — Options-Style Boundary Crossing Model.

This is NOT a price prediction model. It answers:
  P(BTC_price_at_expiry > start_price)

This is a boundary crossing problem, solved analytically using:
  1. Distance from start price (how far BTC has moved since market opened)
  2. Realized 1-minute volatility scaled to remaining time
  3. Microstructure adjustments (orderbook, momentum, volume spike)

Uses 1-minute candles (NOT hourly) for maximum responsiveness.

DO NOT USE: GARCH, Monte Carlo, hourly indicators — they dilute the signal
on this time scale.
"""

import numpy as np
from scipy.stats import norm


def compute_sigma_remaining(
    log_returns_1m: np.ndarray,
    minutes_remaining: float,
    lookback: int = 30,
) -> float:
    """Compute volatility scaled to remaining time.

    Uses recent 1-minute realized vol, then scales by sqrt(time_remaining).

    Args:
        log_returns_1m: Array of 1-minute log returns.
        minutes_remaining: Minutes until market expiry.
        lookback: Number of recent 1m returns to use for vol estimation.

    Returns:
        sigma_remaining: Volatility over the remaining window.
    """
    if len(log_returns_1m) < 5:
        return 0.005  # fallback: ~0.5% for 15 min

    recent = log_returns_1m[-lookback:] if len(log_returns_1m) >= lookback else log_returns_1m
    sigma_1m = float(np.std(recent, ddof=1))

    # Guard against zero vol
    if sigma_1m < 1e-8:
        sigma_1m = 1e-5

    # Scale to remaining time: σ_T = σ_1m * √(T)
    sigma_remaining = sigma_1m * np.sqrt(max(minutes_remaining, 0.5))
    return float(sigma_remaining)


def boundary_crossing_probability(
    current_price: float,
    start_price: float,
    sigma_remaining: float,
) -> float:
    """Compute P(S_T > start_price) using closed-form normal model.

    This is the core of the 15m engine.

    z = ln(start_price / current_price) / σ_remaining
    P(up) = 1 - Φ(z) = Φ(-z)

    If current_price > start_price → z < 0 → P(up) > 0.5 (we're already above)
    If current_price < start_price → z > 0 → P(up) < 0.5 (we need to climb back)

    Args:
        current_price: Current BTC price.
        start_price: BTC price when the Polymarket market opened.
        sigma_remaining: Volatility over the remaining time window.

    Returns:
        P(price_at_expiry > start_price) in [0.01, 0.99].
    """
    if sigma_remaining <= 0 or current_price <= 0 or start_price <= 0:
        return 0.5

    z = np.log(start_price / current_price) / sigma_remaining
    p_up = float(norm.cdf(-z))

    # Clamp to reasonable range
    return max(0.01, min(0.99, p_up))


def microstructure_adjustment(
    p_base: float,
    orderbook_imbalance: float = 0.0,
    momentum_3m: float = 0.0,
    volume_ratio: float = 1.0,
) -> tuple[float, dict]:
    """Apply microstructure adjustments to base probability.

    These capture short-term information not in the price yet:
      1. Orderbook imbalance: bid-heavy = bullish pressure
      2. Short-term momentum: 3-5 min return direction
      3. Volume spike: above-average volume confirms directional moves

    Args:
        p_base: Base probability from boundary crossing model.
        orderbook_imbalance: (bid_vol - ask_vol) / total, in [-1, 1].
        momentum_3m: Log return over last 3 minutes.
        volume_ratio: recent_volume / average_volume.

    Returns:
        (p_adjusted, adjustments_dict)
    """
    adjustments = {}

    # 1. Orderbook imbalance: ±0.03 max adjustment
    # imbalance > 0.6 means 60% of depth is bids → bullish
    ob_adj = 0.0
    if abs(orderbook_imbalance) > 0.05:
        ob_adj = orderbook_imbalance * 0.05  # max ±0.05
        ob_adj = max(-0.03, min(0.03, ob_adj))
    adjustments["orderbook"] = {"imbalance": orderbook_imbalance, "adjustment": ob_adj}

    # 2. Momentum: recent 3-5 min return, max ±0.04 adjustment
    mom_adj = 0.0
    if abs(momentum_3m) > 0.0002:  # > 0.02% move in 3 min
        # Scale: 0.1% move in 3 min → ~0.02 adjustment
        mom_adj = momentum_3m * 20  # amplify small moves
        mom_adj = max(-0.04, min(0.04, mom_adj))
    adjustments["momentum"] = {"return_3m": momentum_3m, "adjustment": mom_adj}

    # 3. Volume spike: amplifies existing direction, max ±0.02
    vol_adj = 0.0
    if volume_ratio > 1.5:
        # High volume amplifies the direction we're already leaning
        direction = 1 if (p_base + ob_adj + mom_adj) > 0.5 else -1
        vol_adj = direction * min((volume_ratio - 1.0) * 0.01, 0.02)
    adjustments["volume"] = {"ratio": volume_ratio, "adjustment": vol_adj}

    p_adjusted = p_base + ob_adj + mom_adj + vol_adj
    p_adjusted = max(0.02, min(0.98, p_adjusted))

    adjustments["total_adjustment"] = ob_adj + mom_adj + vol_adj

    return p_adjusted, adjustments


def compute_15m_signal(
    current_price: float,
    start_price: float,
    minutes_remaining: float,
    log_returns_1m: np.ndarray,
    orderbook_imbalance: float = 0.0,
    momentum_3m: float = 0.0,
    volume_ratio: float = 1.0,
) -> dict:
    """Full 15-minute analytical signal.

    This is the main entry point for the 15m engine.

    Args:
        current_price: Current BTC price.
        start_price: BTC price when the market opened.
        minutes_remaining: Minutes until market expiry.
        log_returns_1m: Array of recent 1-minute log returns.
        orderbook_imbalance: Orderbook bid/ask imbalance.
        momentum_3m: 3-minute log return.
        volume_ratio: Recent volume / average volume.

    Returns:
        Complete signal dict.
    """
    distance_pct = ((current_price - start_price) / start_price) * 100 if start_price > 0 else 0
    sigma_remaining = compute_sigma_remaining(log_returns_1m, minutes_remaining)
    p_base = boundary_crossing_probability(current_price, start_price, sigma_remaining)
    p_final, adjustments = microstructure_adjustment(
        p_base, orderbook_imbalance, momentum_3m, volume_ratio,
    )

    return {
        "engine": "15m_analytical",
        "p_up": p_final,
        "p_down": 1.0 - p_final,
        "p_base": p_base,
        "current_price": current_price,
        "start_price": start_price,
        "distance_pct": distance_pct,
        "sigma_remaining": sigma_remaining,
        "sigma_1m": float(np.std(log_returns_1m[-30:], ddof=1)) if len(log_returns_1m) >= 5 else 0.0,
        "minutes_remaining": minutes_remaining,
        "adjustments": adjustments,
    }
