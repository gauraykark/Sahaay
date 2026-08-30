from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from ..auth import (
    CurrentUser,
    create_access_token,
    hash_password,
    verify_password,
)
from ..database import get_db
from ..models import ROLES, ROLE_DOCTOR, User
from ..schemas import Token, UserOut, UserRegister, UserUpdate

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserOut, status_code=201)
def register(body: UserRegister, db: Annotated[Session, Depends(get_db)]):
    if body.role not in ROLES:
        raise HTTPException(status_code=400, detail=f"role must be one of {ROLES}")

    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        name=body.name,
        email=body.email,
        role=body.role,
        # Only doctors carry a designation — it shows in the dashboard header.
        designation=body.designation if body.role == ROLE_DOCTOR else None,
        preferred_language=body.preferred_language,
        hashed_password=hash_password(body.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/token", response_model=Token)
def login(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: Annotated[Session, Depends(get_db)],
):
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Role travels in the token and in the response, so the frontend can route
    # straight to the right dashboard without a second request.
    return Token(
        access_token=create_access_token(user.id, user.role),
        role=user.role,
        name=user.name,
    )


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser):
    return user


@router.patch("/me", response_model=UserOut)
def update_me(
    body: UserUpdate,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
):
    if body.preferred_language is not None:
        user.preferred_language = body.preferred_language
    db.commit()
    db.refresh(user)
    return user


@router.get("/doctors", response_model=list[UserOut])
def list_doctors(db: Annotated[Session, Depends(get_db)]):
    """Doctors available to assign a patient to.

    Open on purpose: a caregiver registering a patient has to pick one, and
    name plus designation is not sensitive.
    """
    return db.query(User).filter(User.role == ROLE_DOCTOR).all()