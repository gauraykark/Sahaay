"""Sprint 10 DoD: three patients, ninety days, the intended verdict each.

The seeder is the demo. If Bipul's memory flag is not on the board when the
page loads, there is nothing to show, so these run the real seeder against a
throwaway database and read the real analytics off it -- no fixtures, no
stubs. A test that asserts against hand-built rows would pass while the demo
was broken.

Run from the repo root:  python tools/test_seed_demo.py
"""

from __future__ import annotations

import contextlib
import io as _io
import os
import sys
import tempfile
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

_tmp = Path(tempfile.mkdtemp(prefix="sahaay-sprint10-")) / "test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp.as_posix()}"
os.environ.setdefault("SECRET_KEY", "sprint10-test-only")
os.environ["GROQ_API_KEY"] = ""
os.environ["GEMINI_API_KEY"] = ""

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.domains import DOMAINS, GAME_TYPES  # noqa: E402
from app.levels import MAX_LEVEL, MIN_LEVEL  # noqa: E402
from app.models import (  # noqa: E402
    DifficultyHistory,
    GameSession,
    Patient,
    PatientDomainLevel,
    User,
)
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


# ── Run the real seeder ──────────────────────────────────────────────────────

Base.metadata.create_all(bind=engine)

from seed_demo import (  # noqa: E402
    BANK_POOLS,
    BIPUL,
    HISTORY_DAYS,
    KAMALA,
    PATIENTS,
    RINA,
    SESSION_GAP_HOURS,
    seed,
)

# The seeder prints a login table; not wanted in test output.
with contextlib.redirect_stdout(_io.StringIO()):
    seed()

db = SessionLocal()
now = datetime.now(timezone.utc)

patients = {p.name: p for p in db.query(Patient).all()}
cards = {name: analytics.build_patient_card(db, p) for name, p in patients.items()}

kamala = cards[KAMALA.name]
bipul = cards[BIPUL.name]
rina = cards[RINA.name]


# ── 1. Nothing carries an old four-domain label ──────────────────────────────
#
# The old taxonomy was memory / attention / routine / recognition. Two of those
# names survive into the six, so "is it in DOMAINS" is not enough on its own --
# a row labelled `recognition` is the one that proves a stale writer, and a row
# labelled `routine` likewise. Both are checked by name AND the whole set is
# checked against DOMAINS, because a future fifth invented label would slip
# past a blocklist.

DEAD_DOMAINS = {"routine", "recognition"}
DEAD_GAME_TYPES = {"memory-match", "routine", "objects", "name-recall"}

session_domains = {row.domain for row in db.query(GameSession).all()}
session_games = {row.game_type for row in db.query(GameSession).all()}
history_domains = {row.domain for row in db.query(DifficultyHistory).all()}
level_domains = {row.domain for row in db.query(PatientDomainLevel).all()}

check("no session row carries a dead domain label", session_domains & DEAD_DOMAINS, set())
check("no difficulty row carries a dead domain label", history_domains & DEAD_DOMAINS, set())
check("no stored level carries a dead domain label", level_domains & DEAD_DOMAINS, set())
check("no session row carries a legacy game type", session_games & DEAD_GAME_TYPES, set())

ok(
    "every session domain is one of the six",
    session_domains <= set(DOMAINS),
    f"stray: {session_domains - set(DOMAINS)}",
)
ok(
    "every difficulty domain is one of the six",
    history_domains <= set(DOMAINS),
    f"stray: {history_domains - set(DOMAINS)}",
)
# game_type EQUALS domain, matching what the client actually sends
# (PlaySession.jsx passes `gameType: item.domain`). Not checked against
# domains.GAME_TYPES, which still holds the six activity names -- attention,
# sequencing, recall, naming, shapes, faces -- from before a game type became
# a domain. That table and the client have drifted; the seeder follows the
# client, because the client is what writes the rows this has to look like.
check(
    "every game type equals its row's domain, as the client writes it",
    [
        (row.game_type, row.domain)
        for row in db.query(GameSession).all()
        if row.game_type != row.domain
    ][:5],
    [],
)
ok(
    "every game type is one of the six domains",
    session_games <= set(DOMAINS),
    f"stray: {session_games - set(DOMAINS)}",
)
check("all six domains are actually written, not just five", session_domains, set(DOMAINS))


# ── 2. Levels are on the 0-15 scale and stored, not inferred ─────────────────

for name, patient in patients.items():
    stored = base_levels.levels_for(db, patient.id)
    ok(
        f"{name}: six base levels are stored",
        all(level is not None for level in stored.values()),
        str(stored),
    )
    ok(
        f"{name}: every stored level is inside 0-15",
        all(MIN_LEVEL <= level <= MAX_LEVEL for level in stored.values()),
        str(stored),
    )

rows_out_of_scale = [
    row.level
    for row in db.query(GameSession).all()
    if row.level is not None and not (MIN_LEVEL <= row.level <= MAX_LEVEL)
]
check("no session row was played at a level off the scale", rows_out_of_scale, [])

# The old scale topped out at 5. A seeded caseload that never exceeds it would
# pass every check above while still being the old model in disguise.
ok(
    "the caseload actually uses the upper half of the 0-15 scale",
    max(row.level for row in db.query(GameSession).all() if row.level is not None) > 5,
    "nothing above level 5 -- this is still 1-5 data",
)


# ── 3. Ninety days, two sittings a day, four hours apart ─────────────────────

for name, patient in patients.items():
    rows = (
        db.query(GameSession)
        .filter(GameSession.patient_id == patient.id)
        .order_by(GameSession.created_at.asc())
        .all()
    )
    span_days = (rows[-1].created_at - rows[0].created_at).days
    ok(
        f"{name}: history spans most of the {HISTORY_DAYS}-day window",
        span_days >= HISTORY_DAYS - 10,
        f"spans only {span_days} days",
    )

    # Group into sittings, then check the per-day count and the gap.
    sittings: dict[str, list[datetime]] = defaultdict(list)
    for row in rows:
        sittings[row.session_id].append(row.created_at)

    ok(f"{name}: every row belongs to a sitting", all(sittings), "a row has no session_id")

    by_day: dict[object, list[tuple[datetime, datetime]]] = defaultdict(list)
    for times in sittings.values():
        by_day[min(times).date()].append((min(times), max(times)))

    too_many = [day for day, s in by_day.items() if len(s) > 2]
    check(f"{name}: never more than two sittings in a day", too_many, [])

    violations = []
    for day, spans in by_day.items():
        spans.sort()
        for (_, first_end), (second_start, _) in zip(spans, spans[1:]):
            if second_start - first_end < timedelta(hours=SESSION_GAP_HOURS):
                violations.append((day, second_start - first_end))
    check(f"{name}: the four-hour gap holds between sittings", violations, [])


# ── 4. Abandons exist, and never write a zero ────────────────────────────────

abandoned = db.query(GameSession).filter(GameSession.status == "abandoned").all()
ok("abandoned rounds are present in the data", len(abandoned) > 0, "none were written")

check(
    "no abandoned row carries a score",
    [r.id for r in abandoned if r.score is not None],
    [],
)
check(
    "no abandoned row carries a total",
    [r.id for r in abandoned if r.total is not None],
    [],
)
check(
    "no abandoned row carries an error count",
    [r.id for r in abandoned if r.errors is not None],
    [],
)
ok(
    "an abandoned row is not marked completed",
    all(r.completed is False for r in abandoned),
    "one is flagged completed",
)
# The point of the rule: a null and a zero must be distinguishable, and a
# genuinely-scored zero has to still be possible. If every zero had been
# turned into a null the data would be just as broken in the other direction.
zero_scores = (
    db.query(GameSession)
    .filter(GameSession.status == "completed", GameSession.score == 0)
    .count()
)
ok(
    "a genuine scored zero is still written as 0, not null",
    zero_scores > 0,
    "no completed row scored zero -- null and zero are no longer distinguishable",
)

# An abandoned sitting must be SHORT: the domains never reached get no row at
# all, which is the same statement as a null.
sitting_sizes = defaultdict(int)
sitting_abandoned = defaultdict(bool)
for row in db.query(GameSession).all():
    sitting_sizes[row.session_id] += 1
    if row.status == "abandoned":
        sitting_abandoned[row.session_id] = True

full = max(sitting_sizes.values())
short_abandons = [
    s for s, was in sitting_abandoned.items() if was and sitting_sizes[s] < full
]
check(
    "every abandoned sitting is short -- unplayed domains got no row",
    len(short_abandons),
    sum(1 for v in sitting_abandoned.values() if v),
)


# ── 5. Kamala: all six flat, all green, low risk ─────────────────────────────

check("Kamala: overall trend is stable", kamala["trend"], "stable")
check("Kamala: risk is low", kamala["risk"], "low")
check("Kamala: nothing is flagged", kamala["flagged_domains"], [])

non_stable = [d["domain"] for d in kamala["domains"] if d["trend"] != "stable"]
check("Kamala: all six domains read steady", non_stable, [])

# Green on the dashboard is >= 70 (DomainScore.jsx BAR_TONE).
not_green = [
    (d["domain"], d["score"]) for d in kamala["domains"] if (d["score"] or 0) < 70
]
check("Kamala: all six domains are green", not_green, [])

ok(
    "Kamala: has enough data for the trend to mean something",
    kamala["has_enough_data"],
    f"only {kamala['sittings_14d']} sittings",
)


# ── 6. Bipul: memory alone, far enough to flag ───────────────────────────────

by_domain = {d["domain"]: d for d in bipul["domains"]}

check("Bipul: memory reads declining", by_domain["memory"]["trend"], "declining")

others = [d for k, d in by_domain.items() if k != "memory"]
check(
    "Bipul: the other five hold steady",
    [d["domain"] for d in others if d["trend"] != "stable"],
    [],
)
check(
    "Bipul: the other five stay green",
    [(d["domain"], d["score"]) for d in others if (d["score"] or 0) < 70],
    [],
)

check("Bipul: exactly one domain is flagged", len(bipul["flagged_domains"]), 1)
check("Bipul: the flagged domain is memory", bipul["flagged_domains"][0]["domain"], "memory")

drop = bipul["flagged_domains"][0]["delta"]
ok(
    "Bipul: memory crosses the -2 sustained threshold inside 30 days",
    drop <= analytics.LEVEL_DROP_FLAG,
    f"memory moved {drop}, threshold is {analytics.LEVEL_DROP_FLAG}",
)

drops_30 = analytics.level_drops(db, patients[BIPUL.name].id, days=30)
check(
    "Bipul: no domain but memory moved at all in 30 days",
    sorted(d for d, delta in drops_30.items() if delta != 0),
    ["memory"],
)

ok(
    "Bipul: the memory base level ends low on the scale",
    by_domain["memory"]["level"] <= 4,
    f"memory level is {by_domain['memory']['level']}",
)
ok(
    "Bipul: the other five base levels stay high",
    all(d["level"] >= 8 for d in others),
    str({d["domain"]: d["level"] for d in others}),
)

ok(
    "Bipul: the card names Memory in its reason line",
    "Memory" in bipul["reason"],
    bipul["reason"],
)

# The decline has to be GRADUAL. One cliff would be a device fault or a bad
# fortnight, not the thing this demo claims to detect.
memory_moves = (
    db.query(DifficultyHistory)
    .filter(
        DifficultyHistory.patient_id == patients[BIPUL.name].id,
        DifficultyHistory.domain == "memory",
    )
    .order_by(DifficultyHistory.created_at.asc())
    .all()
)
ok(
    "Bipul: memory declined over many weeks, not in one jump",
    len(memory_moves) >= 5,
    f"only {len(memory_moves)} recorded moves",
)
check(
    "Bipul: no single move is bigger than one level",
    [m.id for m in memory_moves if abs(m.to_level - m.from_level) != 1],
    [],
)
# And no domain may move twice inside one week -- max +/-1 per domain per week.
for domain in DOMAINS:
    moves = [m for m in memory_moves if m.domain == domain]
    close = [
        (a.created_at, b.created_at)
        for a, b in zip(moves, moves[1:])
        if (b.created_at - a.created_at) < timedelta(days=7)
    ]
    check(f"Bipul: {domain} never moves twice in a week", close, [])

# THE POINT OF THE WHOLE DEMO: the single overall number does not show this.
memory_rows = [
    s
    for s in analytics.load_sessions(db, patients[BIPUL.name].id, days=HISTORY_DAYS)
    if s.domain == "memory"
]
all_rows = analytics.load_sessions(db, patients[BIPUL.name].id, days=HISTORY_DAYS)


def _half_delta(rows):
    rates = analytics.daily_rates(rows)
    mid = len(rates) // 2
    return sum(rates[mid:]) / len(rates[mid:]) - sum(rates[:mid]) / mid


memory_delta = _half_delta(memory_rows)
overall_delta = _half_delta(all_rows)
ok(
    "Bipul: memory falls far more than the overall score does",
    memory_delta < overall_delta * 3,
    f"memory {memory_delta:+.3f} vs overall {overall_delta:+.3f}",
)
ok(
    "Bipul: the overall score hides most of the fall",
    abs(overall_delta) < abs(memory_delta) / 3,
    f"overall moved {overall_delta:+.3f} against memory's {memory_delta:+.3f}",
)


# ── 7. Rina: insufficient_data, not a flat line ──────────────────────────────

check("Rina: the card reports insufficient_data", rina["trend"], "insufficient_data")
check("Rina: has_enough_data is false", rina["has_enough_data"], False)
ok(
    "Rina: fewer sittings than the trust threshold",
    rina["sittings_14d"] < analytics.TRUST_MIN_SITTINGS,
    f"{rina['sittings_14d']} sittings, threshold {analytics.TRUST_MIN_SITTINGS}",
)

not_insufficient = [
    d["domain"] for d in rina["domains"] if d["trend"] != "insufficient_data"
]
check("Rina: no domain claims a direction either", not_insufficient, [])

# The specific failure this guards: "stable" is what a flat line says, and it
# is the one answer that must never be produced from too little data. It looks
# identical to a genuinely steady patient and means the opposite.
ok(
    "Rina: no domain reads stable",
    all(d["trend"] != "stable" for d in rina["domains"]),
    "a domain is claiming steadiness off three sittings",
)

# She still has scores. The marker withholds the direction, not the numbers.
ok(
    "Rina: her scores are still reported",
    all(d["score"] is not None for d in rina["domains"]),
    "a domain came back with no score at all",
)
ok(
    "Rina: she has a real 90-day history behind the sparse tail",
    db.query(GameSession).filter(GameSession.patient_id == patients[RINA.name].id).count()
    > 200,
    "too few rows to call it ninety days",
)

rina_sittings_30 = analytics.count_sittings(
    analytics.load_sessions(db, patients[RINA.name].id, days=30), days=30
)
ok(
    "Rina: about six sittings in the last 30 days",
    4 <= rina_sittings_30 <= 8,
    f"{rina_sittings_30} sittings in 30 days",
)


# ── 8. The board opens on Bipul ──────────────────────────────────────────────

card_list = list(cards.values())
priority = analytics.build_priority(card_list)

ok("the priority strip is not empty", len(priority) > 0)
check(
    "the board's focus patient is Bipul",
    priority[0]["patient_name"],
    BIPUL.name,
)
ok(
    "the priority headline names Memory",
    "Memory" in priority[0]["headline"],
    priority[0]["headline"],
)

# Kamala must not be promoted -- a healthy patient in the priority strip
# teaches the viewer that the strip means nothing.
ok(
    "Kamala is not in the priority strip",
    all(item["patient_name"] != KAMALA.name for item in priority),
    "the healthy baseline is being flagged",
)

# And all three must be visible on a plain visit, without ?include_demo=true.
visible = db.query(Patient).filter(Patient.is_demo.is_(False)).count()
check("all three patients show on the default caseload", visible, len(PATIENTS))


# ── 9. Rotation ──────────────────────────────────────────────────────────────
#
# The 14-day no-repeat rule CANNOT be satisfied by the banks as they stand, so
# it is not asserted here. Three items a sitting, two sittings a day, fourteen
# days is 84 draws per banked domain against pools of 60 / 27 / 20 / 12. The
# live selector degrades to least-recently-used in exactly this situation, and
# the seeder does the same; a test demanding a clean fortnight would fail
# forever and would be asking the demo data to behave better than the app.
#
# What IS asserted is everything the rule was protecting that remains
# reachable: never the same item twice in one sitting or one day, and the
# whole pool in use rather than a favourite handful.

for name, patient in patients.items():
    rows = (
        db.query(GameSession)
        .filter(GameSession.patient_id == patient.id)
        .order_by(GameSession.created_at.asc())
        .all()
    )

    per_sitting: dict[str, list[str]] = defaultdict(list)
    per_day: dict[object, list[str]] = defaultdict(list)
    per_domain_pool: dict[str, set[str]] = defaultdict(set)

    for row in rows:
        for item_id in (row.item_ids or "").split(","):
            if not item_id:
                continue
            per_sitting[row.session_id].append(item_id)
            per_day[row.created_at.date()].append(item_id)
            per_domain_pool[row.domain].add(item_id)

    dup_sitting = [s for s, ids in per_sitting.items() if len(ids) != len(set(ids))]
    check(f"{name}: no item appears twice in one sitting", dup_sitting[:3], [])

    dup_day = [d for d, ids in per_day.items() if len(ids) != len(set(ids))]
    check(f"{name}: no item appears twice in one day", dup_day[:3], [])

    # The whole bank gets used. A selector that kept returning the same few
    # items would pass both checks above and still be the memorisation
    # problem the rotation rule exists to stop.
    for domain, (_prefix, depth) in BANK_POOLS.items():
        used = len(per_domain_pool.get(domain, ()))
        ok(
            f"{name}: {domain} draws on its whole bank ({used}/{depth})",
            used >= depth * 0.9,
            f"only {used} of {depth} items ever shown",
        )


# ── Report ───────────────────────────────────────────────────────────────────

db.close()

for line in passed:
    print(f"  PASS  {line}")
for line in failed:
    print(f"  FAIL  {line}")

print()
if failed:
    print(f"SEED DEMO: FAIL ({len(failed)} of {len(passed) + len(failed)})")
    sys.exit(1)
print(f"SEED DEMO: OK ({len(passed)} checks)")
