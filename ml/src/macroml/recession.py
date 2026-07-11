"""M1: P(US recession within the next 12 months), walk-forward.

A ridge-logit ("probit" in spirit) on four explainable features:

  curve         10y Treasury minus fed funds (level). 10y-FF instead of the
                dashboard's 10y-3m because DGS10+FEDFUNDS reach back to 1962
                vs 1982 for T10Y3M — three extra recessions of history.
  ff_delta_12m  12-month change in the fed funds rate (tightening cycles).
  sahm_rule     Sahm-rule level; publishes with a one-month lag (handled).
  indpro_yoy    industrial production YoY from ALFRED INITIAL prints — the
                number an observer actually saw, not today's revised history.

Honesty protocol (every plotted point is out-of-sample):
  - Refit monthly on an expanding window. At decision month t, an example s
    is trainable only if s <= t - LABEL_LAG (24m): 12 for the outcome window
    to close + 12 for NBER to have announced any turning point inside it.
  - Features for period s are as first published (initial prints / pub lags);
    the fed funds rate and Treasury yields are observable daily, so treating
    month t's average as known at t is not lookahead.
  - Scored only on months whose outcome window has closed, against a
    curve-only logit (same protocol) and climatology (the base rate known
    at t). The extra features must beat the curve to earn dashboard space.
  - Scoring treats the current USREC vintage as final; the newest scored
    months could re-label if NBER later declares a turning point.

Known result (2026-07): the 4-feature model out-RANKS the curve (AUC .83 vs
.77 — e.g. Mar-2020, when the curve was positive and only Sahm/INDPRO saw
trouble) but its tail probabilities are overconfident (readings >75% realized
~half the time; Brier loses to curve-only, driven by the 2022-25 inversion
false alarm). Reported as-is on the dashboard — no post-hoc re-specification.

Usage:  uv run python -m macroml.recession        (vintage cache from M0;
        set FRED_API_KEY only if ml/data/vintages/ is cold)
Writes ml/out/recession.json and merges ml:recession_* into the shared CSV.
"""

from __future__ import annotations

import json

import numpy as np

from .data import idx_to_date, load_metric_points, load_observations
from .models import auc, brier, fit_logit, log_loss, predict_logit, standardize
from .output import OUT_DIR, write_metric_points
from .pit import vintage_known_at

HORIZON = 12          # label: recession within the next 12 months
NBER_LAG = 12         # months until turning points are reliably in USREC
LABEL_LAG = HORIZON + NBER_LAG
OOS_START = 1976 * 12  # Jan 1976: ~14y of training incl. 1969-70 and 1973-75
FFILL = 2             # months a feature may be stale in a row (pub lags)
MIN_TRAIN = 120
MIN_POS = 10
RIDGE = 1.0

FEATURES = ["curve", "ff_delta_12m", "sahm_rule", "indpro_yoy"]
CURVE_ONLY = ["curve"]
FAR_FUTURE = 10**9


def feature_row(
    series: dict[str, dict[int, float]], names: list[str], s: int
) -> list[float] | None:
    row = []
    for name in names:
        ser = series[name]
        v = next((ser[s - b] for b in range(FFILL + 1) if s - b in ser), None)
        if v is None:
            return None
        row.append(v)
    return row


def fit_and_predict(
    rows: dict[int, list[float]], names: list[str], train_s: list[int],
    y: np.ndarray, x_now: list[float],
) -> tuple[float, np.ndarray]:
    idx = [FEATURES.index(n) for n in names]
    X = np.array([[rows[s][i] for i in idx] for s in train_s])
    Xs, mu, sd = standardize(X)
    beta = fit_logit(Xs, y, l2=RIDGE)
    x = (np.array([x_now[i] for i in idx]) - mu) / sd
    return predict_logit(beta, x), beta


def main() -> None:
    metric_points = load_metric_points()
    observations = load_observations()
    t10, ff = metric_points["treasury_10y"], metric_points["fed_funds"]
    usrec = metric_points["usrec"]

    fns = vintage_known_at({"indpro_yoy": "INDPRO"}, observations, metric_points)
    curve = {p: t10[p] - ff[p] for p in t10 if p in ff}
    ff_d12 = {p: ff[p] - ff[p - 12] for p in ff if p - 12 in ff}

    def known_at(t: int) -> dict[str, dict[int, float]]:
        return {
            "curve": {p: v for p, v in curve.items() if p <= t},
            "ff_delta_12m": {p: v for p, v in ff_d12.items() if p <= t},
            "sahm_rule": fns["sahm_rule"](t),
            "indpro_yoy": fns["indpro_yoy"](t),
        }

    # Training rows are t-invariant (initial prints never change; pub lags
    # are inside LABEL_LAG), so build them once from the full-availability
    # view. Only the PREDICTION row must be rebuilt from known_at(t).
    full = known_at(FAR_FUTURE)
    rows = {}
    for s in sorted(curve):
        row = feature_row(full, FEATURES, s)
        if row is not None:
            rows[s] = row

    last_rec = max(usrec)

    def label(s: int) -> float | None:
        if s + HORIZON > last_rec:
            return None
        hit = any(usrec.get(s + k, 0.0) >= 0.5 for k in range(1, HORIZON + 1))
        return 1.0 if hit else 0.0

    labeled = {s: yv for s in rows if (yv := label(s)) is not None}

    prob: dict[int, float] = {}
    prob_curve: dict[int, float] = {}
    prob_clim: dict[int, float] = {}
    beta_last: np.ndarray | None = None
    t_last = max(curve)
    for t in range(OOS_START, t_last + 1):
        train_s = [s for s in labeled if s <= t - LABEL_LAG]
        y = np.array([labeled[s] for s in train_s])
        if len(train_s) < MIN_TRAIN or y.sum() < MIN_POS:
            continue
        x_now = feature_row(known_at(t), FEATURES, t)
        if x_now is None:
            continue
        prob[t], beta_last = fit_and_predict(rows, FEATURES, train_s, y, x_now)
        prob_curve[t], _ = fit_and_predict(rows, CURVE_ONLY, train_s, y, x_now)
        prob_clim[t] = float(y.mean())

    # Score on out-of-sample months whose outcome window has closed.
    scored = [t for t in prob if label(t) is not None]
    y_true = np.array([label(t) for t in scored])
    scores = {}
    for name, p_of in [("model", prob), ("curve_only", prob_curve), ("climatology", prob_clim)]:
        p = np.array([p_of[t] for t in scored])
        scores[name] = {"auc": auc(y_true, p), "brier": brier(y_true, p), "log_loss": log_loss(y_true, p)}
    scores["climatology"]["auc"] = None  # constant-at-t forecast; AUC not meaningful

    current = prob[max(prob)]
    summary = {
        "config": {
            "features": FEATURES, "horizon_months": HORIZON, "label_lag_months": LABEL_LAG,
            "ridge_l2": RIDGE, "oos_start": idx_to_date(OOS_START),
        },
        "oos_months": len(prob), "scored_months": len(scored),
        "base_rate": float(y_true.mean()),
        "scores": scores,
        "current": {"date": idx_to_date(max(prob)), "prob": current},
        "latest_coefficients_standardized": dict(
            zip(["intercept", *FEATURES], [round(float(b), 4) for b in beta_last])
        ),
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "recession.json").write_text(json.dumps(summary, indent=2))

    stat_date = max(prob)
    write_metric_points({
        "ml:recession_prob": {t: p * 100.0 for t, p in prob.items()},
        "ml:recession_auc": {stat_date: scores["model"]["auc"]},
        "ml:recession_auc_curve": {stat_date: scores["curve_only"]["auc"]},
        "ml:recession_brier": {stat_date: scores["model"]["brier"]},
        "ml:recession_base": {stat_date: float(y_true.mean()) * 100.0},
    })

    print(f"walk-forward: {idx_to_date(min(prob))} .. {idx_to_date(max(prob))} "
          f"({len(prob)} decisions, {len(scored)} scored, base rate {y_true.mean()*100:.1f}%)")
    for name in ("model", "curve_only", "climatology"):
        s = scores[name]
        a = f"{s['auc']:.3f}" if s["auc"] is not None else "  —  "
        print(f"{name:<12} AUC {a}  Brier {s['brier']:.4f}  logloss {s['log_loss']:.4f}")
    print(f"current P(recession within 12m) = {current*100:.1f}%  (as of {idx_to_date(max(prob))})")
    print("standardized betas:", summary["latest_coefficients_standardized"])


if __name__ == "__main__":
    main()
