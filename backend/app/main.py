from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import Base, engine
from .routers import ai, auth, doctors, patients, reminders, sessions


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Idempotent — safe on every start. For schema *changes* during
    # development, run rebuild_db.py instead; create_all does not alter
    # existing tables.
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="Sahaay API",
    description=(
        "Backend for Sahaay — offline-first cognitive care for elderly "
        "dementia patients in the North Eastern Region. Three roles: "
        "patient, caregiver, doctor."
    ),
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(patients.router)
app.include_router(sessions.router)
app.include_router(reminders.router)
app.include_router(doctors.router)
app.include_router(ai.router)


@app.get("/health", tags=["meta"])
def health():
    return {
        "status": "ok",
        "service": "sahaay-api",
        "ai_configured": settings.ai_configured,
    }
