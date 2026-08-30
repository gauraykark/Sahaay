"""The cognitive level scale -- one definition, both runtimes.

Every level in Sahaay is a single 0-15 number per DSM-5 domain. There is no
per-game range any more: routine 1-4, name-recall 1-5 and this side's old 1-3
clamp all disagreed with each other, and that drift made real content
unreachable through the AI path. Whatever needs a bound imports it here.

The JavaScript mirror is ``shared/levels.js``. If you change one, change both --
they are checked against each other by ``tools/check_level_parity.py``.

Two rules this module exists to enforce:

1. **Level 0 is a real level, not "missing".** It means very severe, and a
   patient sitting at 0 still plays, still scores, still appears on the trend
   line. Never write ``level or 1`` -- 0 is falsy in Python and every level-0
   patient would silently read as level 1. Use ``is None`` instead.

2. **"Uncalibrated" is None, never 0.** A patient who has not been calibrated
   yet has no level; a patient at 0 has the lowest one. Those are different
   facts and the report must be able to tell them apart.
"""

from __future__ import annotations

MIN_LEVEL = 0
MAX_LEVEL = 15

#: A patient who has never been calibrated. Distinct from ``MIN_LEVEL``.
UNCALIBRATED = None


def is_level(value: object) -> bool:
    """True only for a real level: an int inside ``[MIN_LEVEL, MAX_LEVEL]``."""
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and MIN_LEVEL <= value <= MAX_LEVEL
    )


def clamp_level(level: int | float | None) -> int | None:
    """Bound a number to the scale.

    Bounds only -- it deliberately does NOT limit how far a level may move in
    one step. Step limiting is a clinical rule that belongs to the weekly
    evaluator (max +/-1 per domain per week), not to something every caller can
    re-implement slightly differently. Two independent +/-1 clamps is exactly
    the bug this replaces.

    ``None`` passes through unchanged so this can be applied blindly.
    """
    if level is None:
        return UNCALIBRATED
    try:
        n = int(round(float(level)))
    except (TypeError, ValueError):
        return UNCALIBRATED
    return max(MIN_LEVEL, min(MAX_LEVEL, n))


def level_or_none(value: object) -> int | None:
    """Read a level out of a row or payload without ever coercing 0.

    Anything that is not a usable number comes back as ``UNCALIBRATED``.
    """
    if value is None or value == "":
        return UNCALIBRATED
    try:
        return clamp_level(float(value))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return UNCALIBRATED


def first_level(*candidates: object) -> int | None:
    """First candidate that is a real level, else ``UNCALIBRATED``.

    The explicit replacement for ``a or b or 1``. ``first_level(0, 3)`` is 0,
    which is the whole point.
    """
    for candidate in candidates:
        resolved = level_or_none(candidate)
        if resolved is not None:
            return resolved
    return UNCALIBRATED


# ── Content ceiling (TEMPORARY -- remove in Sprint 3) ────────────────────────
#
# Mirror of CONTENT_MAX_LEVEL in shared/levels.js. See that file for the full
# reasoning; the short version is that MAX_LEVEL is 15 but the level banks are
# still the fixed arrays sized for the old 1-5 scale, and deleting LEVEL_BOUNDS
# removed the guard that kept a proposed level inside them.
#
# These are the HIGHEST LEVEL EACH BANK SERVES, not the entry count. The banks
# are 1-indexed, so a 4-entry bank serves levels 1-4 and its ceiling is 4.
#
# DELETE THIS TABLE in Sprint 3, alongside its JavaScript mirror.
CONTENT_MAX_LEVEL = {
    "memory": 4,        # MEMORY_GRIDS keys 1-4 (2x2 .. 4x4)
    "routine": 4,       # ROUTINE_LEVELS, 4 scenarios, 4-16 steps
    "objects": 5,       # objectsQuestionCount caps at 5 (25 questions)
    "name-recall": 5,   # NAME_RECALL_CIRCLES, levels 1-5
}


def content_max_level(game_type: str) -> int:
    """Highest level ``game_type``'s bank serves, or MAX_LEVEL if it has none."""
    ceiling = CONTENT_MAX_LEVEL.get(game_type)
    if ceiling is None:
        return MAX_LEVEL
    return min(MAX_LEVEL, ceiling)


def step_bounded(
    proposed: int | float | None,
    current: int | float | None,
    game_type: str,
) -> int | None:
    """Bound a proposed level: at most one step from current, then into range.

    The step limit lives here, in one definition both runtimes import, because
    the two independent +/-1 clamps this replaces had already drifted apart and
    made real content unreachable. It is an interim guard on the per-round
    coach -- the clinical rule it stands in for is "max +/-1 per domain per
    week", which belongs to the weekly evaluator in Sprint 6.

    The content ceiling is a HARD clamp applied after the step limit, so it can
    move a level down by more than one step -- but only downward, and only for
    a patient already stored above what their game can serve. That is a
    one-time correction of an impossible state, not adaptation: there is no
    level-9 memory board to hand them. It disappears with the ceiling in
    Sprint 3.

    An uncalibrated ``current`` imposes no step limit (there is nothing to step
    from), only the bounds. A proposal that is not a usable number leaves the
    patient where they are rather than inventing a level.
    """
    frm = level_or_none(current)
    nxt = level_or_none(proposed)

    if nxt is None:
        return frm

    if frm is not None:
        nxt = min(nxt, frm + 1)
        nxt = max(nxt, frm - 1)

    return max(MIN_LEVEL, min(content_max_level(game_type), nxt))
