"""Sprint 2 DoD, server half: six base levels persist, abandons can be written.

Run from the repo root:  python tools/test_base_levels.py
"""

from __future__ import annotations

import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

_tmp = Path(tempfile.mkdtemp(prefix="sahaay-sprint2-")) / "test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp.as_posix()}"
os.environ.setdefault("SECRET_KEY", "sprint2-test-only")
os.environ["GROQ_API_KEY"] = ""
os.environ["GEMINI_API_KEY"] = ""

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.domains import DOMAINS  # noqa: E402
from app.levels import MAX_LEVEL  # noqa: E402
from app.models import GameSession, Patient, PatientDomainLevel, User  # noqa: E402
from app.services import analytics, base_levels  # noqa: E402

passed: list[str] = []
failed: list[str] = []


def check(name, got, want) -> None:
    if got == want:
        passed.append(name)
    else:
        failed.append(f"{name}: got {got!r}, want {want!r}")


def ok(name, condition, detail="") -> None:
    if condition:
        passed.append(name)
    else:
        failed.append(f"{name}: {detail}" if detail else name)


Base.metadata.create_all(bind=engine)
db = SessionLocal()

doctor = User(name="D", email="s2-d@t.local", hashed_password="x", role="doctor")
cg1 = User(name="C1", email="s2-c1@t.local", hashed_password="x", role="caregiver")
cg2 = User(name="C2", email="s2-c2@t.local", hashed_password="x", role="caregiver")
db.add_all([doctor, cg1, cg2])
db.flush()
patient = Patient(name="P", doctor_id=doctor.id, caregiver_id=cg1.id, is_demo=True)
fresh = Patient(name="Fresh", doctor_id=doctor.id, caregiver_id=cg2.id, is_demo=True)
db.add_all([patient, fresh])
db.commit()


# -- Uncalibrated is None, and stays None -------------------------------------

levels = base_levels.levels_for(db, fresh.id)
check("a fresh patient still gets six keys", sorted(levels), sorted(DOMAINS))
ok(
    "every one is None, not 0 and not 1",
    all(v is None for v in levels.values()),
    f"got {levels}",
)
check("a fresh patient is not calibrated", base_levels.is_calibrated(db, fresh.id), False)


# -- Writing and reading back -------------------------------------------------

base_levels.set_level(db, patient.id, "memory", 0, reason="calibration")
base_levels.set_level(db, patient.id, "executive", 7)
base_levels.set_level(db, patient.id, "attention", MAX_LEVEL)
db.commit()

stored = base_levels.levels_for(db, patient.id)
check("a stored 0 reads back as 0, NOT None and NOT 1", stored["memory"], 0)
check("a stored 7 reads back as 7", stored["executive"], 7)
check("a stored 15 reads back as 15", stored["attention"], 15)
check("an unwritten domain is still None", stored["language"], None)
check("partially calibrated is not calibrated", base_levels.is_calibrated(db, patient.id), False)

ok(
    "0 and None are distinguishable after a round trip",
    stored["memory"] == 0 and stored["memory"] is not None and stored["language"] is None,
)

base_levels.set_level(db, patient.id, "memory", 1, reason="weekly", source="weekly")
db.commit()
rows = (
    db.query(PatientDomainLevel)
    .filter(
        PatientDomainLevel.patient_id == patient.id,
        PatientDomainLevel.domain == "memory",
    )
    .all()
)
check("writing twice upserts rather than duplicating", len(rows), 1)
check("the new value won", rows[0].level, 1)
check("the reason travelled with it", rows[0].reason, "weekly")

base_levels.set_level(db, patient.id, "social", 99)
base_levels.set_level(db, patient.id, "language", -5)
db.commit()
stored = base_levels.levels_for(db, patient.id)
check("99 is clamped to the ceiling", stored["social"], MAX_LEVEL)
check("-5 is clamped to the floor", stored["language"], 0)

base_levels.set_level(db, patient.id, "social", None, reason="reseed")
db.commit()
check(
    "a domain can be set back to uncalibrated",
    base_levels.levels_for(db, patient.id)["social"],
    None,
)

try:
    base_levels.set_level(db, patient.id, "not_a_domain", 3)
    failed.append("an unknown domain should raise")
except ValueError:
    passed.append("an unknown domain raises rather than writing junk")
db.rollback()


# -- Analytics reads the store, not the newest session ------------------------

base_levels.set_levels(db, patient.id, {d: 4 for d in DOMAINS})
base_levels.set_level(db, patient.id, "memory", 0)
db.commit()

now = datetime.now(timezone.utc).replace(tzinfo=None)
db.add(
    GameSession(
        patient_id=patient.id,
        game_type="memory",
        domain="memory",
        score=8.0,
        total=10.0,
        level=12,
        new_level=13,
        duration_ms=30000,
        completed=True,
        status="completed",
        created_at=now,
    )
)
db.commit()

sessions = analytics.load_sessions(db, patient.id, days=30)
by_domain = {d["domain"]: d for d in analytics.domain_scores(db, patient.id, sessions)}
check("the base level comes from the store, not the session", by_domain["memory"]["level"], 0)
check("other domains read their stored level", by_domain["executive"]["level"], 4)
ok(
    "a session new_level does not overwrite the base level",
    by_domain["memory"]["level"] != 13,
)

base_levels.set_level(db, fresh.id, "memory", None)
db.commit()
fresh_scores = analytics.domain_scores(db, fresh.id, [])
ok(
    "uncalibrated renders as a null level, not 0",
    all(d["level"] is None for d in fresh_scores),
    f"got {[d['level'] for d in fresh_scores]}",
)


# -- Abandoned rounds ---------------------------------------------------------

db.add(
    GameSession(
        patient_id=patient.id,
        game_type="routine",
        domain="executive",
        score=None,
        total=None,
        moves=None,
        errors=None,
        level=4,
        new_level=None,
        duration_ms=8000,
        completed=False,
        status="abandoned",
        item_ids="exec-003,exec-007",
        session_id="sess-abc",
        created_at=now,
    )
)
db.commit()

row = (
    db.query(GameSession)
    .filter(GameSession.patient_id == patient.id, GameSession.status == "abandoned")
    .one()
)
check("an abandoned row saves", row.status, "abandoned")
check("its score is null, NOT zero", row.score, None)
check("its total is null, NOT zero", row.total, None)
check("item ids survive for the rotation check", row.item_ids, "exec-003,exec-007")
check("the session id survives", row.session_id, "sess-abc")

db.add(
    GameSession(
        patient_id=patient.id,
        game_type="objects",
        domain="language",
        score=0.0,
        total=10.0,
        errors=10,
        level=2,
        new_level=2,
        duration_ms=50000,
        completed=True,
        status="completed",
        created_at=now,
    )
)
db.commit()
zero = (
    db.query(GameSession)
    .filter(GameSession.patient_id == patient.id, GameSession.game_type == "objects")
    .one()
)
check("a genuinely scored zero stores as 0", zero.score, 0.0)
ok(
    "scored-zero and unplayed-null are different rows",
    zero.score == 0.0 and row.score is None,
)

sessions = analytics.load_sessions(db, patient.id, days=30)
scored = {d["domain"]: d for d in analytics.domain_scores(db, patient.id, sessions)}
check("a real zero counts as 0%", scored["language"]["score"], 0)
check("an abandoned round contributes no score", scored["executive"]["score"], None)

db.close()

for name in passed:
    print(f"  PASS  {name}")
for line in failed:
    print(f"  FAIL  {line}")

print()
if failed:
    print(f"BASE LEVELS: FAIL ({len(failed)} of {len(passed) + len(failed)})")
    sys.exit(1)
print(f"BASE LEVELS: OK ({len(passed)} checks)")
