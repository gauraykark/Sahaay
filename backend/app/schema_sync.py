"""Bring an existing database up to what the models declare.

`Base.metadata.create_all()` creates missing TABLES and silently ignores
missing COLUMNS on tables that already exist. That is a quiet failure with a
loud consequence: Sprint 2 added `status`, `item_ids` and `session_id` to
`game_sessions`, every start printed nothing, and the first query that named
one of them died with `no such column: game_sessions.status` -- surfacing as a
500 on the doctor dashboard, four layers from the cause.

`rebuild_db.py` is the documented answer and it is right for a schema still in
motion, but it drops every row. Reaching for it after every model edit means
either losing the demo seed and whatever has been played since, or not running
it and shipping the drift. Neither is a good default.

So: add what can be added, refuse what cannot, and say so either way.

WHAT THIS DELIBERATELY DOES NOT DO
----------------------------------
Only `ALTER TABLE ... ADD COLUMN`. It never drops a column, never changes a
type, never touches a constraint, and never rewrites data. Those need a real
migration with a human deciding what the old rows mean, and SQLite cannot do
most of them in place anyway. Anything in that class is REPORTED, not guessed
at -- a tool that silently reshaped a column would be far worse than the bug
it replaced.

This is not Alembic and is not a substitute for it. It closes the specific gap
between "the model grew a nullable column" and "every request 500s", which is
the only drift this project has actually hit. Swap it for Alembic when there
is a deployment whose data matters.
"""

from __future__ import annotations

import logging

from sqlalchemy import MetaData, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.schema import CreateIndex

log = logging.getLogger("sahaay.schema")


class SchemaDrift(RuntimeError):
    """Drift that cannot be fixed by adding a column."""


def _column_ddl(column) -> str | None:
    """The column fragment for ADD COLUMN, or None if it cannot be added.

    A NOT NULL column can only be added to a table that may already hold rows
    if it carries a constant DEFAULT -- otherwise the existing rows have no
    legal value and the database is right to refuse. A Python-side default
    (`default=`) does not count: it lives in the ORM and never reaches SQL, so
    rows written by anything else would violate the constraint.
    """
    type_sql = column.type.compile(dialect=None)
    parts = [f'"{column.name}"', str(type_sql)]

    if column.nullable:
        return " ".join(parts)

    # NOT NULL: needs a literal default to be back-fillable.
    server_default = getattr(column, "server_default", None)
    if server_default is not None and hasattr(server_default, "arg"):
        parts += ["NOT NULL", "DEFAULT", str(server_default.arg)]
        return " ".join(parts)

    py_default = getattr(column, "default", None)
    if py_default is not None and getattr(py_default, "is_scalar", False):
        value = py_default.arg
        literal = f"'{value}'" if isinstance(value, str) else str(value)
        # The ORM default becomes a SQL default for the back-fill only. New
        # rows still get their value from the ORM exactly as before; this just
        # gives the rows that already exist something legal to hold.
        parts += ["NOT NULL", "DEFAULT", literal]
        return " ".join(parts)

    return None


def plan(engine: Engine, metadata: MetaData) -> tuple[list[str], list[str]]:
    """What would be run, and what cannot be. Reads only.

    Returns (statements, problems).
    """
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    statements: list[str] = []
    problems: list[str] = []

    for table_name, table in metadata.tables.items():
        if table_name not in existing_tables:
            # create_all handles a wholly missing table; nothing to do here.
            continue

        actual = {c["name"] for c in inspector.get_columns(table_name)}
        existing_indexes = {i["name"] for i in inspector.get_indexes(table_name)}

        for column in table.columns:
            if column.name in actual:
                continue

            ddl = _column_ddl(column)
            if ddl is None:
                problems.append(
                    f"{table_name}.{column.name} is NOT NULL with no constant "
                    f"default -- existing rows have no legal value for it. Give "
                    f"it a default, make it nullable, or run a real migration."
                )
                continue

            statements.append(f"ALTER TABLE {table_name} ADD COLUMN {ddl}")

        # Indexes for columns that were missing, plus any the table never got.
        for index in table.indexes:
            if index.name in existing_indexes:
                continue
            statements.append(str(CreateIndex(index).compile(bind=engine)).strip())

    return statements, problems


def sync(engine: Engine, metadata: MetaData, *, strict: bool = False) -> list[str]:
    """Apply the additive half of the plan. Returns the statements run.

    `strict` raises on drift that cannot be fixed additively, for a start-up
    that would rather stop than serve requests that are going to 500 anyway.
    Off by default so a developer mid-edit is warned rather than locked out.
    """
    statements, problems = plan(engine, metadata)

    for problem in problems:
        log.error("schema drift needs a migration: %s", problem)
    if problems and strict:
        raise SchemaDrift("; ".join(problems))

    if not statements:
        return []

    with engine.begin() as conn:
        for statement in statements:
            log.warning("schema sync: %s", statement)
            conn.execute(text(statement))

    log.warning(
        "schema sync applied %d statement(s). This is drift the models had and "
        "the database did not -- it is normal mid-development, but if you see "
        "it on a start you did not expect, something is out of step.",
        len(statements),
    )
    return statements
