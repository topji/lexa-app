"""Signal Aggregator V2 — Dual-Engine Architecture.

Two separate engines for two time horizons:

  15m Engine (Analytical):
    - Options-style boundary crossing: P(S_T > start_price)
    - Uses 1-minute candles for high-resolution vol
    - Microstructure adjustments (orderbook, momentum, volume)
    - NO GARCH, NO Monte Carlo (too slow, dilutes signal)

  1h Engine (Full Quant Ensemble):
    - GARCH(1,1) volatility forecast
    - Monte Carlo simulation with Student-t fat tails
    - Bayesian update from microstructure signals
    - Momentum indicators (RSI, MACD, EMA, ROC)
    - All models compute P(S_T > start_price)

Both engines output:
    - P(up) = probability that BTC will be above start_price at expiry
    - This is a BOUNDARY CROSSING problem, not a direction prediction

Post-processing (both engines):
    1. Probability calibration
    2. Model agreement filter (1h only)
    3. Volatility filter
    4. Spread filter
    5. Time filter
    6. Regime detection (1h only)
"""

import time
from typing import Any

import numpy as np

from config import (
    WEIGHT_GARCH, WEIGHT_MC, WEIGHT_BAYESIAN, WEIGHT_MOMENTUM,
    MC_HORIZON_HOURS, SIGNAL_CACHE_SECONDS,
    CALIB_SLOPE, CALIB_INTERCEPT,
    MODEL_AGREEMENT_MAX_STD, MIN_HOURLY_VOL,
)
from data.binance import (
    fetch_all_btc_data, fetch_ohlcv_1m, compute_log_returns,
    compute_momentum_3m, compute_volume_ratio,
)
from models.garch import garch_probability_up, fit_garch
from models.montecarlo import run_simulation
from models.bayesian import bayesian_update
from models.momentum import momentum_probability_up
from models.regime import detect_regime
from models.analytical_15m import compute_15m_signal
from signals.kelly import kelly_criterion, compute_ev_gap

# ── Cache ──────────────────────────────────────────────────────────────
_cache_15m: dict[str, Any] = {}
_cache_15m_ts: float = 0
_cache_1h: dict[str, Any] = {}
_cache_1h_ts: float = 0

CACHE_15M_SECONDS = 5   # 15m engine refreshes every 5s (fast)
CACHE_1H_SECONDS = 30   # 1h engine refreshes every 30s


def calibrate_probability(p: float) -> float:
    """Apply linear probability calibration.

    p_cal = CALIB_SLOPE * p + CALIB_INTERCEPT
    Default: 0.90 * p + 0.05  →  [0, 1] → [0.05, 0.95]
    """
    return max(0.02, min(0.98, CALIB_SLOPE * p + CALIB_INTERCEPT))


# ── 15-MINUTE ENGINE ──────────────────────────────────────────────────

async def generate_15m_signal(
    start_price: float,
    minutes_remaining: float,
    market_price: float | None = None,
    spread: float | None = None,
) -> dict:
    """Generate 15m analytical signal.

    Args:
        start_price: BTC price when the Polymarket 15m market opened.
        minutes_remaining: Minutes until market expiry.
        market_price: Current Polymarket YES price (0-1).
        spread: Current bid-ask spread on Polymarket.

    Returns:
        Complete 15m signal dict.
    """
    global _cache_15m, _cache_15m_ts
    now = time.time()

    # Time filter: don't trade in first 60s or last 90s
    time_ok = minutes_remaining > 1.5 and minutes_remaining < 14.0

    # Check cache (short TTL for 15m)
    if _cache_15m and (now - _cache_15m_ts) < CACHE_15M_SECONDS:
        cached = dict(_cache_15m)
        if market_price is not None and cached.get("market_price") != market_price:
            cached["kelly"] = kelly_criterion(cached["p_up"], market_price)
            cached["ev"] = compute_ev_gap(cached["p_up"], market_price)
            cached["market_price"] = market_price
        return cached

    # Fetch 1-minute candles + orderbook in parallel
    import asyncio
    ohlcv_1m_task = fetch_ohlcv_1m(limit=100)
    from data.binance import fetch_orderbook
    orderbook_task = fetch_orderbook()
    ohlcv_1m, orderbook = await asyncio.gather(
        ohlcv_1m_task, orderbook_task, return_exceptions=True,
    )

    if isinstance(ohlcv_1m, Exception) or ohlcv_1m is None or len(ohlcv_1m) < 5:
        return {"error": "Failed to fetch 1m OHLCV data", "engine": "15m_analytical", "timestamp": now}

    log_returns_1m = compute_log_returns(ohlcv_1m)
    current_price = float(ohlcv_1m["close"].iloc[-1])

    # Compute microstructure features
    ob_imbalance = orderbook["imbalance"] if not isinstance(orderbook, Exception) and orderbook else 0.0
    momentum_3m = compute_momentum_3m(ohlcv_1m)
    volume_ratio = compute_volume_ratio(ohlcv_1m)

    # Run 15m analytical engine
    signal_15m = compute_15m_signal(
        current_price=current_price,
        start_price=start_price,
        minutes_remaining=minutes_remaining,
        log_returns_1m=log_returns_1m,
        orderbook_imbalance=ob_imbalance,
        momentum_3m=momentum_3m,
        volume_ratio=volume_ratio,
    )

    p_up_raw = signal_15m["p_up"]
    p_up = calibrate_probability(p_up_raw)

    # Volatility filter
    sigma_1m = signal_15m.get("sigma_1m", 0)
    vol_sufficient = sigma_1m > 0.0001  # minimum 0.01% per minute

    # Spread filter
    spread_ok = True
    if spread is not None:
        spread_ok = spread < 0.04

    # Composite trade gate
    trade_allowed = time_ok and vol_sufficient and spread_ok

    # Kelly + EV
    mkt_price = market_price if market_price is not None else 0.50
    kelly_result = kelly_criterion(p_up, mkt_price)
    ev_result = compute_ev_gap(p_up, mkt_price)

    if not trade_allowed:
        kelly_result["side"] = "NONE"
        kelly_result["safe_kelly_fraction"] = 0
        kelly_result["has_edge"] = False
        ev_result["action"] = "NO_TRADE"
        reasons = []
        if not time_ok:
            reasons.append(f"Time filter: {minutes_remaining:.1f}m remaining")
        if not vol_sufficient:
            reasons.append(f"Low vol: σ_1m={sigma_1m:.6f}")
        if not spread_ok:
            reasons.append(f"Wide spread: {spread:.3f}")
        ev_result["block_reason"] = " | ".join(reasons)
        ev_result["confidence"] = "blocked"

    result = {
        "engine": "15m_analytical",
        "timestamp": now,
        "symbol": "BTC",
        "horizon": "15m",
        "current_price_usd": current_price,
        "start_price": start_price,
        "distance_pct": signal_15m["distance_pct"],
        "minutes_remaining": minutes_remaining,
        "market_price": mkt_price,
        "p_up_raw": float(p_up_raw),
        "p_up": float(p_up),
        "p_down": float(1 - p_up),
        "p_base": signal_15m["p_base"],
        "calibration": {
            "raw": float(p_up_raw),
            "calibrated": float(p_up),
            "slope": CALIB_SLOPE,
            "intercept": CALIB_INTERCEPT,
        },
        "sigma_remaining": signal_15m["sigma_remaining"],
        "sigma_1m": sigma_1m,
        "adjustments": signal_15m["adjustments"],
        "filters": {
            "time_ok": time_ok,
            "vol_sufficient": vol_sufficient,
            "spread_ok": spread_ok,
            "spread": spread,
            "minutes_remaining": minutes_remaining,
        },
        "trade_allowed": trade_allowed,
        "data_summary": {
            "orderbook_imbalance": ob_imbalance,
            "momentum_3m": momentum_3m,
            "volume_ratio": volume_ratio,
            "best_bid": orderbook["best_bid"] if not isinstance(orderbook, Exception) and orderbook else 0,
            "best_ask": orderbook["best_ask"] if not isinstance(orderbook, Exception) and orderbook else 0,
        },
        "kelly": kelly_result,
        "ev": ev_result,
    }

    _cache_15m = result
    _cache_15m_ts = now
    return result


# ── 1-HOUR ENGINE ─────────────────────────────────────────────────────

async def generate_1h_signal(
    start_price: float | None = None,
    minutes_remaining: float | None = None,
    market_price: float | None = None,
    spread: float | None = None,
) -> dict:
    """Generate 1h full quant ensemble signal.

    Args:
        start_price: BTC price when the Polymarket 1h market opened.
        minutes_remaining: Minutes until market expiry.
        market_price: Current Polymarket YES price (0-1).
        spread: Current bid-ask spread on Polymarket.

    Returns:
        Complete 1h signal dict with all model outputs.
    """
    global _cache_1h, _cache_1h_ts
    now = time.time()

    # Check cache
    if _cache_1h and (now - _cache_1h_ts) < CACHE_1H_SECONDS:
        cached = dict(_cache_1h)
        if market_price is not None and cached.get("market_price") != market_price:
            cached["kelly"] = kelly_criterion(cached["p_up"], market_price)
            cached["ev"] = compute_ev_gap(cached["p_up"], market_price)
            cached["market_price"] = market_price
        return cached

    # Fetch all data (hourly candles + microstructure)
    data = await fetch_all_btc_data()

    if data["ohlcv"] is None or data["log_returns"] is None:
        return {"error": "Failed to fetch OHLCV data", "engine": "1h_quant", "timestamp": now}

    log_returns = data["log_returns"]
    current_price = data["current_price"]
    ohlcv = data["ohlcv"]

    # Regime detection
    try:
        regime_info = detect_regime(ohlcv)
    except Exception as e:
        regime_info = {
            "regime": "UNKNOWN", "adx": 0, "recent_vol": 0.01,
            "long_term_vol": 0.01, "vol_ratio": 1.0,
            "weight_adjustments": {"garch": 1, "monte_carlo": 1, "bayesian": 1, "momentum": 1},
            "kelly_multiplier": 1.0, "description": f"Detection failed: {e}",
        }

    # ── 1. GARCH — now computes P(S_T > start_price) ──────────────────
    try:
        garch_result = garch_probability_up(
            log_returns,
            current_price=current_price,
            start_price=start_price,
        )
        garch_fit = fit_garch(log_returns)
    except Exception as e:
        garch_result = {"p_up": 0.5, "model": "GARCH(1,1)", "error": str(e)}
        garch_fit = {"forecast_vol_per_hour": 0.01, "params": {"nu": 5}}

    # ── 2. Monte Carlo — P(S_T > start_price) ─────────────────────────
    try:
        hourly_vol = garch_fit.get("forecast_vol_per_hour", 0.01)
        nu = garch_fit.get("params", {}).get("nu", 5)
        mc_result = run_simulation(
            current_price=current_price,
            hourly_vol=hourly_vol,
            nu=nu,
            start_price=start_price,
        )
    except Exception as e:
        mc_result = {"p_up": 0.5, "model": "MonteCarlo-StudentT", "error": str(e)}

    # ── 3. Momentum ────────────────────────────────────────────────────
    try:
        mom_result = momentum_probability_up(ohlcv)
    except Exception as e:
        mom_result = {"p_up": 0.5, "model": "MomentumEnsemble", "error": str(e)}

    # ── 4. Bayesian (prior = MC, capped shift) ─────────────────────────
    oi_change_pct = 0.0
    price_change_pct = 0.0
    ls_ratio_val = 1.0
    orderbook_imb = 0.0
    try:
        if data["oi_history"] and len(data["oi_history"]) >= 2:
            recent_oi = float(data["oi_history"][-1].get("sumOpenInterest", 0))
            older_oi = float(
                data["oi_history"][-5].get("sumOpenInterest", recent_oi)
                if len(data["oi_history"]) >= 5
                else data["oi_history"][0].get("sumOpenInterest", recent_oi)
            )
            if older_oi > 0:
                oi_change_pct = ((recent_oi - older_oi) / older_oi) * 100

        if len(ohlcv) >= 5:
            price_change_pct = (
                (float(ohlcv["close"].iloc[-1]) - float(ohlcv["close"].iloc[-5]))
                / float(ohlcv["close"].iloc[-5])
            ) * 100

        if data["long_short_ratio"] and len(data["long_short_ratio"]) > 0:
            ls_ratio_val = float(data["long_short_ratio"][-1].get("longShortRatio", 1.0))

        orderbook_imb = data["orderbook"]["imbalance"] if data["orderbook"] else 0.0

        bayesian_result = bayesian_update(
            prior_p_up=mc_result["p_up"],
            funding_rate=data.get("funding_rate", 0.0),
            orderbook_imbalance=orderbook_imb,
            long_short_ratio=ls_ratio_val,
            oi_change_pct=oi_change_pct,
            price_change_pct=price_change_pct,
        )
    except Exception as e:
        bayesian_result = {"posterior_p_up": mc_result["p_up"], "model": "BayesianUpdate", "error": str(e)}

    # ── 5. Regime-Adjusted Weighted Ensemble ───────────────────────────
    p_garch = garch_result.get("p_up", 0.5)
    p_mc = mc_result.get("p_up", 0.5)
    p_bayesian = bayesian_result.get("posterior_p_up", 0.5)
    p_momentum = mom_result.get("p_up", 0.5)
    raw_probs = [p_garch, p_mc, p_bayesian, p_momentum]

    adj = regime_info["weight_adjustments"]
    w_garch = WEIGHT_GARCH * adj["garch"]
    w_mc = WEIGHT_MC * adj["monte_carlo"]
    w_bayesian = WEIGHT_BAYESIAN * adj["bayesian"]
    w_momentum = WEIGHT_MOMENTUM * adj["momentum"]
    w_total = w_garch + w_mc + w_bayesian + w_momentum
    w_garch /= w_total
    w_mc /= w_total
    w_bayesian /= w_total
    w_momentum /= w_total

    p_up_raw = (
        w_garch * p_garch +
        w_mc * p_mc +
        w_bayesian * p_bayesian +
        w_momentum * p_momentum
    )

    # ── 6. Calibration ─────────────────────────────────────────────────
    p_up = calibrate_probability(p_up_raw)

    # ── 7. Filters ─────────────────────────────────────────────────────
    model_std = float(np.std(raw_probs))
    models_agree = model_std <= MODEL_AGREEMENT_MAX_STD
    recent_vol = regime_info.get("recent_vol", 0.01)
    vol_sufficient = recent_vol >= MIN_HOURLY_VOL
    spread_ok = True if spread is None else spread < 0.04
    time_ok = True
    if minutes_remaining is not None:
        time_ok = minutes_remaining > 5.0  # don't enter 1h in last 5 min

    trade_allowed = models_agree and vol_sufficient and spread_ok and time_ok

    # ── 8. Kelly + EV ──────────────────────────────────────────────────
    mkt_price = market_price if market_price is not None else 0.50
    kelly_result = kelly_criterion(p_up, mkt_price)
    ev_result = compute_ev_gap(p_up, mkt_price)
    kelly_result["regime_kelly_fraction"] = kelly_result["safe_kelly_fraction"] * regime_info["kelly_multiplier"]

    if not trade_allowed:
        kelly_result["side"] = "NONE"
        kelly_result["safe_kelly_fraction"] = 0
        kelly_result["regime_kelly_fraction"] = 0
        kelly_result["has_edge"] = False
        ev_result["action"] = "NO_TRADE"
        reasons = []
        if not models_agree:
            reasons.append(f"Model disagreement: std={model_std:.4f}")
        if not vol_sufficient:
            reasons.append(f"Low vol: {recent_vol:.6f}")
        if not spread_ok:
            reasons.append(f"Wide spread: {spread:.3f}")
        if not time_ok:
            reasons.append(f"Time filter: {minutes_remaining:.1f}m remaining")
        ev_result["block_reason"] = " | ".join(reasons)
        ev_result["confidence"] = "blocked"

    distance_pct = ((current_price - start_price) / start_price * 100) if start_price and start_price > 0 else 0.0

    result = {
        "engine": "1h_quant",
        "timestamp": now,
        "symbol": "BTC",
        "horizon": "1h",
        "current_price_usd": current_price,
        "start_price": start_price,
        "distance_pct": distance_pct,
        "minutes_remaining": minutes_remaining,
        "market_price": mkt_price,
        "p_up_raw": float(p_up_raw),
        "p_up": float(p_up),
        "p_down": float(1 - p_up),
        "calibration": {
            "raw": float(p_up_raw),
            "calibrated": float(p_up),
            "slope": CALIB_SLOPE,
            "intercept": CALIB_INTERCEPT,
        },
        "filters": {
            "models_agree": models_agree,
            "model_std": round(model_std, 4),
            "model_std_threshold": MODEL_AGREEMENT_MAX_STD,
            "vol_sufficient": vol_sufficient,
            "recent_vol": round(recent_vol, 6),
            "min_vol_threshold": MIN_HOURLY_VOL,
            "spread_ok": spread_ok,
            "spread": spread,
            "time_ok": time_ok,
            "regime": regime_info["regime"],
            "regime_kelly_multiplier": regime_info["kelly_multiplier"],
        },
        "trade_allowed": trade_allowed,
        "regime": {
            "name": regime_info["regime"],
            "adx": regime_info["adx"],
            "vol_ratio": regime_info["vol_ratio"],
            "kelly_multiplier": regime_info["kelly_multiplier"],
            "description": regime_info["description"],
            "weight_adjustments": regime_info["weight_adjustments"],
        },
        "models": {
            "garch": {
                "p_up": p_garch,
                "weight": float(w_garch),
                "base_weight": WEIGHT_GARCH,
                "contribution": float(w_garch * p_garch),
                **{k: v for k, v in garch_result.items() if k != "p_up"},
            },
            "monte_carlo": {
                "p_up": p_mc,
                "weight": float(w_mc),
                "base_weight": WEIGHT_MC,
                "contribution": float(w_mc * p_mc),
                **{k: v for k, v in mc_result.items() if k not in ("p_up", "model")},
            },
            "bayesian": {
                "p_up": p_bayesian,
                "weight": float(w_bayesian),
                "base_weight": WEIGHT_BAYESIAN,
                "contribution": float(w_bayesian * p_bayesian),
                "prior": mc_result["p_up"],
                "shift": bayesian_result.get("shift", 0),
                "shift_capped": bayesian_result.get("shift_capped", False),
                "signals": bayesian_result.get("signals", {}),
            },
            "momentum": {
                "p_up": p_momentum,
                "weight": float(w_momentum),
                "base_weight": WEIGHT_MOMENTUM,
                "contribution": float(w_momentum * p_momentum),
                "indicators": mom_result.get("indicators", {}),
            },
        },
        "kelly": kelly_result,
        "ev": ev_result,
        "data_summary": {
            "funding_rate": data.get("funding_rate", 0),
            "orderbook_imbalance": orderbook_imb,
            "best_bid": data["orderbook"]["best_bid"] if data["orderbook"] else 0,
            "best_ask": data["orderbook"]["best_ask"] if data["orderbook"] else 0,
            "open_interest": data["open_interest"]["open_interest"] if data["open_interest"] else 0,
            "long_short_ratio": ls_ratio_val,
            "oi_change_pct": oi_change_pct,
            "price_change_pct": price_change_pct,
        },
        "horizon_hours": MC_HORIZON_HOURS,
    }

    _cache_1h = result
    _cache_1h_ts = now
    return result


# ── UNIFIED DISPATCH ──────────────────────────────────────────────────

async def generate_btc_signal(
    horizon: str = "1h",
    start_price: float | None = None,
    minutes_remaining: float | None = None,
    market_price: float | None = None,
    spread: float | None = None,
) -> dict:
    """Unified signal dispatch — routes to the correct engine.

    Args:
        horizon: "15m" or "1h"
        start_price: BTC price when the market opened.
        minutes_remaining: Minutes until expiry.
        market_price: Polymarket YES price.
        spread: Polymarket bid-ask spread.

    Returns:
        Signal dict from the appropriate engine.
    """
    if horizon == "15m":
        if start_price is None or start_price <= 0:
            return {"error": "start_price required for 15m engine", "engine": "15m_analytical"}
        if minutes_remaining is None:
            minutes_remaining = 15.0  # default
        return await generate_15m_signal(
            start_price=start_price,
            minutes_remaining=minutes_remaining,
            market_price=market_price,
            spread=spread,
        )
    else:
        return await generate_1h_signal(
            start_price=start_price,
            minutes_remaining=minutes_remaining,
            market_price=market_price,
            spread=spread,
        )
