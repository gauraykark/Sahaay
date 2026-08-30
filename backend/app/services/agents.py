

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from ..config import settings
from ..domains import GAME_LABELS, GAME_TYPES, domain_for_game
from ..models import DifficultyHistory, GameSession, Patient
from . import analytics

# Level bounds per game, matching the frontend's GAME_LEVEL_META.
LEVEL_BOUNDS = {
    "memory": (1, 4),
    "routine": (1, 3),
    "objects": (1, 5),
    "name-recall": (1, 3),
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def is_available() -> bool:
    """True once an API key is set AND the chains are importable."""
    if not settings.ai_configured:
        return False
    try:
        from langchain_core.output_parsers import PydanticOutputParser  # noqa: F401
        from langchain_core.prompts import ChatPromptTemplate  # noqa: F401

        if settings.groq_api_key:
            import langchain_groq  # noqa: F401
        else:
            import langchain_google_genai  # noqa: F401
    except ImportError:
        return False
    return True


def clamp(level: int, game_type: str, current: int) -> int:
    """Bound a proposed level to the game's range and +/-1 of current.

    Applies to rule output and AI output alike. See g_prop_02_architecture D9.
    """
    low, high = LEVEL_BOUNDS.get(game_type, (1, 5))
    level = max(low, min(high, level))
    if level > current + 1:
        level = current + 1
    if level < current - 1:
        level = current - 1
    return level


# ── Cognitive Coach ───────────────────────────────────────────────────────────

def build_difficulty_plan(db: Session, patient: Patient, lookback: int = 8) -> dict:
    """Return a multi-branch plan for every game.

    Dispatches to the LLM chain when available, otherwise to the rule engine.
    Either way the shape is identical, so the client never branches on source.
    """
    if is_available():
        try:
            return _llm_difficulty_plan(db, patient, lookback)
        except Exception:
            pass  # fall through to rule engine
    return _rule_difficulty_plan(db, patient, lookback)


def _llm_difficulty_plan(db: Session, patient: Patient, lookback: int) -> dict:
    """Cognitive Coach chain.

    Reads the last `lookback` sessions per game server-side, calls the LLM,
    clamps every returned level, writes DifficultyHistory rows, and returns
    the same shape as _rule_difficulty_plan with source="ai".
    """
    from pydantic import BaseModel, Field
    from langchain_core.output_parsers import PydanticOutputParser
    from langchain_core.prompts import ChatPromptTemplate

    from .prompts import COACH_SYSTEM, COACH_HUMAN

    llm = get_llm()
    if llm is None:
        raise RuntimeError("No LLM available")

    # ── Pydantic output model ─────────────────────────────────────────────────
    class Branch(BaseModel):
        level: int
        reason: str

    class GameOutput(BaseModel):
        game_type: str
        level_if_good: int = Field(..., description="Level when round goes well")
        reason_if_good: str
        level_if_ok: int = Field(..., description="Level when round is average")
        reason_if_ok: str
        level_if_poor: int = Field(..., description="Level when round is difficult")
        reason_if_poor: str

    class CoachOutput(BaseModel):
        games: list[GameOutput]
        next_game: str = Field(..., description="Recommended next game type")

    # ── Build parser and chain ────────────────────────────────────────────────
    # PydanticOutputParser from langchain_core already tolerates ```json fences.
    parser: PydanticOutputParser[CoachOutput] = PydanticOutputParser(pydantic_object=CoachOutput)

    prompt = ChatPromptTemplate.from_messages([
        ("system", COACH_SYSTEM),
        ("human", COACH_HUMAN),
    ])

    chain = prompt | llm | parser

    # ── Gather session data per game ──────────────────────────────────────────
    game_blocks = []
    session_data: dict[str, dict] = {}

    for game_type in GAME_TYPES:
        sessions = (
            db.query(GameSession)
            .filter(GameSession.patient_id == patient.id)
            .filter(GameSession.game_type == game_type)
            .order_by(GameSession.created_at.desc())
            .limit(lookback)
            .all()
        )
        current = (sessions[0].new_level or sessions[0].level or 1) if sessions else 1
        session_data[game_type] = {"current": current, "sessions": sessions}

        if sessions:
            completed = sum(1 for s in sessions if s.completed)
            completion_rate = round(completed / len(sessions) * 100)
            durations = [s.duration_ms for s in sessions if s.duration_ms]
            avg_dur = round(sum(durations) / len(durations) / 1000) if durations else None
            errors = [s.errors for s in sessions if s.errors is not None]
            avg_errors = round(sum(errors) / len(errors), 1) if errors else None
            scores = [analytics._accuracy(s) for s in sessions]
            scores = [s for s in scores if s is not None]
            trend = "improving" if len(scores) >= 2 and scores[0] > scores[-1] else \
                    "declining" if len(scores) >= 2 and scores[0] < scores[-1] else "stable"
        else:
            completion_rate = None
            avg_dur = None
            avg_errors = None
            trend = "unknown"

        label = GAME_LABELS[game_type]
        block = f"Game: {label} ({game_type})\n  Current level: {current}"
        if completion_rate is not None:
            block += f"\n  Completion rate: {completion_rate}%"
        if avg_dur is not None:
            block += f"\n  Average duration: {avg_dur}s"
        if avg_errors is not None:
            block += f"\n  Average errors: {avg_errors}"
        block += f"\n  Score trend: {trend}"
        block += f"\n  Sessions reviewed: {len(sessions)}"
        game_blocks.append(block)

    game_data = "\n\n".join(game_blocks)

    # ── Invoke chain ──────────────────────────────────────────────────────────
    result: CoachOutput = chain.invoke({
        "patient_name": patient.name.split()[0],  # first name only
        "game_data": game_data,
        "format_instructions": parser.get_format_instructions(),
    })

    # ── Build plan, clamping every level ─────────────────────────────────────
    plans = []
    for game_out in result.games:
        gt = game_out.game_type
        if gt not in session_data:
            continue
        current = session_data[gt]["current"]

        good_lvl = clamp(game_out.level_if_good, gt, current)
        ok_lvl   = clamp(game_out.level_if_ok,   gt, current)
        poor_lvl = clamp(game_out.level_if_poor,  gt, current)

        # Write DifficultyHistory rows for any change
        for branch_level, branch_reason in [
            (good_lvl,  game_out.reason_if_good),
            (ok_lvl,   game_out.reason_if_ok),
            (poor_lvl, game_out.reason_if_poor),
        ]:
            if branch_level != current:
                history_row = DifficultyHistory(
                    patient_id=patient.id,
                    game_type=gt,
                    domain=domain_for_game(gt),
                    from_level=current,
                    to_level=branch_level,
                    reason=branch_reason,
                    source="ai",
                    created_at=_now(),
                )
                db.add(history_row)

        plans.append({
            "game_type": gt,
            "current_level": current,
            "if_good":  {"level": good_lvl,  "reason": game_out.reason_if_good},
            "if_ok":    {"level": ok_lvl,    "reason": game_out.reason_if_ok},
            "if_poor":  {"level": poor_lvl,  "reason": game_out.reason_if_poor},
        })

    db.commit()

    # Ensure all four game types are represented
    covered = {p["game_type"] for p in plans}
    for game_type in GAME_TYPES:
        if game_type not in covered:
            current = session_data.get(game_type, {}).get("current", 1)
            label = GAME_LABELS[game_type]
            plans.append({
                "game_type": game_type,
                "current_level": current,
                "if_good":  {"level": clamp(current + 1, game_type, current), "reason": f"Doing beautifully — let's try a little more next time."},
                "if_ok":    {"level": clamp(current,     game_type, current), "reason": f"Steady and consistent — same level next time."},
                "if_poor":  {"level": clamp(current - 1, game_type, current), "reason": f"We'll take it a little easier next time."},
            })

    next_game = result.next_game if result.next_game in GAME_TYPES else _suggest_next_game(db, patient)

    return {
        "patient_id": patient.id,
        "generated_at": _now(),
        "source": "ai",
        "next_game": next_game,
        "plans": plans,
    }


def _rule_difficulty_plan(db: Session, patient: Patient, lookback: int) -> dict:
    """Deterministic plan. Runs offline, needs no key, always available."""
    plans = []

    for game_type in GAME_TYPES:
        sessions = (
            db.query(GameSession)
            .filter(GameSession.patient_id == patient.id)
            .filter(GameSession.game_type == game_type)
            .order_by(GameSession.created_at.desc())
            .limit(lookback)
            .all()
        )
        current = (sessions[0].new_level or sessions[0].level or 1) if sessions else 1
        label = GAME_LABELS[game_type]

        plans.append(
            {
                "game_type": game_type,
                "current_level": current,
                "if_good": {
                    "level": clamp(current + 1, game_type, current),
                    "reason": f"Doing well — {label} will step up a little.",
                },
                "if_ok": {
                    "level": clamp(current, game_type, current),
                    "reason": f"{label} stays at the same level next time.",
                },
                "if_poor": {
                    "level": clamp(current - 1, game_type, current),
                    "reason": f"{label} will be a little gentler next time.",
                },
            }
        )

    return {
        "patient_id": patient.id,
        "generated_at": _now(),
        "source": "rule",
        "next_game": _suggest_next_game(db, patient),
        "plans": plans,
    }


def _suggest_next_game(db: Session, patient: Patient) -> str | None:
    """Point at the weakest measured domain's game. The LLM version phrases
    this warmly; the choice itself stays arithmetic."""
    sessions = analytics.load_sessions(db, patient.id, days=30)
    if not sessions:
        return "memory"

    domains = analytics.domain_scores(db, patient.id, sessions)
    scored = [d for d in domains if d["score"] is not None and d["sessions"] > 0]
    if not scored:
        return "memory"

    weakest = min(scored, key=lambda d: d["score"])
    for game_type in GAME_TYPES:
        if domain_for_game(game_type) == weakest["domain"]:
            return game_type
    return "memory"


# ── Report Generator ──────────────────────────────────────────────────────────

def build_report(
    db: Session,
    patient: Patient,
    audience: str = "caregiver",
    period_days: int = 7,
    language: str = "en",
) -> dict:
    if is_available():
        try:
            return _llm_report(db, patient, audience, period_days, language)
        except Exception:
            pass  # fall through to rule engine
    return _rule_report(db, patient, audience, period_days, language)


def _llm_report(
    db: Session, patient: Patient, audience: str, period_days: int, language: str
) -> dict:
    """Report Generator chain.

    Assembles the same data as _rule_report, runs the LLM chain, persists to
    ai_reports, and returns the same four-section shape with source="ai".
    """
    from pydantic import BaseModel
    from langchain_core.output_parsers import PydanticOutputParser
    from langchain_core.prompts import ChatPromptTemplate

    from ..models import AIReport
    from .prompts import REPORT_SYSTEM, REPORT_HUMAN

    llm = get_llm()
    if llm is None:
        raise RuntimeError("No LLM available")

    # ── Pydantic output model ─────────────────────────────────────────────────
    class ReportOutput(BaseModel):
        summary: str
        trends: list[str]
        observations: list[str]
        suggestions: list[str]

    # ── Build parser and chain ────────────────────────────────────────────────
    parser: PydanticOutputParser[ReportOutput] = PydanticOutputParser(pydantic_object=ReportOutput)

    prompt = ChatPromptTemplate.from_messages([
        ("system", REPORT_SYSTEM),
        ("human", REPORT_HUMAN),
    ])

    chain = prompt | llm | parser

    # ── Assemble data (mirrors _rule_report) ──────────────────────────────────
    sessions = analytics.load_sessions(db, patient.id, days=period_days)
    domains = analytics.domain_scores(db, patient.id, sessions)
    adherence_pct = analytics.adherence(db, patient.id, days=period_days)

    domain_lines = []
    for d in domains:
        score_str = f"{d['score']}%" if d["score"] is not None else "not played"
        domain_lines.append(f"  {d['label']}: {score_str}, trend={d['trend']}, sessions={d['sessions']}")

    from ..models import DifficultyHistory as DH
    import json as _json
    difficulty_rows = (
        db.query(DH)
        .filter(DH.patient_id == patient.id)
        .filter(DH.created_at >= _now().replace(hour=0, minute=0, second=0) if False else DH.created_at)
        .order_by(DH.created_at.desc())
        .limit(20)
        .all()
    )
    difficulty_lines_list = []
    for row in difficulty_rows:
        reason_bit = f" ({row.reason})" if row.reason else ""
        difficulty_lines_list.append(
            f"  {row.game_type}: level {row.from_level} → {row.to_level}{reason_bit} [{row.source}]"
        )
    difficulty_lines = "\n".join(difficulty_lines_list) or "  No difficulty changes this period."

    lang_labels = {"en": "English", "hi": "Hindi", "as": "Assamese"}
    lang_label = lang_labels.get(language, language)

    # ── Invoke chain ──────────────────────────────────────────────────────────
    result: ReportOutput = chain.invoke({
        "patient_name": patient.name,
        "patient_age": patient.age or "unknown",
        "period_days": period_days,
        "audience": audience,
        "session_count": len(sessions),
        "adherence_pct": f"{adherence_pct}%" if adherence_pct is not None else "unknown",
        "domain_lines": "\n".join(domain_lines) or "  No session data.",
        "difficulty_lines": difficulty_lines,
        "language": lang_label,
        "format_instructions": parser.get_format_instructions(),
    })

    now = _now()

    # ── Persist to ai_reports ─────────────────────────────────────────────────
    content = {
        "summary": result.summary,
        "trends": result.trends,
        "observations": result.observations,
        "suggestions": result.suggestions,
    }
    import json as _json2
    report_row = AIReport(
        patient_id=patient.id,
        audience=audience,
        period_days=period_days,
        language=language,
        content_json=_json2.dumps(content),
        source="ai",
        created_at=now,
    )
    db.add(report_row)
    db.commit()

    return {
        "patient_id": patient.id,
        "audience": audience,
        "period_days": period_days,
        "language": language,
        "source": "ai",
        "generated_at": now,
        "summary": result.summary,
        "trends": result.trends,
        "observations": result.observations,
        "suggestions": result.suggestions,
    }


def _rule_report(
    db: Session, patient: Patient, audience: str, period_days: int, language: str
) -> dict:
    """Deterministic report. Plain, factual, and honest about what it is."""
    sessions = analytics.load_sessions(db, patient.id, days=period_days)
    domains = analytics.domain_scores(db, patient.id, sessions)
    trend = analytics.trend_of(sessions)
    adherence_pct = analytics.adherence(db, patient.id, days=period_days)

    rates = [
        r for r in (analytics._accuracy(s) for s in sessions) if r is not None
    ]
    overall = round(sum(rates) / len(rates) * 100) if rates else None

    name = patient.name
    if not sessions:
        summary = f"{name} has not played any sessions in the last {period_days} days."
    else:
        score_bit = f" with an overall score of {overall}%" if overall is not None else ""
        summary = (
            f"In the last {period_days} days, {name} completed {len(sessions)} "
            f"sessions{score_bit}. Performance is {trend}."
        )

    trends = [
        f"{d['label']}: {d['score']}% ({d['trend']})"
        for d in domains
        if d["score"] is not None
    ] or ["Not enough sessions to describe a trend yet."]

    observations = []
    scored = [d for d in domains if d["score"] is not None]
    if scored:
        best = max(scored, key=lambda d: d["score"])
        worst = min(scored, key=lambda d: d["score"])
        observations.append(f"Strongest area: {best['label']} at {best['score']}%.")
        observations.append(f"Weakest area: {worst['label']} at {worst['score']}%.")
    if adherence_pct is not None:
        observations.append(f"Reminder adherence: {adherence_pct}%.")
    untouched = [d["label"] for d in scored if d["sessions"] == 0]
    if untouched:
        observations.append(f"Not attempted this period: {', '.join(untouched)}.")

    risk = analytics.risk_band(
        trend, overall, adherence_pct, analytics.sudden_drop_z(sessions)
    )
    suggestions = analytics.recommended_actions(trend, domains, adherence_pct, risk)

    return {
        "patient_id": patient.id,
        "audience": audience,
        "period_days": period_days,
        "language": language,
        "source": "rule",
        "generated_at": _now(),
        "summary": summary,
        "trends": trends,
        "observations": observations or ["No observations for this period."],
        "suggestions": suggestions,
    }


# ── LLM factory — used by the chains ─────────────────────────────────────────

def get_llm():
    """Groq if a key exists, else Gemini, else None.

    Callers must handle None rather than raising: no key is a normal state in
    this app, not an error.
    """
    # Reasoning models (gpt-oss on Groq, Gemini 2.5) spend part of the token
    # budget thinking before they emit JSON — 1024 left the coach chain with
    # an empty completion. 4096 leaves room for both.
    if settings.groq_api_key:
        from langchain_groq import ChatGroq

        return ChatGroq(
            model=settings.groq_model,
            api_key=settings.groq_api_key,
            temperature=0.3,
            max_tokens=4096,
        )

    if settings.gemini_api_key:
        from langchain_google_genai import ChatGoogleGenerativeAI

        return ChatGoogleGenerativeAI(
            model=settings.gemini_model,
            google_api_key=settings.gemini_api_key,
            temperature=0.3,
            max_output_tokens=4096,
        )

    return None