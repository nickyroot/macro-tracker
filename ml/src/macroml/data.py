"""Load the CSVs exported by scripts/export-ml-data.ts into dicts of
{month_index: value} keyed series. Month index = year*12 + (month-1),
matching the TS engine's grid."""

from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).resolve().parents[2] / "data"


def month_idx(date_str: str) -> int:
    y, m = int(date_str[0:4]), int(date_str[5:7])
    return y * 12 + (m - 1)


def idx_to_date(idx: int) -> str:
    return f"{idx // 12}-{idx % 12 + 1:02d}-01"


def _load(path: Path, key_col: str) -> dict[str, dict[int, float]]:
    df = pd.read_csv(path, dtype={key_col: str, "date": str, "value": float})
    out: dict[str, dict[int, float]] = {}
    for key, date, value in zip(df[key_col], df["date"], df["value"]):
        out.setdefault(key, {})[month_idx(date)] = float(value)
    return out


def load_metric_points() -> dict[str, dict[int, float]]:
    return _load(DATA_DIR / "metric_points.csv", "metric_key")


def load_observations() -> dict[str, dict[int, float]]:
    return _load(DATA_DIR / "observations.csv", "code")


def etf_prices(observations: dict[str, dict[int, float]]) -> dict[str, dict[int, float]]:
    from .config import ASSETS

    return {etf: observations.get(etf, {}) for _, etf, _ in ASSETS}
