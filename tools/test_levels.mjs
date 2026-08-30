// Sprint 0 DoD, client half: level 0 is never coerced to 1.
//
// The Python mirror is tools/test_level_zero_roundtrip.py and it asserts the
// same facts. Both must pass.
//
// Run from the repo root:  node tools/test_levels.mjs

import {
  MAX_LEVEL,
  MIN_LEVEL,
  UNCALIBRATED,
  clampLevel,
  contentMaxLevel,
  isLevel,
  levelOrNull,
  stepBounded,
} from "../shared/levels.js";

const passed = [];
const failed = [];

function check(name, got, want) {
  if (Object.is(got, want)) passed.push(name);
  else failed.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
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
check("caps at the bank ceiling", stepBounded(9, 4, "memory"), 4);
check("never goes below MIN_LEVEL", stepBounded(-5, 0, "memory"), 0);
check("uncalibrated current: bounds only, no step limit", stepBounded(9, null, "objects"), 5);
check("no proposal leaves the patient where they are", stepBounded(null, 3, "memory"), 3);
check("no proposal and uncalibrated stays uncalibrated", stepBounded(null, null, "memory"), null);
check("unknown game type is bounded by MAX_LEVEL", contentMaxLevel("social"), MAX_LEVEL);
check("unknown game type still gets the step limit", stepBounded(9, 1, "social"), 2);

// The top of every bank must stay reachable -- `bankSize - 1` would not.
check("memory level 4 reachable", stepBounded(4, 3, "memory"), 4);
check("routine level 4 reachable", stepBounded(4, 3, "routine"), 4);
check("objects level 5 reachable", stepBounded(5, 4, "objects"), 5);
check("name-recall level 5 reachable", stepBounded(5, 4, "name-recall"), 5);

// A level stored above the ceiling is an impossible state; correcting it may
// take more than one step, but only downward.
check("above-ceiling level corrects down to playable", stepBounded(16, 15, "memory"), 4);
check("the correction is downward only", stepBounded(15, 15, "memory"), 4);

for (const name of passed) console.log(`  PASS  ${name}`);
for (const line of failed) console.log(`  FAIL  ${line}`);

console.log();
if (failed.length) {
  console.log(`SHARED LEVEL SCALE: FAIL (${failed.length} of ${passed.length + failed.length})`);
  process.exit(1);
}
console.log(`SHARED LEVEL SCALE: OK (${passed.length} checks)`);
