"""M2: which regime quadrant will the engine read 3 months from now?

The regime has no external referee (unlike M1's NBER dates): the quadrant is
defined by our own deterministic engine. So the target is the engine's OWN
future reading, computed honestly — the argmax quadrant of the vintage-
correct, as-of-time engine at t+3. Features are the same engine's current
composite z-scores and their 3-month momenta:

  gz, iz            growth / inflation composite z at t (as-of mode)
  gz_d3, iz_d3      3-month change in each composite

Four forecasters, predeclared and walk-forward scored on equal footing:
  - one-vs-rest ridge logits on the features above (the ML challenger)
  - persistence: today's quadrant probabilities reused as the forecast
  - empirical 4x4 transition matrix (Laplace-smoothed counts, expanding)
  - climatology (class base rates)
Same honesty protocol as M1: monthly refits, labels usable only LABEL_LAG
months after the fact, every published point out-of-sample.

RESULT (2026-07, 615 scored months): the ML challenger LOST. Transition
matrix Brier 0.486 / acc 69.6% beat the logit (0.520 / 58.2% — its momentum
features call changes too eagerly) and persistence on calibration (0.573 /
70.9%). Labels are soft (as-of vs full-sample argmax agree only ~67%), so
~70% accuracy is near the label's noise ceiling. Per the earn-your-place
rule the dashboard gets the transition matrix's forecast; the logit stays
here as the challenger to beat, all scorecards in regime.json.

Usage:  uv run python -m macroml.regime      (vintage cache from M0)
Writes ml/out/regime.json and merges ml:regime_* into the shared CSV.
"""

from __future__ import annotations

import json

import numpy as np

from .config import QUADRANTS, VINTAGE_SOURCES
from .data import idx_to_date, load_metric_points, load_observations
from .engine import composites_series, quadrant_probs
from .models import fit_logit, predict_logit, standardize
from .output import OUT_DIR, write_metric_points
from .pit import vintage_known_at

HORIZON = 3          # forecast the engine's quadrant 3 months ahead
LABEL_LAG = 6        # nowcast at s+3 is public by s+4; +2 safety
DELTA = 3            # momentum lookback for the composite features
OOS_START = 1975 * 12
MIN_TRAIN = 120
RIDGE = 1.0
GRID_START = 1950 * 12


def multiclass_scores(y: np.ndarray, P: np.ndarray) -> dict:
    """y: (n,) class indices. P: (n, k) probabilities."""
    n, k = P.shape
    onehot = np.zeros((n, k))
    onehot[np.arange(n), y] = 1.0
    p_true = np.clip(P[np.arange(n), y], 1e-9, None)
    return {
        "accuracy": float((P.argmax(axis=1) == y).mean()),
        "brier": float(((P - onehot) ** 2).sum(axis=1).mean()),
        "log_loss": float(-np.log(p_true).mean()),
    }


def asof_engine(
    metric_points: dict[str, dict[int, float]],
    observations: dict[str, dict[int, float]],
) -> tuple[dict[int, tuple[float, float]], dict[int, int]]:
    """As-of composites and their argmax quadrant index per month — the
    honest regime reading this job and the M3 blend both build on."""
    fns = vintage_known_at(VINTAGE_SOURCES, observations, metric_points)
    keys = {"sahm_rule", "unemployment", "yield_curve", "hy_spread", "indpro_yoy",
            "payems_yoy", "consumer_sentiment", "cpi_yoy", "core_pce_yoy",
            "m2_yoy", "breakeven_10y"}
    t_max = max(max(metric_points[k]) for k in keys if k in metric_points)
    months = list(range(GRID_START, t_max + 1))
    comps = composites_series(metric_points, months, mode="asof", known_at=fns)
    quad = {t: int(np.argmax([quadrant_probs(gz, iz)[q] for q in QUADRANTS]))
            for t, (gz, iz) in comps.items()}
    return comps, quad


def eligible_examples(comps: dict, quad: dict[int, int]) -> dict[int, int]:
    """s -> quadrant at s+HORIZON, for months where the walk-forward's
    feature vector exists (s and s-DELTA in comps) and the label is known."""
    return {s: quad[s + HORIZON] for s in sorted(comps)
            if s - DELTA in comps and s + HORIZON in quad}


def transition_forecast(quad: dict[int, int], labeled: dict[int, int], t: int) -> np.ndarray | None:
    """The published forecaster: Laplace-smoothed expanding transition row
    for t's quadrant, trained on examples embargoed LABEL_LAG months."""
    train_s = [s for s in labeled if s <= t - LABEL_LAG]
    if len(train_s) < MIN_TRAIN or t not in quad:
        return None
    k = len(QUADRANTS)
    counts = np.ones((k, k))
    for s in train_s:
        counts[quad[s], labeled[s]] += 1.0
    return counts[quad[t]] / counts[quad[t]].sum()


def main() -> None:
    metric_points = load_metric_points()
    observations = load_observations()
    comps, quad = asof_engine(metric_points, observations)

    def x_at(t: int) -> list[float] | None:
        if t not in comps or t - DELTA not in comps:
            return None
        gz, iz = comps[t]
        gz0, iz0 = comps[t - DELTA]
        return [gz, iz, gz - gz0, iz - iz0]

    def label(s: int) -> int | None:
        return quad.get(s + HORIZON)

    rows = {s: x for s in sorted(comps) if (x := x_at(s)) is not None}
    labeled = eligible_examples(comps, quad)

    t_last = max(comps)
    k = len(QUADRANTS)
    fc: dict[int, np.ndarray] = {}      # model forecast distributions
    fc_persist: dict[int, np.ndarray] = {}
    fc_trans: dict[int, np.ndarray] = {}
    fc_clim: dict[int, np.ndarray] = {}
    for t in range(OOS_START, t_last + 1):
        train_s = [s for s in labeled if s <= t - LABEL_LAG]
        x_now = x_at(t)
        if len(train_s) < MIN_TRAIN or x_now is None:
            continue
        X = np.array([rows[s] for s in train_s])
        y = np.array([labeled[s] for s in train_s])
        Xs, mu, sd = standardize(X)
        z = (np.array(x_now) - mu) / sd
        p = np.array([predict_logit(fit_logit(Xs, (y == c).astype(float), l2=RIDGE), z)
                      for c in range(k)])
        fc[t] = p / p.sum()

        fc_persist[t] = np.array([quadrant_probs(*comps[t])[q] for q in QUADRANTS])
        fc_trans[t] = transition_forecast(quad, labeled, t)
        fc_clim[t] = np.bincount(y, minlength=k) / len(y)

    scored = [t for t in fc if label(t) is not None]
    y_true = np.array([label(t) for t in scored])
    scores = {}
    for name, f in [("model", fc), ("persistence", fc_persist),
                    ("transition", fc_trans), ("climatology", fc_clim)]:
        scores[name] = multiclass_scores(y_true, np.array([f[t] for t in scored]))

    # Label-robustness FYI: how often does the honest as-of argmax agree with
    # the stored full-sample regime history?
    stored = {t: int(np.argmax([metric_points[f"regime_{q}"].get(t, 0.0) for q in QUADRANTS]))
              for t in quad if all(f"regime_{q}" in metric_points for q in QUADRANTS)
              and any(metric_points[f"regime_{q}"].get(t) is not None for q in QUADRANTS)}
    overlap = [t for t in quad if t in stored]
    agree = float(np.mean([quad[t] == stored[t] for t in overlap])) if overlap else float("nan")

    # Publish the walk-forward winner (transition matrix); the logit is
    # recorded as the challenger. Selection criterion: Brier among the
    # predeclared candidates, per the earn-your-place rule.
    published = fc_trans
    current = published[t_last]
    now_dist = np.array([quadrant_probs(*comps[t_last])[q] for q in QUADRANTS])
    summary = {
        "config": {"horizon_months": HORIZON, "label_lag_months": LABEL_LAG,
                   "challenger_features": ["gz", "iz", f"gz_d{DELTA}", f"iz_d{DELTA}"],
                   "ridge_l2": RIDGE, "oos_start": idx_to_date(OOS_START)},
        "published": "transition",
        "oos_months": len(published), "scored_months": len(scored),
        "label_agreement_asof_vs_stored": agree,
        "scores": scores,
        "current": {
            "date": idx_to_date(t_last),
            "now_quadrant": QUADRANTS[quad[t_last]],
            "now": {q: float(now_dist[i]) for i, q in enumerate(QUADRANTS)},
            "forecast": {q: float(current[i]) for i, q in enumerate(QUADRANTS)},
            "top": QUADRANTS[int(current.argmax())],
        },
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "regime.json").write_text(json.dumps(summary, indent=2))

    out = {f"ml:regime_next_{q}": {t: float(published[t][i]) * 100.0 for t in published}
           for i, q in enumerate(QUADRANTS)}
    for i, q in enumerate(QUADRANTS):
        out[f"ml:regime_now_{q}"] = {t_last: float(now_dist[i]) * 100.0}
    out["ml:regime_next_acc"] = {t_last: scores["transition"]["accuracy"] * 100.0}
    out["ml:regime_next_acc_persist"] = {t_last: scores["persistence"]["accuracy"] * 100.0}
    out["ml:regime_next_brier"] = {t_last: scores["transition"]["brier"]}
    out["ml:regime_next_brier_persist"] = {t_last: scores["persistence"]["brier"]}
    out["ml:regime_next_brier_challenger"] = {t_last: scores["model"]["brier"]}
    write_metric_points(out)

    print(f"walk-forward: {idx_to_date(min(published))} .. {idx_to_date(t_last)} "
          f"({len(published)} decisions, {len(scored)} scored, horizon {HORIZON}m)")
    print(f"as-of vs stored full-sample label agreement: {agree*100:.1f}%")
    for name in ("model", "persistence", "transition", "climatology"):
        s = scores[name]
        star = "  <- published" if name == "transition" else ""
        print(f"{name:<12} acc {s['accuracy']*100:5.1f}%  Brier {s['brier']:.4f}  logloss {s['log_loss']:.4f}{star}")
    now_q, top_q = QUADRANTS[quad[t_last]], QUADRANTS[int(current.argmax())]
    dist = "  ".join(f"{q} {current[i]*100:.0f}%" for i, q in enumerate(QUADRANTS))
    print(f"now: {now_q}  ->  +{HORIZON}m published forecast: {top_q}   ({dist})")


if __name__ == "__main__":
    main()
