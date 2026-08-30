#!/usr/bin/env bash
# Sprint 0 definition of done, in one command.
#
#   Level 0 survives a full round trip. No `or 1` chains remain anywhere.
#
# Run from the repo root:  bash tools/sprint0_gate.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PY="backend/venv/Scripts/python.exe"
[ -x "$PY" ] || PY="backend/venv/bin/python"
[ -x "$PY" ] || PY="python"

status=0

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

echo
if [ "$status" -ne 0 ]; then
  echo "SPRINT 0: FAIL"
  exit 1
fi
echo "SPRINT 0: PASS"
