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

# 3. push results up (only ml:* metric keys are allowed through)
npm run ml:import           # ml/out/metric_points.csv -> metric_points
```

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
- `backtest.py` — M0 harness: static vs full-sample vs vintage over the ETF
  era. Writes `ml/out/summary.json` + `ml:bt_*` series for import.

## M0 result (2026-07-09, 2014-12 → 2026-06)

| run | CAGR | vol | maxDD |
|---|---|---|---|
| static All Weather | 5.55% | 8.73% | −22.2% |
| engine, full-sample z | 5.25% | 8.21% | −19.4% |
| engine, vintage-correct | 5.28% | 8.26% | −20.0% |

The tilt engine's −0.27pp excess CAGR is **robust to lookahead** (flattery
≈ −0.03pp): it genuinely trades ~0.3pp of return for ~2pp less drawdown.

## Next milestones

- M1: recession probit (trained here, `ml:recession_prob` to the dashboard)
- M2: regime forecaster (P(next quadrant))
- M3: return views + Black-Litterman blend; models earn tilt budget from
  walk-forward evidence produced by this harness.
