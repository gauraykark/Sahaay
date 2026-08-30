"""Sprint 0 DoD: level 0 survives save -> load -> analytics as 0, not 1.

Three live `or 1` chains used to coerce it (agents.py x2, analytics.py x1).
This drives the real code paths against a throwaway SQLite file, so it fails
if any of them come back.

Run from the repo root:  python tools/test_level_zero_roundtrip.py
"""

from __future__ import annotations

import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

# A throwaway database, and a throwaway secret so Settings() validates. This
# test must never touch the real sahaay.db or read the real .env.
_tmp = Path(tempfile.mkdtemp(prefix="sahaay-sprint0-")) / "test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp.as_posix()}"
os.environ.setdefault("SECRET_KEY", "sprint0-test-only")
os.environ["GROQ_API_KEY"] = ""
os.environ["GEMINI_API_KEY"] = ""

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.levels import (  # noqa: E402
    MAX_LEVEL,
    MIN_LEVEL,
    clamp_level,
    first_level,
    is_level,
    level_or_none,
)
from app.models import GameSession, Patient, User  # noqa: E402
from app.services import agents, analytics  # noqa: E402

passed: list[str] = []
failed: list[str] = []


def check(name: str, got, want) -> None:
    if got == want and type(got) is type(want):
        passed.append(name)
    else:
        failed.append(f"{name}: got {got!r} ({type(got).__name__}), want {want!r}")


# ── Pure helpers ─────────────────────────────────────────────────────────────

check("scale floor is 0", MIN_LEVEL, 0)
check("scale ceiling is 15", MAX_LEVEL, 15)
check("0 is a real level", is_level(0), True)
check("None is not a level", is_level(None), False)
check("16 is not a level", is_level(16), False)
check("True is not a level", is_level(True), False)

check("clamp keeps 0 as 0", clamp_level(0), 0)
check("clamp keeps None as None", clamp_level(None), None)
check("clamp floors -3 to 0", clamp_level(-3), 0)
check("clamp caps 99 at 15", clamp_level(99), 15)

check("level_or_none(0) is 0", level_or_none(0), 0)
check("level_or_none(None) is None", level_or_none(None), None)
check('level_or_none("") is None', level_or_none(""), None)
check('level_or_none("0") is 0', level_or_none("0"), 0)

# The whole point: first_level replaces `a or b or 1`.
check("first_level(0, 3) is 0 not 3", first_level(0, 3), 0)
check("first_level(None, 0) is 0 not 1", first_level(None, 0), 0)
check("first_level(None, None) is None", first_level(None, None), None)


# ── Round trip through the database and analytics ────────────────────────────

Base.metadata.create_all(bind=engine)
db = SessionLocal()

doctor = User(
    name="Test Doctor",
    email="sprint0-doctor@test.local",
    hashed_password="x",
    role="doctor",
)
caregiver = User(
    name="Test Caregiver",
    email="sprint0-caregiver@test.local",
    hashed_password="x",
    role="caregiver",
)
db.add_all([doctor, caregiver])
db.flush()

patient = Patient(
    name="Zero Patient",
    doctor_id=doctor.id,
    caregiver_id=caregiver.id,
    is_demo=True,
)
db.add(patient)
db.flush()

now = datetime.now(timezone.utc).replace(tzinfo=None)
for i in range(6):
    db.add(
        GameSession(
            patient_id=patient.id,
            game_type="memory",
            domain="memory",
            score=2.0,
            total=4.0,
            errors=2,
            level=0,          # a real level 0
            new_level=0,      # stayed at 0
            duration_ms=40000,
            completed=True,
            created_at=now - timedelta(days=i),
        )
    )
db.commit()

reloaded = (
    db.query(GameSession)
    .filter(GameSession.patient_id == patient.id)
    .order_by(GameSession.created_at.desc())
    .first()
)
check("session row stores level 0", reloaded.level, 0)
check("session row stores new_level 0", reloaded.new_level, 0)

levels = analytics._latest_levels(db, patient.id)
check("analytics reads memory level back as 0", levels.get("memory"), 0)

all_sessions = (
    db.query(GameSession).filter(GameSession.patient_id == patient.id).all()
)
scores = analytics.domain_scores(db, patient.id, all_sessions)
memory_score = next(d for d in scores if d["domain"] == "memory")
check("domain_scores reports level 0", memory_score["level"], 0)

# The coach's own read of "where is this patient now".
plan = agents._rule_difficulty_plan(db, patient, lookback=8)
memory_plan = next(p for p in plan["plans"] if p["game_type"] == "memory")
check("rule plan sees current level 0", memory_plan["current_level"], 0)
check("rule plan holds at 0, never below", memory_plan["if_poor"]["level"], 0)
check("rule plan can step up from 0", memory_plan["if_good"]["level"], 1)

# A patient pinned at the ceiling must not walk off it.
for i in range(6):
    db.add(
        GameSession(
            patient_id=patient.id,
            game_type="objects",
            domain="recognition",
            score=15.0,
            total=15.0,
            errors=0,
            level=MAX_LEVEL,
            new_level=MAX_LEVEL,
            duration_ms=30000,
            completed=True,
            created_at=now - timedelta(days=i),
        )
    )
db.commit()
plan = agents._rule_difficulty_plan(db, patient, lookback=8)
objects_plan = next(p for p in plan["plans"] if p["game_type"] == "objects")
check("rule plan caps at 15", objects_plan["if_good"]["level"], MAX_LEVEL)

db.close()

# ── Report ───────────────────────────────────────────────────────────────────

for name in passed:
    print(f"  PASS  {name}")
for line in failed:
    print(f"  FAIL  {line}")

print()
if failed:
    print(f"LEVEL ZERO ROUND TRIP: FAIL ({len(failed)} of {len(passed) + len(failed)})")
    sys.exit(1)
print(f"LEVEL ZERO ROUND TRIP: OK ({len(passed)} checks)")
