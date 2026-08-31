import logging
import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import schema_sync
from .config import settings
from .database import Base, engine
from .routers import ai, auth, doctors, patients, reminders, sessions

log = logging.getLogger("sahaay")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # create_all is idempotent, but it only creates whole tables that are
    # MISSING. A column added to a table that already exists is silently
    # skipped, and the failure surfaces much later as `no such column` from
    # whatever query first names it.
    Base.metadata.create_all(bind=engine)

    # So close that gap explicitly. Additive only — it adds columns and
    # indexes the models declare, and refuses (loudly) anything needing a real
    # migration. rebuild_db.py is still the answer for a destructive reset.
    schema_sync.sync(engine, Base.metadata)

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

def _cors_headers_for(request: Request) -> dict[str, str]:
    """The CORS headers CORSMiddleware would have set, for a response it never sees.

    A handler for `Exception` does NOT run inside CORSMiddleware. Starlette
    routes bare-`Exception` handling to ServerErrorMiddleware, which is the
    OUTERMOST layer — outside the CORS middleware — so a response returned
    from there goes straight to the client with no CORS headers on it. (This
    is unlike a handler for a specific exception class, which does run inside.)

    So the headers are reproduced here. Deliberately only the simple-request
    subset: an error response is never a preflight, and preflights keep going
    through CORSMiddleware normally.

    The allow-list is still honoured. An origin nobody configured gets no
    grant, exactly as before — this makes real errors legible to the app's own
    front end, and changes nothing for anyone else.
    """
    origin = request.headers.get("origin")
    if not origin or origin not in settings.cors_origins:
        return {}
    return {
        # Echo the exact origin, never "*": the middleware is configured with
        # allow_credentials=True, and the two are not allowed together.
        "access-control-allow-origin": origin,
        "access-control-allow-credentials": "true",
        "vary": "Origin",
    }


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Turn an unhandled exception into a readable response.

    Without this, the browser cannot read the 500 and reports it as a CORS
    failure. That is how a server bug on ONE endpoint comes to look like a
    misconfigured origin affecting everything — and the investigation goes to
    the CORS settings, which were correct, while the actual traceback sits
    unread in the server log.

    The status stays 500 and the error stays an error. It is just now legible.

    The traceback is logged, never returned: it names file paths and query
    values, and the patient side is unauthenticated by design.
    """
    log.error(
        "unhandled exception on %s %s\n%s",
        request.method,
        request.url.path,
        "".join(traceback.format_exception(exc)),
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal server error",
            "path": request.url.path,
            "hint": "See the server log for the stack trace.",
        },
        headers=_cors_headers_for(request),
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
