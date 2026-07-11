"""Strategy config — a faithful mirror of src/lib/portfolio.ts.

KEEP IN SYNC with the TypeScript engine. The full-sample backtest mode exists
precisely to catch drift: it must reproduce the TS engine's track_dynamic
series before any vintage-mode result is trusted.
"""

from dataclasses import dataclass

SIGMOID_K = 1.25
SMOOTH_MONTHS = 3  # used by the live engine's headline; history is unsmoothed
FFILL_MONTHS = 2
ACTIVE_SHARE_CAP = 20.0
MIN_SIGNALS = {"growth": 3, "inflation": 2}
MIN_SIGNAL_HISTORY = 24  # a signal needs this many points before it counts


@dataclass(frozen=True)
class Signal:
    name: str
    metric_key: str
    kind: str  # "level" | "delta" | "momentum"
    months: int = 12
    invert: bool = False
    weight: float = 1.0


GROWTH_SIGNALS = [
    Signal("Sahm rule", "sahm_rule", "level", invert=True, weight=1.25),
    Signal("unemployment 12m change", "unemployment", "delta", months=12, invert=True, weight=1.0),
    Signal("yield curve", "yield_curve", "level", weight=1.0),
    Signal("HY spread 6m change", "hy_spread", "delta", months=6, invert=True, weight=1.0),
    Signal("industrial production YoY", "indpro_yoy", "level", weight=1.25),
    Signal("payrolls YoY", "payems_yoy", "level", weight=1.25),
    Signal("sentiment 6m change", "consumer_sentiment", "delta", months=6, weight=0.75),
]

INFLATION_SIGNALS = [
    Signal("CPI momentum", "cpi_yoy", "momentum", months=12, weight=1.25),
    Signal("core PCE level", "core_pce_yoy", "level", weight=1.25),
    Signal("M2 growth", "m2_yoy", "level", weight=0.75),
    Signal("breakeven 6m change", "breakeven_10y", "delta", months=6, weight=1.0),
    Signal("breakeven level", "breakeven_10y", "level", weight=0.75),
]

# (key, ETF, baseline weight in %)
ASSETS = [
    ("equities", "VTI", 30.0),
    ("long_treasuries", "TLT", 40.0),
    ("intermediate_treasuries", "IEF", 15.0),
    ("tips", "SCHP", 0.0),
    ("gold", "GLD", 7.5),
    ("commodities", "PDBC", 7.5),
    ("cash", "BIL", 0.0),
]

QUADRANTS = ["goldilocks", "reflation", "stagflation", "bust"]

TILTS = {
    "goldilocks": {"equities": 10, "long_treasuries": -5, "commodities": -5},
    "reflation": {"commodities": 8, "tips": 5, "gold": 2, "equities": -5, "long_treasuries": -10},
    "bust": {"long_treasuries": 10, "cash": 5, "intermediate_treasuries": 3,
             "equities": -10, "commodities": -5, "gold": -3},
    "stagflation": {"gold": 8, "tips": 8, "cash": 4, "equities": -10, "long_treasuries": -10},
}

# How each signal's underlying data behaves in real time. Metric keys map to
# the FRED source series that gets revised; market-priced series never do.
# SAHMREALTIME is a real-time series by construction. Used by vintage mode.
VINTAGE_SOURCES = {
    "unemployment": "UNRATE",
    "indpro_yoy": "INDPRO",
    "payems_yoy": "PAYEMS",
    "cpi_yoy": "CPIAUCSL",
    "core_pce_yoy": "PCEPILFE",
    "m2_yoy": "M2SL",
    "consumer_sentiment": "UMCSENT",
}
