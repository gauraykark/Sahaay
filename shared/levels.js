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

// ── Content ceiling ─────────────────────────────────────────────────────────
//
//                        >>> REMOVE IN SPRINT 3 <<<
//
// MAX_LEVEL is 15, but the level banks are still the old fixed arrays sized
// for the 1-5 scale. Deleting LEVEL_BOUNDS removed the guard that kept a
// proposed level inside what the banks can actually serve, so this replaces
// it -- in one place, imported by both sides, rather than the two drifting
// copies it replaces.
//
// These are the HIGHEST LEVEL EACH BANK SERVES, not the entry count. The
// banks are 1-indexed (MEMORY_GRIDS starts at key 1, getRoutineForLevel maps
// level-1 to an array index), so a 4-entry bank serves levels 1 through 4 and
// its ceiling is 4, not 3. Capping at `entries - 1` would lock out the top
// level of every game -- including ROUTINE_LEVELS[3], "A full day at home",
// which is the exact content LEVEL_BOUNDS made unreachable the first time.
//
// A game type that is not listed has no bank ceiling and is bounded by
// MAX_LEVEL alone. That is deliberate: the six DSM-5 domains arriving in
// Sprint 4 are generated from the difficulty formula and have no fixed bank.
//
// REMOVE IN SPRINT 3. When difficultyFor(level) replaces the fixed arrays,
// every level 0-15 is servable on demand and this ceiling stops existing --
// stepBounded() must then clamp to MAX_LEVEL alone. If the table survives the
// generator it silently caps the new 0-15 scale at 5, which looks exactly like
// a patient who stopped improving. tools/check_level_parity.py fails the
// moment difficultyFor exists while this table still does.
export const CONTENT_MAX_LEVEL = {
  memory: 4, // MEMORY_GRIDS keys 1-4 (2x2 .. 4x4)
  routine: 4, // ROUTINE_LEVELS, 4 scenarios, 4-16 steps
  objects: 5, // objectsQuestionCount caps at 5 (25 questions)
  "name-recall": 5, // NAME_RECALL_CIRCLES, levels 1-5
};

/** Highest level `gameType`'s bank can serve, or MAX_LEVEL if it has no bank. */
export function contentMaxLevel(gameType) {
  const ceiling = CONTENT_MAX_LEVEL[gameType];
  return ceiling === undefined ? MAX_LEVEL : Math.min(MAX_LEVEL, ceiling);
}

/**
 * Bound a proposed level: at most one step from where the patient is now, then
 * into [MIN_LEVEL, whatever the content can serve].
 *
 * The step limit is here, in ONE definition both runtimes import, because the
 * two independent +/-1 clamps this replaces had already drifted apart and made
 * real content unreachable. It is an interim guard on the per-round coach --
 * the clinical rule it stands in for is "max +/-1 per domain per week", which
 * belongs to the weekly evaluator in Sprint 6. When that lands, this stops
 * being called per round.
 *
 * The content ceiling is a HARD clamp applied after the step limit, so it can
 * move a level down by more than one step -- but only downward, and only for a
 * patient already stored above what their game can serve. That is a one-time
 * correction of an impossible state, not adaptation: there is no level-9 memory
 * board to hand them. It disappears with the ceiling in Sprint 3.
 *
 * An uncalibrated `current` imposes no step limit (there is nothing to step
 * from), only the bounds. A proposal that is not a usable number leaves the
 * patient where they are rather than inventing a level.
 */
export function stepBounded(proposed, current, gameType) {
  const from = levelOrNull(current);
  let next = levelOrNull(proposed);

  if (next === null) return from;

  if (from !== null) {
    if (next > from + 1) next = from + 1;
    if (next < from - 1) next = from - 1;
  }

  return Math.max(MIN_LEVEL, Math.min(contentMaxLevel(gameType), next));
}
