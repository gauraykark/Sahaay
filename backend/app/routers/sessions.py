from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import CurrentUser, resolve_patient_access
from ..database import get_db
from ..domains import domain_for_game
from ..models import DifficultyHistory, GameSession, Patient
from ..schemas import GameSessionOut, SyncRequest, SyncResponse

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.get("/{patient_id}", response_model=list[GameSessionOut])
def list_sessions(
    patient_id: int,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    game_type: str | None = None,
    limit: int = 50,
):
    resolve_patient_access(user, patient_id, db)

    query = db.query(GameSession).filter(GameSession.patient_id == patient_id)
    if game_type:
        query = query.filter(GameSession.game_type == game_type)
    return query.order_by(GameSession.created_at.desc()).limit(limit).all()


@router.post("/sync", response_model=SyncResponse)
def sync_sessions(
    body: SyncRequest,
    user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
):
    """Accept batched offline sessions from the Dexie queue.

    Deduplicated by (patient_id, dexie_id) so retries are safe — a device that
    loses signal mid-push can resend the whole batch without creating doubles.

    Touching last_sync_at here is what feeds the dashboard's offline
    indicator: the absence of a sync is itself the signal.
    """
    synced = 0
    skipped = 0
    touched: set[int] = set()
    # In-batch dedup: the DB query below cannot see rows added earlier in this
    # same loop (autoflush is off), so a queue that was retried mid-push would
    # otherwise hit the unique constraint and 500 the whole batch.
    seen: set[tuple[int, int]] = set()

    for item in body.sessions:
        try:
            patient = resolve_patient_access(user, item.patient_id, db)
        except Exception:
            skipped += 1
            continue

        if item.dexie_id is not None:
            key = (item.patient_id, item.dexie_id)
            if key in seen:
                skipped += 1
                continue
            already = (
                db.query(GameSession)
                .filter(
                    GameSession.patient_id == item.patient_id,
                    GameSession.dexie_id == item.dexie_id,
                )
                .first()
            )
            if already:
                skipped += 1
                continue
            seen.add(key)

        # domain is NOT NULL, and an unrecognised game type resolves to None.
        # Without this guard the insert fails a constraint and the IntegrityError
        # handler below swallows it -- the row would vanish and the only trace
        # would be the skipped count. Skip it here instead, for the same reason
        # and visibly. Sprint 2 moves domain into the payload and retires this.
        domain = domain_for_game(item.game_type)
        if domain is None:
            skipped += 1
            continue

        session = GameSession(
            dexie_id=item.dexie_id,
            patient_id=item.patient_id,
            game_type=item.game_type,
            # Resolved here, once, rather than recomputed on every dashboard read.
            domain=domain,
            score=item.score,
            total=item.total,
            moves=item.moves,
            errors=item.errors,
            level=item.level,
            new_level=item.new_level,
            duration_ms=item.duration_ms,
            started_at=item.started_at,
            ended_at=item.ended_at,
            completed=item.completed,
            created_at=item.created_at or datetime.now(timezone.utc),
        )

        # Savepoint per row: a duplicate slipping past dedup (e.g. two devices
        # pushing the same queue concurrently) drops that row, not the batch.
        try:
            with db.begin_nested():
                db.add(session)

                # A level change carries its reason and who decided it, so the
                # doctor's adaptive history can show "rule" vs "ai" honestly.
                if (
                    item.level is not None
                    and item.new_level is not None
                    and item.new_level != item.level
                ):
                    db.add(
                        DifficultyHistory(
                            patient_id=item.patient_id,
                            game_type=item.game_type,
                            domain=domain,
                            from_level=item.level,
                            to_level=item.new_level,
                            reason=item.reason,
                            source=item.source or "rule",
                            created_at=item.created_at or datetime.now(timezone.utc),
                        )
                    )
                db.flush()
        except IntegrityError:
            skipped += 1
            continue

        synced += 1
        touched.add(patient.id)

    now = datetime.now(timezone.utc)
    for patient_id in touched:
        patient = db.get(Patient, patient_id)
        if patient:
            patient.last_sync_at = now

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Sync conflict — please retry the batch",
        )
    return SyncResponse(synced=synced, skipped=skipped, server_time=now)
