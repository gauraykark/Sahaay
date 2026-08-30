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
  isLevel,
  levelOrNull,
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

for (const name of passed) console.log(`  PASS  ${name}`);
for (const line of failed) console.log(`  FAIL  ${line}`);

console.log();
if (failed.length) {
  console.log(`SHARED LEVEL SCALE: FAIL (${failed.length} of ${passed.length + failed.length})`);
  process.exit(1);
}
console.log(`SHARED LEVEL SCALE: OK (${passed.length} checks)`);
