"""Point-in-time data from ALFRED (FRED's archival API, same key).

We use output_type=4 = "initial release only": for each period, the value as
FIRST published, plus realtime_start = the date it was published. That gives
release-date-aware, unrevised data in one request per series.

Approximation (documented): transforms like YoY divide two periods' initial
releases rather than one vintage's view of both. Standard practice for cheap
real-time studies; the rigorous alternative (full revision triangles,
output_type=2) can replace this later without changing callers.

Coverage caveat: ALFRED vintages for most series begin in the 1990s. Before a
series' first vintage we fall back to current (revised) values, flagged with
release ~= period end. Decisions scored in the ETF era (2014+) are fully
inside vintage coverage.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

import requests

from .data import month_idx

CACHE_DIR = Path(__file__).resolve().parents[2] / "data" / "vintages"
FRED_OBS = "https://api.stlouisfed.org/fred/series/observations"


def _fetch_initial_releases(code: str) -> list[dict]:
    key = os.environ.get("FRED_API_KEY")
    if not key:
        raise RuntimeError("FRED_API_KEY not set")
    params = {
        "series_id": code,
        "api_key": key,
        "file_type": "json",
        "output_type": "4",  # initial release only
        "realtime_start": "1776-07-04",
        "realtime_end": "9999-12-31",
    }
    r = requests.get(FRED_OBS, params=params, timeout=60)
    r.raise_for_status()
    return r.json()["observations"]


def initial_releases(code: str, refresh: bool = False) -> list[tuple[int, int, float]]:
    """Return [(period_idx, release_idx, value)] for a series, cached on disk.

    period_idx  = month index of the observation period
    release_idx = month index in which that value was first published
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = CACHE_DIR / f"{code}.json"
    if cache.exists() and not refresh:
        raw = json.loads(cache.read_text())
    else:
        raw = _fetch_initial_releases(code)
        cache.write_text(json.dumps(raw))
        time.sleep(0.4)  # stay polite to the API

    out: list[tuple[int, int, float]] = []
    for obs in raw:
        if obs["value"] == ".":
            continue
        out.append((month_idx(obs["date"]), month_idx(obs["realtime_start"]), float(obs["value"])))
    return out


def vintage_series(code: str, current: dict[int, float]) -> list[tuple[int, int, float]]:
    """Initial releases, extended backwards with current data where ALFRED has
    no vintages. Pre-vintage points get release = period + 1 month (the
    typical publication lag), which is optimistic-but-reasonable for deep
    history that only matters through the z-score distribution."""
    releases = initial_releases(code)
    if not releases:
        return [(p, p + 1, v) for p, v in sorted(current.items())]
    first_vintage_period = min(p for p, _, _ in releases)
    backfill = [(p, p + 1, v) for p, v in sorted(current.items()) if p < first_vintage_period]
    return backfill + sorted(releases)
