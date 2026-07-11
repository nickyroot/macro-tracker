"""Python port of the deterministic engine (src/lib/portfolio.ts), extended
with as-of-time discipline for vintage-correct evaluation.

Two z-scoring modes:
  full   — each point scored against the FULL sample (exactly what the TS
           engine does; flattering, used only to validate this port against
           the stored track_dynamic series)
  asof   — each point scored against the distribution known at decision time
           (expanding window; the honest mode)
"""

from __future__ import annotations

import math

from .config import (
    ACTIVE_SHARE_CAP,
    ASSETS,
    FFILL_MONTHS,
    MIN_SIGNAL_HISTORY,
    MIN_SIGNALS,
    QUADRANTS,
    SIGMOID_K,
    TILTS,
    GROWTH_SIGNALS,
    INFLATION_SIGNALS,
    Signal,
)


def build_signal_raw(series: dict[int, float], sig: Signal) -> dict[int, float]:
    """kind transforms, replicating buildSignal() in portfolio.ts."""
    raw: dict[int, float] = {}
    for idx, v in series.items():
        if sig.kind == "level":
            raw[idx] = v
        elif sig.kind == "delta":
            prev = series.get(idx - sig.months)
            if prev is not None:
                raw[idx] = v - prev
        else:  # momentum: level minus trailing n-month mean
            window = [series[idx - k] for k in range(1, sig.months + 1) if idx - k in series]
            if len(window) >= sig.months * 0.75:
                raw[idx] = v - sum(window) / len(window)
    return raw


def _z(value: float, dist: list[float]) -> float:
    m = sum(dist) / len(dist)
    sd = math.sqrt(sum((v - m) ** 2 for v in dist) / len(dist))
    return 0.0 if sd == 0 else (value - m) / sd


def signal_z_at(
    raw: dict[int, float], sig: Signal, t: int, mode: str
) -> float | None:
    """z of the latest raw point in [t-FFILL, t], scored per `mode`.
    Returns None if no recent point or not enough history."""
    p = next((t - back for back in range(FFILL_MONTHS + 1) if t - back in raw), None)
    if p is None:
        return None
    if mode == "full":
        dist = list(raw.values())
    else:  # asof: only what was computable by t
        dist = [v for idx, v in raw.items() if idx <= t]
    if len(dist) < MIN_SIGNAL_HISTORY:
        return None
    z = _z(raw[p], dist)
    return -z if sig.invert else z


def composite_at(
    signal_raws: list[tuple[Signal, dict[int, float]]], t: int, min_count: int, mode: str
) -> float | None:
    total_wz = total_w = 0.0
    count = 0
    for sig, raw in signal_raws:
        z = signal_z_at(raw, sig, t, mode)
        if z is None:
            continue
        total_wz += sig.weight * z
        total_w += sig.weight
        count += 1
    return total_wz / total_w if count >= min_count else None


def sigmoid(z: float) -> float:
    return 1.0 / (1.0 + math.exp(-SIGMOID_K * z))


def quadrant_probs(gz: float, iz: float) -> dict[str, float]:
    pg, pi = sigmoid(gz), sigmoid(iz)
    return {
        "goldilocks": pg * (1 - pi),
        "reflation": pg * pi,
        "stagflation": (1 - pg) * pi,
        "bust": (1 - pg) * (1 - pi),
    }


def weights_from_probs(probs: dict[str, float]) -> dict[str, float]:
    """baseline + prob-weighted tilts, then the guardrails — an exact port of
    applyQuadrantTilts + guardrail in portfolio.ts."""
    w = {key: base for key, _, base in ASSETS}
    for q in QUADRANTS:
        for asset, tilt in TILTS[q].items():
            w[asset] += probs[q] * tilt
    for k in w:
        w[k] = max(0.0, w[k])
    baselines = {key: base for key, _, base in ASSETS}
    active = sum(abs(w[k] - baselines[k]) for k in w) / 2
    if active > ACTIVE_SHARE_CAP:
        scale = ACTIVE_SHARE_CAP / active
        for k in w:
            w[k] = baselines[k] + (w[k] - baselines[k]) * scale
    total = sum(w.values())
    for k in w:
        w[k] = w[k] / total * 100.0
    return w


def probs_series(
    metric_series: dict[str, dict[int, float]],
    months: list[int],
    mode: str,
    known_at: dict[str, "callable"] | None = None,
) -> dict[int, dict[str, float]]:
    """Quadrant probabilities per decision month (unsmoothed, matching the
    regimeHistory convention the track record compounds on).

    `known_at`, if given, maps metric_key -> fn(t) returning the series as
    known at t (vintage mode). Otherwise the exported series is used as-is.
    """
    out: dict[int, dict[str, float]] = {}
    for t in months:
        def raws(signals: list[Signal]) -> list[tuple[Signal, dict[int, float]]]:
            pairs = []
            for sig in signals:
                if known_at and sig.metric_key in known_at:
                    series = known_at[sig.metric_key](t)
                else:
                    series = {p: v for p, v in metric_series.get(sig.metric_key, {}).items() if mode == "full" or p <= t}
                raw = build_signal_raw(series, sig)
                if mode == "full" and len(raw) < MIN_SIGNAL_HISTORY:
                    continue  # TS drops thin signals wholesale in full-sample mode
                pairs.append((sig, raw))
            return pairs

        gz = composite_at(raws(GROWTH_SIGNALS), t, MIN_SIGNALS["growth"], mode)
        iz = composite_at(raws(INFLATION_SIGNALS), t, MIN_SIGNALS["inflation"], mode)
        if gz is None or iz is None:
            continue
        out[t] = quadrant_probs(gz, iz)
    return out
