

from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .models import ROLE_CAREGIVER, ROLE_DOCTOR, ROLE_PATIENT, Patient, User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")


class TokenData(BaseModel):
    user_id: int | None = None
    role: str | None = None


# ── Password helpers ──────────────────────────────────────────────────────────

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


# ── JWT helpers ───────────────────────────────────────────────────────────────

def create_access_token(user_id: int, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.access_token_expire_minutes
    )
    payload = {"sub": str(user_id), "role": role, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_token(token: str) -> TokenData:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        return TokenData(user_id=int(payload.get("sub")), role=payload.get("role"))
    except (JWTError, TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ── Current user ──────────────────────────────────────────────────────────────

def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    token_data = decode_token(token)
    user = db.get(User, token_data.user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found"
        )
    return user


def require_role(*roles: str):
    """Dependency factory: restrict an endpoint to one or more roles."""

    def _guard(user: Annotated[User, Depends(get_current_user)]) -> User:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This action requires the {' or '.join(roles)} role",
            )
        return user

    return _guard


# Convenience aliases used across routers.
CurrentUser = Annotated[User, Depends(get_current_user)]
DoctorUser = Annotated[User, Depends(require_role(ROLE_DOCTOR))]
CaregiverUser = Annotated[User, Depends(require_role(ROLE_CAREGIVER))]


# ── The single access rule ────────────────────────────────────────────────────

def resolve_patient_access(user: User, patient_id: int, db: Session) -> Patient:
    """Return the patient if this user may see them, else 404.

    404 rather than 403 on purpose — a caregiver probing ids should not be
    able to learn which patient ids exist.
    """
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient not found")

    if user.role == ROLE_DOCTOR and patient.doctor_id == user.id:
        return patient
    if user.role == ROLE_CAREGIVER and patient.caregiver_id == user.id:
        return patient
    if user.role == ROLE_PATIENT and patient.user_id == user.id:
        return patient

    raise HTTPException(status_code=404, detail="Patient not found")


def visible_patients(user: User, db: Session) -> list[Patient]:
    """Every patient this user may see. Empty list rather than an error.

    Doctors never see seeded demo patients here — their caseload lists only
    real, locally created patients. (Caregivers are already scoped to their
    own patient, and a seeded caregiver login is itself demo context.)
    """
    if user.role == ROLE_DOCTOR:
        return (
            db.query(Patient)
            .filter(Patient.doctor_id == user.id, Patient.is_demo.is_(False))
            .all()
        )
    if user.role == ROLE_CAREGIVER:
        return db.query(Patient).filter(Patient.caregiver_id == user.id).all()
    if user.role == ROLE_PATIENT:
        return db.query(Patient).filter(Patient.user_id == user.id).all()
    return []
