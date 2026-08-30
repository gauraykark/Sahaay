from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import CurrentUser, resolve_patient_access, visible_patients
from ..database import get_db
from ..models import ROLE_CAREGIVER, Patient
from ..schemas import PatientCreate, PatientOut, PatientUpdate

router = APIRouter(prefix="/patients", tags=["patients"])


@router.post("", response_model=PatientOut, status_code=201)
def create_patient(
    body: PatientCreate,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
):
    """Caregivers create patients. One caregiver, one patient.

    The 1:1 rule is a unique constraint on the column, but it is checked here
    too so the caller gets a readable message instead of an IntegrityError.
    """
    if user.role != ROLE_CAREGIVER:
        raise HTTPException(
            status_code=403, detail="Only a caregiver can create a patient record"
        )

    existing = db.query(Patient).filter(Patient.caregiver_id == user.id).first()
    if existing:
        raise HTTPException(
            status_code=400,
            detail="This caregiver already has a patient. One caregiver supports one patient.",
        )

    patient = Patient(**body.model_dump(), caregiver_id=user.id)
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return patient


@router.get("", response_model=list[PatientOut])
def list_patients(user: CurrentUser, db: Annotated[Session, Depends(get_db)]):
    """Scoped by role — a doctor sees their caseload, a caregiver sees one."""
    return visible_patients(user, db)


@router.get("/{patient_id}", response_model=PatientOut)
def get_patient(
    patient_id: int,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
):
    return resolve_patient_access(user, patient_id, db)


@router.patch("/{patient_id}", response_model=PatientOut)
def update_patient(
    patient_id: int,
    body: PatientUpdate,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
):
    patient = resolve_patient_access(user, patient_id, db)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(patient, field, value)
    db.commit()
    db.refresh(patient)
    return patient


@router.delete("/{patient_id}", status_code=204)
def delete_patient(
    patient_id: int,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
):
    patient = resolve_patient_access(user, patient_id, db)
    if user.role != ROLE_CAREGIVER:
        raise HTTPException(
            status_code=403, detail="Only the patient's caregiver can delete this record"
        )
    db.delete(patient)
    db.commit()
