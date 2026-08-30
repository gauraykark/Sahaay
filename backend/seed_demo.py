"""Seed a realistic caseload.

The priority strip, the five filter chips and the risk badges all mean nothing
against an empty database — and an empty dashboard reads as unbuilt whatever
the code says. So this creates one doctor, twelve caregivers, twelve patients,
and eight weeks of plausible session history spanning the full risk range.

    python seed_demo.py

Login after seeding:
    doctor     doctor@sahaay.in     / sahaay123
    caregiver  caregiver1@sahaay.in / sahaay123   (…through caregiver12@)

The history is generated, not observed. Say so if anyone asks — a seeded
dataset presented as real data is the kind of thing that unravels badly.
"""

import random
from datetime import datetime, timedelta, timezone

from app.auth import hash_password
from app.database import SessionLocal
from app.domains import GAME_TYPES, domain_for_game
from app.models import (
    ROLE_CAREGIVER,
    ROLE_DOCTOR,
    DifficultyHistory,
    GameSession,
    Patient,
    Reminder,
    ReminderLog,
    User,
)

random.seed(26003)  # reproducible — the demo looks the same every run

PASSWORD = "sahaay123"

# name, age, stage, profile, caregiver name
PEOPLE = [
    ("Nirmala Devi",     72, "Mild",  "declining", "Anita Devi"),
    ("Rongsen Ao",       78, "Mild",  "declining", "Imlong Ao"),
    ("Bimala Rabha",     69, "MCI",   "improving", "Sujata Rabha"),
    ("Hemanta Sarma",    75, "Mild",  "stable",    "Pranab Sarma"),
    ("Lalrinmawii",      71, "MCI",   "improving", "Zoramthanga"),
    ("Dipen Baruah",     80, "Mild",  "declining", "Manash Baruah"),
    ("Sabitri Boro",     68, "MCI",   "stable",    "Jayanta Boro"),
    ("Thangkhanlal",     74, "Mild",  "stable",    "Ginlianmang"),
    ("Renu Gogoi",       77, "Mild",  "improving", "Deepak Gogoi"),
    ("Kailash Chetri",   73, "MCI",   "stable",    "Bina Chetri"),
    ("Momon Pegu",       70, "MCI",   "improving", "Ranjit Pegu"),
    ("Sarala Nath",      82, "Mild",  "declining", "Kamal Nath"),
]

REMINDERS = [
    ("medicine",  "Morning tablet",   "08:00"),
    ("hydration", "Glass of water",   "11:00"),
    ("activity",  "Short walk",       "17:00"),
    ("medicine",  "Evening tablet",   "20:00"),
]


def _now():
    return datetime.now(timezone.utc)


def _accuracy_for(profile: str, day_index: int, total_days: int) -> float:
    """Base accuracy, drifting according to the patient's profile."""
    progress = day_index / max(1, total_days)

    if profile == "improving":
        base = 0.52 + 0.30 * progress
    elif profile == "declining":
        base = 0.80 - 0.32 * progress
    else:
        base = 0.68

    return max(0.12, min(0.98, base + random.uniform(-0.09, 0.09)))


def seed() -> None:
    db = SessionLocal()
    try:
        if db.query(User).filter(User.email == "doctor@sahaay.in").first():
            print("Demo data already present. Run rebuild_db.py first to reset.")
            return

        doctor = User(
            name="Dr. Ananya Sharma",
            email="doctor@sahaay.in",
            role=ROLE_DOCTOR,
            designation="Geriatric Care",
            hashed_password=hash_password(PASSWORD),
            preferred_language="en",
        )
        db.add(doctor)
        db.flush()

        total_days = 56
        start = _now() - timedelta(days=total_days)

        for index, (name, age, stage, profile, caregiver_name) in enumerate(PEOPLE, 1):
            caregiver = User(
                name=caregiver_name,
                email=f"caregiver{index}@sahaay.in",
                role=ROLE_CAREGIVER,
                hashed_password=hash_password(PASSWORD),
                preferred_language="as" if index % 3 == 0 else "en",
            )
            db.add(caregiver)
            db.flush()

            # Two patients are deliberately stale, so the offline indicator and
            # the "High Offline Usage" filter have something real to show.
            is_offline = index in (2, 12)
            last_sync = _now() - timedelta(days=6 if is_offline else 0, hours=3)

            patient = Patient(
                name=name,
                age=age,
                diagnosis_stage=stage,
                caregiver_id=caregiver.id,
                doctor_id=doctor.id,
                preferred_language=caregiver.preferred_language,
                last_sync_at=last_sync,
                created_at=start,
                is_demo=True,
            )
            db.add(patient)
            db.flush()

            levels = {game: random.randint(1, 2) for game in GAME_TYPES}

            for day in range(total_days):
                # Not every day — real adherence is patchy.
                if random.random() < 0.42:
                    continue
                when = start + timedelta(days=day, hours=random.randint(8, 19))
                if is_offline and day > total_days - 6:
                    continue  # stopped syncing

                for game in random.sample(GAME_TYPES, random.randint(1, 3)):
                    accuracy = _accuracy_for(profile, day, total_days)
                    total = random.choice([4, 5, 6])
                    score = round(accuracy * total)
                    level = levels[game]

                    new_level = level
                    if accuracy > 0.8 and level < 4:
                        new_level = level + 1
                    elif accuracy < 0.45 and level > 1:
                        new_level = level - 1

                    db.add(
                        GameSession(
                            patient_id=patient.id,
                            # No dexie_id: seeded rows never came from a device.
                            # Real devices start their Dexie ids at 1, and a
                            # seeded id in that range makes the sync dedup
                            # silently skip genuine sessions.
                            dexie_id=None,
                            game_type=game,
                            domain=domain_for_game(game),
                            score=score,
                            total=total,
                            moves=random.randint(6, 22) if game == "memory" else None,
                            errors=total - score,
                            level=level,
                            new_level=new_level,
                            duration_ms=random.randint(38_000, 155_000),
                            completed=random.random() > 0.09,
                            created_at=when,
                        )
                    )

                    if new_level != level:
                        db.add(
                            DifficultyHistory(
                                patient_id=patient.id,
                                game_type=game,
                                domain=domain_for_game(game),
                                from_level=level,
                                to_level=new_level,
                                reason=(
                                    "Accuracy stayed high across recent rounds."
                                    if new_level > level
                                    else "Recent rounds were harder going than usual."
                                ),
                                source="rule",
                                created_at=when,
                            )
                        )
                        levels[game] = new_level

            # Reminders, and enough logs to make adherence % real.
            adherence_rate = {
                "improving": 0.90, "stable": 0.78, "declining": 0.55
            }[profile]

            for reminder_type, title, at in REMINDERS:
                reminder = Reminder(
                    caregiver_id=caregiver.id,
                    patient_id=patient.id,
                    reminder_type=reminder_type,
                    title=title,
                    scheduled_time=at,
                    days_of_week="daily",
                )
                db.add(reminder)
                db.flush()

                for day_back in range(14):
                    due = _now() - timedelta(days=day_back)
                    done = random.random() < adherence_rate
                    db.add(
                        ReminderLog(
                            reminder_id=reminder.id,
                            patient_id=patient.id,
                            due_at=due,
                            acted_at=due + timedelta(minutes=random.randint(2, 45))
                            if done
                            else None,
                            status="done" if done else "missed",
                        )
                    )

        db.commit()

        print(f"Seeded 1 doctor, {len(PEOPLE)} caregivers, {len(PEOPLE)} patients.")
        print(f"  sessions:  {db.query(GameSession).count()}")
        print(f"  reminders: {db.query(Reminder).count()}")
        print(f"  logs:      {db.query(ReminderLog).count()}")
        print()
        print("Login:")
        print(f"  doctor     doctor@sahaay.in     / {PASSWORD}")
        print(f"  caregiver  caregiver1@sahaay.in / {PASSWORD}")

    finally:
        db.close()


if __name__ == "__main__":
    seed()
