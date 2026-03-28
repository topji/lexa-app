"""Bayesian probability updater.

Starts with a prior P(up) from Monte Carlo, then updates with evidence
signals using Bayes' theorem:

  P(up|evidence) = P(evidence|up) * P(up) / P(evidence)

Evidence signals and their likelihood ratios:
  1. Funding rate: positive funding → longs pay shorts → bearish crowding
  2. Order book imbalance: bid-heavy → bullish pressure
  3. Long/short ratio: extreme longs → contrarian bearish
  4. Open interest trend: rising OI + rising price → bullish confirmation
"""

from config import FUNDING_RATE_THRESHOLD, BAYESIAN_MAX_SHIFT


def _funding_rate_likelihood(funding_rate: float) -> tuple[float, float]:
    """Convert funding rate into likelihood ratio P(obs|up) / P(obs|down).

    High positive funding = longs crowded = contrarian bearish signal.
    High negative funding = shorts crowded = contrarian bullish signal.

    Returns (p_obs_given_up, p_obs_given_down).
    """
    if funding_rate > FUNDING_RATE_THRESHOLD:
        # Crowded longs — slightly bearish
        strength = min(abs(funding_rate) / 0.002, 1.0)  # cap at 0.2%
        return (0.4 + 0.1 * (1 - strength), 0.6 + 0.1 * strength)
    elif funding_rate < -FUNDING_RATE_THRESHOLD:
        # Crowded shorts — slightly bullish
        strength = min(abs(funding_rate) / 0.002, 1.0)
        return (0.6 + 0.1 * strength, 0.4 + 0.1 * (1 - strength))
    else:
        # Neutral
        return (0.5, 0.5)


def _orderbook_likelihood(imbalance: float) -> tuple[float, float]:
    """Convert order book imbalance into likelihood ratio.

    imbalance > 0 = more bids = bullish
    imbalance < 0 = more asks = bearish

    Returns (p_obs_given_up, p_obs_given_down).
    """
    # Clamp imbalance to [-1, 1]
    imb = max(-1.0, min(1.0, imbalance))

    # Linear mapping: imbalance of ±0.3 is a moderate signal
    p_up = 0.5 + 0.2 * imb
    p_down = 0.5 - 0.2 * imb

    return (max(0.1, min(0.9, p_up)), max(0.1, min(0.9, p_down)))


def _long_short_ratio_likelihood(ratio: float) -> tuple[float, float]:
    """Convert top trader long/short ratio into likelihood.

    ratio > 1.5 = very long-heavy → contrarian bearish
    ratio < 0.7 = very short-heavy → contrarian bullish
    """
    if ratio > 1.5:
        strength = min((ratio - 1.5) / 1.0, 1.0)
        return (0.4 - 0.1 * strength, 0.6 + 0.1 * strength)
    elif ratio < 0.7:
        strength = min((0.7 - ratio) / 0.3, 1.0)
        return (0.6 + 0.1 * strength, 0.4 - 0.1 * strength)
    else:
        return (0.5, 0.5)


def _oi_trend_likelihood(oi_change_pct: float, price_change_pct: float) -> tuple[float, float]:
    """Open interest + price trend confirmation.

    Rising OI + rising price = new longs entering → bullish
    Rising OI + falling price = new shorts entering → bearish
    Falling OI + rising price = short covering → weak bullish
    Falling OI + falling price = long liquidation → bearish
    """
    if oi_change_pct > 2 and price_change_pct > 0:
        # Strong bullish confirmation
        return (0.65, 0.35)
    elif oi_change_pct > 2 and price_change_pct < 0:
        # Bearish: new shorts entering
        return (0.35, 0.65)
    elif oi_change_pct < -2 and price_change_pct > 0:
        # Weak bullish (short covering)
        return (0.55, 0.45)
    elif oi_change_pct < -2 and price_change_pct < 0:
        # Long liquidation → bearish
        return (0.35, 0.65)
    else:
        return (0.5, 0.5)


def bayesian_update(
    prior_p_up: float,
    funding_rate: float = 0.0,
    orderbook_imbalance: float = 0.0,
    long_short_ratio: float = 1.0,
    oi_change_pct: float = 0.0,
    price_change_pct: float = 0.0,
) -> dict:
    """Run Bayesian update on P(up) using all evidence signals.

    Args:
        prior_p_up: Prior probability from Monte Carlo.
        funding_rate: Current funding rate.
        orderbook_imbalance: Bid-ask imbalance (-1 to 1).
        long_short_ratio: Top trader long/short ratio.
        oi_change_pct: Open interest % change (e.g., last 4h).
        price_change_pct: Price % change over same period.

    Returns:
        Dict with posterior P(up), prior, and per-signal contributions.
    """
    p_up = prior_p_up
    p_down = 1.0 - p_up
    signals = {}

    # 1. Funding rate update
    l_up, l_down = _funding_rate_likelihood(funding_rate)
    numerator = l_up * p_up
    denominator = l_up * p_up + l_down * p_down
    p_up = numerator / denominator if denominator > 0 else p_up
    p_down = 1.0 - p_up
    signals["funding_rate"] = {
        "value": funding_rate,
        "likelihood_up": l_up,
        "likelihood_down": l_down,
        "posterior_after": p_up,
    }

    # 2. Order book imbalance update
    l_up, l_down = _orderbook_likelihood(orderbook_imbalance)
    numerator = l_up * p_up
    denominator = l_up * p_up + l_down * p_down
    p_up = numerator / denominator if denominator > 0 else p_up
    p_down = 1.0 - p_up
    signals["orderbook"] = {
        "value": orderbook_imbalance,
        "likelihood_up": l_up,
        "likelihood_down": l_down,
        "posterior_after": p_up,
    }

    # 3. Long/short ratio update
    l_up, l_down = _long_short_ratio_likelihood(long_short_ratio)
    numerator = l_up * p_up
    denominator = l_up * p_up + l_down * p_down
    p_up = numerator / denominator if denominator > 0 else p_up
    p_down = 1.0 - p_up
    signals["long_short_ratio"] = {
        "value": long_short_ratio,
        "likelihood_up": l_up,
        "likelihood_down": l_down,
        "posterior_after": p_up,
    }

    # 4. OI trend + price confirmation
    l_up, l_down = _oi_trend_likelihood(oi_change_pct, price_change_pct)
    numerator = l_up * p_up
    denominator = l_up * p_up + l_down * p_down
    p_up = numerator / denominator if denominator > 0 else p_up
    p_down = 1.0 - p_up
    signals["oi_trend"] = {
        "oi_change_pct": oi_change_pct,
        "price_change_pct": price_change_pct,
        "likelihood_up": l_up,
        "likelihood_down": l_down,
        "posterior_after": p_up,
    }

    # Cap total shift to prevent evidence from overwhelming the prior
    shift = p_up - prior_p_up
    if abs(shift) > BAYESIAN_MAX_SHIFT:
        p_up = prior_p_up + (BAYESIAN_MAX_SHIFT if shift > 0 else -BAYESIAN_MAX_SHIFT)
        p_down = 1.0 - p_up

    return {
        "prior_p_up": prior_p_up,
        "posterior_p_up": p_up,
        "posterior_p_down": 1.0 - p_up,
        "shift": p_up - prior_p_up,
        "shift_capped": abs(p_up - prior_p_up) >= BAYESIAN_MAX_SHIFT - 0.001,
        "max_shift": BAYESIAN_MAX_SHIFT,
        "signals": signals,
        "model": "BayesianUpdate",
    }
