// Sprint 0 DoD, client half: level 0 is never coerced to 1.
//
// The Python mirror is tools/test_level_zero_roundtrip.py and it asserts the
// same facts. Both must pass.
//
// Run from the repo root:  node tools/test_levels.mjs

import * as levels from "../shared/levels.js";
import {
  MAX_LEVEL,
  MIN_LEVEL,
  UNCALIBRATED,
  clampLevel,
  contentMaxLevel,
  STARTING_LEVEL,
  isLevel,
  levelForPlay,
  levelOrNull,
  stepBounded,
} from "../shared/levels.js";

const passed = [];
const failed = [];

function check(name, got, want) {
  if (Object.is(got, want)) passed.push(name);
  else failed.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

function ok(name, condition, detail = "") {
  if (condition) passed.push(name);
  else failed.push(detail ? `${name}: ${detail}` : name);
}

check("scale floor is 0", MIN_LEVEL, 0);
check("scale ceiling is 15", MAX_LEVEL, 15);
check("uncalibrated is null, not 0", UNCALIBRATED, null);

check("0 is a real level", isLevel(0), true);
check("15 is a real level", isLevel(15), true);
check("null is not a level", isLevel(null), false);
check("undefined is not a level", isLevel(undefined), false);
check("16 is not a level", isLevel(16), false);
check("-1 is not a level", isLevel(-1), false);
check("2.5 is not a level", isLevel(2.5), false);
check('"3" is not a level', isLevel("3"), false);

check("clamp keeps 0 as 0", clampLevel(0), 0);
check("clamp keeps 15 as 15", clampLevel(15), 15);
check("clamp floors -3 to 0", clampLevel(-3), 0);
check("clamp caps 99 at 15", clampLevel(99), 15);
check("clamp passes null through", clampLevel(null), null);
check("clamp passes undefined through as null", clampLevel(undefined), null);
check("clamp rejects NaN as null", clampLevel(Number.NaN), null);

// The exact failure the old `|| 1` chains produced.
check("levelOrNull(0) is 0, NOT 1", levelOrNull(0), 0);
check('levelOrNull("0") is 0, NOT 1', levelOrNull("0"), 0);
check("levelOrNull(null) is null", levelOrNull(null), null);
check("levelOrNull(undefined) is null", levelOrNull(undefined), null);
check('levelOrNull("") is null', levelOrNull(""), null);
check('levelOrNull("nope") is null', levelOrNull("nope"), null);

// clampLevel does bounds only. Step limiting is the weekly evaluator's job and
// must not be re-implemented here -- two copies of that rule is what broke the
// old model.
check("clamp does not limit step size", clampLevel(12), 12);

// ── stepBounded: one step, then into range ─────────────────────────────────
// The Python mirror asserts the same cases. Both must agree.

check("steps up by one", stepBounded(9, 2, "objects"), 3);
check("steps down by one", stepBounded(0, 4, "objects"), 3);
check("holds when proposal equals current", stepBounded(3, 3, "objects"), 3);
check("no ceiling below MAX_LEVEL any more", contentMaxLevel("memory"), MAX_LEVEL);
check("unknown game types are bounded by MAX_LEVEL", contentMaxLevel("anything"), MAX_LEVEL);
ok(
  "CONTENT_MAX_LEVEL is gone (Sprint 4 deleted the legacy banks)",
  levels.CONTENT_MAX_LEVEL === undefined,
  "the table is still exported and will silently cap the scale"
);
check("a step up near the ceiling is allowed", stepBounded(15, 14, "recall"), 15);
check("MAX_LEVEL is reachable", stepBounded(99, 14, "faces"), 15);

// Nothing sits above MAX_LEVEL any more, so the old downward correction is
// simply a clamp.
check("above the scale clamps to the top", stepBounded(16, 15, "recall"), 15);
check("holding at the top holds", stepBounded(15, 15, "recall"), 15);

// ── The uncalibrated starting level ─────────────────────────────────────────
//
// Serving MIN_LEVEL to an uncalibrated patient is the bug this section exists
// to keep out. At level 0 generateAttention emits noGoRatio 0 -- no red
// stimulus at all, so the instruction lies and every tap scores -- and
// buildExecutive falls to three steps with the next one highlighted. Six
// domains then score a constant 1.0, and a flat line from a task nobody can
// fail is indistinguishable from a flat line from a patient who is fine.

check("uncalibrated plays at STARTING_LEVEL, not the floor", levelForPlay(null), STARTING_LEVEL);
check("undefined is uncalibrated too", levelForPlay(undefined), STARTING_LEVEL);
ok(
  "STARTING_LEVEL is not the floor -- that floor measures nothing",
  STARTING_LEVEL > MIN_LEVEL,
  `STARTING_LEVEL is ${STARTING_LEVEL}`
);
ok(
  "STARTING_LEVEL is not the ceiling -- the spec forbids starting everyone at 15",
  STARTING_LEVEL < MAX_LEVEL,
  `STARTING_LEVEL is ${STARTING_LEVEL}`
);
ok("STARTING_LEVEL is a real level", isLevel(STARTING_LEVEL));

// The whole point of the null/0 distinction: a MEASURED zero is honoured. A
// patient at the bottom of the scale still plays at the bottom of the scale.
check("a measured 0 still plays at 0, not at STARTING_LEVEL", levelForPlay(0), 0);
check("a measured level passes straight through", levelForPlay(11), 11);
check("levelForPlay bounds a silly number", levelForPlay(99), MAX_LEVEL);

// levelForPlay must not write anything back. It resolves at BUILD time only,
// so getDomainLevels() keeps returning null and the report can still say
// "not calibrated" rather than reporting a level nobody measured.
check("levelOrNull is untouched by levelForPlay existing", levelOrNull(null), UNCALIBRATED);

for (const name of passed) console.log(`  PASS  ${name}`);
for (const line of failed) console.log(`  FAIL  ${line}`);

console.log();
if (failed.length) {
  console.log(`SHARED LEVEL SCALE: FAIL (${failed.length} of ${passed.length + failed.length})`);
  process.exit(1);
}
console.log(`SHARED LEVEL SCALE: OK (${passed.length} checks)`);
