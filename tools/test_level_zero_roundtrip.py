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
    content_max_level,
    first_level,
    is_level,
    level_or_none,
    step_bounded,
)
from app.models import GameSession, Patient, User  # noqa: E402
from app.services import agents, analytics, base_levels  # noqa: E402

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


# ── step_bounded: one step, then into range ──────────────────────────────────
# The JavaScript mirror asserts the same cases. Both must agree.

check("steps up by one", step_bounded(9, 2, "objects"), 3)
check("steps down by one", step_bounded(0, 4, "objects"), 3)
check("holds when proposal equals current", step_bounded(3, 3, "objects"), 3)
check("caps at MAX_LEVEL, no bank ceiling", step_bounded(99, 14, "recall"), 15)
check("never goes below MIN_LEVEL", step_bounded(-5, 0, "memory"), 0)
check("uncalibrated current: bounds only, no step limit", step_bounded(9, None, "naming"), 9)
check("no proposal holds current", step_bounded(None, 3, "memory"), 3)
check("no proposal, uncalibrated stays None", step_bounded(None, None, "memory"), None)
check("unknown game type bounded by MAX_LEVEL", content_max_level("social"), MAX_LEVEL)
check("unknown game type still step limited", step_bounded(9, 1, "social"), 2)

# The top of every bank must stay reachable -- `bankSize - 1` would not.
check("a step up is allowed", step_bounded(4, 3, "recall"), 4)
check("sequencing steps up", step_bounded(4, 3, "sequencing"), 4)
check("naming steps up", step_bounded(5, 4, "naming"), 5)
check("faces steps up", step_bounded(5, 4, "faces"), 5)

# Nothing sits above MAX_LEVEL any more, so this is simply a clamp.
check("above the scale clamps to the top", step_bounded(16, 15, "recall"), 15)
check("holding at the top holds", step_bounded(15, 15, "recall"), 15)


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
            game_type="recall",
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

# Sprint 2 moved base levels into their own store, so sessions no longer imply
# a level. A patient with plenty of play but no calibration reads as
# uncalibrated -- the honest answer, and a different fact from level 0.
levels = analytics._latest_levels(db, patient.id)
check("sessions alone do not imply a base level", levels.get("memory"), None)

all_sessions = (
    db.query(GameSession).filter(GameSession.patient_id == patient.id).all()
)
scores = analytics.domain_scores(db, patient.id, all_sessions)
memory_score = next(d for d in scores if d["domain"] == "memory")
check("an uncalibrated domain reports level None", memory_score["level"], None)

# The Sprint 0 guarantee, now routed through the store: a base level of 0
# stays 0 and is never read as 1 or confused with "not measured".
base_levels.set_level(db, patient.id, "memory", 0, reason="calibration")
db.commit()
check(
    "a STORED level 0 reads back as 0",
    analytics._latest_levels(db, patient.id)["memory"],
    0,
)
memory_score = next(
    d for d in analytics.domain_scores(db, patient.id, all_sessions)
    if d["domain"] == "memory"
)
check("domain_scores reports the stored level 0, not 1", memory_score["level"], 0)
check(
    "0 is not confused with uncalibrated",
    memory_score["level"] == 0 and memory_score["level"] is not None,
    True,
)

# The coach's own read of "where is this patient now".
plan = agents._rule_difficulty_plan(db, patient, lookback=8)
memory_plan = next(p for p in plan["plans"] if p["game_type"] == "recall")
check("rule plan sees current level 0", memory_plan["current_level"], 0)
check("rule plan holds at 0, never below", memory_plan["if_poor"]["level"], 0)
check("rule plan can step up from 0", memory_plan["if_good"]["level"], 1)

# A patient pinned at the ceiling must not walk off it.
for i in range(6):
    db.add(
        GameSession(
            patient_id=patient.id,
            game_type="naming",
            domain="language",
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
objects_plan = next(p for p in plan["plans"] if p["game_type"] == "naming")
# Seeded at MAX_LEVEL: the plan may not propose 16.
check("rule plan cannot exceed MAX_LEVEL", objects_plan["if_good"]["level"], MAX_LEVEL)

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
