"""Shared writer for ml/out/metric_points.csv.

Multiple jobs (backtest, recession, ...) contribute series to the one CSV the
import bridge reads. Writes are merge-by-key: a job replaces only the keys it
owns and leaves every other job's rows in place, so jobs can run in any order.
"""

from __future__ import annotations

from pathlib import Path

from .data import idx_to_date, month_idx

OUT_DIR = Path(__file__).resolve().parents[2] / "out"
CSV_PATH = OUT_DIR / "metric_points.csv"
HEADER = "metric_key,date,value\n"


def write_metric_points(series: dict[str, dict[int, float]]) -> None:
    """Merge {metric_key: {month_idx: value}} into the shared CSV."""
    for key in series:
        if not key.startswith("ml:"):
            raise ValueError(f"metric keys must be ml:-prefixed, got {key}")

    kept: list[tuple[str, int, float]] = []
    if CSV_PATH.exists():
        for line in CSV_PATH.read_text().splitlines()[1:]:
            key, date, value = line.split(",")
            if key not in series:
                kept.append((key, month_idx(date), float(value)))

    rows = kept + [(k, m, v) for k, s in series.items() for m, v in s.items()]
    rows.sort()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(CSV_PATH, "w") as f:
        f.write(HEADER)
        for key, m, v in rows:
            f.write(f"{key},{idx_to_date(m)},{v:.4f}\n")
