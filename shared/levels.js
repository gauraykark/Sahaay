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
