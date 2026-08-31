"""A column added to an existing table must not become a 500.

The bug this pins: Sprint 2 added `status`, `item_ids` and `session_id` to
`game_sessions`. `create_all()` creates missing TABLES and silently skips
missing COLUMNS on tables that already exist, so every start looked clean and
the first query naming `status` died with `no such column` -- which surfaced as
a 500 on the doctor dashboard, and (because FastAPI attaches no CORS headers to
an unhandled exception) was reported by the browser as a CORS failure.

Two things are asserted here:
  1. schema_sync adds what it safely can, without touching existing rows.
  2. An unhandled exception comes back as a real response WITH CORS headers,
     so a server bug can never again present as a CORS problem.

Run:  python tools/test_schema_sync.py
"""

from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

# Never touch the real sahaay.db, and never need the real .env. Settings are
# read at import time, so these have to be set before `app.*` is imported.
_tmp = Path(tempfile.mkdtemp()) / "schema_sync_test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp.as_posix()}"
os.environ.setdefault("SECRET_KEY", "schema-sync-test-only-not-a-real-key")
os.environ["GROQ_API_KEY"] = ""
os.environ["GEMINI_API_KEY"] = ""

from sqlalchemy import create_engine, inspect  # noqa: E402

from app import schema_sync  # noqa: E402
from app.database import Base  # noqa: E402
from app import models  # noqa: F401,E402  — registers the tables

passed: list[str] = []
failed: list[str] = []


def ok(name: str, cond: bool, detail: str = "") -> None:
    (passed if cond else failed).append(name if cond else f"{name} — {detail}")


def eq(name: str, got, want) -> None:
    ok(name, got == want, f"got {got!r}, want {want!r}")


# ── 1. The real drift, reproduced ────────────────────────────────────────────
#
# Build game_sessions as it existed BEFORE Sprint 2, put a row in it, and let
# the sync bring it forward. The row must survive with its values intact.

with tempfile.TemporaryDirectory() as tmp:
    db_path = Path(tmp) / "old.db"
    raw = sqlite3.connect(db_path)
    raw.executescript(
        """
        CREATE TABLE game_sessions (
            id INTEGER PRIMARY KEY,
            dexie_id INTEGER,
            patient_id INTEGER NOT NULL,
            game_type VARCHAR(50) NOT NULL,
            domain VARCHAR(30) NOT NULL,
            score FLOAT, total FLOAT, moves INTEGER, errors INTEGER,
            level INTEGER, new_level INTEGER, duration_ms INTEGER,
            started_at DATETIME, ended_at DATETIME,
            completed BOOLEAN,
            created_at DATETIME NOT NULL
        );
        """
    )
    raw.execute(
        "INSERT INTO game_sessions (id, patient_id, game_type, domain, score, "
        "total, level, completed, created_at) VALUES "
        "(1, 7, 'memory', 'memory', 3.0, 4.0, 0, 1, '2026-08-01 10:00:00')"
    )
    raw.commit()
    raw.close()

    engine = create_engine(f"sqlite:///{db_path}")

    before = {c["name"] for c in inspect(engine).get_columns("game_sessions")}
    ok("the fixture really is missing the Sprint 2 columns",
       {"status", "item_ids", "session_id"}.isdisjoint(before))

    statements, problems = schema_sync.plan(engine, Base.metadata)
    ok("the plan names the missing columns",
       all(any(c in s for s in statements) for c in ("status", "item_ids", "session_id")),
       str(statements))
    eq("nothing about this drift needs a real migration", problems, [])
    ok("the plan only ever adds",
       all("ADD COLUMN" in s or s.upper().startswith("CREATE INDEX") for s in statements),
       str(statements))

    applied = schema_sync.sync(engine, Base.metadata)
    ok("statements were applied", len(applied) > 0)

    after = {c["name"] for c in inspect(engine).get_columns("game_sessions")}
    for col in ("status", "item_ids", "session_id"):
        ok(f"{col} exists after the sync", col in after)

    # THE POINT: rebuild_db.py would also have produced these columns, by
    # deleting every row. This must not.
    check = sqlite3.connect(db_path)
    row = check.execute(
        "SELECT patient_id, game_type, score, total, level, status, item_ids "
        "FROM game_sessions WHERE id = 1"
    ).fetchone()
    ok("the existing row survived", row is not None)
    if row:
        eq("its patient is untouched", row[0], 7)
        eq("its score is untouched", row[2], 3.0)
        # Level 0 is a real level and must not have been disturbed either.
        eq("a level of 0 is still 0, not NULL and not 1", row[4], 0)
        eq("the NOT NULL column back-filled to its default", row[5], "completed")
        eq("the nullable column back-filled to NULL", row[6], None)
    check.close()

    # ── 2. Idempotent ────────────────────────────────────────────────────────
    #
    # This runs on every start. A second run must be a no-op, or the warning it
    # logs becomes noise nobody reads.
    second, _ = schema_sync.plan(engine, Base.metadata)
    eq("a second run has nothing to do", second, [])
    eq("and applies nothing", schema_sync.sync(engine, Base.metadata), [])

    engine.dispose()


# ── 3. What it refuses ───────────────────────────────────────────────────────
#
# A NOT NULL column with no constant default cannot be added to a table that
# already holds rows -- those rows would have no legal value. Guessing one is
# how a migration tool corrupts data. It must be reported instead.

with tempfile.TemporaryDirectory() as tmp:
    from sqlalchemy import Column, Integer, MetaData, String, Table

    db_path = Path(tmp) / "strict.db"
    raw = sqlite3.connect(db_path)
    raw.execute("CREATE TABLE thing (id INTEGER PRIMARY KEY)")
    raw.execute("INSERT INTO thing (id) VALUES (1)")
    raw.commit()
    raw.close()

    engine = create_engine(f"sqlite:///{db_path}")
    md = MetaData()
    Table(
        "thing", md,
        Column("id", Integer, primary_key=True),
        Column("mandatory", String(10), nullable=False),   # no default at all
        Column("optional", String(10), nullable=True),
    )

    statements, problems = schema_sync.plan(engine, md)
    ok("a NOT NULL column with no default is reported", len(problems) == 1, str(problems))
    ok("...and named in the report",
       problems and "thing.mandatory" in problems[0], str(problems))
    ok("...and not attempted",
       all("mandatory" not in s for s in statements), str(statements))
    ok("the addable column is still added",
       any("optional" in s for s in statements), str(statements))

    # The safe half still applies — a developer mid-edit gets the columns that
    # can be added and a clear message about the one that cannot.
    schema_sync.sync(engine, md)
    cols = {c["name"] for c in inspect(engine).get_columns("thing")}
    ok("optional was added", "optional" in cols)
    ok("mandatory was not", "mandatory" not in cols)

    try:
        schema_sync.sync(engine, md, strict=True)
        ok("strict mode raises on unfixable drift", False, "it returned instead")
    except schema_sync.SchemaDrift:
        ok("strict mode raises on unfixable drift", True)

    engine.dispose()


# ── 4. A 500 carries CORS headers ────────────────────────────────────────────
#
# Without the handler the exception escapes past CORSMiddleware, the browser
# cannot read the response, and a server bug on ONE endpoint reads as a CORS
# misconfiguration affecting everything. That is what sent the last
# investigation to the CORS config, which was correct all along.

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

ORIGIN = "http://localhost:5173"


@app.get("/__boom__")
def _boom():
    raise RuntimeError("deliberate: an unhandled server error")


client = TestClient(app, raise_server_exceptions=False)

res = client.get("/__boom__", headers={"Origin": ORIGIN})
eq("an unhandled exception is still a 500", res.status_code, 500)
eq("the 500 carries access-control-allow-origin",
   res.headers.get("access-control-allow-origin"), ORIGIN)
ok("the browser can therefore read it", "access-control-allow-origin" in res.headers)
ok("the body is JSON, not a bare string",
   res.headers.get("content-type", "").startswith("application/json"),
   res.headers.get("content-type", ""))
ok("the body names the failing path", res.json().get("path") == "/__boom__", res.text)

# The stack trace is for the log, never the wire: it carries file paths and
# query values, and the patient side is unauthenticated by design. Check for
# what an actual leak would contain -- the exception type, its message, and
# source paths -- not for the word "trace", which the safe hint itself uses.
body = res.text.lower()
ok("the exception type is not leaked", "runtimeerror" not in body, res.text[:200])
ok("the exception message is not leaked", "deliberate" not in body, res.text[:200])
ok("no source path is leaked",
   ".py" not in body and "sahaay-main" not in body, res.text[:200])
ok("no stack frames are leaked", "file \"" not in body and "line " not in body,
   res.text[:200])

# A normal request is unaffected.
healthy = client.get("/health", headers={"Origin": ORIGIN})
eq("healthy requests still work", healthy.status_code, 200)
eq("and still carry CORS",
   healthy.headers.get("access-control-allow-origin"), ORIGIN)

# An origin that is NOT allow-listed must still be refused. The handler must
# not have become a way to hand errors to anybody who asks.
stranger = client.get("/__boom__", headers={"Origin": "http://evil.example"})
eq("a stranger still gets no CORS grant",
   stranger.headers.get("access-control-allow-origin"), None)


for name in passed:
    print(f"  PASS  {name}")
for line in failed:
    print(f"  FAIL  {line}")

print()
if failed:
    print(f"SCHEMA SYNC: FAIL ({len(failed)} of {len(passed) + len(failed)})")
    sys.exit(1)
print(f"SCHEMA SYNC: OK ({len(passed)} checks)")
