---
name: quant-system-feedback
description: User feedback on quant-backend improvements - calibration, agreement filter, volatility filter, regime detection
type: feedback
---

User reviewed the quant-backend build and gave specific improvements:

1. Add probability calibration layer (Platt scaling after 50+ samples, simple linear for now)
2. Add model agreement filter — don't trade if std_dev(models) > 4%
3. Add volatility filter — skip trades when BTC is flat (5m vol < threshold)
4. Combine SynthData + Quant signals — 2x bet when both agree
5. Add daily stop loss — max 20% drawdown
6. Log: model_std_dev, disagreement, volatility_at_trade, distance_from_start, time_remaining, spread, orderbook_imbalance
7. For 15m markets, momentum/orderbook/liquidations matter more than full GARCH
8. Add market regime detection (trend/range/high-vol)

**Why:** Raw models are miscalibrated, disagreeing models = noise, flat markets = random outcomes
**How to apply:** Add these as filters/layers in the signal aggregator before outputting final signal
