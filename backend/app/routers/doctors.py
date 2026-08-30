import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import DoctorUser, resolve_patient_access
from ..database import get_db
from ..models import AIReport, ClinicalNote, DifficultyHistory, Patient, Reminder, ROLE_CAREGIVER, User
from ..schemas import (
    ClinicalNoteCreate,
    ClinicalNoteOut,
    ClinicalViewOut,
    DoctorDashboardOut,
    PatientOut,
    UserOut,
)
from ..services import analytics

router = APIRouter(prefix="/doctors", tags=["doctors"])


@router.get("/me/patients", response_model=DoctorDashboardOut)
def dashboard(
    doctor: DoctorUser,
    db: Annotated[Session, Depends(get_db)],
    include_demo: bool = False,
):
    """Everything the Doctor Dashboard renders, in a single payload.

    Demo patients are hidden by default so the caseload shows only real,
    locally created patients. Pass ?include_demo=true to show the seeded
    board (useful when presenting the analytics on a full caseload).
    """
    query = db.query(Patient).filter(Patient.doctor_id == doctor.id)
    if not include_demo:
        query = query.filter(Patient.is_demo.is_(False))
    patients = query.all()

    cards = [analytics.build_patient_card(db, patient) for patient in patients]
    # Most urgent first, so the list matches the priority strip above it.
    risk_rank = {"high": 0, "medium": 1, "low": 2}
    cards.sort(key=lambda c: (risk_rank[c["risk"]], c["name"].lower()))

    return {
        "doctor_name": doctor.name,
        "designation": doctor.designation,
        "total_patients": len(patients),
        "priority": analytics.build_priority(cards),
        "patients": cards,
        "assistant": analytics.build_assistant(db, cards, doctor.id),
    }


@router.get("/patients/{patient_id}/clinical", response_model=ClinicalViewOut)
def clinical_view(
    patient_id: int,
    doctor: DoctorUser,
    db: Annotated[Session, Depends(get_db)],
):
    patient = resolve_patient_access(doctor, patient_id, db)

    sessions_30 = analytics.load_sessions(db, patient.id, days=30)
    sessions_60 = analytics.load_sessions(db, patient.id, days=60)

    rates_30 = [
        r for r in (analytics._accuracy(s) for s in sessions_30) if r is not None
    ]
    overall = round(sum(rates_30) / len(rates_30) * 100) if rates_30 else None

    # Previous period = the 30 days before the current 30, so the comparison
    # the requirements ask for is like-for-like.
    recent_ids = {s.id for s in sessions_30}
    previous = [s for s in sessions_60 if s.id not in recent_ids]
    rates_prev = [
        r for r in (analytics._accuracy(s) for s in previous) if r is not None
    ]
    previous_score = (
        round(sum(rates_prev) / len(rates_prev) * 100) if rates_prev else None
    )

    domains = analytics.domain_scores(db, patient.id, sessions_30)
    trend = analytics.trend_of(sessions_30)
    adherence_pct = analytics.adherence(db, patient.id)
    risk = analytics.risk_band(
        trend, overall, adherence_pct, analytics.sudden_drop_z(sessions_30)
    )

    history = (
        db.query(DifficultyHistory)
        .filter(DifficultyHistory.patient_id == patient.id)
        .order_by(DifficultyHistory.created_at.desc())
        .limit(20)
        .all()
    )

    notes = (
        db.query(ClinicalNote)
        .filter(ClinicalNote.patient_id == patient.id)
        .order_by(ClinicalNote.created_at.desc())
        .limit(20)
        .all()
    )

    # Daily Guidance, read-only for the doctor.
    routine = (
        db.query(Reminder)
        .filter(Reminder.patient_id == patient.id, Reminder.is_active.is_(True))
        .order_by(Reminder.scheduled_time.asc())
        .all()
    )

    latest_report = (
        db.query(AIReport)
        .filter(AIReport.patient_id == patient.id, AIReport.audience == "doctor")
        .order_by(AIReport.created_at.desc())
        .first()
    )

    return {
        "patient": PatientOut.model_validate(patient),
        "caregiver_name": patient.caregiver.name if patient.caregiver else "—",
        "caregiver_email": patient.caregiver.email if patient.caregiver else "—",
        "overall_score": overall,
        "previous_score": previous_score,
        "percentile": analytics.percentile_against(db, doctor.id, overall),
        "adherence": adherence_pct,
        "domains": domains,
        "trend_30d": analytics.trend_series(sessions_30, days=30),
        "difficulty_history": history,
        "notes": notes,
        "recommended_actions": analytics.recommended_actions(
            trend, domains, adherence_pct, risk
        ),
        "routine_steps": [f"{r.scheduled_time} · {r.title}" for r in routine],
        # null, not 0. Memory Vault people live only in the caregiver device's
        # IndexedDB (Dexie table `vaultPeople`) — there is no server table and
        # no sync endpoint, so the server cannot know the count. Reporting 0
        # would assert an empty vault we have no basis to claim.
        "people_count": None,
        "latest_report": json.loads(latest_report.content_json) if latest_report else None,
    }


@router.post(
    "/patients/{patient_id}/notes", response_model=ClinicalNoteOut, status_code=201
)
def add_note(
    patient_id: int,
    body: ClinicalNoteCreate,
    doctor: DoctorUser,
    db: Annotated[Session, Depends(get_db)],
):
    resolve_patient_access(doctor, patient_id, db)

    if not body.body.strip():
        raise HTTPException(status_code=400, detail="Note cannot be empty")

    note = ClinicalNote(
        patient_id=patient_id,
        doctor_id=doctor.id,
        body=body.body.strip(),
        needs_followup=body.needs_followup,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


@router.get("/patients/{patient_id}/notes", response_model=list[ClinicalNoteOut])
def list_notes(
    patient_id: int,
    doctor: DoctorUser,
    db: Annotated[Session, Depends(get_db)],
):
    resolve_patient_access(doctor, patient_id, db)
    return (
        db.query(ClinicalNote)
        .filter(ClinicalNote.patient_id == patient_id)
        .order_by(ClinicalNote.created_at.desc())
        .all()
    )


@router.post("/patients/{patient_id}/assign", response_model=PatientOut)
def assign_to_me(
    patient_id: int,
    doctor: DoctorUser,
    db: Annotated[Session, Depends(get_db)],
):
    """Take an unassigned patient onto this doctor's caseload."""
    patient = db.get(Patient, patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    if patient.doctor_id not in (None, doctor.id):
        raise HTTPException(
            status_code=409, detail="This patient is already assigned to another doctor"
        )

    patient.doctor_id = doctor.id
    db.commit()
    db.refresh(patient)
    return patient


@router.get("/caregivers", response_model=list[UserOut])
def list_caregivers(doctor: DoctorUser, db: Annotated[Session, Depends(get_db)]):
    """Every caregiver whose patient is (or could be) on this doctor's caseload.
    Used by the Manage screen so a doctor can see caregiver contact details
    and, for unassigned patients, pull them onto their own caseload.
    """
    return (
        db.query(User)
        .filter(User.role == ROLE_CAREGIVER)
        .order_by(User.name.asc())
        .all()
    )


@router.delete("/patients/{patient_id}", status_code=204)
def remove_patient(
    patient_id: int,
    doctor: DoctorUser,
    db: Annotated[Session, Depends(get_db)],
):
    """Doctor-side patient removal.
    Unlike the caregiver-only DELETE on /patients/{id}, this lets a doctor
    remove a patient from their own caseload. It deletes the patient record
    entirely (cascades to sessions/notes/reports), matching what the
    caregiver-side delete already does — there is no separate "unassign vs
    delete" distinction in the data model today.
    """
    patient = resolve_patient_access(doctor, patient_id, db)
    db.delete(patient)
    db.commit()


@router.post("/patients/{patient_id}/unassign", response_model=PatientOut)
def unassign_patient(
    patient_id: int,
    doctor: DoctorUser,
    db: Annotated[Session, Depends(get_db)],
):
    """Detach a patient from this doctor without deleting their record.
    Leaves the patient and their caregiver intact, and available for another
    doctor to pick up via POST /patients/{id}/assign.
    """
    patient = resolve_patient_access(doctor, patient_id, db)
    patient.doctor_id = None
    db.commit()
    db.refresh(patient)
    return patient