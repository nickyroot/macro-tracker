"""M0 walk-forward harness.

Runs the deterministic strategy three ways over the ETF era and compares:
  static      — the fixed All Weather baseline
  full-sample — the TS engine's exact logic (lookahead z-scores). Must match
                the stored track_dynamic series; that match validates the port.
  vintage     — the honest run: initial-release (ALFRED) data, release-date
                aware, expanding-window z-scores. No lookahead.

Usage:  FRED_API_KEY=... uv run python -m macroml.backtest
Writes ml/out/summary.json and ml/out/metric_points.csv (ml:bt_* series).
"""

from __future__ import annotations

import json

from .config import ASSETS, VINTAGE_SOURCES
from .data import etf_prices, idx_to_date, load_metric_points, load_observations
from .engine import probs_series, weights_from_probs
from .output import OUT_DIR, write_metric_points
from .pit import vintage_known_at


def compound(
    prices: dict[str, dict[int, float]],
    months: list[int],
    weights_at: dict[int, dict[str, float]] | None,
) -> dict[int, float]:
    """Growth of 100, monthly rebalanced. weights_at=None -> static baseline."""
    base_frac = {key: b / 100.0 for key, _, b in ASSETS}
    etf_of = {key: etf for key, etf, _ in ASSETS}
    index = {months[0]: 100.0}
    level = 100.0
    for d0, d1 in zip(months, months[1:]):
        w = weights_at.get(d0) if weights_at is not None else None
        frac = {k: v / 100.0 for k, v in w.items()} if w else base_frac
        ret = 0.0
        for key, _, _ in ASSETS:
            p0, p1 = prices[etf_of[key]][d0], prices[etf_of[key]][d1]
            ret += frac[key] * (p1 / p0 - 1.0)
        level *= 1.0 + ret
        index[d1] = level
    return index


def stats(index: dict[int, float]) -> dict:
    months = sorted(index)
    vals = [index[m] for m in months]
    n = len(vals) - 1
    rets = [vals[i + 1] / vals[i] - 1.0 for i in range(n)]
    mean_r = sum(rets) / n
    vol = (sum((r - mean_r) ** 2 for r in rets) / n) ** 0.5 * (12**0.5)
    peak, mdd = -1e18, 0.0
    for v in vals:
        peak = max(peak, v)
        mdd = min(mdd, v / peak - 1.0)
    return {
        "cagr": (vals[-1] / vals[0]) ** (12.0 / n) - 1.0,
        "total": vals[-1] / vals[0] - 1.0,
        "vol": vol,
        "max_drawdown": mdd,
        "months": n,
        "start": idx_to_date(months[0]),
        "end": idx_to_date(months[-1]),
    }


def main() -> None:
    metric_points = load_metric_points()
    observations = load_observations()
    prices = etf_prices(observations)

    # Scoring window: months where every ETF has a price; drop the current
    # (partial) month so the last return is a complete one.
    common = sorted(set.intersection(*[set(p.keys()) for p in prices.values()]))
    months = common[:-1]
    print(f"scoring window: {idx_to_date(months[0])} .. {idx_to_date(months[-1])} ({len(months)-1} returns)")

    static_idx = compound(prices, months, None)

    # --- full-sample mode: validate the port against the stored TS series ---
    probs_full = probs_series(metric_points, months, mode="full")
    weights_full = {t: weights_from_probs(p) for t, p in probs_full.items()}
    full_idx = compound(prices, months, weights_full)
    stored = metric_points.get("track_dynamic", {})
    overlap = [m for m in months if m in stored]
    max_err = max(abs(full_idx[m] - stored[m]) for m in overlap) if overlap else float("nan")
    print(f"port check vs stored track_dynamic: max abs diff = {max_err:.4f} over {len(overlap)} months")

    # --- vintage mode: the honest run ---
    known_at = vintage_known_at(VINTAGE_SOURCES, observations, metric_points)
    probs_vint = probs_series(metric_points, months, mode="asof", known_at=known_at)
    weights_vint = {t: weights_from_probs(p) for t, p in probs_vint.items()}
    vint_idx = compound(prices, months, weights_vint)

    summary = {
        "port_check_max_abs_diff": max_err,
        "static": stats(static_idx),
        "full_sample": stats(full_idx),
        "vintage": stats(vint_idx),
    }
    summary["excess_cagr_full_vs_static"] = summary["full_sample"]["cagr"] - summary["static"]["cagr"]
    summary["excess_cagr_vintage_vs_static"] = summary["vintage"]["cagr"] - summary["static"]["cagr"]
    summary["lookahead_flattery_cagr"] = summary["full_sample"]["cagr"] - summary["vintage"]["cagr"]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "summary.json").write_text(json.dumps(summary, indent=2))
    write_metric_points({
        "ml:bt_static": static_idx,
        "ml:bt_dynamic_fullsample": full_idx,
        "ml:bt_dynamic_vintage": vint_idx,
    })

    fmt = lambda s: (f"CAGR {s['cagr']*100:5.2f}%  vol {s['vol']*100:5.2f}%  "
                     f"maxDD {s['max_drawdown']*100:6.2f}%  total {s['total']*100:6.1f}%")
    print(f"static       {fmt(summary['static'])}")
    print(f"full-sample  {fmt(summary['full_sample'])}")
    print(f"vintage      {fmt(summary['vintage'])}")
    print(f"excess CAGR vs static: full {summary['excess_cagr_full_vs_static']*100:+.2f}pp | "
          f"vintage {summary['excess_cagr_vintage_vs_static']*100:+.2f}pp | "
          f"lookahead flattery {summary['lookahead_flattery_cagr']*100:+.2f}pp")


if __name__ == "__main__":
    main()
