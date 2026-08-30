from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import CurrentUser, resolve_patient_access
from ..database import get_db
from ..models import ROLE_CAREGIVER, Reminder, ReminderLog
from ..schemas import (
    ReminderCreate,
    ReminderLogCreate,
    ReminderLogOut,
    ReminderOut,
    ReminderUpdate,
)

router = APIRouter(prefix="/reminders", tags=["reminders"])


def _editable_reminder(reminder_id: int, user, db: Session) -> Reminder:
    """A reminder the caller may change. Doctors read; caregivers write."""
    reminder = db.get(Reminder, reminder_id)
    if not reminder:
        raise HTTPException(status_code=404, detail="Reminder not found")

    resolve_patient_access(user, reminder.patient_id, db)

    if user.role != ROLE_CAREGIVER:
        raise HTTPException(
            status_code=403,
            detail="Reminders are read-only for this role",
        )
    return reminder


@router.post("", response_model=ReminderOut, status_code=201)
def create_reminder(
    body: ReminderCreate,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
):
    resolve_patient_access(user, body.patient_id, db)
    if user.role != ROLE_CAREGIVER:
        raise HTTPException(status_code=403, detail="Only a caregiver can set reminders")

    reminder = Reminder(**body.model_dump(), caregiver_id=user.id)
    db.add(reminder)
    db.commit()
    db.refresh(reminder)
    return reminder


@router.get("/{patient_id}", response_model=list[ReminderOut])
def list_reminders(
    patient_id: int,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
):
    """Readable by caregiver and doctor alike — the doctor's clinical view
    shows Daily Guidance read-only, which needs this."""
    resolve_patient_access(user, patient_id, db)
    return db.query(Reminder).filter(Reminder.patient_id == patient_id).all()


@router.patch("/{reminder_id}", response_model=ReminderOut)
def update_reminder(
    reminder_id: int,
    body: ReminderUpdate,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
):
    reminder = _editable_reminder(reminder_id, user, db)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(reminder, field, value)
    db.commit()
    db.refresh(reminder)
    return reminder


@router.delete("/{reminder_id}", status_code=204)
def delete_reminder(
    reminder_id: int,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
):
    reminder = _editable_reminder(reminder_id, user, db)
    db.delete(reminder)
    db.commit()


# ── Logs ──────────────────────────────────────────────────────────────────────
# Every firing is recorded here. This is the only source for adherence %,
# which the requirements put on every patient card and in every report.

@router.post("/logs", response_model=ReminderLogOut, status_code=201)
def record_reminder_log(
    body: ReminderLogCreate,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
):
    resolve_patient_access(user, body.patient_id, db)

    log = ReminderLog(**body.model_dump())
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


@router.get("/logs/{patient_id}", response_model=list[ReminderLogOut])
def list_reminder_logs(
    patient_id: int,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    limit: int = 100,
):
    resolve_patient_access(user, patient_id, db)
    return (
        db.query(ReminderLog)
        .filter(ReminderLog.patient_id == patient_id)
        .order_by(ReminderLog.due_at.desc())
        .limit(limit)
        .all()
    )
