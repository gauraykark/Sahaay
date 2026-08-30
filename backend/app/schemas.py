from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

Role = Literal["patient", "caregiver", "doctor"]


# ── Auth ──────────────────────────────────────────────────────────────────────

class UserRegister(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: Role = "caregiver"
    designation: str | None = None
    preferred_language: str = "en"


class UserOut(BaseModel):
    id: int
    name: str
    email: str
    role: str
    designation: str | None
    preferred_language: str
    created_at: datetime

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    preferred_language: str | None = None


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    name: str


# ── Patients ──────────────────────────────────────────────────────────────────

class PatientCreate(BaseModel):
    name: str
    age: int | None = None
    diagnosis_stage: str | None = None
    photo: str | None = None
    doctor_id: int | None = None
    preferred_language: str = "en"
    is_demo: bool = False


class PatientUpdate(BaseModel):
    name: str | None = None
    age: int | None = None
    diagnosis_stage: str | None = None
    photo: str | None = None
    doctor_id: int | None = None
    preferred_language: str | None = None


class PatientOut(BaseModel):
    id: int
    name: str
    age: int | None
    diagnosis_stage: str | None
    photo: str | None
    is_demo: bool
    caregiver_id: int
    doctor_id: int | None
    preferred_language: str
    last_sync_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Game sessions ─────────────────────────────────────────────────────────────

class GameSessionCreate(BaseModel):
    """One session pushed up from the Dexie offline queue.

    The client maps its camelCase row onto these names before sending — see
    api.js toSyncPayload(). `domain` now comes FROM the client: the device
    knows which domain it was measuring, and resolving it server-side froze a
    four-domain label into every historical row. The server still falls back
    to domain_for_game() when an older client omits it.
    """
    dexie_id: int | None = None
    patient_id: int
    game_type: str
    domain: str | None = None
    score: float | None = None
    total: float | None = None
    moves: int | None = None
    errors: int | None = None
    level: int | None = None
    new_level: int | None = None
    duration_ms: int | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    completed: bool = True

    # "completed" | "abandoned". Defaults to completed so an older client that
    # does not send it keeps working. A quit round sends "abandoned" with null
    # scores for what was not played -- never 0, which would be
    # indistinguishable from a genuinely scored zero.
    status: Literal["completed", "abandoned"] = "completed"

    # Ids of the items shown, for the 14-day no-repeat rule.
    item_ids: list[str] | None = None
    # Groups the rounds of one sitting.
    session_id: str | None = None

    created_at: datetime | None = None
    reason: str | None = None
    source: str = "rule"


class GameSessionOut(BaseModel):
    id: int
    dexie_id: int | None
    patient_id: int
    game_type: str
    domain: str
    status: str
    session_id: str | None
    score: float | None
    total: float | None
    moves: int | None
    errors: int | None
    level: int | None
    new_level: int | None
    duration_ms: int | None
    completed: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class SyncRequest(BaseModel):
    sessions: list[GameSessionCreate]


class SyncResponse(BaseModel):
    synced: int
    skipped: int
    server_time: datetime


# ── Reminders ─────────────────────────────────────────────────────────────────

class ReminderCreate(BaseModel):
    dexie_id: int | None = None
    patient_id: int
    reminder_type: str          # medicine | hydration | activity | appointment
    title: str
    scheduled_time: str         # "HH:MM"
    days_of_week: str = "daily"


class ReminderUpdate(BaseModel):
    title: str | None = None
    scheduled_time: str | None = None
    days_of_week: str | None = None
    is_active: bool | None = None


class ReminderOut(BaseModel):
    id: int
    dexie_id: int | None
    caregiver_id: int
    patient_id: int
    reminder_type: str
    title: str
    scheduled_time: str
    days_of_week: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class ReminderLogCreate(BaseModel):
    reminder_id: int
    patient_id: int
    due_at: datetime
    acted_at: datetime | None = None
    status: Literal["done", "missed", "pending"] = "pending"


class ReminderLogOut(BaseModel):
    id: int
    reminder_id: int
    patient_id: int
    due_at: datetime
    acted_at: datetime | None
    status: str

    model_config = {"from_attributes": True}


# ── Difficulty history ────────────────────────────────────────────────────────

class DifficultyHistoryOut(BaseModel):
    id: int
    game_type: str
    domain: str
    from_level: int
    to_level: int
    reason: str | None
    source: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Clinical notes ────────────────────────────────────────────────────────────

class ClinicalNoteCreate(BaseModel):
    body: str
    needs_followup: bool = False


class ClinicalNoteOut(BaseModel):
    id: int
    patient_id: int
    doctor_id: int
    body: str
    ai_summary: str | None
    needs_followup: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Analytics (Doctor Dashboard) ──────────────────────────────────────────────

class DomainScore(BaseModel):
    """One of the six mini-scores on a patient card."""
    domain: str
    label: str
    score: int | None = Field(None, description="0-100, null when never played")
    # Nullable, and the distinction matters: null means nobody has calibrated
    # this domain, 0 means calibrated at the bottom of the 0-15 scale. A
    # non-nullable int here would have forced one of those to lie.
    level: int | None = Field(None, description="0-15, null when uncalibrated")
    trend: Literal["improving", "stable", "declining", "unknown"]
    sessions: int


class PatientCardOut(BaseModel):
    """Everything one Smart Patient Card needs, in a single payload.

    Deliberately denormalised — the dashboard must render without follow-up
    requests or per-card model calls.
    """
    id: int
    name: str
    age: int | None
    photo: str | None
    caregiver_name: str
    last_active: datetime | None
    last_sync_at: datetime | None
    is_offline: bool
    adherence: int | None
    overall_score: int | None
    trend: Literal["improving", "stable", "declining", "unknown"]
    reason: str
    risk: Literal["low", "medium", "high"]
    domains: list[DomainScore]
    sessions_this_week: int


class PriorityItem(BaseModel):
    """One line in the Today's Priority strip."""
    patient_id: int
    patient_name: str
    headline: str
    reason: str
    severity: Literal["low", "medium", "high"]


class AssistantPanelOut(BaseModel):
    """The AI Clinical Assistant sidebar."""
    improving: list[PriorityItem]
    sudden_drop: list[PriorityItem]
    difficulty_changes_today: list[DifficultyHistoryOut]


class DoctorDashboardOut(BaseModel):
    doctor_name: str
    designation: str | None
    total_patients: int
    priority: list[PriorityItem]
    patients: list[PatientCardOut]
    assistant: AssistantPanelOut


class TrendPoint(BaseModel):
    date: str
    score: int | None
    sessions: int


class ClinicalViewOut(BaseModel):
    """The single-patient deep dive."""
    patient: PatientOut
    caregiver_name: str
    caregiver_email: str
    overall_score: int | None
    previous_score: int | None
    percentile: int | None
    adherence: int | None
    domains: list[DomainScore]
    trend_30d: list[TrendPoint]
    difficulty_history: list[DifficultyHistoryOut]
    notes: list[ClinicalNoteOut]
    recommended_actions: list[str]
    routine_steps: list[str]
    # None = the server has no visibility into the device-local Memory Vault,
    # which is different from "the vault is empty".
    people_count: int | None
    latest_report: dict | None


# ── AI (Phase 3 — stubs today) ────────────────────────────────────────────────

class AdaptDifficultyRequest(BaseModel):
    patient_id: int
    lookback_sessions: int = 8


class PlanBranch(BaseModel):
    level: int
    reason: str


class GamePlan(BaseModel):
    """A cached multi-branch plan for one game.

    The device applies whichever branch matches the round it just finished,
    so adaptivity works with no network. See g_prop_02_architecture.md D3.
    """
    game_type: str
    current_level: int
    if_good: PlanBranch
    if_ok: PlanBranch
    if_poor: PlanBranch


class AdaptDifficultyResponse(BaseModel):
    patient_id: int
    generated_at: datetime
    source: Literal["ai", "rule"]
    next_game: str | None
    plans: list[GamePlan]


class GenerateReportRequest(BaseModel):
    patient_id: int
    audience: Literal["caregiver", "doctor"] = "caregiver"
    period_days: int = 7
    language: str = "en"


class GenerateReportResponse(BaseModel):
    patient_id: int
    audience: str
    period_days: int
    language: str
    source: Literal["ai", "rule"]
    generated_at: datetime
    summary: str
    trends: list[str]
    observations: list[str]
    suggestions: list[str]