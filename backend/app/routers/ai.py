

import json
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import CurrentUser, resolve_patient_access
from ..config import settings
from ..database import get_db
from ..models import AIReport
from ..schemas import (
    AdaptDifficultyRequest,
    AdaptDifficultyResponse,
    GenerateReportRequest,
    GenerateReportResponse,
)
from ..services import agents

router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/status")
def ai_status():
    """What the AI layer can do right now.

    The frontend reads this to label guidance as AI-written or offline, rather
    than guessing. See the mode indicator in the architecture doc (D11).
    """
    return {
        "key_configured": settings.ai_configured,
        "chains_implemented": agents.is_available(),
        "provider": "groq" if settings.groq_api_key else ("gemini" if settings.gemini_api_key else None),
        "mode": "ai" if agents.is_available() else "rule",
    }


@router.post("/adapt-difficulty", response_model=AdaptDifficultyResponse)
def adapt_difficulty(
    body: AdaptDifficultyRequest,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
):
    """Return a cached-plan payload for every game.

    The response is a plan, not a single level: the next round's outcome is
    unknown, so the device needs a branch for each. It stores this and applies
    the matching branch offline. See architecture D3.
    """
    patient = resolve_patient_access(user, body.patient_id, db)
    return agents.build_difficulty_plan(db, patient, lookback=body.lookback_sessions)


@router.post("/generate-report", response_model=GenerateReportResponse)
def generate_report(
    body: GenerateReportRequest,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
):
    """Generate and persist a progress report.

    Persisted every time so the doctor dashboard can read the latest one
    instead of generating on page load — twenty patients means twenty model
    calls otherwise.
    """
    patient = resolve_patient_access(user, body.patient_id, db)

    report = agents.build_report(
        db,
        patient,
        audience=body.audience,
        period_days=body.period_days,
        language=body.language,
    )

    db.add(
        AIReport(
            patient_id=patient.id,
            audience=report["audience"],
            period_days=report["period_days"],
            language=report["language"],
            source=report["source"],
            content_json=json.dumps(
                {
                    "summary": report["summary"],
                    "trends": report["trends"],
                    "observations": report["observations"],
                    "suggestions": report["suggestions"],
                }
            ),
        )
    )
    db.commit()

    return report
