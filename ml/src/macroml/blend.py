"""M3: return views + Black-Litterman-lite blend. The ML sleeve must EARN
its tilt budget from walk-forward evidence; until it does, the published
mix stays at the All Weather baseline.

PREDECLARED RULES (fixed before any result was seen — do not tune after):

Views, exactly two families:
  V1 regime view (each risky asset): E[next-12m excess return] =
     12 x sum_q P3_q x mean monthly excess return in quadrant q, where P3
     is M2's published transition forecast and cell stats are expanding-
     window on as-of quadrant labels. Cells need >= 12 months; P3 mass is
     renormalised over usable cells and the view is skipped below 50%
     coverage. View variance = 12 x sum_q P3n_q^2 x var_q/n_q, floored at
     (2%)^2. Cash never gets a view.
  V2 valuation view (equities only): expected next-12m excess return from
     an expanding OLS of forward 12m S&P total return (multpl price +
     dividend yield, 1871+) minus cash (fed funds; 3% flat before 1954) on
     the as-of CAPE percentile. 12-month label embargo, >= 240 training
     months before the first prediction, view variance = expanding variance
     of its own out-of-sample residuals (fallback (15%)^2 until 60 exist).

Blend: tau = 0.05, risk aversion delta = 2.5. Sigma = expanding covariance
of monthly excess returns over the joint ETF window (>= 24 months), shrunk
20% to its diagonal, annualised x12, + 1e-4 I ridge. Prior pi = delta x
Sigma x w_base. Posterior tilt w* = w_base + Sigma^-1 (mu - pi) / delta,
guardrailed at the 10pp REFERENCE cap (shorts clipped, renormalised).

Budget: the walk-forward blend (reference cap, monthly rebalance) runs
against the static baseline over the joint ETF era. Live budget =
10pp x clip(IR, 0, 1) with IR = annualised mean excess / annualised
tracking error (IR treated as 0 if TE < 0.1pp/yr). The published live mix
is the posterior tilt re-guardrailed at that earned budget — IR <= 0 means
budget 0 and the published mix IS the baseline. Shipped as computed.

Usage:  uv run python -m macroml.blend        (vintage cache from M0)
Writes ml/out/blend.json and merges ml:view_*/ml:blend_*/ml:bt_blend.
"""

from __future__ import annotations

import json

import numpy as np

from .backtest import compound, stats
from .config import ASSETS
from .data import idx_to_date, load_metric_points, load_observations
from .engine import guardrail
from .output import OUT_DIR, write_metric_points
from .regime import asof_engine, eligible_examples, transition_forecast

ASSET_KEYS = [key for key, _, _ in ASSETS]
ETF_OF = {key: etf for key, etf, _ in ASSETS}
W_BASE = np.array([base for _, _, base in ASSETS]) / 100.0
RISKY = [k for k in ASSET_KEYS if k != "cash"]

REF_CAP = 10.0
TAU = 0.05
DELTA_RA = 2.5
SHRINK = 0.2
COV_RIDGE = 1e-4
MIN_COV_MONTHS = 24
MIN_CELL = 12
MIN_VIEW_MASS = 0.5
VIEW_VAR_FLOOR = 0.02**2
VAL_MIN_TRAIN = 240
VAL_EMBARGO = 12
VAL_SIGMA_FALLBACK = 0.15
CASH_FALLBACK_PCT = 3.0  # flat annual cash proxy before fed funds exists


def monthly_returns(prices: dict[int, float]) -> dict[int, float]:
    return {m: prices[m] / prices[m - 1] - 1.0 for m in prices if m - 1 in prices}


def cash_returns(observations, metric_points) -> dict[int, float]:
    """Monthly cash return: BIL where it exists, else fed funds / 12."""
    bil = monthly_returns(observations.get("BIL", {}))
    ff = metric_points.get("fed_funds", {})
    lo = min(min(ff), min(bil, default=min(ff)))
    hi = max(max(ff), max(bil, default=max(ff)))
    out = {}
    for m in range(lo, hi + 1):
        if m in bil:
            out[m] = bil[m]
        elif m in ff:
            out[m] = ff[m] / 100.0 / 12.0
        else:
            out[m] = CASH_FALLBACK_PCT / 100.0 / 12.0
    return out


def valuation_view(observations, metric_points) -> dict[int, tuple[float, float]]:
    """t -> (expected next-12m equity excess return, view variance), walk-
    forward on the 1871+ S&P total-return series vs as-of CAPE percentile."""
    px = observations.get("SP500_PRICE", {})
    dy = observations.get("SP500_DIVYIELD", {})
    cape = observations.get("SHILLER_CAPE", {})
    if not px or not dy or not cape:
        return {}
    cash = cash_returns(observations, metric_points)
    r_sp = {m: px[m] / px[m - 1] - 1.0 + dy[m] / 100.0 / 12.0
            for m in px if m - 1 in px and m in dy}

    def fwd12_excess(s: int) -> float | None:
        acc_r = acc_c = 1.0
        for k in range(1, 13):
            if s + k not in r_sp:
                return None
            acc_r *= 1.0 + r_sp[s + k]
            acc_c *= 1.0 + cash.get(s + k, CASH_FALLBACK_PCT / 100.0 / 12.0)
        return acc_r - acc_c

    cape_months = sorted(cape)
    pct = {}
    past: list[float] = []
    for m in cape_months:
        past.append(cape[m])
        rank = sum(1 for v in past if v <= cape[m]) / len(past)
        pct[m] = rank * 100.0

    xs, ys, ss = [], [], []
    for s in cape_months:
        y = fwd12_excess(s)
        if y is not None and s in pct:
            xs.append(pct[s])
            ys.append(y)
            ss.append(s)
    xs, ys, ss = np.array(xs), np.array(ys), np.array(ss)

    out = {}
    resid: list[float] = []
    resid_at: list[tuple[int, float]] = []  # (s, oos residual), usable at s+12
    preds: dict[int, float] = {}
    for i, t in enumerate(cape_months):
        train = ss <= t - VAL_EMBARGO
        if train.sum() < VAL_MIN_TRAIN:
            continue
        b, a = np.polyfit(xs[train], ys[train], 1)
        pred = a + b * pct[t]
        preds[t] = pred
        resid = [r for s, r in resid_at if s + VAL_EMBARGO <= t]
        sigma2 = float(np.var(resid)) if len(resid) >= 60 else VAL_SIGMA_FALLBACK**2
        out[t] = (float(pred), sigma2)
        j = np.searchsorted(ss, t)
        if j < len(ss) and ss[j] == t:
            resid_at.append((t, float(ys[j] - pred)))

    # Diagnostics stashed on the function for the caller's report.
    scored = [(t, preds[t]) for t in preds if t in dict(zip(ss.tolist(), ys.tolist()))]
    y_of = dict(zip(ss.tolist(), ys.tolist()))
    if scored:
        errs = np.array([y_of[t] - p for t, p in scored])
        base = np.array([y_of[t] for t, _ in scored])
        valuation_view.diag = {
            "oos_months": len(scored),
            "oos_r2_vs_zero": float(1 - (errs**2).sum() / (base**2).sum()),
            "latest_slope_per_pct": float(np.polyfit(xs, ys, 1)[0]),
        }
    return out


def main() -> None:
    metric_points = load_metric_points()
    observations = load_observations()
    comps, quad = asof_engine(metric_points, observations)
    labeled = eligible_examples(comps, quad)

    cash = cash_returns(observations, metric_points)
    rets = {k: monthly_returns(observations.get(ETF_OF[k], {})) for k in ASSET_KEYS}
    ex = {k: {m: r - cash.get(m, 0.0) for m, r in rets[k].items()} for k in ASSET_KEYS}
    val_view = valuation_view(observations, metric_points)

    def p3_at(t: int) -> np.ndarray | None:
        for back in range(3):
            p = transition_forecast(quad, labeled, t - back)
            if p is not None:
                return p
        return None

    def regime_view(key: str, t: int, p3: np.ndarray) -> tuple[float, float] | None:
        cells = {q: [] for q in range(4)}
        for m, r in ex[key].items():
            if m <= t and m in quad:
                cells[quad[m]].append(r)
        usable = {q: v for q, v in cells.items() if len(v) >= MIN_CELL}
        mass = sum(p3[q] for q in usable)
        if mass < MIN_VIEW_MASS or not usable:
            return None
        e = var = 0.0
        for q, v in usable.items():
            w = p3[q] / mass
            e += w * float(np.mean(v))
            var += w**2 * float(np.var(v)) / len(v)
        return 12.0 * e, max(12.0 * var, VIEW_VAR_FLOOR)

    def posterior_tilt(t: int) -> tuple[np.ndarray, dict] | None:
        joint = sorted(set.intersection(*[set(ex[k]) for k in ASSET_KEYS]))
        joint = [m for m in joint if m <= t]
        if len(joint) < MIN_COV_MONTHS:
            return None
        R = np.array([[ex[k][m] for k in ASSET_KEYS] for m in joint])
        S = np.cov(R.T)
        sigma = 12.0 * ((1 - SHRINK) * S + SHRINK * np.diag(np.diag(S))) + COV_RIDGE * np.eye(len(ASSET_KEYS))
        pi = DELTA_RA * sigma @ W_BASE

        p3 = p3_at(t)
        rows, qs, oms, detail = [], [], [], {}
        for i, k in enumerate(ASSET_KEYS):
            if k == "cash" or p3 is None:
                continue
            v = regime_view(k, t, p3)
            if v is None:
                continue
            row = np.zeros(len(ASSET_KEYS))
            row[i] = 1.0
            rows.append(row)
            qs.append(v[0])
            oms.append(v[1])
            detail[k] = {"regime_view": v[0]}
        if t in val_view:
            row = np.zeros(len(ASSET_KEYS))
            row[ASSET_KEYS.index("equities")] = 1.0
            rows.append(row)
            qs.append(val_view[t][0])
            oms.append(val_view[t][1])
            detail.setdefault("equities", {})["valuation_view"] = val_view[t][0]

        if rows:
            P = np.array(rows)
            omega_inv = np.diag(1.0 / np.array(oms))
            a = np.linalg.inv(TAU * sigma)
            mu = np.linalg.solve(a + P.T @ omega_inv @ P, a @ pi + P.T @ omega_inv @ np.array(qs))
        else:
            mu = pi
        dw = np.linalg.solve(sigma, mu - pi) / DELTA_RA
        return dw, detail

    def weights_at_cap(dw: np.ndarray, cap: float) -> dict[str, float]:
        w = {k: (W_BASE[i] + dw[i]) * 100.0 for i, k in enumerate(ASSET_KEYS)}
        return guardrail(w, cap)

    # --- walk-forward evaluation at the reference cap ---
    prices = {ETF_OF[k]: observations.get(ETF_OF[k], {}) for k in ASSET_KEYS}
    common = sorted(set.intersection(*[set(p.keys()) for p in prices.values()]))
    months = common[:-1]
    weights, views_hist = {}, {}
    for t in months:
        pt = posterior_tilt(t)
        if pt is None:
            continue
        weights[t] = weights_at_cap(pt[0], REF_CAP)
        views_hist[t] = pt[1]
    eval_months = [m for m in months if m >= min(weights)]
    blend_idx = compound(prices, eval_months, weights)
    static_idx = compound(prices, eval_months, None)

    bm = sorted(blend_idx)
    e = np.array([blend_idx[b] / blend_idx[a] - static_idx[b] / static_idx[a]
                  for a, b in zip(bm, bm[1:])])
    te = float(e.std() * 12**0.5)
    ir = 0.0 if te < 0.001 else float(e.mean() * 12 / te)
    budget = REF_CAP * min(max(ir, 0.0), 1.0)

    # --- live mix at the earned budget ---
    t_live = months[-1]
    pt_live = posterior_tilt(common[-1]) or posterior_tilt(t_live)
    dw_live, detail_live = pt_live
    w_ref = weights_at_cap(dw_live, REF_CAP)
    w_live = weights_at_cap(dw_live, budget)

    val_diag = getattr(valuation_view, "diag", {})
    summary = {
        "config": {"ref_cap_pp": REF_CAP, "tau": TAU, "delta": DELTA_RA,
                   "shrink": SHRINK, "min_cell": MIN_CELL,
                   "budget_rule": "10pp x clip(IR_vs_static, 0, 1)"},
        "eval": {"start": idx_to_date(min(blend_idx)), "end": idx_to_date(max(blend_idx)),
                 "months": len(bm) - 1,
                 "blend": stats(blend_idx), "static": stats(static_idx),
                 "tracking_error": te, "information_ratio": ir},
        "budget_pp": budget,
        "valuation_view": val_diag,
        "current": {
            "date": idx_to_date(common[-1]),
            "views_expected_excess_12m": detail_live,
            "weights_reference_cap": w_ref,
            "weights_published": w_live,
        },
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "blend.json").write_text(json.dumps(summary, indent=2))

    out: dict[str, dict[int, float]] = {"ml:bt_blend": blend_idx}
    for k in RISKY:
        ser = {t: v[k]["regime_view"] * 100.0 for t, v in views_hist.items() if k in v}
        if k in detail_live and "regime_view" in detail_live[k]:
            ser[common[-1]] = detail_live[k]["regime_view"] * 100.0
        if ser:
            out[f"ml:view_{k}"] = ser
    for k in ASSET_KEYS:
        out[f"ml:blend_w_{k}"] = {common[-1]: w_live[k]}
        out[f"ml:blend_dir_{k}"] = {common[-1]: w_ref[k] - dict(zip(ASSET_KEYS, W_BASE * 100))[k]}
    out["ml:blend_budget"] = {common[-1]: budget}
    out["ml:blend_ir"] = {common[-1]: ir}
    out["ml:blend_te"] = {common[-1]: te * 100.0}
    out["ml:blend_excess_cagr"] = {common[-1]: (stats(blend_idx)["cagr"] - stats(static_idx)["cagr"]) * 100.0}
    write_metric_points(out)

    fmt = lambda s: (f"CAGR {s['cagr']*100:5.2f}%  vol {s['vol']*100:5.2f}%  "
                     f"maxDD {s['max_drawdown']*100:6.2f}%")
    print(f"eval window: {idx_to_date(min(blend_idx))} .. {idx_to_date(max(blend_idx))} ({len(bm)-1} returns)")
    print(f"blend@{REF_CAP:.0f}pp  {fmt(stats(blend_idx))}")
    print(f"static      {fmt(stats(static_idx))}")
    print(f"TE {te*100:.2f}%/yr  IR {ir:+.2f}  ->  EARNED BUDGET {budget:.1f}pp of {REF_CAP:.0f}pp")
    if val_diag:
        print(f"valuation view: OOS months {val_diag['oos_months']}, "
              f"R^2 vs zero {val_diag['oos_r2_vs_zero']:+.3f}, "
              f"slope {val_diag['latest_slope_per_pct']*100:+.3f}%/pctile")
    print("current views (E[12m excess], %):",
          {k: round(v.get("regime_view", 0) * 100, 1) for k, v in detail_live.items()})
    print("published mix:", {k: round(v, 1) for k, v in w_live.items()})


if __name__ == "__main__":
    main()
