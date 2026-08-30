"""Reading and writing the six stored base levels.

Before this, the server had no level column at all -- it reconstructed a
patient's level by reading the newest session (`agents.py`, `analytics.py`).
That cannot represent six independently moving levels, and it silently coerced
level 0 to 1 on the way through.

Base levels are stored now. One place, both sides reading the same source.

Three rules this module exists to hold:

1. **None is uncalibrated, 0 is measured-and-severe.** Every function here
   preserves that distinction. Nothing defaults a missing level to a number.
2. **Bounds come from app/levels.py**, never from a literal here.
3. **A domain with no row is absent, not zero.** Callers get a dict that may
   be missing keys, and `levels_for` fills the gaps with None explicitly so
   the shape is always six.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ..domains import DOMAINS
from ..levels import clamp_level
from ..models import PatientDomainLevel


def _now() -> datetime:
    return datetime.now(timezone.utc)


def levels_for(db: Session, patient_id: int) -> dict[str, int | None]:
    """The patient's six base levels, always six keys.

    A domain nobody has calibrated maps to None -- not 0, not 1. Callers that
    want to know "has this been measured at all" check `is None`.
    """
    rows = (
        db.query(PatientDomainLevel)
        .filter(PatientDomainLevel.patient_id == patient_id)
        .all()
    )
    stored = {row.domain: row.level for row in rows}
    return {domain: stored.get(domain) for domain in DOMAINS}


def rows_for(db: Session, patient_id: int) -> dict[str, PatientDomainLevel]:
    """The raw rows, keyed by domain, for callers that need reason/source."""
    rows = (
        db.query(PatientDomainLevel)
        .filter(PatientDomainLevel.patient_id == patient_id)
        .all()
    )
    return {row.domain: row for row in rows}


def set_level(
    db: Session,
    patient_id: int,
    domain: str,
    level: int | None,
    reason: str | None = None,
    source: str = "calibration",
) -> PatientDomainLevel:
    """Write one domain's base level. Upsert on (patient_id, domain).

    `level` may be None to mark a domain uncalibrated again -- useful when a
    reseed invalidates a measurement. It is clamped to [MIN_LEVEL, MAX_LEVEL]
    otherwise; a caller that wants a step limit applies step_bounded first,
    because a step limit is a clinical rule and this is storage.
    """
    if domain not in DOMAINS:
        raise ValueError(f"unknown domain {domain!r}")

    row = (
        db.query(PatientDomainLevel)
        .filter(
            PatientDomainLevel.patient_id == patient_id,
            PatientDomainLevel.domain == domain,
        )
        .first()
    )
    bounded = clamp_level(level)

    if row is None:
        row = PatientDomainLevel(
            patient_id=patient_id,
            domain=domain,
            level=bounded,
            reason=reason,
            source=source,
            updated_at=_now(),
        )
        db.add(row)
    else:
        row.level = bounded
        row.reason = reason
        row.source = source
        row.updated_at = _now()

    return row


def set_levels(
    db: Session,
    patient_id: int,
    levels: dict[str, int | None],
    reason: str | None = None,
    source: str = "calibration",
) -> None:
    """Write several domains at once. Domains not named are left alone."""
    for domain, level in levels.items():
        set_level(db, patient_id, domain, level, reason=reason, source=source)


def is_calibrated(db: Session, patient_id: int) -> bool:
    """True once every domain has a real level.

    Deliberately strict: a patient half-calibrated is not calibrated, because
    a report drawn from three measured domains and three guesses is worse than
    one that says "not enough data".
    """
    return all(level is not None for level in levels_for(db, patient_id).values())
