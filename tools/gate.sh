#!/usr/bin/env bash
# Every sprint DoD gate so far, in one command.
#
#   Sprint 0 -- level 0 survives a full round trip, no `or 1` chains remain
#   Sprint 1 -- six DSM-5 domains end to end, report agent describes them
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
run "content overflow, all four banks" node tools/test_content_overflow.mjs
run "six DSM-5 domains" "$PY" tools/test_six_domains.py
run "report agent, six domains" "$PY" tools/test_report_six_domains.py $LIVE

echo
if [ "$status" -ne 0 ]; then
  echo "GATE: FAIL"
  exit 1
fi
echo "GATE: PASS  (sprints 0-1)"
