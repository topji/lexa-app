"""Kelly Criterion position sizer and Expected Value calculator.

Kelly Criterion: f* = (p * b - q) / b
Where:
  p = probability of winning
  q = 1 - p = probability of losing
  b = odds (payout ratio, e.g., 1:1 → b=1)
  f* = fraction of bankroll to bet

We use quarter-Kelly (f*/4) for safety — reduces variance while
capturing ~75% of the growth rate.

EV Gap = (p_true - market_price) * payout
Only signal when EV > threshold (default 5%).
"""

from config import KELLY_FRACTION, EV_MIN_EDGE


def kelly_criterion(
    p_true: float,
    market_price: float,
    payout: float = 1.0,
) -> dict:
    """Compute Kelly fraction for a binary market.

    In a binary prediction market:
      - Buy YES at price `market_price` → win `payout - market_price` or lose `market_price`
      - Buy NO at price `1 - market_price` → win `market_price` or lose `1 - market_price`

    Args:
        p_true: Our estimated true probability of YES.
        market_price: Current market price (probability) of YES.
        payout: Payout on correct bet (default $1).

    Returns:
        Dict with kelly fraction, recommended side, EV, edge.
    """
    q_true = 1.0 - p_true

    # Evaluate both sides
    # YES side: risk market_price, gain (payout - market_price)
    yes_b = (payout - market_price) / market_price if market_price > 0 else 0
    yes_kelly = (p_true * yes_b - q_true) / yes_b if yes_b > 0 else 0
    yes_ev = p_true * (payout - market_price) - q_true * market_price

    # NO side: risk (1 - market_price), gain market_price
    no_price = payout - market_price
    no_b = market_price / no_price if no_price > 0 else 0
    no_kelly = (q_true * no_b - p_true) / no_b if no_b > 0 else 0
    no_ev = q_true * market_price - p_true * no_price

    # Pick the side with positive EV
    if yes_ev > no_ev and yes_ev > 0:
        side = "YES"
        raw_kelly = max(0, yes_kelly)
        ev = yes_ev
        edge = p_true - market_price
    elif no_ev > 0:
        side = "NO"
        raw_kelly = max(0, no_kelly)
        ev = no_ev
        edge = (1 - p_true) - (1 - market_price)
    else:
        side = "NONE"
        raw_kelly = 0
        ev = max(yes_ev, no_ev)
        edge = 0

    # Apply fractional Kelly
    safe_kelly = raw_kelly * KELLY_FRACTION

    # Signal strength
    has_edge = abs(edge) >= EV_MIN_EDGE

    return {
        "side": side,
        "raw_kelly_fraction": raw_kelly,
        "safe_kelly_fraction": safe_kelly,
        "ev_per_dollar": ev,
        "edge": edge,
        "edge_pct": edge * 100,
        "has_edge": has_edge,
        "p_true": p_true,
        "market_price": market_price,
        "yes_ev": yes_ev,
        "no_ev": no_ev,
    }


def compute_ev_gap(
    p_true: float,
    market_price: float,
    payout: float = 1.0,
) -> dict:
    """Simple EV gap analysis.

    EV = (p_true - market_price) * payout for YES side
    EV = ((1-p_true) - (1-market_price)) * payout for NO side

    Args:
        p_true: Our model's true probability.
        market_price: Current market YES price.
        payout: Payout amount.

    Returns:
        Dict with ev_gap, recommended action, confidence.
    """
    yes_edge = p_true - market_price
    no_edge = (1 - p_true) - (1 - market_price)  # same magnitude, opposite sign

    ev_yes = yes_edge * payout
    ev_no = no_edge * payout

    if yes_edge > EV_MIN_EDGE:
        return {
            "action": "BUY_YES",
            "ev_gap": ev_yes,
            "edge_pct": yes_edge * 100,
            "confidence": "high" if yes_edge > 0.10 else "medium",
            "market_mispriced_by": f"{yes_edge*100:.1f}%",
        }
    elif no_edge > EV_MIN_EDGE:
        return {
            "action": "BUY_NO",
            "ev_gap": ev_no,
            "edge_pct": no_edge * 100,
            "confidence": "high" if no_edge > 0.10 else "medium",
            "market_mispriced_by": f"{no_edge*100:.1f}%",
        }
    else:
        return {
            "action": "NO_TRADE",
            "ev_gap": max(ev_yes, ev_no),
            "edge_pct": max(yes_edge, no_edge) * 100,
            "confidence": "low",
            "market_mispriced_by": f"{max(yes_edge, no_edge)*100:.1f}%",
        }
