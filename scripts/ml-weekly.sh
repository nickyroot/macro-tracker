#!/bin/bash
# Weekly local ML refresh: pull prod data down, rerun the phase-3 jobs on
# this Mac, push ml:* results back up. Installed as a launchd agent — see
# ml/launchd/com.nickroot.macroml.weekly.plist (logs to ml/out/weekly.log).
# Safe to run by hand:  bash scripts/ml-weekly.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
mkdir -p ml/out

echo "== $(date '+%Y-%m-%d %H:%M:%S') ml-weekly start"
set -a
source .env                 # FRED_API_KEY (ALFRED vintage refresh)
source .env.prod-db.local   # prod DATABASE_URL overrides .env's local one
set +a

npm run ml:export
(cd ml && uv run python -m macroml.backtest && uv run python -m macroml.recession)
npm run ml:import
echo "== $(date '+%Y-%m-%d %H:%M:%S') ml-weekly done"
