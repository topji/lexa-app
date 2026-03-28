"""Monte Carlo simulation engine for BTC price forecasting.

Runs N simulated price paths using:
  - GARCH-calibrated volatility (σ per hour)
  - Student-t innovations (fat tails, calibrated ν from GARCH)
  - Optional drift from recent momentum

Each path: S_{t+1} = S_t * exp(drift_h + σ_h * ε_t)
where ε_t ~ Student-t(ν) normalized to unit variance.

Output: P(up) = fraction of paths ending above current price.
"""

import numpy as np
from scipy.stats import t as student_t

from config import MC_NUM_PATHS, MC_HORIZON_HOURS, MC_DF


def run_simulation(
    current_price: float,
    hourly_vol: float,
    horizon_hours: int = MC_HORIZON_HOURS,
    num_paths: int = MC_NUM_PATHS,
    drift_per_hour: float = 0.0,
    nu: float = MC_DF,
    start_price: float | None = None,
) -> dict:
    """Run Monte Carlo price simulation.

    CRITICAL: P(up) is computed as P(S_T > start_price), NOT P(S_T > current_price).
    Polymarket "up" markets resolve based on whether price is above the market's
    start price at expiry, not whether it went up from current.

    Args:
        current_price: Current BTC price.
        hourly_vol: GARCH-calibrated hourly volatility (σ).
        horizon_hours: Number of hours to simulate forward.
        num_paths: Number of simulation paths.
        drift_per_hour: Expected hourly return (drift).
        nu: Degrees of freedom for Student-t distribution.
        start_price: Price when the Polymarket market opened. If None, uses current_price.

    Returns:
        Dict with p_up, terminal prices distribution, confidence intervals.
    """
    threshold = start_price if start_price is not None else current_price

    rng = np.random.default_rng()

    # Student-t innovations, normalized to unit variance
    # Var(t_ν) = ν/(ν-2), so we divide by sqrt(ν/(ν-2)) to get unit variance
    raw_innovations = student_t.rvs(df=nu, size=(num_paths, horizon_hours), random_state=rng)
    scale_factor = np.sqrt(nu / (nu - 2)) if nu > 2 else 1.0
    innovations = raw_innovations / scale_factor

    # Log returns per step: drift + vol * innovation
    log_returns = drift_per_hour + hourly_vol * innovations  # (num_paths, horizon_hours)

    # Cumulative log returns → terminal prices
    cumulative_log_returns = np.sum(log_returns, axis=1)  # (num_paths,)
    terminal_prices = current_price * np.exp(cumulative_log_returns)

    # P(up) = fraction of paths ending above START price (not current)
    p_up = float(np.mean(terminal_prices > threshold))
    p_down = 1.0 - p_up

    terminal_sorted = np.sort(terminal_prices)
    percentiles = {
        "p5": float(terminal_sorted[int(0.05 * num_paths)]),
        "p25": float(terminal_sorted[int(0.25 * num_paths)]),
        "p50": float(terminal_sorted[int(0.50 * num_paths)]),
        "p75": float(terminal_sorted[int(0.75 * num_paths)]),
        "p95": float(terminal_sorted[int(0.95 * num_paths)]),
    }

    expected_price = float(np.mean(terminal_prices))
    expected_return = (expected_price - current_price) / current_price

    # Value at Risk (95% confidence)
    var_95 = current_price - percentiles["p5"]

    # Distance from threshold
    distance_pct = ((current_price - threshold) / threshold) * 100 if threshold > 0 else 0

    return {
        "p_up": p_up,
        "p_down": p_down,
        "current_price": current_price,
        "start_price": threshold,
        "distance_from_start_pct": distance_pct,
        "expected_price": expected_price,
        "expected_return_pct": expected_return * 100,
        "percentiles": percentiles,
        "var_95": var_95,
        "horizon_hours": horizon_hours,
        "num_paths": num_paths,
        "nu": nu,
        "model": "MonteCarlo-StudentT",
    }
