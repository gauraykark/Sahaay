// The cognitive level scale — one definition, both runtimes.
//
// Every level in Sahaay is a single 0–15 number per DSM-5 domain. There is no
// per-game range any more: routine 1–4, name-recall 1–5 and the server's 1–3
// clamp all disagreed with each other, and that drift made real content
// unreachable through the AI path. Whatever needs a bound imports it here.
//
// The Python mirror is backend/app/levels.py. If you change one, change both —
// they are checked against each other by tools/check_level_parity.py.
//
// Two rules this file exists to enforce:
//
//   1. LEVEL 0 IS A REAL LEVEL, NOT "MISSING". It means very severe, and a
//      patient sitting at 0 still plays, still scores, still appears on the
//      trend line. Never write `level || 1`, `if (level)` or `!level` — 0 is
//      falsy in JS and every level-0 patient would silently read as level 1.
//      Use `isLevel(x)` / `x === null` instead.
//
//   2. "Uncalibrated" is null, never 0. A patient who has not been calibrated
//      yet has no level; a patient at 0 has the lowest one. Those are
//      different facts and the report must be able to tell them apart.

export const MIN_LEVEL = 0;
export const MAX_LEVEL = 15;

/** A patient who has never been calibrated. Distinct from MIN_LEVEL. */
export const UNCALIBRATED = null;

/**
 * Where an uncalibrated patient PLAYS until something measures them.
 *
 * This is not a level anybody has been assigned. It is the level the games are
 * built at when the store says `null`, and it is deliberately not MIN_LEVEL.
 *
 * Serving 0 to an uncalibrated patient was a real bug, not a safe default. At
 * level 0 the attention generator emits `noGoRatio === 0` (no red stimulus at
 * all), executive falls to three steps with the next one highlighted, and
 * memory shows two pictures behind a two-second gap. Every domain then scores a
 * near-constant 1.0, which is not "an easy session" -- it is six trend lines
 * measuring nothing, and a flat line from a task nobody can fail is
 * indistinguishable from a flat line from a patient who is doing fine.
 *
 * Mid-scale is the honest placeholder. The spec's calibration (section 3)
 * starts high and drops fast on failure; until that exists, starting at the
 * middle is wrong by at most a few steps in either direction, and the weekly
 * evaluator can walk a patient to their real level from here. Starting at the
 * floor is wrong by up to fifteen and can only walk upwards.
 *
 * INTERIM. Once calibration lands this becomes its starting point rather than
 * a standing default, and a calibrated patient never reads it at all.
 */
export const STARTING_LEVEL = 7;

/**
 * The level to actually build an item at.
 *
 * The one place `null` is allowed to become a number, and it does so WITHOUT
 * writing anything: `getDomainLevels()` keeps returning null, the session row
 * keeps storing null, and the report can still say "not calibrated". Storing
 * STARTING_LEVEL instead would forge a measurement nobody took.
 *
 * Every game-building path goes through here. Scattering `?? MIN_LEVEL` at the
 * call sites is what produced the level-0 sessions in the first place -- four
 * copies of the same decision, none of them stated as one.
 */
export function levelForPlay(level) {
  const stored = levelOrNull(level);
  return stored === null ? STARTING_LEVEL : stored;
}

/** True only for a real level: an integer inside [MIN_LEVEL, MAX_LEVEL]. */
export function isLevel(value) {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_LEVEL &&
    value <= MAX_LEVEL
  );
}

/**
 * Bound a number to the scale. Bounds only — it deliberately does NOT limit
 * how far a level may move in one step. Step limiting is a clinical rule that
 * belongs to the weekly evaluator (max +/-1 per domain per week), not to
 * something every caller can re-implement slightly differently.
 *
 * Returns UNCALIBRATED unchanged so it can be applied blindly.
 */
export function clampLevel(level) {
  if (level === null || level === undefined) return UNCALIBRATED;
  const n = Math.round(Number(level));
  if (Number.isNaN(n)) return UNCALIBRATED;
  return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, n));
}

/**
 * Read a level out of storage or a payload without ever coercing 0.
 * Anything that is not a usable number comes back as UNCALIBRATED.
 */
export function levelOrNull(value) {
  if (value === null || value === undefined || value === "") return UNCALIBRATED;
  const n = Number(value);
  return Number.isFinite(n) ? clampLevel(n) : UNCALIBRATED;
}

// The content ceiling is GONE, as Sprint 3 promised and Sprint 4 delivered.
//
// CONTENT_MAX_LEVEL existed only because the legacy banks were fixed arrays
// that could not serve a level they had no entry for. Those games are deleted;
// every item is now generated or selected from a bank that covers 0-15. A
// ceiling here would silently cap the scale, and a patient pinned at a ceiling
// reads exactly like a patient who stopped improving.
//
// stepBounded now clamps to MAX_LEVEL alone.

/** Kept for callers that still pass a game type. Always MAX_LEVEL. */
export function contentMaxLevel() {
  return MAX_LEVEL;
}

/**
 * Bound a proposed level: at most one step from where the patient is now, then
 * into [MIN_LEVEL, MAX_LEVEL].
 *
 * The step limit lives here, in ONE definition both runtimes import, because
 * the two independent +/-1 clamps this replaced had already drifted apart and
 * made real content unreachable. It is an interim guard on the per-round
 * coach; the clinical rule it stands in for is "max +/-1 per domain per week",
 * which belongs to the weekly evaluator in Sprint 6.
 *
 * An uncalibrated `current` imposes no step limit -- there is nothing to step
 * from -- only the bounds. A proposal that is not a usable number leaves the
 * patient where they are rather than inventing a level.
 */
export function stepBounded(proposed, current) {
  const from = levelOrNull(current);
  let next = levelOrNull(proposed);

  if (next === null) return from;

  if (from !== null) {
    if (next > from + 1) next = from + 1;
    if (next < from - 1) next = from - 1;
  }

  return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, next));
}

// ── The difficulty formula ──────────────────────────────────────────────────
//
// One formula, every domain, every level. No hand-made tables: because it is a
// formula, adding levels costs nothing and the same level means the same thing
// in every game.
//
// The level controls DIFFICULTY AND NOTHING ELSE. It does not decide which
// games appear, swap in other content, or lock anything. A patient at level 0
// still plays, still scores, still appears on the trend line -- their items are
// just two at a time and fully cued. The moment scoring stops their line goes
// flat, and nobody can tell "steady" from "we gave up".
//
// No sub-levels. Granularity comes from these knobs moving inside a level.
export function difficultyFor(level) {
  const l = clampLevel(level) ?? MIN_LEVEL;
  return {
    // 2x2 at level 0, up to 8x8 from level 12.
    gridSize: Math.min(2 + Math.floor(l / 2), 8),
    // 2 items at level 0, 17 at level 15.
    itemCount: 2 + l,
    // Never. Timers create anxiety, and a tired score looks exactly like a
    // declining one. Response time is logged silently instead.
    timerSec: null,
    // How much help is on screen: the word beside the picture, a first letter,
    // or nothing at all.
    cueLevel: l < 5 ? "full" : l < 10 ? "partial" : "none",
  };
}
