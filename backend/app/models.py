from datetime import datetime, timezone

from sqlalchemy import (
    Integer, String, Float, Boolean, Text,
    DateTime, ForeignKey, UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Roles ─────────────────────────────────────────────────────────────────────
# Three roles, one users table, one role column — per the requirements PDF:
#   "You can implement roles with a simple role column in your SQLite users
#    table (patient | caregiver | doctor)."

ROLE_PATIENT = "patient"
ROLE_CAREGIVER = "caregiver"
ROLE_DOCTOR = "doctor"
ROLES = (ROLE_PATIENT, ROLE_CAREGIVER, ROLE_DOCTOR)


class User(Base):
    """Every human who can authenticate. Replaces the old Caregiver model.

    Relationship rules enforced elsewhere (auth.resolve_patient_access):
      Doctor  (1) -> Patient (many)
      Patient (1) -> Caregiver (1)
    """
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, index=True)

    # Doctors only — shown in the dashboard header ("Geriatric Care").
    designation: Mapped[str | None] = mapped_column(String(120), nullable=True)

    # Multilingual readiness: the structure carries language even before the
    # i18n layer exists. en | hi | as
    preferred_language: Mapped[str] = mapped_column(String(8), default="en")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    patients_as_doctor: Mapped[list["Patient"]] = relationship(
        "Patient", foreign_keys="Patient.doctor_id", back_populates="doctor"
    )
    patient_as_caregiver: Mapped["Patient | None"] = relationship(
        "Patient", foreign_keys="Patient.caregiver_id", back_populates="caregiver",
        uselist=False,
    )


class Patient(Base):
    """A patient record.

    caregiver_id is UNIQUE — one patient has exactly one caregiver, which is
    the relationship the requirements specify. doctor_id is a plain FK, so one
    doctor holds many patients.
    """
    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # Optional login for the patient themselves (recognition-based on device).
    user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True, unique=True
    )
    caregiver_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False, unique=True, index=True
    )
    doctor_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True, index=True
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Clinical header on the doctor's single-patient view. Free text so the
    # app never has to assert a diagnosis it cannot support.
    diagnosis_stage: Mapped[str | None] = mapped_column(String(80), nullable=True)

    photo: Mapped[str | None] = mapped_column(Text, nullable=True)
    preferred_language: Mapped[str] = mapped_column(String(8), default="en")

    # Source for the dashboard's offline indicator. Null = never synced.
    last_sync_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    caregiver: Mapped["User"] = relationship(
        "User", foreign_keys=[caregiver_id], back_populates="patient_as_caregiver"
    )
    doctor: Mapped["User | None"] = relationship(
        "User", foreign_keys=[doctor_id], back_populates="patients_as_doctor"
    )
    account: Mapped["User | None"] = relationship("User", foreign_keys=[user_id])

    game_sessions: Mapped[list["GameSession"]] = relationship(
        "GameSession", back_populates="patient", cascade="all, delete-orphan"
    )
    reminders: Mapped[list["Reminder"]] = relationship(
        "Reminder", back_populates="patient", cascade="all, delete-orphan"
    )
    difficulty_history: Mapped[list["DifficultyHistory"]] = relationship(
        "DifficultyHistory", back_populates="patient", cascade="all, delete-orphan"
    )
    clinical_notes: Mapped[list["ClinicalNote"]] = relationship(
        "ClinicalNote", back_populates="patient", cascade="all, delete-orphan"
    )
    ai_reports: Mapped[list["AIReport"]] = relationship(
        "AIReport", back_populates="patient", cascade="all, delete-orphan"
    )


class GameSession(Base):
    """One completed (or abandoned) round of any of the four games.

    Mirrors the Dexie gameSessions table so /sessions/sync can upsert rows
    from the offline queue without data loss.
    """
    __tablename__ = "game_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    # Device-local Dexie id, kept so re-syncs deduplicate.
    dexie_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    patient_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("patients.id"), nullable=False, index=True
    )

    game_type: Mapped[str] = mapped_column(String(50), nullable=False)
    # Resolved from game_type at write time (domains.domain_for_game) so the
    # dashboard never has to compute it on read.
    domain: Mapped[str] = mapped_column(String(30), nullable=False, index=True)

    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    total: Mapped[float | None] = mapped_column(Float, nullable=True)
    moves: Mapped[int | None] = mapped_column(Integer, nullable=True)
    errors: Mapped[int | None] = mapped_column(Integer, nullable=True)

    level: Mapped[int | None] = mapped_column(Integer, nullable=True)
    new_level: Mapped[int | None] = mapped_column(Integer, nullable=True)

    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, index=True
    )

    patient: Mapped["Patient"] = relationship("Patient", back_populates="game_sessions")

    __table_args__ = (
        UniqueConstraint("patient_id", "dexie_id", name="uq_session_patient_dexie"),
    )


class DifficultyHistory(Base):
    """Every difficulty change, with the reason that produced it.

    Powers the doctor's "AI Adaptive History" timeline and the AI Clinical
    Assistant's "AI Difficulty Changes today" panel.

    `source` is "rule" or "ai" — the dashboard labels which one decided, so
    the offline fallback is visible rather than hidden.
    """
    __tablename__ = "difficulty_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    patient_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("patients.id"), nullable=False, index=True
    )
    game_type: Mapped[str] = mapped_column(String(50), nullable=False)
    domain: Mapped[str] = mapped_column(String(30), nullable=False)

    from_level: Mapped[int] = mapped_column(Integer, nullable=False)
    to_level: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(10), default="rule")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, index=True
    )

    patient: Mapped["Patient"] = relationship("Patient", back_populates="difficulty_history")


class Reminder(Base):
    """A scheduled reminder — medicine, hydration, activity, or appointment."""
    __tablename__ = "reminders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    dexie_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    caregiver_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    patient_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("patients.id"), nullable=False, index=True
    )

    reminder_type: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    scheduled_time: Mapped[str] = mapped_column(String(10), nullable=False)   # "HH:MM"
    days_of_week: Mapped[str] = mapped_column(String(20), default="daily")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    patient: Mapped["Patient"] = relationship("Patient", back_populates="reminders")
    logs: Mapped[list["ReminderLog"]] = relationship(
        "ReminderLog", back_populates="reminder", cascade="all, delete-orphan"
    )


class ReminderLog(Base):
    """One firing of a reminder, and whether it was acted on.

    This is the only possible source for the adherence % the requirements put
    on every patient card and in every report. Without it, adherence cannot be
    computed at all.
    """
    __tablename__ = "reminder_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    reminder_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("reminders.id"), nullable=False, index=True
    )
    patient_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("patients.id"), nullable=False, index=True
    )

    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    acted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # done | missed | pending
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)

    reminder: Mapped["Reminder"] = relationship("Reminder", back_populates="logs")


class ClinicalNote(Base):
    """A doctor's note on a patient, plus the AI progress summary beside it.

    `body` is written by the doctor. `ai_summary` is generated (Phase 3) and
    is never edited in place — a new row is written instead, so the history
    stays intact.
    """
    __tablename__ = "clinical_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    patient_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("patients.id"), nullable=False, index=True
    )
    doctor_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)

    body: Mapped[str] = mapped_column(Text, nullable=False)
    ai_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    needs_followup: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, index=True
    )

    patient: Mapped["Patient"] = relationship("Patient", back_populates="clinical_notes")


class AIReport(Base):
    """A generated progress report, stored for history.

    audience: caregiver | doctor
    content_json holds the structured output (summary, trends, observations,
    suggestions) so the UI renders sections rather than a wall of prose.
    """
    __tablename__ = "ai_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    patient_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("patients.id"), nullable=False, index=True
    )

    audience: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    period_days: Mapped[int] = mapped_column(Integer, default=7)
    language: Mapped[str] = mapped_column(String(8), default="en")

    content_json: Mapped[str] = mapped_column(Text, nullable=False)
    # "ai" once the agents land; "rule" for the deterministic fallback.
    source: Mapped[str] = mapped_column(String(10), default="rule")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, index=True
    )

    patient: Mapped["Patient"] = relationship("Patient", back_populates="ai_reports")
