"""Binance public API data fetcher — no API key required.

Fetches:
  - OHLCV (klines) for GARCH + Monte Carlo calibration
  - Order book depth for bid/ask imbalance
  - Funding rate history for sentiment
  - Open interest for positioning
  - Recent liquidations for squeeze detection
"""

import time
from typing import Any

import httpx
import numpy as np
import pandas as pd

from config import BINANCE_BASE, BINANCE_FUTURES_BASE, BTC_SYMBOL

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=15.0)
    return _client


# ── OHLCV ──────────────────────────────────────────────────────────────

async def fetch_ohlcv(
    symbol: str = BTC_SYMBOL,
    interval: str = "1h",
    limit: int = 168,
) -> pd.DataFrame:
    """Fetch hourly candles. Returns DataFrame with columns:
    open_time, open, high, low, close, volume, close_time, quote_volume, trades
    """
    client = _get_client()
    resp = await client.get(
        f"{BINANCE_BASE}/api/v3/klines",
        params={"symbol": symbol, "interval": interval, "limit": limit},
    )
    resp.raise_for_status()
    raw: list[list[Any]] = resp.json()

    df = pd.DataFrame(raw, columns=[
        "open_time", "open", "high", "low", "close", "volume",
        "close_time", "quote_volume", "trades",
        "_taker_buy_base", "_taker_buy_quote", "_ignore",
    ])
    for col in ("open", "high", "low", "close", "volume", "quote_volume"):
        df[col] = df[col].astype(float)
    df["open_time"] = pd.to_datetime(df["open_time"], unit="ms")
    df["close_time"] = pd.to_datetime(df["close_time"], unit="ms")
    return df[["open_time", "open", "high", "low", "close", "volume", "quote_volume", "trades"]]


def compute_log_returns(df: pd.DataFrame) -> np.ndarray:
    """Compute log returns from close prices."""
    closes = df["close"].values
    return np.diff(np.log(closes))


# ── 1-MINUTE OHLCV (for 15m engine) ───────────────────────────────────

async def fetch_ohlcv_1m(
    symbol: str = BTC_SYMBOL,
    limit: int = 100,
) -> pd.DataFrame:
    """Fetch 1-minute candles for the 15m analytical engine.

    Returns last ~100 minutes of 1m candles for high-resolution vol estimation.
    """
    return await fetch_ohlcv(symbol=symbol, interval="1m", limit=limit)


def compute_momentum_3m(df_1m: pd.DataFrame) -> float:
    """Compute 3-minute momentum (log return over last 3 candles)."""
    if len(df_1m) < 4:
        return 0.0
    return float(np.log(df_1m["close"].iloc[-1] / df_1m["close"].iloc[-4]))


def compute_volume_ratio(df_1m: pd.DataFrame, lookback: int = 30) -> float:
    """Compute recent volume vs average volume ratio.

    A ratio > 1.5 means a volume spike is happening.
    """
    if len(df_1m) < lookback + 3:
        return 1.0
    avg_vol = df_1m["volume"].iloc[:-3].tail(lookback).mean()
    recent_vol = df_1m["volume"].iloc[-3:].mean()
    return float(recent_vol / avg_vol) if avg_vol > 0 else 1.0


# ── ORDER BOOK ─────────────────────────────────────────────────────────

async def fetch_orderbook(
    symbol: str = BTC_SYMBOL,
    depth: int = 20,
) -> dict[str, Any]:
    """Fetch top-N bids and asks. Returns raw Binance response + imbalance ratio."""
    client = _get_client()
    resp = await client.get(
        f"{BINANCE_BASE}/api/v3/depth",
        params={"symbol": symbol, "limit": depth},
    )
    resp.raise_for_status()
    data = resp.json()

    bids = sum(float(b[1]) for b in data["bids"])
    asks = sum(float(a[1]) for a in data["asks"])
    total = bids + asks
    imbalance = (bids - asks) / total if total > 0 else 0.0

    return {
        "bid_volume": bids,
        "ask_volume": asks,
        "imbalance": imbalance,  # positive = more bids (bullish), negative = more asks
        "best_bid": float(data["bids"][0][0]) if data["bids"] else 0,
        "best_ask": float(data["asks"][0][0]) if data["asks"] else 0,
    }


# ── FUNDING RATE ───────────────────────────────────────────────────────

async def fetch_funding_rate(symbol: str = BTC_SYMBOL, limit: int = 10) -> list[dict[str, Any]]:
    """Fetch recent funding rate history from Binance Futures."""
    client = _get_client()
    resp = await client.get(
        f"{BINANCE_FUTURES_BASE}/fapi/v1/fundingRate",
        params={"symbol": symbol, "limit": limit},
    )
    resp.raise_for_status()
    return resp.json()


async def get_current_funding_rate(symbol: str = BTC_SYMBOL) -> float:
    """Return the most recent funding rate as a float."""
    rates = await fetch_funding_rate(symbol, limit=1)
    if not rates:
        return 0.0
    return float(rates[-1]["fundingRate"])


# ── OPEN INTEREST ──────────────────────────────────────────────────────

async def fetch_open_interest(symbol: str = BTC_SYMBOL) -> dict[str, float]:
    """Fetch current open interest from Binance Futures."""
    client = _get_client()
    resp = await client.get(
        f"{BINANCE_FUTURES_BASE}/fapi/v1/openInterest",
        params={"symbol": symbol},
    )
    resp.raise_for_status()
    data = resp.json()
    return {
        "open_interest": float(data["openInterest"]),
        "symbol": data["symbol"],
        "time": data.get("time", int(time.time() * 1000)),
    }


async def fetch_open_interest_history(
    symbol: str = BTC_SYMBOL,
    period: str = "1h",
    limit: int = 48,
) -> list[dict[str, Any]]:
    """Fetch OI history for trend detection."""
    client = _get_client()
    resp = await client.get(
        f"{BINANCE_FUTURES_BASE}/futures/data/openInterestHist",
        params={"symbol": symbol, "period": period, "limit": limit},
    )
    resp.raise_for_status()
    return resp.json()


# ── LIQUIDATIONS (via recent aggTrades with large size as proxy) ──────

async def fetch_long_short_ratio(
    symbol: str = BTC_SYMBOL,
    period: str = "1h",
    limit: int = 24,
) -> list[dict[str, Any]]:
    """Fetch top trader long/short ratio — proxy for liquidation pressure."""
    client = _get_client()
    resp = await client.get(
        f"{BINANCE_FUTURES_BASE}/futures/data/topLongShortAccountRatio",
        params={"symbol": symbol, "period": period, "limit": limit},
    )
    resp.raise_for_status()
    return resp.json()


# ── CONVENIENCE: fetch all data in parallel ───────────────────────────

async def fetch_all_btc_data() -> dict[str, Any]:
    """Fetch all BTC data sources in parallel. Returns a dict with all raw data."""
    import asyncio

    ohlcv_task = fetch_ohlcv()
    orderbook_task = fetch_orderbook()
    funding_task = get_current_funding_rate()
    oi_task = fetch_open_interest()
    oi_hist_task = fetch_open_interest_history()
    ls_ratio_task = fetch_long_short_ratio()

    ohlcv, orderbook, funding, oi, oi_hist, ls_ratio = await asyncio.gather(
        ohlcv_task, orderbook_task, funding_task,
        oi_task, oi_hist_task, ls_ratio_task,
        return_exceptions=True,
    )

    result: dict[str, Any] = {}

    if isinstance(ohlcv, pd.DataFrame):
        result["ohlcv"] = ohlcv
        result["log_returns"] = compute_log_returns(ohlcv)
        result["current_price"] = float(ohlcv["close"].iloc[-1])
    else:
        result["ohlcv"] = None
        result["log_returns"] = None
        result["current_price"] = None

    result["orderbook"] = orderbook if not isinstance(orderbook, Exception) else None
    result["funding_rate"] = funding if not isinstance(funding, Exception) else 0.0
    result["open_interest"] = oi if not isinstance(oi, Exception) else None
    result["oi_history"] = oi_hist if not isinstance(oi_hist, Exception) else []
    result["long_short_ratio"] = ls_ratio if not isinstance(ls_ratio, Exception) else []

    return result
