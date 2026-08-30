// Does a proposed level above the bank ceiling ever produce an undefined index?
//
// Deleting LEVEL_BOUNDS removed the guard that kept a proposed level inside
// what the fixed level banks can serve. This drives a proposed level of 9 --
// well past every bank -- through stepBounded and then through each game's
// real content entry points, and asserts nothing comes back undefined, empty,
// or NaN.
//
// It also pins the ceilings themselves, so a bank that grows or shrinks
// without CONTENT_MAX_LEVEL being updated fails here rather than in a round.
//
// Run from the repo root:  node tools/test_content_overflow.mjs

import {
  CONTENT_MAX_LEVEL,
  MAX_LEVEL,
  contentMaxLevel,
  stepBounded,
} from "../shared/levels.js";
import {
  MEMORY_MAX_LEVEL,
  NAME_RECALL_CIRCLES,
  OBJECTS_MAX_LEVEL,
  ROUTINE_LEVELS,
  dealMemoryCards,
  dealNameRecallQuestions,
  dealObjectQuestions,
  getRoutineForLevel,
  memoryGridDims,
  memoryGridLabel,
  objectsQuestionCount,
} from "../frontend/src/lib/gameContent.js";

const passed = [];
const failed = [];

function check(name, got, want) {
  if (Object.is(got, want)) passed.push(name);
  else failed.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

function ok(name, condition, detail = "") {
  if (condition) passed.push(name);
  else failed.push(`${name}${detail ? `: ${detail}` : ""}`);
}

const OVERFLOW = 9; // the level the brief asks about

// ── 1. The ceilings match the banks they describe ───────────────────────────
//
// Read off the banks themselves, so this fails if a bank changes size and the
// table does not follow.

check("memory ceiling tracks MEMORY_MAX_LEVEL", CONTENT_MAX_LEVEL.memory, MEMORY_MAX_LEVEL);
check("objects ceiling tracks OBJECTS_MAX_LEVEL", CONTENT_MAX_LEVEL.objects, OBJECTS_MAX_LEVEL);
check("routine ceiling tracks ROUTINE_LEVELS length", CONTENT_MAX_LEVEL.routine, ROUTINE_LEVELS.length);
check(
  "name-recall ceiling tracks highest circle",
  CONTENT_MAX_LEVEL["name-recall"],
  Math.max(...NAME_RECALL_CIRCLES.map((c) => c.level))
);

// The top level of every bank must stay reachable. `bankSize - 1` would lock
// out ROUTINE_LEVELS[3] ("A full day at home") -- the same content the old
// LEVEL_BOUNDS made unreachable.
ok(
  "routine level 4 is still reachable",
  stepBounded(4, 3, "routine") === 4,
  `stepBounded(4, 3, "routine") = ${stepBounded(4, 3, "routine")}`
);
check("routine level 4 is the full-day scenario", getRoutineForLevel(4).id, "full-day");
ok(
  "memory level 4 is still reachable",
  stepBounded(4, 3, "memory") === 4,
  `stepBounded(4, 3, "memory") = ${stepBounded(4, 3, "memory")}`
);
check("name-recall level 5 is still reachable", stepBounded(5, 4, "name-recall"), 5);

// ── 2. stepBounded caps the overflow ────────────────────────────────────────

for (const [gameType, ceiling] of Object.entries(CONTENT_MAX_LEVEL)) {
  // Climbing one step at a time from 0 must stop at the ceiling, never pass it.
  let level = 0;
  for (let round = 0; round < 30; round += 1) {
    level = stepBounded(OVERFLOW, level, gameType);
  }
  check(`${gameType}: repeated overflow settles at ceiling`, level, ceiling);
  ok(
    `${gameType}: single overflow proposal never exceeds ceiling`,
    stepBounded(OVERFLOW, ceiling, gameType) <= ceiling
  );
}

check("a game type with no bank is bounded by MAX_LEVEL", contentMaxLevel("attention"), MAX_LEVEL);
check("step limit still applies with no bank", stepBounded(OVERFLOW, 1, "attention"), 2);

// ── 3. The banks themselves, fed the raw overflow level ─────────────────────
//
// Even unbounded -- a stored level from before this guard existed, say -- no
// entry point may return undefined. This is the crash the brief asks about.

const RAW_LEVELS = [OVERFLOW, 15, 99, 0, -1];

for (const level of RAW_LEVELS) {
  const dims = memoryGridDims(level);
  ok(
    `memoryGridDims(${level}) returns a grid`,
    dims != null && Number.isFinite(dims.cols) && Number.isFinite(dims.rows),
    `got ${JSON.stringify(dims)}`
  );

  const cards = dealMemoryCards(level);
  ok(
    `dealMemoryCards(${level}) deals an even, non-empty board`,
    Array.isArray(cards) && cards.length > 0 && cards.length % 2 === 0 &&
      cards.every((c) => c && typeof c.value === "string"),
    `got ${cards?.length} cards`
  );

  ok(
    `memoryGridLabel(${level}) is a real label`,
    typeof memoryGridLabel(level) === "string" && !memoryGridLabel(level).includes("undefined"),
    `got ${memoryGridLabel(level)}`
  );

  const routine = getRoutineForLevel(level);
  ok(
    `getRoutineForLevel(${level}) returns a scenario`,
    routine != null && Array.isArray(routine.items) && routine.items.length > 0 &&
      routine.items.every((s) => s && typeof s.label === "string" && Number.isFinite(s.order)),
    `got ${JSON.stringify(routine?.id)} with ${routine?.items?.length} items`
  );

  ok(
    `objectsQuestionCount(${level}) is a positive count`,
    Number.isFinite(objectsQuestionCount(level)) && objectsQuestionCount(level) > 0,
    `got ${objectsQuestionCount(level)}`
  );

  const objectQs = dealObjectQuestions(level);
  ok(
    `dealObjectQuestions(${level}) deals answerable questions`,
    Array.isArray(objectQs) && objectQs.length > 0 &&
      objectQs.every((q) => q && q.emoji && q.correct && Array.isArray(q.options) &&
        q.options.includes(q.correct)),
    `got ${objectQs?.length} questions`
  );

  const nameQs = dealNameRecallQuestions(level, []);
  ok(
    `dealNameRecallQuestions(${level}) deals answerable questions`,
    Array.isArray(nameQs) && nameQs.length > 0 &&
      nameQs.every((q) => q && typeof q.label === "string" && q.correct &&
        Array.isArray(q.options) && q.options.includes(q.correct)),
    `got ${nameQs?.length} questions`
  );
}

// A caregiver-added person must not break the overflow path either.
const withVault = dealNameRecallQuestions(OVERFLOW, [
  { name: "Rahul", relationship: "Your son", circle: 1 },
]);
ok(
  `dealNameRecallQuestions(${OVERFLOW}, vaultPeople) stays answerable`,
  withVault.length > 0 && withVault.every((q) => q.options.includes(q.correct))
);

for (const name of passed) console.log(`  PASS  ${name}`);
for (const line of failed) console.log(`  FAIL  ${line}`);

console.log();
if (failed.length) {
  console.log(`CONTENT OVERFLOW: FAIL (${failed.length} of ${passed.length + failed.length})`);
  process.exit(1);
}
console.log(`CONTENT OVERFLOW: OK (${passed.length} checks)`);
