"""Quant Backend V2 — Dual-Engine Signal Server for BTC Polymarket.

FastAPI server exposing:
  GET /signal/btc          → dual-engine dispatch (15m analytical or 1h quant ensemble)
  GET /signal/btc/summary  → compact signal for edge trading runner
  GET /health              → health check

Query params (both endpoints):
  horizon          — "15m" or "1h" (default: "1h")
  start_price      — BTC price when the Polymarket market opened
  minutes_remaining — minutes until market expiry
  market_price     — current Polymarket YES price (0-1)
  spread           — current bid-ask spread on Polymarket

When called via the Lexa Node gateway, pass auto_context=1 to merge the latest
synthdata_insights row (from the Lexa worker: Polymarket + Binance, or legacy SynthData):
start_price, Polymarket YES, bid/ask spread, and time remaining.
"""

import time

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from config import API_HOST, API_PORT
from signals.aggregator import generate_btc_signal

app = FastAPI(
    title="Lexa Quant Engine V2",
    description="Dual-engine signal server: 15m analytical + 1h GARCH/MC/Bayesian/Momentum",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_start_time = time.time()


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "uptime_seconds": round(time.time() - _start_time),
        "engine": "quant-backend-v2",
        "engines": ["15m_analytical", "1h_quant"],
    }


@app.get("/signal/btc")
async def signal_btc(
    horizon: str = Query("1h", description="Engine horizon: '15m' (analytical) or '1h' (full quant ensemble)."),
    start_price: float | None = Query(None, description="BTC price when the Polymarket market opened."),
    minutes_remaining: float | None = Query(None, description="Minutes until market expiry."),
    market_price: float | None = Query(None, description="Current Polymarket YES price (0-1)."),
    spread: float | None = Query(None, description="Current Polymarket bid-ask spread."),
):
    """Full BTC signal with all model outputs, Kelly sizing, and EV analysis.

    Routes to the appropriate engine based on `horizon`:
      - "15m" → 15m analytical (boundary crossing, 1m candles, microstructure)
      - "1h"  → 1h quant ensemble (GARCH + MC + Bayesian + Momentum)
    """
    result = await generate_btc_signal(
        horizon=horizon,
        start_price=start_price,
        minutes_remaining=minutes_remaining,
        market_price=market_price,
        spread=spread,
    )
    return result


@app.get("/signal/btc/summary")
async def signal_btc_summary(
    horizon: str = Query("1h", description="Engine horizon: '15m' or '1h'."),
    start_price: float | None = Query(None, description="BTC price when market opened."),
    minutes_remaining: float | None = Query(None, description="Minutes until expiry."),
    market_price: float | None = Query(None, description="Polymarket YES price (0-1)."),
    spread: float | None = Query(None, description="Polymarket bid-ask spread."),
):
    """Compact signal for the edge trading runner.

    Returns only what the runner needs: engine, p_up, side, kelly, ev_gap, has_edge.
    """
    result = await generate_btc_signal(
        horizon=horizon,
        start_price=start_price,
        minutes_remaining=minutes_remaining,
        market_price=market_price,
        spread=spread,
    )

    if "error" in result:
        return result

    kelly = result.get("kelly", {})
    ev = result.get("ev", {})
    filters = result.get("filters", {})
    regime = result.get("regime", {})

    summary = {
        "symbol": "BTC",
        "engine": result.get("engine", "unknown"),
        "horizon": result.get("horizon", horizon),
        "timestamp": result["timestamp"],
        "current_price_usd": result.get("current_price_usd", 0),
        "start_price": result.get("start_price"),
        "distance_pct": result.get("distance_pct", 0),
        "minutes_remaining": result.get("minutes_remaining"),
        "p_up": result["p_up"],
        "p_up_raw": result.get("p_up_raw", result["p_up"]),
        "p_down": result["p_down"],
        "side": kelly.get("side", "NONE"),
        "kelly_fraction": kelly.get("safe_kelly_fraction", 0),
        "regime_kelly_fraction": kelly.get("regime_kelly_fraction", 0),
        "ev_gap": ev.get("ev_gap", 0),
        "edge_pct": ev.get("edge_pct", 0),
        "has_edge": kelly.get("has_edge", False),
        "action": ev.get("action", "NO_TRADE"),
        "confidence": ev.get("confidence", "low"),
        "trade_allowed": result.get("trade_allowed", True),
        "block_reason": ev.get("block_reason", None),
        "market_price": result.get("market_price", 0.5),
    }

    # 1h-specific fields
    if result.get("engine") == "1h_quant":
        summary.update({
            "model_std": filters.get("model_std", 0),
            "models_agree": filters.get("models_agree", True),
            "recent_vol": filters.get("recent_vol", 0),
            "vol_sufficient": filters.get("vol_sufficient", True),
            "regime": regime.get("name", "UNKNOWN"),
            "regime_kelly_multiplier": regime.get("kelly_multiplier", 1.0),
        })

    # 15m-specific fields
    if result.get("engine") == "15m_analytical":
        summary.update({
            "sigma_remaining": result.get("sigma_remaining", 0),
            "sigma_1m": result.get("sigma_1m", 0),
            "vol_sufficient": filters.get("vol_sufficient", True),
            "time_ok": filters.get("time_ok", True),
            "spread_ok": filters.get("spread_ok", True),
        })

    return summary


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=API_HOST, port=API_PORT, reload=True)
