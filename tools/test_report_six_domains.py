"""Sprint 1 integration: the report agent describes six domains, prompt untouched.

The report prompt hardcodes no domain names -- it renders whatever
analytics.domain_scores() hands it. This proves that claim rather than
asserting it, by building the exact prompt input the chain receives and, when
a key is configured, calling the live chain.

Reads the real .env from backend/, so run it from the repo root:

    python tools/test_report_six_domains.py           # offline path only
    python tools/test_report_six_domains.py --live    # also calls the LLM
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

LIVE = "--live" in sys.argv

# The model writes real prose -- en dashes, non-breaking hyphens, Assamese.
# The Windows console defaults to cp1252 and raises on all of it.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

_tmp = Path(tempfile.mkdtemp(prefix="sahaay-sprint1-report-")) / "test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp.as_posix()}"
os.environ.setdefault("SECRET_KEY", "sprint1-test-only")
if not LIVE:
    # Force the offline path so the default run needs no network and no key.
    os.environ["GROQ_API_KEY"] = ""
    os.environ["GEMINI_API_KEY"] = ""
else:
    # Settings reads .env relative to CWD, so run from backend/ for the keys.
    os.chdir(ROOT / "backend")

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.domains import DOMAIN_LABELS, DOMAINS, GAME_TYPES, domain_for_game  # noqa: E402
from app.models import GameSession, Patient, User  # noqa: E402
from app.services import agents, analytics  # noqa: E402

passed: list[str] = []
failed: list[str] = []


def ok(name, condition, detail="") -> None:
    (passed if condition else failed).append(
        name if condition else f"{name}{': ' + detail if detail else ''}"
    )


# ── The prompt itself must not name any domain ───────────────────────────────

prompt_src = (ROOT / "backend/app/services/prompts.py").read_text(encoding="utf-8")
report_prompt = prompt_src[prompt_src.index("REPORT_SYSTEM") :]
# "Language" is also the name of the OUTPUT language instruction ("write
# everything in {language}"), so a naive substring scan flags it. Check every
# other label directly, and check that one by sense.
for label in DOMAIN_LABELS.values():
    if label == "Language":
        continue
    ok(
        f"report prompt does not hardcode {label!r}",
        label.lower() not in report_prompt.lower(),
    )

language_lines = [
    line for line in report_prompt.splitlines() if "language" in line.lower()
]
ok(
    "every 'language' in the prompt is the output-language instruction, not the domain",
    all(
        "{language}" in line or "target language" in line.lower()
        or "clinical language" in line.lower()
        for line in language_lines
    ),
    f"unexplained: {[l for l in language_lines if '{language}' not in l and 'target language' not in l.lower() and 'clinical language' not in l.lower()]}",
)
ok(
    "the prompt never renders a domain line itself",
    "Language:" not in report_prompt and "Memory:" not in report_prompt,
)
for old in ("Object Recognition", "Daily Routine", "recognition", "routine"):
    ok(f"report prompt carries no four-domain label {old!r}", old.lower() not in report_prompt.lower())

# And it is byte-for-byte unchanged from the last commit.
diff = subprocess.run(
    ["git", "diff", "HEAD", "--", "backend/app/services/prompts.py"],
    cwd=ROOT, capture_output=True, text=True,
)
ok("prompts.py is unmodified", diff.stdout.strip() == "", "it has uncommitted changes")


# ── Seed a patient across every playable domain ──────────────────────────────

Base.metadata.create_all(bind=engine)
db = SessionLocal()

doctor = User(name="D", email="s1r-d@test.local", hashed_password="x", role="doctor")
caregiver = User(name="C", email="s1r-c@test.local", hashed_password="x", role="caregiver")
db.add_all([doctor, caregiver])
db.flush()
patient = Patient(
    name="Bipul Das", age=78, doctor_id=doctor.id, caregiver_id=caregiver.id,
    is_demo=True, preferred_language="en",
)
db.add(patient)
db.flush()

now = datetime.now(timezone.utc).replace(tzinfo=None)
for i, game in enumerate(GAME_TYPES):
    for day in range(8):
        db.add(GameSession(
            patient_id=patient.id, game_type=game, domain=domain_for_game(game),
            score=6.0 + (i % 3), total=10.0, errors=4, level=3, new_level=3,
            duration_ms=42000, completed=True,
            created_at=now - timedelta(days=day, hours=i),
        ))
db.commit()

sessions = analytics.load_sessions(db, patient.id, days=30)
domains = analytics.domain_scores(db, patient.id, sessions)
ok("analytics hands the agent six domains", len(domains) == 6, f"got {len(domains)}")


# ── The exact block the chain is given ───────────────────────────────────────

domain_lines = []
for d in domains:
    score_str = "no data" if d["score"] is None else f"{d['score']}%"
    domain_lines.append(
        f"  {d['label']}: {score_str}, trend={d['trend']}, sessions={d['sessions']}"
    )
block = "\n".join(domain_lines)

ok("prompt input has six domain lines", len(domain_lines) == 6)
for domain in DOMAINS:
    ok(f"prompt input mentions {domain}", DOMAIN_LABELS[domain] in block)
ok(
    "unmeasured domains are sent as 'no data', not 0%",
    block.count("no data") == 2,
    f"got {block.count('no data')} -- attention and perceptual-motor should both be unmeasured",
)
print("\n  --- prompt input actually sent ---")
print(block)
print()


# ── The offline report ───────────────────────────────────────────────────────

rule = agents._rule_report(db, patient, "doctor", 30, "en")
rule_text = " ".join([rule["summary"], *rule["trends"], *rule["observations"], *rule["suggestions"]])
covered = [d for d in DOMAINS if DOMAIN_LABELS[d].lower() in rule_text.lower()]
ok(
    "offline report names all six domains",
    len(covered) == 6,
    f"named only {covered}",
)
for old in ("Object Recognition", "Daily Routine"):
    ok(f"offline report drops the old label {old!r}", old not in rule_text)


# ── The live chain, prompt unchanged ─────────────────────────────────────────

if LIVE:
    ok("AI is configured for the live run", agents.is_available())
    report = agents.build_report(db, patient, audience="doctor", period_days=30)
    text = " ".join(
        [report.get("summary", ""), *report.get("trends", []),
         *report.get("observations", []), *report.get("suggestions", [])]
    )
    print("  --- live report source:", report.get("source", "?"), "---")
    print("  summary:", report.get("summary", "")[:300])
    print("  trends:")
    for t in report.get("trends", []):
        print("   ", t)
    print()
    named = [d for d in DOMAINS if DOMAIN_LABELS[d].lower() in text.lower()]
    ok(
        "live report describes at least five of the six domains",
        len(named) >= 5,
        f"named {named}",
    )
    ok("live report is prose, not empty", len(report.get("summary", "")) > 40)
    for old in ("Object Recognition", "Daily Routine"):
        ok(f"live report drops the old label {old!r}", old not in text)
else:
    print("  (skipping the live LLM call -- pass --live to include it)\n")

db.close()

for name in passed:
    print(f"  PASS  {name}")
for line in failed:
    print(f"  FAIL  {line}")

print()
if failed:
    print(f"REPORT SIX DOMAINS: FAIL ({len(failed)} of {len(passed) + len(failed)})")
    sys.exit(1)
print(f"REPORT SIX DOMAINS: OK ({len(passed)} checks)")
