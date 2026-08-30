
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from statistics import mean, pstdev

from sqlalchemy.orm import Session

from ..domains import (
    DERIVED_DOMAINS,
    DOMAIN_ATTENTION,
    DOMAIN_LABELS,
    DOMAINS,
    GAME_LABELS,
)
from ..levels import MIN_LEVEL, first_level
from ..models import DifficultyHistory, GameSession, Patient, ReminderLog

# Attention has no game of its own yet -- it is synthesised (see
# attention_score). Until it is genuinely measured it reports from the bottom
# of the scale rather than an invented 1. Sprint 1 removes the synthesis.
UNPLAYED_START_LEVEL = MIN_LEVEL

# A device that has not synced in this long is shown as offline. The NER
# context makes this a normal state, not an error — the card says "offline",
# it does not warn.
OFFLINE_AFTER_HOURS = 48

TREND_BAND = 0.06        # +/- 6% counts as stable
DROP_Z_THRESHOLD = -1.5  # z-score below this is a "sudden drop"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    """SQLite hands back naive datetimes. Normalise before comparing."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _accuracy(session: GameSession) -> float | None:
    if session.score is None or not session.total:
        return None
    return max(0.0, min(1.0, session.score / session.total))


# ── Session loading ───────────────────────────────────────────────────────────

def load_sessions(db: Session, patient_id: int, days: int = 30) -> list[GameSession]:
    cutoff = _now() - timedelta(days=days)
    return (
        db.query(GameSession)
        .filter(GameSession.patient_id == patient_id)
        .filter(GameSession.created_at >= cutoff.replace(tzinfo=None))
        .order_by(GameSession.created_at.asc())
        .all()
    )


# ── Trend ─────────────────────────────────────────────────────────────────────

def trend_of(sessions: list[GameSession]) -> str:
    """Split the window in half and compare mean accuracy.

    Simple on purpose: a doctor asking "why is this improving?" gets an
    answer they can check by hand.
    """
    rates = [r for r in (_accuracy(s) for s in sessions) if r is not None]
    if len(rates) < 4:
        return "unknown"

    mid = len(rates) // 2
    older, newer = mean(rates[:mid]), mean(rates[mid:])
    delta = newer - older

    if delta > TREND_BAND:
        return "improving"
    if delta < -TREND_BAND:
        return "declining"
    return "stable"


def sudden_drop_z(sessions: list[GameSession]) -> float | None:
    """Z-score of the most recent session against the patient's own baseline.

    Compared against themselves, never against other patients — the only
    comparison that means anything clinically.
    """
    rates = [r for r in (_accuracy(s) for s in sessions) if r is not None]
    if len(rates) < 6:
        return None

    baseline, latest = rates[:-1], rates[-1]
    spread = pstdev(baseline)
    if spread < 0.01:
        return None
    return (latest - mean(baseline)) / spread


# ── Domain scores ─────────────────────────────────────────────────────────────

def attention_score(sessions: list[GameSession]) -> tuple[int | None, int]:
    """Attention is not owned by a game — it is derived.

    Two behavioural signals across every game: how often rounds are finished
    rather than abandoned, and how steady the pace is. A patient who finishes
    everything at an even pace is attending; one who drifts is not.
    """
    if not sessions:
        return None, 0

    completion = sum(1 for s in sessions if s.completed) / len(sessions)

    durations = [s.duration_ms for s in sessions if s.duration_ms]
    if len(durations) >= 3 and mean(durations) > 0:
        # Coefficient of variation: lower spread = steadier pace.
        steadiness = 1 - min(1.0, pstdev(durations) / mean(durations))
    else:
        steadiness = completion

    return round((completion * 0.6 + steadiness * 0.4) * 100), len(sessions)


def domain_scores(
    db: Session, patient_id: int, sessions: list[GameSession]
) -> list[dict]:
    """One entry per displayed domain, in a fixed order."""
    latest_levels = _latest_levels(db, patient_id)
    out = []

    for domain in DOMAINS:
        if domain in DERIVED_DOMAINS:
            score, count = attention_score(sessions)
            subset = sessions
        else:
            subset = [s for s in sessions if s.domain == domain]
            rates = [r for r in (_accuracy(s) for s in subset) if r is not None]
            score = round(mean(rates) * 100) if rates else None
            count = len(subset)

        out.append(
            {
                "domain": domain,
                "label": DOMAIN_LABELS[domain],
                "score": score,
                # A domain with no sessions has no measured level. It reports
                # the floor rather than an invented 1 until Sprint 2 gives
                # patients stored base levels and this becomes null.
                "level": latest_levels.get(domain, UNPLAYED_START_LEVEL),
                "trend": trend_of(subset),
                "sessions": count,
            }
        )

    return out


def _latest_levels(db: Session, patient_id: int) -> dict[str, int]:
    """Most recent level reached per domain.

    `row.new_level or row.level or 1` used to live here. On the 0-15 scale that
    reads every genuine level-0 patient as level 1, and level 0 is a real
    level -- those patients still play and still need a truthful trend line.
    first_level() checks `is None`, so a stored 0 comes back as 0.

    A domain with no sessions is simply absent from the returned map rather
    than defaulted, because "not measured yet" and "measured at the bottom of
    the scale" are different facts. Stored base levels replace this inference
    entirely in Sprint 2.
    """
    rows = (
        db.query(GameSession)
        .filter(GameSession.patient_id == patient_id)
        .order_by(GameSession.created_at.desc())
        .limit(80)
        .all()
    )
    levels: dict[str, int] = {}
    for row in rows:
        if row.domain in levels:
            continue
        resolved = first_level(row.new_level, row.level)
        if resolved is not None:
            levels[row.domain] = resolved
    levels.setdefault(DOMAIN_ATTENTION, UNPLAYED_START_LEVEL)
    return levels


# ── Adherence ─────────────────────────────────────────────────────────────────

def adherence(db: Session, patient_id: int, days: int = 7) -> int | None:
    """Percentage of due reminders that were acted on. None if none were due."""
    cutoff = (_now() - timedelta(days=days)).replace(tzinfo=None)
    logs = (
        db.query(ReminderLog)
        .filter(ReminderLog.patient_id == patient_id)
        .filter(ReminderLog.due_at >= cutoff)
        .filter(ReminderLog.status != "pending")
        .all()
    )
    if not logs:
        return None
    done = sum(1 for log in logs if log.status == "done")
    return round(done / len(logs) * 100)


# ── Risk ──────────────────────────────────────────────────────────────────────

def risk_band(
    trend: str, overall: int | None, adherence_pct: int | None, drop_z: float | None
) -> str:
    """Additive risk. Deliberately readable rather than clever — a doctor can
    reconstruct why a patient was flagged."""
    points = 0

    if trend == "declining":
        points += 2
    elif trend == "stable":
        points += 0

    if drop_z is not None and drop_z <= DROP_Z_THRESHOLD:
        points += 2

    if overall is not None and overall < 45:
        points += 1

    if adherence_pct is not None and adherence_pct < 60:
        points += 1

    if points >= 3:
        return "high"
    if points >= 1:
        return "medium"
    return "low"


# ── Reasons (deterministic today, AI-rewritten later) ─────────────────────────

def build_reason(
    sessions: list[GameSession],
    domains: list[dict],
    trend: str,
    drop_z: float | None,
    adherence_pct: int | None,
) -> str:
    """The short explanation under the trend arrow.

    Phase 3 replaces this string with warmer AI phrasing. The *decision* it
    describes is made here and does not change — which is what keeps the
    dashboard honest when the network is down.
    """
    if not sessions:
        return "No sessions recorded yet."

    if drop_z is not None and drop_z <= DROP_Z_THRESHOLD:
        return "Sharp drop in the most recent session compared to their usual range."

    weakest = min(
        (d for d in domains if d["score"] is not None),
        key=lambda d: d["score"],
        default=None,
    )

    if trend == "declining" and weakest:
        return f"{weakest['label']} scores easing over recent sessions."
    if trend == "improving" and weakest:
        return f"Steady gains overall; {weakest['label'].lower()} remains the weakest area."
    if adherence_pct is not None and adherence_pct < 60:
        return f"Performance steady, but reminder adherence is {adherence_pct}%."
    if trend == "stable":
        return "Holding steady across recent sessions."
    return "Not enough sessions yet to read a trend."


def recommended_actions(
    trend: str, domains: list[dict], adherence_pct: int | None, risk: str
) -> list[str]:
    """The Recommended Actions block on the clinical view."""
    actions: list[str] = []

    if risk == "high":
        actions.append("Schedule a follow-up within the week")
    elif trend == "declining":
        actions.append("Review at the next scheduled visit")
    else:
        actions.append("Continue current difficulty")

    weakest = min(
        (d for d in domains if d["score"] is not None),
        key=lambda d: d["score"],
        default=None,
    )
    if weakest and weakest["score"] is not None and weakest["score"] < 60:
        actions.append(f"Suggest caregiver focus on {weakest['label']} activities")

    if adherence_pct is not None and adherence_pct < 70:
        actions.append("Discuss reminder routine with the caregiver")

    if any(d["sessions"] == 0 for d in domains if d["domain"] not in DERIVED_DOMAINS):
        actions.append("Encourage trying the untouched activity types")

    return actions


# ── Patient card ──────────────────────────────────────────────────────────────

def build_patient_card(db: Session, patient: Patient) -> dict:
    """Everything one Smart Patient Card needs, in one pass."""
    sessions = load_sessions(db, patient.id, days=30)

    rates = [r for r in (_accuracy(s) for s in sessions) if r is not None]
    overall = round(mean(rates) * 100) if rates else None

    trend = trend_of(sessions)
    drop_z = sudden_drop_z(sessions)
    domains = domain_scores(db, patient.id, sessions)
    adherence_pct = adherence(db, patient.id)

    last_active = _aware(sessions[-1].created_at) if sessions else None
    last_sync = _aware(patient.last_sync_at)
    is_offline = (
        last_sync is None or (_now() - last_sync) > timedelta(hours=OFFLINE_AFTER_HOURS)
    )

    week_ago = _now() - timedelta(days=7)
    sessions_this_week = sum(
        1 for s in sessions if (_aware(s.created_at) or _now()) >= week_ago
    )

    return {
        "id": patient.id,
        "name": patient.name,
        "age": patient.age,
        "photo": patient.photo,
        "caregiver_name": patient.caregiver.name if patient.caregiver else "—",
        "last_active": last_active,
        "last_sync_at": last_sync,
        "is_offline": is_offline,
        "adherence": adherence_pct,
        "overall_score": overall,
        "trend": trend,
        "reason": build_reason(sessions, domains, trend, drop_z, adherence_pct),
        "risk": risk_band(trend, overall, adherence_pct, drop_z),
        "domains": domains,
        "sessions_this_week": sessions_this_week,
    }


# ── Today's Priority ──────────────────────────────────────────────────────────

def build_priority(cards: list[dict], limit: int = 3) -> list[dict]:
    """The 2-3 patients the doctor should look at first.

    Answers "what do I look at first?" — the question the requirements say a
    plain metrics row fails to answer.
    """
    severity_rank = {"high": 0, "medium": 1, "low": 2}
    ranked = sorted(
        cards,
        key=lambda c: (
            severity_rank[c["risk"]],
            0 if c["trend"] == "declining" else 1,
            c["overall_score"] if c["overall_score"] is not None else 999,
        ),
    )

    out = []
    for card in ranked[:limit]:
        if card["risk"] == "low" and card["trend"] != "declining":
            continue
        out.append(
            {
                "patient_id": card["id"],
                "patient_name": card["name"],
                "headline": _headline(card),
                "reason": card["reason"],
                "severity": card["risk"],
            }
        )
    return out


def _headline(card: dict) -> str:
    if card["trend"] == "declining":
        weakest = min(
            (d for d in card["domains"] if d["score"] is not None),
            key=lambda d: d["score"],
            default=None,
        )
        if weakest:
            return f"{weakest['label']} declining"
        return "Performance declining"
    if card["adherence"] is not None and card["adherence"] < 60:
        return f"Reminder adherence at {card['adherence']}%"
    if card["is_offline"]:
        return "No sync in over 48 hours"
    return "Needs review"


def build_assistant(db: Session, cards: list[dict], doctor_id: int) -> dict:
    """The AI Clinical Assistant sidebar: improving, sudden drop, changes today."""
    improving = [
        {
            "patient_id": c["id"],
            "patient_name": c["name"],
            "headline": "Improving this week",
            "reason": c["reason"],
            "severity": "low",
        }
        for c in cards
        if c["trend"] == "improving"
    ]

    sudden_drop = [
        {
            "patient_id": c["id"],
            "patient_name": c["name"],
            "headline": "Sudden drop",
            "reason": c["reason"],
            "severity": c["risk"],
        }
        for c in cards
        if c["risk"] == "high" and c["trend"] == "declining"
    ]

    since = (_now() - timedelta(days=1)).replace(tzinfo=None)
    patient_ids = [c["id"] for c in cards]
    changes = (
        db.query(DifficultyHistory)
        .filter(DifficultyHistory.patient_id.in_(patient_ids or [-1]))
        .filter(DifficultyHistory.created_at >= since)
        .order_by(DifficultyHistory.created_at.desc())
        .limit(12)
        .all()
    )

    return {
        "improving": improving[:5],
        "sudden_drop": sudden_drop[:5],
        "difficulty_changes_today": changes,
    }


# ── Trend graph ───────────────────────────────────────────────────────────────

def trend_series(sessions: list[GameSession], days: int = 30) -> list[dict]:
    """Daily mean accuracy for the last N days. Gaps stay null so the graph
    breaks the line rather than inventing a value."""
    today = _now().date()
    buckets: dict[str, list[float]] = {}

    for session in sessions:
        created = _aware(session.created_at)
        if created is None:
            continue
        key = created.date().isoformat()
        rate = _accuracy(session)
        if rate is not None:
            buckets.setdefault(key, []).append(rate)

    series = []
    for offset in range(days - 1, -1, -1):
        day = (today - timedelta(days=offset)).isoformat()
        values = buckets.get(day, [])
        series.append(
            {
                "date": day,
                "score": round(mean(values) * 100) if values else None,
                "sessions": len(values),
            }
        )
    return series


def percentile_against(db: Session, doctor_id: int, score: int | None) -> int | None:
    """Where this patient sits among the doctor's other patients.

    Cohort is the doctor's own caseload — small, but it is the comparison the
    requirements ask for, and it is honest about what it measures.
    """
    if score is None:
        return None

    # Real patients only — ranking a person against seeded demo data would
    # produce a percentile that means nothing clinically.
    peers = (
        db.query(Patient)
        .filter(Patient.doctor_id == doctor_id, Patient.is_demo.is_(False))
        .all()
    )
    scores = []
    for peer in peers:
        rates = [
            r
            for r in (_accuracy(s) for s in load_sessions(db, peer.id, days=30))
            if r is not None
        ]
        if rates:
            scores.append(mean(rates) * 100)

    if len(scores) < 2:
        return None
    below = sum(1 for s in scores if s < score)
    return round(below / len(scores) * 100)
