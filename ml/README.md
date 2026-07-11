# macroml — local ML workspace (phase 3)

Runs on the Mac with [uv](https://docs.astral.sh/uv/) (self-contained Python,
no Xcode tools needed). The cloud app never runs Python; this workspace talks
to it only through two Node bridges:

```bash
# 1. pull data down (run with prod DATABASE_URL, like the backfill)
npm run ml:export           # -> ml/data/*.csv

# 2. run jobs
cd ml
FRED_API_KEY=... uv run python -m macroml.backtest   # -> ml/out/
uv run python -m macroml.recession                    # -> ml/out/ (M1)

# 3. push results up (only ml:* metric keys are allowed through)
npm run ml:import           # ml/out/metric_points.csv -> metric_points
```

`bash scripts/ml-weekly.sh` runs all three steps; `ml/launchd/` has a plist
that schedules it weekly (Mon 09:00) — install instructions in its comments.

## Modules

- `config.py` — mirror of the TS engine's signals/tilts/guardrails.
  **Keep in sync with `src/lib/portfolio.ts`**; the backtest's full-sample
  mode validates the mirror by reproducing the stored `track_dynamic` series
  exactly (max abs diff printed on every run — it should be ~0).
- `alfred.py` — point-in-time data via ALFRED initial releases
  (`output_type=4`), cached in `ml/data/vintages/`. YoY transforms divide two
  initial prints (documented approximation; full revision triangles can
  replace it later).
- `engine.py` — the engine port with `full` (lookahead, validation-only) and
  `asof` (expanding-window, honest) z-scoring modes.
- `pit.py` — point-in-time access shared by the jobs: per-metric fn(t) →
  series as known at month t (initial prints, publication lags).
- `models.py` — deterministic ridge logistic regression (numpy IRLS, no
  seeds) plus AUC / Brier / log-loss scoring.
- `output.py` — merge-by-key writer for the shared `ml/out/metric_points.csv`
  so jobs can run in any order without clobbering each other.
- `backtest.py` — M0 harness: static vs full-sample vs vintage over the ETF
  era. Writes `ml/out/summary.json` + `ml:bt_*` series for import.
- `recession.py` — M1: walk-forward P(recession within 12m) on curve
  (10y−FF), fed-funds 12m change, Sahm rule, INDPRO initial prints. Monthly
  refits, 24-month label embargo (outcome window + NBER announcement lag).
  Writes `ml/out/recession.json` + `ml:recession_*` for the dashboard panel.

## M0 result (2026-07-09, 2014-12 → 2026-06)

| run | CAGR | vol | maxDD |
|---|---|---|---|
| static All Weather | 5.55% | 8.73% | −22.2% |
| engine, full-sample z | 5.25% | 8.21% | −19.4% |
| engine, vintage-correct | 5.28% | 8.26% | −20.0% |

The tilt engine's −0.27pp excess CAGR is **robust to lookahead** (flattery
≈ −0.03pp): it genuinely trades ~0.3pp of return for ~2pp less drawdown.

## M1 result (2026-07-11, out-of-sample 1976-01 → 2025-06, 594 scored months)

| forecaster | AUC | Brier | log loss |
|---|---|---|---|
| 4-feature model | **0.833** | 0.1442 | 0.4968 |
| curve-only logit | 0.771 | **0.1336** | **0.4431** |
| climatology (base rate 20.9%) | — | 0.1770 | 0.5418 |

Read both columns honestly: the model **ranks** risk better than the curve
alone (it saw Mar-2020 at 40% while the curve was positive), but its tail
probabilities are overconfident — OOS readings above 75% realized only ~53%
of the time, driven by the 2022-25 inversion false alarm (Jun-2024 read 85%).
Reported as-is on the dashboard; no post-hoc re-specification.

## Next milestones

- M2: regime forecaster (P(next quadrant))
- M3: return views + Black-Litterman blend; models earn tilt budget from
  walk-forward evidence produced by this harness.
