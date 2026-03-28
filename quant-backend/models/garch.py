"""GARCH(1,1) conditional volatility model for BTC.

Fits GARCH(1,1) to hourly log returns, then forecasts conditional variance
over a given horizon. Converts σ forecast into P(up) via normal CDF.

σ²_t = ω + α·ε²_{t-1} + β·σ²_{t-1}

Where:
  ω = long-run variance baseline
  α = ARCH coefficient (reaction to shocks)
  β = GARCH coefficient (persistence)
"""

import numpy as np
from arch import arch_model
from scipy.stats import norm

from config import GARCH_P, GARCH_Q, MC_HORIZON_HOURS


def fit_garch(log_returns: np.ndarray) -> dict:
    """Fit GARCH(1,1) to log returns.

    Args:
        log_returns: Array of log returns (e.g. hourly).

    Returns:
        Dict with model params, conditional volatility, and forecasts.
    """
    # Scale returns to percentage for numerical stability (arch library convention)
    scaled = log_returns * 100.0

    model = arch_model(
        scaled,
        vol="Garch",
        p=GARCH_P,
        q=GARCH_Q,
        dist="StudentsT",  # fat tails
        mean="Zero",       # assume zero-mean for short horizon
    )
    result = model.fit(disp="off", show_warning=False)

    # Extract parameters
    params = {
        "omega": float(result.params.get("omega", 0)),
        "alpha": float(result.params.get("alpha[1]", 0)),
        "beta": float(result.params.get("beta[1]", 0)),
        "nu": float(result.params.get("nu", 5)),  # degrees of freedom
    }

    # Current conditional volatility (last fitted value)
    cond_vol = float(result.conditional_volatility.iloc[-1]) / 100.0  # back to decimal

    # Forecast variance over horizon
    forecast = result.forecast(horizon=MC_HORIZON_HOURS)
    # Mean of forecasted variance across horizon steps
    forecast_variance = float(forecast.variance.iloc[-1].mean()) / (100.0 ** 2)
    forecast_vol = float(np.sqrt(forecast_variance))

    # Annualized volatility (for display)
    annual_vol = forecast_vol * np.sqrt(8760)  # 8760 hours in a year

    return {
        "params": params,
        "current_hourly_vol": cond_vol,
        "forecast_vol_per_hour": forecast_vol,
        "forecast_vol_horizon": forecast_vol * np.sqrt(MC_HORIZON_HOURS),
        "annualized_vol": annual_vol,
        "persistence": params["alpha"] + params["beta"],
        "residuals": result.resid.values / 100.0,
        "conditional_volatility_series": result.conditional_volatility.values / 100.0,
    }


def garch_probability_up(
    log_returns: np.ndarray,
    current_price: float | None = None,
    start_price: float | None = None,
    drift: float = 0.0,
) -> dict:
    """Estimate P(S_T > start_price) using GARCH-forecasted volatility.

    CRITICAL: This computes P(price_at_expiry > start_price), the boundary
    crossing probability for Polymarket "up" markets.

    z = ln(start_price / current_price) / σ_horizon
    P(up) = Φ(-z)

    When start_price is not available, falls back to P(up) ≈ 0.50 (random walk).

    Args:
        log_returns: Hourly log returns array.
        current_price: Current BTC price.
        start_price: BTC price when the Polymarket market opened.
        drift: Expected hourly drift (default 0 = random walk).

    Returns:
        Dict with p_up, volatility info, and model params.
    """
    garch_result = fit_garch(log_returns)
    sigma_h = garch_result["forecast_vol_horizon"]

    # Compute P(S_T > start_price) via boundary crossing
    if sigma_h > 0 and current_price and start_price and start_price > 0:
        z = np.log(start_price / current_price) / sigma_h
        p_up = float(norm.cdf(-z))
    elif sigma_h > 0:
        # Fallback: no start_price, use drift-based (≈ 0.50 for zero drift)
        z = (drift * MC_HORIZON_HOURS) / sigma_h
        p_up = float(norm.cdf(z))
    else:
        p_up = 0.5

    distance_pct = ((current_price - start_price) / start_price * 100) if current_price and start_price and start_price > 0 else 0.0

    return {
        "p_up": p_up,
        "p_down": 1.0 - p_up,
        "sigma_horizon": sigma_h,
        "distance_from_start_pct": distance_pct,
        "annualized_vol": garch_result["annualized_vol"],
        "persistence": garch_result["persistence"],
        "garch_params": garch_result["params"],
        "model": "GARCH(1,1)",
    }
