"""Seed the demo caseload for the six-domain model.

Three patients, ninety days each, built to make one point that a single
overall score cannot make:

    Kamala   72   all six domains flat and green            "steady"
    Bipul    78   memory sliding, the other five flat       "the money shot"
    Rina     69   six sittings in thirty days               "not enough data"

Bipul is the reason this file exists. Across the ninety days his memory
accuracy falls forty points, from 0.72 to 0.32 -- and his OVERALL accuracy
falls six, from 0.74 to 0.68. Memory is one domain of six, so a collapse in it
arrives at a single-score dashboard divided by six, as a wobble a few points
wide that is hard to tell from a bad fortnight. That dashboard is not
computing anything wrong. It is reading a number that cannot hold the answer,
and it can never say which domain moved, which is the only part a caregiver
can act on.

Six independent base levels can say it. His memory level walks 11 -> 3 while
the other five sit still, three of those steps inside the last thirty days,
which is what trips the flag and puts "Memory" on the card by name.

    python seed_demo.py             (or: python rebuild_db.py --seed)

Login after seeding:
    doctor     doctor@sahaay.in     / sahaay123
    caregiver  see the table printed at the end, all / sahaay123

THE HISTORY IS GENERATED, NOT OBSERVED. Say so if anyone asks. A seeded
dataset presented as real data is the kind of thing that unravels badly, and
"here is what the model looks like with three months in it" is a stronger
claim than a quiet implication that three months happened.

Why the old seeder could not be patched
---------------------------------------
Every row it wrote carried one of the four invented domain labels (memory,
attention, routine, recognition) and a level on the old 1-5 scale, both frozen
into the row at write time. Two of those labels do not exist any more, and the
two that survive by name mean something different: the old `memory` blended
the memory game with name-recall, which is social cognition. There is no
mapping back -- `recognition` was objects-naming, which is language, but the
row does not record which game produced it once the label has been applied.
The implementation plan calls for a reseed rather than a migration for exactly
this reason, and the data was generated in the first place.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from app.auth import hash_password
from app.database import SessionLocal
from app.domains import (
    DOMAIN_ATTENTION,
    DOMAIN_EXECUTIVE,
    DOMAIN_LANGUAGE,
    DOMAIN_MEMORY,
    DOMAIN_PERCEPTUAL_MOTOR,
    DOMAIN_SOCIAL,
    DOMAINS,
)
from app.models import (
    ROLE_CAREGIVER,
    ROLE_DOCTOR,
    DifficultyHistory,
    GameSession,
    Patient,
    Reminder,
    ReminderLog,
    User,
)
from app.services import base_levels

PASSWORD = "sahaay123"

# Reproducible: the demo must look identical on every machine it is shown on.
SEED = 26003

HISTORY_DAYS = 90
WEEKS = HISTORY_DAYS // 7  # 12 whole weeks, plus the part-week we are in

# Mirrors ITEMS_PER_DOMAIN / ITEMS_PER_DOMAIN_OVERRIDES in
# shared/sessionRules.js. Sixteen rows per sitting: attention is capped at one
# item because a go/no-go block runs on a fixed clock rather than at the
# patient's pace, so three of them ate a third of the session.
ITEMS_PER_DOMAIN = {domain: 3 for domain in DOMAINS}
ITEMS_PER_DOMAIN[DOMAIN_ATTENTION] = 1
ITEMS_PER_SITTING = sum(ITEMS_PER_DOMAIN.values())  # 16

# Two sittings a day, the second unlocking four hours after the first ENDS --
# a rolling gap, never a clock time. shared/sessionRules.js SESSION_GAP_MS.
SESSION_GAP_HOURS = 4

# Roughly one sitting in twelve is walked away from partway. Leaving is never
# failure, but it does have to be *recorded*, or the quit path is invisible in
# the data the same way it was invisible in the old code (every game hardcoded
# completed=True, so no round could ever be logged as abandoned).
ABANDON_RATE = 0.08

# Item id shapes, matching shared/itemBank.js exactly. The banked domains draw
# from a fixed pool; the two generated ones encode level and seed, which is
# what makes their rotation automatic.
BANK_POOLS = {
    DOMAIN_MEMORY: ("mem", 60),
    DOMAIN_LANGUAGE: ("lan", 20),
    DOMAIN_SOCIAL: ("soc", 12),
    DOMAIN_EXECUTIVE: ("exe", 27),
}
GENERATED_PREFIX = {
    DOMAIN_ATTENTION: "att-gen",
    DOMAIN_PERCEPTUAL_MOTOR: "pmo-gen",
}

# Never the same item twice inside a fortnight. Without this the patient
# memorises the specific pictures, scores drift upward on their own, and the
# trend line reports an improvement that did not happen -- which would make
# every number below meaningless.
#
# THE BANKS CANNOT ACTUALLY HONOUR THIS, AND NEITHER CAN THE LIVE APP. Three
# items a sitting, two sittings a day, fourteen days is eighty-four draws per
# banked domain. The pools are memory 60, executive 27, language 20, social
# 12. Social repeats every second day no matter how the selector is written;
# it is short by seventy-two items, not by a few.
#
# So this mirrors what shared/itemBank.js actually does when a pool runs dry:
# fall back to the least recently used rather than throw, because a patient
# must always be given a question. Seeding a clean fourteen-day rotation would
# have meant inventing item ids the bank does not contain, and the demo data
# would then be quietly better than the software it is demonstrating.
ROTATION_DAYS = 14

REMINDERS = [
    ("medicine", "Morning tablet", "08:00"),
    ("hydration", "Glass of water", "11:00"),
    ("activity", "Short walk", "17:00"),
    ("medicine", "Evening tablet", "20:00"),
]


def _now() -> datetime:
    return datetime.now(timezone.utc)


# -- The shape of one domain over ninety days --------------------------------


@dataclass
class DomainTrack:
    """One domain's ninety days: a base level path and an accuracy path.

    Two separate things, and keeping them separate is the model:

    * ``levels`` is the CLINICAL number -- one entry per week, moving at most
      one step per week, because that is the only rate the weekly evaluator is
      allowed to move it at. This is what the report tracks.
    * the accuracy pair is what the patient actually scored day to day. Noisy,
      moves freely, and is the evidence the level path is a lagging read of.

    A declining patient shows accuracy falling first; the base level follows
    it down a week or so later, which is what "seven days of declining daily
    scores moves the base level by one" looks like from the outside.
    """

    levels: list[int]
    start_accuracy: float
    end_accuracy: float
    noise: float = 0.05
    # Amplitude of a slow multi-week wobble. Pure linear drift plus white
    # noise still reads as a ruled line at a glance; real performance drifts
    # in and out of good spells, and a trend that survives that is more
    # convincing than one drawn along a straight edge.
    wobble: float = 0.03

    def level_on(self, day: int) -> int:
        """`day` counts BACKWARDS from today: 0 is today, 89 is the oldest."""
        weeks_ago = min(day // 7, len(self.levels) - 1)
        return self.levels[len(self.levels) - 1 - weeks_ago]

    def accuracy_on(self, day: int, rng: random.Random) -> float:
        # Same convention: day 89 is the start of the window, day 0 is today.
        progress = 1.0 - (day / max(1, HISTORY_DAYS - 1))
        base = self.start_accuracy + (self.end_accuracy - self.start_accuracy) * progress
        # Two wobbles, both with periods well SHORTER than the thirty-day
        # window the analytics compare halves of. That constraint is the whole
        # point: a swing whose period is longer than the window is not noise
        # inside it, it is a trend, and a "flat" patient built with one drifts
        # in and out of declining at random depending on where the window
        # happens to land. Twelve days and six days both average out across a
        # fifteen-day half, so good spells and bad spells show up in the daily
        # scores without ever bending the thirty-day read.
        swing = self.wobble * (
            math.sin(day / 1.9) * 0.6 + math.sin(day / 0.95 + 1.1) * 0.4
        )
        value = base + swing + rng.gauss(0, self.noise)
        return max(0.05, min(0.99, value))


def flat(level: int, accuracy: float, drift: float = 0.0, **kw) -> DomainTrack:
    """A domain that holds its level for the whole window."""
    return DomainTrack(
        levels=[level] * (WEEKS + 1),
        start_accuracy=accuracy,
        end_accuracy=accuracy + drift,
        **kw,
    )


def stepped(
    levels: list[int], start_accuracy: float, end_accuracy: float, **kw
) -> DomainTrack:
    """A domain with an explicit weekly level path, oldest week first.

    Explicit rather than computed: the path has to satisfy two constraints at
    once -- at most one step a week, and at least two steps inside the last
    thirty days so the caregiver flag actually trips -- and writing the twelve
    numbers out is easier to check by eye than an interpolation that happens
    to land there.
    """
    assert len(levels) == WEEKS + 1, f"need {WEEKS + 1} weekly levels, got {len(levels)}"
    for a, b in zip(levels, levels[1:]):
        assert abs(b - a) <= 1, f"level path steps more than 1 in a week: {a} -> {b}"
    return DomainTrack(
        levels=levels,
        start_accuracy=start_accuracy,
        end_accuracy=end_accuracy,
        **kw,
    )


# -- The three patients ------------------------------------------------------


@dataclass
class DemoPatient:
    name: str
    age: int
    stage: str
    caregiver_name: str
    caregiver_email: str
    language: str
    adherence: float
    tracks: dict[str, DomainTrack]
    #: Days back from today (0 = today) the patient sat down. None means
    #: "most days", generated with realistic gaps.
    play_days: list[int] | None = None
    skip_rate: float = 0.12
    offline_days: int = 0
    verdict: str = ""
    notes: list[str] = field(default_factory=list)


# Kamala: the baseline. Every domain flat and comfortably green, so the board
# has something unambiguously fine to read the other two against. A caseload
# where every patient is a problem teaches the viewer nothing about what the
# flags mean.
KAMALA = DemoPatient(
    name="Kamala Das",
    age=72,
    stage="MCI",
    caregiver_name="Anita Das",
    caregiver_email="anita@sahaay.in",
    language="en",
    adherence=0.88,
    verdict="all six steady, low risk",
    tracks={
        # See the note on Bipul's attention: one item a sitting means this
        # score is backed by about fifty binary rows over thirty days, so it
        # needs real margin above the 70% green line rather than four points.
        DOMAIN_ATTENTION: flat(11, 0.88, drift=0.01),
        DOMAIN_EXECUTIVE: flat(10, 0.80, drift=0.02),
        DOMAIN_MEMORY: flat(11, 0.82, drift=-0.01),
        DOMAIN_LANGUAGE: flat(12, 0.85, drift=0.01),
        DOMAIN_PERCEPTUAL_MOTOR: flat(10, 0.79, drift=0.00),
        DOMAIN_SOCIAL: flat(11, 0.81, drift=0.01),
    },
    notes=[
        "Flat is the good outcome, not the boring one. Months of level lines",
        "that do not move is the programme working.",
    ],
)

# Bipul: one domain moving alone.
#
# Memory walks 11 -> 3 across the window, accelerating -- slow at first, then
# a step most weeks. The acceleration is deliberate on two counts: it is what
# decline actually looks like, and it puts three of the steps inside the last
# thirty days, which is the window analytics.level_drops() reads. A path that
# lost the same eight levels evenly would end in the same place having never
# tripped the flag.
#
# The other five hold flat. That is the whole demonstration: his OVERALL
# accuracy moves only a few points across three months, because memory is one
# sixth of what he plays, and a few points is inside the stable band. A
# single-score dashboard reports him steady. It is not reading the data wrong;
# it is reading a number that cannot hold the answer.
BIPUL = DemoPatient(
    name="Bipul Hazarika",
    age=78,
    stage="Mild",
    caregiver_name="Nayan Hazarika",
    caregiver_email="nayan@sahaay.in",
    language="as",
    adherence=0.74,
    verdict="memory flagged, five domains steady",
    tracks={
        # ATTENTION NEEDS MARGIN, and the reason is worth keeping.
        #
        # It is the one domain capped at a single item per sitting, so its
        # thirty-day score rests on about fifty rows scored 1 or 0 -- against
        # roughly three hundred for every other domain. The standard error on
        # fifty Bernoulli draws is five points, so an underlying rate of 0.77
        # lands under the 70% green line about one run in ten, and 0.83 still
        # did on this seed. That would put an amber bar on a domain with
        # nothing wrong with it, and on Bipul's card -- where the entire claim
        # is that ONE domain moved -- a second amber bar is not cosmetic.
        #
        # Seeded well clear of the line. Not a fudge to make the demo pass:
        # the thin sampling is a real property of a one-item block, and the
        # honest response is to stop reading a five-point difference in that
        # domain as if it meant something.
        DOMAIN_ATTENTION: flat(10, 0.88, drift=0.01),
        DOMAIN_EXECUTIVE: flat(10, 0.79, drift=-0.01),
        DOMAIN_MEMORY: stepped(
            #  oldest week ....................................... this week
            #  wk0  1   2   3   4  5  6  7  8  9 10 11 12
            [11, 11, 10, 10, 9, 9, 8, 7, 6, 6, 5, 4, 3],
            start_accuracy=0.83,
            end_accuracy=0.28,
            noise=0.06,
        ),
        DOMAIN_LANGUAGE: flat(11, 0.81, drift=0.00),
        DOMAIN_PERCEPTUAL_MOTOR: flat(9, 0.78, drift=0.01),
        DOMAIN_SOCIAL: flat(10, 0.79, drift=-0.01),
    },
    notes=[
        "Overall accuracy barely moves -- memory is one domain of six.",
        "The memory base level falls eight steps, three of them in the last",
        "month, which is what trips the flag.",
    ],
)

# Rina: not enough data, and honest about it.
#
# She played steadily for the first two months, then tailed off. The recent
# sittings below are placed by hand rather than rolled, because the whole
# point of her is a specific count: six in the last thirty days, of which
# three fall inside the fourteen-day trust window. Five is the threshold, so
# she reads `insufficient_data` -- and the report says "not enough data"
# instead of drawing a flat line through three points and calling it stable.
#
# A flat line and no data look identical on a graph and mean opposite things.
# Three play days in the last thirty, two sittings each: about six sessions,
# which is what the plan asks for. Counting in DAYS rather than sittings is
# the part that is easy to get wrong -- six play days would have been twelve
# sessions, and twelve is nowhere near "not enough data".
#
# Days 4 and 13 fall inside the fourteen-day trust window, so at most four
# sittings land there against a threshold of five. That is what makes her
# insufficient_data guaranteed rather than lucky.
RINA_SITTING_DAYS = [
    # The sparse recent tail -- this is the thirty-day window.
    4, 13, 26,
    # Then a normal first two months, so she genuinely has ninety days of
    # history rather than an empty record with a few rows on the end.
    *range(34, HISTORY_DAYS, 2),
]

RINA = DemoPatient(
    name="Rina Barman",
    age=69,
    stage="MCI",
    caregiver_name="Pori Barman",
    caregiver_email="pori@sahaay.in",
    language="hi",
    adherence=0.41,
    verdict="insufficient_data -- 6 sittings in 30 days",
    play_days=RINA_SITTING_DAYS,
    tracks={
        DOMAIN_ATTENTION: flat(8, 0.70),
        DOMAIN_EXECUTIVE: flat(8, 0.69),
        DOMAIN_MEMORY: flat(9, 0.72),
        DOMAIN_LANGUAGE: flat(9, 0.74),
        DOMAIN_PERCEPTUAL_MOTOR: flat(7, 0.68),
        DOMAIN_SOCIAL: flat(8, 0.71),
    },
    notes=[
        "Scores still show -- they were measured and they happened.",
        "What is withheld is the DIRECTION, because three sittings do not",
        "make a pattern.",
    ],
)

PATIENTS = [KAMALA, BIPUL, RINA]


# -- Item rotation -----------------------------------------------------------


class Rotation:
    """Hands out item ids, never repeating one inside ROTATION_DAYS.

    Mirrors the selector in shared/itemBank.js closely enough for the seeded
    rows to be honest about the rule: when a pool is exhausted inside the
    window it degrades to the least recently used rather than throwing, since
    a patient must always be given a question.
    """

    def __init__(self, rng: random.Random) -> None:
        self.rng = rng
        self.last_seen: dict[str, dict[str, int]] = {d: {} for d in DOMAINS}
        self.counter = 0

    def take(self, domain: str, day: int, level: int, n: int) -> list[str]:
        if domain in GENERATED_PREFIX:
            # Generated items rotate by construction: the seed is part of the
            # id, so a fresh one is always available.
            #
            # A COUNTER, NOT A DICE ROLL. Drawing the seed at random out of a
            # few thousand values collides every so often, and a collision is
            # the same generated configuration twice inside the fortnight --
            # a rotation breach, small but real, and one that would show up
            # as an unexplained repeat rather than as a bug.
            prefix = GENERATED_PREFIX[domain]
            out = []
            for _ in range(n):
                self.counter += 1
                out.append(f"{prefix}-{level}-{self.counter}")
            return out

        prefix, depth = BANK_POOLS[domain]
        seen = self.last_seen[domain]
        pool = [f"{prefix}-{i:03d}" for i in range(1, depth + 1)]

        # `day` counts BACKWARDS from today, so eligible means "last shown
        # more than ROTATION_DAYS away from this one".
        eligible = [i for i in pool if abs(seen.get(i, -999) - day) > ROTATION_DAYS]

        if len(eligible) >= n:
            picked = self.rng.sample(eligible, n)
        else:
            # Pool exhausted inside the window: fall back to the least
            # recently used rather than failing to ask a question at all.
            #
            # TAKEN IN ORDER, not sampled. Sampling from the sorted list
            # ignores the sort, which put an item shown earlier TODAY back in
            # the running -- the same picture twice in one day, which is the
            # one repeat nobody could miss. Least-recently-used has to
            # actually mean least recently used.
            ordered = sorted(pool, key=lambda i: -abs(seen.get(i, -999) - day))
            picked = ordered[:n]

        for item_id in picked:
            seen[item_id] = day
        return picked


# -- Building the rows -------------------------------------------------------


def _sitting_times(day_start: datetime, rng: random.Random) -> list[datetime]:
    """When the day's sittings began.

    Two a day, the second at least four hours after the first ENDS. A sitting
    runs about ten minutes, so the gap is measured from start + 10 min and
    then padded -- the rule is "four hours after session one ends", and
    seeding it from the start time would let the pair sit closer together
    than the runner would ever allow.
    """
    first = day_start + timedelta(
        hours=rng.randint(8, 10), minutes=rng.randrange(0, 60)
    )
    if rng.random() < 0.18:
        return [first]  # some days only one sitting happened

    earliest_second = first + timedelta(minutes=10, hours=SESSION_GAP_HOURS)
    second = earliest_second + timedelta(minutes=rng.randrange(5, 180))
    # Never into the night -- a sitting at 23:00 is not what the dosing
    # describes, and it would straddle midnight for no reason.
    if second.hour >= 21:
        return [first]
    return [first, second]


def _build_sitting(
    patient: Patient,
    person: DemoPatient,
    day: int,
    started: datetime,
    sitting_index: int,
    rotation: Rotation,
    rng: random.Random,
) -> list[GameSession]:
    """Sixteen rows, or fewer if the patient walked away partway.

    The domain order is shuffled, exactly as the session runner freezes it at
    the start, so the rows an abandoned sitting leaves behind are the ones
    that were actually reached.
    """
    session_id = f"seed-{patient.id}-{day:03d}-{sitting_index}"

    plan: list[tuple[str, str]] = []
    for domain in DOMAINS:
        level = person.tracks[domain].level_on(day)
        for item_id in rotation.take(domain, day, level, ITEMS_PER_DOMAIN[domain]):
            plan.append((domain, item_id))
    rng.shuffle(plan)

    abandoned_at = None
    if rng.random() < ABANDON_RATE:
        # Walked away somewhere in the middle. Not on the first item -- that
        # is a mis-tap, not a session.
        abandoned_at = rng.randrange(3, len(plan) - 1)

    rows: list[GameSession] = []
    clock = started

    for index, (domain, item_id) in enumerate(plan):
        track = person.tracks[domain]
        level = track.level_on(day)

        if abandoned_at is not None and index == abandoned_at:
            # ONE abandoned row, then nothing. Every field that would carry a
            # measurement is null, because nothing was measured -- a zero here
            # is indistinguishable from a zero earned by declining, and mixing
            # the two poisons every trend built on top. The domains after this
            # point get no row at all, which says the same thing.
            rows.append(
                GameSession(
                    patient_id=patient.id,
                    dexie_id=None,
                    game_type=domain,
                    domain=domain,
                    score=None,
                    total=None,
                    moves=None,
                    errors=None,
                    level=level,
                    new_level=None,
                    duration_ms=rng.randint(2_000, 9_000),
                    completed=False,
                    status="abandoned",
                    item_ids=item_id,
                    session_id=session_id,
                    created_at=clock.replace(tzinfo=None),
                )
            )
            break

        correct = rng.random() < track.accuracy_on(day, rng)
        latency = rng.randint(1_800, 11_000)

        rows.append(
            GameSession(
                patient_id=patient.id,
                # No dexie_id: these rows never came from a device. A seeded
                # id inside a real device's range makes the sync dedup
                # silently skip genuine sessions.
                dexie_id=None,
                # A game type IS a domain now -- the client plays
                # /patient/play/<domain> and sends the domain with every row.
                game_type=domain,
                domain=domain,
                # One meaning for score everywhere: correct over attempted.
                score=1.0 if correct else 0.0,
                total=1.0,
                moves=None,
                errors=0 if correct else 1,
                level=level,
                # Rounds never move levels. That is the weekly evaluator's job.
                new_level=None,
                duration_ms=latency,
                completed=True,
                status="completed",
                item_ids=item_id,
                session_id=session_id,
                created_at=clock.replace(tzinfo=None),
            )
        )
        clock += timedelta(milliseconds=latency + rng.randint(400, 2_500))

    return rows


def _weekly_level_moves(
    patient: Patient, person: DemoPatient, start: datetime
) -> list[DifficultyHistory]:
    """One row per base level move, written where the week turned.

    This is the audit trail the flag is computed from: analytics.level_drops()
    reads difficulty_history rather than inferring a level from the newest
    session, because an inferred level only ever knows what the last round set
    and cannot represent six numbers moving independently.
    """
    rows: list[DifficultyHistory] = []

    for domain, track in person.tracks.items():
        for week in range(1, len(track.levels)):
            frm, to = track.levels[week - 1], track.levels[week]
            if frm == to:
                continue
            when = start + timedelta(days=week * 7, hours=3)
            rows.append(
                DifficultyHistory(
                    patient_id=patient.id,
                    game_type=domain,
                    domain=domain,
                    from_level=frm,
                    to_level=to,
                    reason=(
                        "Seven days of steady scores - stepping up."
                        if to > frm
                        else "Daily scores eased across the week - stepping down."
                    ),
                    source="rule",
                    created_at=when.replace(tzinfo=None),
                )
            )

    rows.sort(key=lambda r: r.created_at)
    return rows


def _seed_reminders(
    db, patient: Patient, caregiver: User, adherence_rate: float, rng: random.Random
) -> None:
    """Reminders, and enough logs for the adherence percentage to be real.

    Adherence is PLACED, not rolled. Coin flips over 56 slots drift far enough
    that a patient seeded at 52% displayed 82%, and the number on the card is
    the whole point of the signal.
    """
    slots = [(d, r) for d in range(14) for r in range(len(REMINDERS))]
    done_map: dict[tuple[int, int], bool] = {}
    acc = 0.0
    for slot in slots:
        acc += adherence_rate
        if acc >= 1.0:
            done_map[slot] = True
            acc -= 1.0
        else:
            done_map[slot] = False

    now = _now()
    for index, (reminder_type, title, at) in enumerate(REMINDERS):
        reminder = Reminder(
            caregiver_id=caregiver.id,
            patient_id=patient.id,
            reminder_type=reminder_type,
            title=title,
            scheduled_time=at,
            days_of_week="daily",
        )
        db.add(reminder)
        db.flush()

        for day_back in range(14):
            due = now - timedelta(days=day_back)
            done = done_map[(day_back, index)]
            db.add(
                ReminderLog(
                    reminder_id=reminder.id,
                    patient_id=patient.id,
                    due_at=due.replace(tzinfo=None),
                    acted_at=(
                        (due + timedelta(minutes=rng.randint(2, 45))).replace(tzinfo=None)
                        if done
                        else None
                    ),
                    status="done" if done else "missed",
                )
            )


def seed_patient(db, doctor: User, person: DemoPatient) -> Patient:
    # A per-patient RNG, seeded from the name, so adding or reordering
    # patients does not reshuffle everyone else's ninety days.
    rng = random.Random(f"{SEED}-{person.name}")

    caregiver = User(
        name=person.caregiver_name,
        email=person.caregiver_email,
        role=ROLE_CAREGIVER,
        hashed_password=hash_password(PASSWORD),
        preferred_language=person.language,
    )
    db.add(caregiver)
    db.flush()

    now = _now()
    start = now - timedelta(days=HISTORY_DAYS)

    patient = Patient(
        name=person.name,
        age=person.age,
        diagnosis_stage=person.stage,
        caregiver_id=caregiver.id,
        doctor_id=doctor.id,
        preferred_language=person.language,
        last_sync_at=(
            now - timedelta(days=person.offline_days, hours=2)
        ).replace(tzinfo=None),
        created_at=start.replace(tzinfo=None),
        # These three ARE the caseload now, so they must show without
        # ?include_demo=true. The flag means "hidden sample data", and hiding
        # the only three patients would leave the board empty.
        is_demo=False,
    )
    db.add(patient)
    db.flush()

    rotation = Rotation(rng)

    if person.play_days is not None:
        days = sorted(set(person.play_days))
    else:
        days = [d for d in range(HISTORY_DAYS) if rng.random() > person.skip_rate]

    # Oldest first, so the rotation's "days apart" arithmetic runs forward in
    # time as it consumes the pool.
    for day in sorted(days, reverse=True):
        if person.offline_days and day < person.offline_days:
            continue  # stopped syncing: nothing after this reached the server

        day_start = (now - timedelta(days=day)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        for sitting_index, started in enumerate(_sitting_times(day_start, rng)):
            for row in _build_sitting(
                patient, person, day, started, sitting_index, rotation, rng
            ):
                db.add(row)

    for row in _weekly_level_moves(patient, person, start):
        db.add(row)

    # BASE LEVELS ARE STORED, NOT INFERRED. The server used to reconstruct a
    # level by reading the newest session; that cannot represent six numbers
    # moving independently, and its `new_level or level or 1` chain read every
    # genuine level-0 patient as level 1.
    base_levels.set_levels(
        db,
        patient.id,
        {domain: track.levels[-1] for domain, track in person.tracks.items()},
        reason="Seeded from ninety days of weekly evaluation.",
        source="weekly",
    )

    _seed_reminders(db, patient, caregiver, person.adherence, rng)
    return patient


def seed() -> None:
    db = SessionLocal()
    try:
        if db.query(User).filter(User.email == "doctor@sahaay.in").first():
            print("Demo data already present. Run rebuild_db.py first to reset.")
            return

        doctor = User(
            name="Dr. Ananya Sharma",
            email="doctor@sahaay.in",
            role=ROLE_DOCTOR,
            designation="Geriatric Care",
            hashed_password=hash_password(PASSWORD),
            preferred_language="en",
        )
        db.add(doctor)
        db.flush()

        for person in PATIENTS:
            seed_patient(db, doctor, person)

        db.commit()

        sessions = db.query(GameSession).count()
        abandoned = (
            db.query(GameSession).filter(GameSession.status == "abandoned").count()
        )
        moves = db.query(DifficultyHistory).count()

        print(f"Seeded 1 doctor, {len(PATIENTS)} patients, {HISTORY_DAYS} days each.")
        print(f"  game_sessions:      {sessions}  ({abandoned} abandoned)")
        print(f"  difficulty_history: {moves}")
        print(f"  reminder_logs:      {db.query(ReminderLog).count()}")
        print()
        print("This history is GENERATED, not observed.")
        print()
        print(f"  doctor  doctor@sahaay.in  / {PASSWORD}")
        print()
        for person in PATIENTS:
            print(f"  {person.name:<18} {person.age}  {person.verdict}")
            print(f"  {'':<18}      {person.caregiver_email:<22} / {PASSWORD}")
        print()
        print("The board opens on Bipul: memory down eight base levels while")
        print("the other five hold flat. His overall score barely moves.")

    finally:
        db.close()


if __name__ == "__main__":
    seed()
