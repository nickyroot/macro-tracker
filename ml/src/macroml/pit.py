"""Point-in-time feature access shared by the walk-forward jobs.

Builds, per metric, a function fn(t) -> {period_idx: value} returning the
series exactly as an observer at month t could have known it:

- Revised metrics (mapped to a FRED source) use ALFRED initial releases;
  YoY metrics divide two initial prints (release = the later of the two).
- The Sahm rule is real-time by construction but publishes with a one-month
  lag: month t's value arrives with month t+1's employment report.
"""

from __future__ import annotations

from collections.abc import Callable

from . import alfred

KnownAt = Callable[[int], dict[int, float]]


def vintage_known_at(
    sources: dict[str, str],
    observations: dict[str, dict[int, float]],
    metric_points: dict[str, dict[int, float]],
) -> dict[str, KnownAt]:
    """`sources` maps metric_key -> FRED source series that gets revised.
    Always includes a "sahm_rule" fn built from current metric points."""
    fns: dict[str, KnownAt] = {}
    for metric_key, source in sources.items():
        vintage = alfred.vintage_series(source, observations.get(source, {}))
        is_yoy = metric_key.endswith("_yoy")
        if is_yoy:
            by_period = {p: (r, v) for p, r, v in vintage}
            rows = []
            for p, (r, v) in sorted(by_period.items()):
                prev = by_period.get(p - 12)
                if prev and prev[1] != 0:
                    rows.append((p, max(r, prev[0]), (v / prev[1] - 1.0) * 100.0))
        else:
            rows = vintage

        def fn(t: int, rows=rows) -> dict[int, float]:
            return {p: v for p, r, v in rows if r <= t and p <= t}

        fns[metric_key] = fn

    sahm = sorted(metric_points.get("sahm_rule", {}).items())

    def sahm_fn(t: int) -> dict[int, float]:
        return {p: v for p, v in sahm if p + 1 <= t}

    fns["sahm_rule"] = sahm_fn
    return fns
