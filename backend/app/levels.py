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
