"""Sprint 1 DoD: the six DSM-5 domains exist end to end.

Drives the real analytics against a throwaway SQLite file, so it fails if the
four-domain taxonomy comes back anywhere.

Run from the repo root:  python tools/test_six_domains.py
"""

from __future__ import annotations

import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

_tmp = Path(tempfile.mkdtemp(prefix="sahaay-sprint1-")) / "test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp.as_posix()}"
os.environ.setdefault("SECRET_KEY", "sprint1-test-only")
os.environ["GROQ_API_KEY"] = ""
os.environ["GEMINI_API_KEY"] = ""

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.domains import (  # noqa: E402
    DERIVED_DOMAINS,
    DOMAIN_LABELS,
    DOMAINS,
    GAME_TO_DOMAIN,
    GAME_TYPES,
    PLAYABLE_DOMAINS,
    TARGET_GAME_TYPES,
    domain_for_game,
)
from app.models import GameSession, Patient, User  # noqa: E402
from app.services import analytics  # noqa: E402

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
        failed.append(f"{name}{': ' + detail if detail else ''}")


# ── The taxonomy ─────────────────────────────────────────────────────────────

DSM5 = ["attention", "executive", "memory", "language", "perceptual_motor", "social"]

check("exactly six domains", DOMAINS, DSM5)
check("nothing is derived any more", DERIVED_DOMAINS, [])
ok("every domain has a clinician label", all(d in DOMAIN_LABELS for d in DOMAINS))

# The two collapses being undone.
ok(
    "memory and name-recall no longer share a domain",
    GAME_TO_DOMAIN["memory"] != GAME_TO_DOMAIN["name-recall"],
    f'both map to {GAME_TO_DOMAIN["memory"]}',
)
check("routine is executive function", domain_for_game("routine"), "executive")
check("objects is language", domain_for_game("objects"), "language")
check("name-recall is social cognition", domain_for_game("name-recall"), "social")
check("memory is memory", domain_for_game("memory"), "memory")

# An unknown game must not silently inflate memory.
check("unknown game type resolves to None", domain_for_game("does-not-exist"), None)

ok(
    "the six target games cover all six domains, one each",
    sorted(GAME_TO_DOMAIN[g] for g in TARGET_GAME_TYPES) == sorted(DOMAINS),
)
check(
    "PLAYABLE_DOMAINS is what the legacy four can reach",
    PLAYABLE_DOMAINS,
    ["executive", "memory", "language", "social"],
)
ok("attention is not playable yet", "attention" not in PLAYABLE_DOMAINS)
ok("perceptual_motor is not playable yet", "perceptual_motor" not in PLAYABLE_DOMAINS)

ok(
    "attention_score is gone",
    not hasattr(analytics, "attention_score"),
    "the synthesised score is still there",
)


# ── Against real data ────────────────────────────────────────────────────────

Base.metadata.create_all(bind=engine)
db = SessionLocal()

doctor = User(name="D", email="s1-d@test.local", hashed_password="x", role="doctor")
caregiver = User(name="C", email="s1-c@test.local", hashed_password="x", role="caregiver")
db.add_all([doctor, caregiver])
db.flush()

# One patient with data, one with none at all.
played = Patient(name="Has Data", doctor_id=doctor.id, caregiver_id=caregiver.id, is_demo=True)
db.add(played)
db.flush()

caregiver2 = User(name="C2", email="s1-c2@test.local", hashed_password="x", role="caregiver")
db.add(caregiver2)
db.flush()
empty = Patient(name="No Data", doctor_id=doctor.id, caregiver_id=caregiver2.id, is_demo=True)
db.add(empty)
db.flush()

now = datetime.now(timezone.utc).replace(tzinfo=None)
for i, game in enumerate(GAME_TYPES):
    for day in range(6):
        db.add(
            GameSession(
                patient_id=played.id,
                game_type=game,
                domain=domain_for_game(game),
                score=7.0,
                total=10.0,
                errors=3,
                level=3,
                new_level=3,
                duration_ms=45000,
                completed=True,
                created_at=now - timedelta(days=day, hours=i),
            )
        )
db.commit()

sessions = analytics.load_sessions(db, played.id, days=30)
scores = analytics.domain_scores(db, played.id, sessions)

check("domain_scores returns exactly six entries", len(scores), 6)
check("in DSM-5 order", [d["domain"] for d in scores], DSM5)

by_domain = {d["domain"]: d for d in scores}
for domain in PLAYABLE_DOMAINS:
    ok(f"{domain} scored from its own sessions", by_domain[domain]["score"] == 70,
       f'got {by_domain[domain]["score"]}')

# The point of deleting attention_score: an unmeasured domain says so.
for domain in ("attention", "perceptual_motor"):
    check(f"{domain} has no score, not a synthesised one", by_domain[domain]["score"], None)
    check(f"{domain} reports zero sessions", by_domain[domain]["sessions"], 0)
    check(f"{domain} trend is unknown", by_domain[domain]["trend"], "unknown")

# Memory and social must differ now -- they were one number before.
ok(
    "memory and social are separate entries",
    by_domain["memory"]["sessions"] > 0 and by_domain["social"]["sessions"] > 0
    and by_domain["memory"] is not by_domain["social"],
)

# A patient with nothing gets six entries, not an empty list.
empty_scores = analytics.domain_scores(db, empty.id, [])
check("no data still returns six entries", len(empty_scores), 6)
ok("all six score None", all(d["score"] is None for d in empty_scores))
ok("none are omitted", [d["domain"] for d in empty_scores] == DSM5)
ok("score is None, never 0", all(d["score"] != 0 for d in empty_scores))

# The whole card still builds, six domains and all.
card = analytics.build_patient_card(db, played)
check("patient card carries six domains", len(card["domains"]), 6)
ok("card still produces a risk band", card.get("risk") in {"low", "medium", "high"})

# recommended_actions must not point at a game that does not exist.
# A patient who has played every PLAYABLE domain must not be told to go and
# try attention or perceptual-motor -- those games do not exist yet.
actions = analytics.recommended_actions(
    trend="stable", domains=scores, adherence_pct=90, risk="low"
)
ok(
    "no nudge toward an activity that has not been built",
    "Encourage trying the untouched activity types" not in actions,
    f"actions were {actions}",
)

# But a genuinely untouched PLAYABLE domain still earns the nudge.
partial = [dict(d) for d in scores]
next(d for d in partial if d["domain"] == "language")["sessions"] = 0
actions_partial = analytics.recommended_actions(
    trend="stable", domains=partial, adherence_pct=90, risk="low"
)
ok(
    "an untouched playable domain still earns the nudge",
    "Encourage trying the untouched activity types" in actions_partial,
    f"actions were {actions_partial}",
)

db.close()

for name in passed:
    print(f"  PASS  {name}")
for line in failed:
    print(f"  FAIL  {line}")

print()
if failed:
    print(f"SIX DOMAINS: FAIL ({len(failed)} of {len(passed) + len(failed)})")
    sys.exit(1)
print(f"SIX DOMAINS: OK ({len(passed)} checks)")
