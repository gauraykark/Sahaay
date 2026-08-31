#!/usr/bin/env bash
# Every sprint DoD gate so far, in one command.
#
#   Sprint 0 -- level 0 survives a full round trip, no `or 1` chains remain
#   Sprint 1 -- six DSM-5 domains end to end, report agent describes them
#   Sprint 2 -- six base levels stored both sides, abandons can be written
#   Sprint 3 -- item bank for all six domains, 14-day rotation, generators
#   Sprint 4 -- six games on one shell, errorless, abandons logged
#   Sprint 5 -- session runner: frozen contents, 2/day, 4h gap, 20min cap
#   Sprint 10 -- seed and demo: three patients, 90 days, the right verdict
#
# The Dexie v3->v4 upgrade needs a real IndexedDB, so it is the one check
# that is not in here: run tools/test_dexie_v4.browser.js in the browser.
#
# Run from the repo root:  bash tools/gate.sh
# Add --live to include the LLM integration test (needs a key and network).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PY="backend/venv/Scripts/python.exe"
[ -x "$PY" ] || PY="backend/venv/bin/python"
[ -x "$PY" ] || PY="python"

status=0
LIVE=""
[ "${1:-}" = "--live" ] && LIVE="--live"

run() {
  echo
  echo "=== $1 ==="
  shift
  "$@" || status=1
}

run "level scale parity + falsy-zero sweep" "$PY" tools/check_level_parity.py
run "shared scale, client" node tools/test_levels.mjs
run "level zero round trip, server" "$PY" tools/test_level_zero_roundtrip.py
run "six DSM-5 domains" "$PY" tools/test_six_domains.py
run "report agent, six domains" "$PY" tools/test_report_six_domains.py $LIVE
run "base levels + abandon path" "$PY" tools/test_base_levels.py
run "item bank + rotation" node tools/test_item_bank.mjs
run "session runner + gating" node tools/test_session_runner.mjs
run "tailwind colours resolve" node tools/test_tailwind_colors.mjs
run "voice: once, right language" node tools/test_voice.mjs
run "sync backs off when the server is down" node tools/test_sync_backoff.mjs
run "go/no-go responds to a tap" node tools/test_gonogo_response.mjs
run "schema drift + CORS on errors" "$PY" tools/test_schema_sync.py
run "seed demo: three patients, three verdicts" "$PY" tools/test_seed_demo.py

echo
if [ "$status" -ne 0 ]; then
  echo "GATE: FAIL"
  exit 1
fi
echo "GATE: PASS  (sprints 0-5 + 10; run tools/test_dexie_v4.browser.js for the client half)"
