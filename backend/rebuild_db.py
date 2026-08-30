"""Drop and recreate every table.

SQLite plus a short timeline means this beats setting up Alembic: the schema
is still moving, and there is no production data to preserve. Swap to Alembic
once there is a deployment whose data matters.

    python rebuild_db.py            drop, recreate
    python rebuild_db.py --seed     drop, recreate, then seed demo data

DESTRUCTIVE. Everything in sahaay.db is deleted.
"""

import sys

from app.database import Base, engine
from app import models  # noqa: F401  — registers every table on Base


def rebuild() -> None:
    print("Dropping all tables…")
    Base.metadata.drop_all(bind=engine)

    print("Creating all tables…")
    Base.metadata.create_all(bind=engine)

    tables = ", ".join(sorted(Base.metadata.tables))
    print(f"\nDone. {len(Base.metadata.tables)} tables:\n  {tables}")


if __name__ == "__main__":
    confirm = "--yes" in sys.argv or "-y" in sys.argv
    if not confirm:
        answer = input("This deletes all data in sahaay.db. Continue? [y/N] ")
        if answer.strip().lower() not in ("y", "yes"):
            print("Aborted.")
            sys.exit(0)

    rebuild()

    if "--seed" in sys.argv:
        print()
        from seed_demo import seed

        seed()
