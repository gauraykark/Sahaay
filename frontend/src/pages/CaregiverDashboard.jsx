import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getActivePatientId,
  setActivePatientId,
  getPatient,
  listPatients,
  createPatient,
  getRecentSessions,
  getLatestSessionForGame,
  listDifficultyState,
  resetDemoPatientData,
  hasCaregiverPin,
  setCaregiverPin,
  verifyCaregiverPin,
  listVaultPeople,
  addVaultPerson,
  deleteVaultPerson,
  listVaultRoutineSteps,
  addVaultRoutineStep,
  deleteVaultRoutineStep,
  setPreviewMode,
} from "../lib/db";
import { MAX_LEVEL, levelOrNull } from "@shared/levels";
import { formatRelativeDay, describeSession } from "../lib/utils";
import { SourceBadge } from "../components/ui/Badge";
import { getMe, hydratePatientsFromServer } from "../lib/api";
import {
  NAME_CIRCLE_OPTIONS,
  memoryGridLabel,
  objectsQuestionCount,
} from "../lib/gameContent";
import {
  SignOut,
  UserCircle,
  Users,
  ChartLine,
  Bell,
  Plus,
  ArrowClockwise,
  LockKey,
  Heart,
  Sun,
  Trash,
  ArrowLeft,
  House,
  Gear,
  FirstAid,
} from "@phosphor-icons/react";

const GAME_LABELS = {
  memory: "Memory Matching",
  routine: "Daily Routine",
  objects: "Object Recognition",
  "name-recall": "Name Recall",
};
const GAME_ORDER = ["memory", "routine", "objects", "name-recall"];

// sessionStorage (not IndexedDB) so the unlock only lasts this browser tab
// session and doesn't silently persist forever across visits/devices.
const UNLOCK_SESSION_KEY = "sahaay-caregiver-unlocked";

export default function CaregiverDashboard() {
  const [status, setStatus] = useState("checking"); // checking | setup | locked | unlocked

  useEffect(() => {
    async function check() {
      const pinExists = await hasCaregiverPin();
      const alreadyUnlocked =
        sessionStorage.getItem(UNLOCK_SESSION_KEY) === "true";

      if (!pinExists) {
        setStatus("setup");
      } else if (alreadyUnlocked) {
        setStatus("unlocked");
      } else {
        setStatus("locked");
      }
    }
    check();
  }, []);

  const handleUnlocked = () => {
    sessionStorage.setItem(UNLOCK_SESSION_KEY, "true");
    setStatus("unlocked");
  };

  if (status === "checking") {
    return <div className="min-h-screen bg-background" />;
  }

  if (status === "setup") {
    return <CaregiverPinSetup onDone={handleUnlocked} />;
  }

  if (status === "locked") {
    return <CaregiverPinEntry onUnlocked={handleUnlocked} />;
  }

  return <CaregiverDashboardContent />;
}

function CaregiverPinSetup({ onDone }) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!/^\d{4}$/.test(pin)) {
      setError("Enter a 4-digit PIN");
      return;
    }
    if (pin !== confirmPin) {
      setError("PINs don't match");
      return;
    }

    setIsSaving(true);
    await setCaregiverPin(pin);
    onDone();
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <LockKey size={28} weight="regular" className="text-neutral-500 mb-4" />
        <h1 className="font-display text-2xl text-neutral-800 mb-1">
          Set up a caregiver PIN
        </h1>
        <p className="text-neutral-600 mb-6">
          This keeps the dashboard separate from the patient's screen. The
          patient never needs to enter this.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <PinInput label="Choose a 4-digit PIN" value={pin} onChange={setPin} />
          <PinInput
            label="Confirm PIN"
            value={confirmPin}
            onChange={setConfirmPin}
          />

          {error && <p className="text-sm text-error">{error}</p>}

          <button
            type="submit"
            disabled={isSaving}
            className="w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white px-5 py-3 rounded-lg text-base font-medium transition-colors"
          >
            {isSaving ? "Saving…" : "Save and continue"}
          </button>
        </form>
      </div>
    </div>
  );
}

function CaregiverPinEntry({ onUnlocked }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [isChecking, setIsChecking] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsChecking(true);
    const isValid = await verifyCaregiverPin(pin);
    setIsChecking(false);

    if (isValid) {
      onUnlocked();
    } else {
      setError("Incorrect PIN");
      setPin("");
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <LockKey size={28} weight="regular" className="text-neutral-500 mb-4" />
        <h1 className="font-display text-2xl text-neutral-800 mb-1">
          Caregiver PIN
        </h1>
        <p className="text-neutral-600 mb-6">
          Enter your PIN to open the dashboard.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <PinInput label="PIN" value={pin} onChange={setPin} autoFocus />
          {error && <p className="text-sm text-error">{error}</p>}

          <button
            type="submit"
            disabled={pin.length !== 4 || isChecking}
            className="w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white px-5 py-3 rounded-lg text-base font-medium transition-colors"
          >
            {isChecking ? "Checking…" : "Unlock"}
          </button>
        </form>

        <Link
          to="/login"
          className="mt-6 flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-700"
        >
          Back to login
        </Link>
      </div>
    </div>
  );
}

function PinInput({ label, value, onChange, autoFocus = false }) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700 mb-1.5">
        {label}
      </label>
      <input
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={4}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
        className="w-full px-4 py-3 rounded-lg border border-neutral-300 text-neutral-800 text-2xl tracking-[0.5em] text-center focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-300"
      />
    </div>
  );
}

function CaregiverDashboardContent() {
  const [isLoading, setIsLoading] = useState(true);
  const [patients, setPatients] = useState([]);
  const [activePatient, setActivePatient] = useState(null);
  const [recentSessions, setRecentSessions] = useState([]);
  const [perGameLatest, setPerGameLatest] = useState({});
  const [difficultyRows, setDifficultyRows] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [vaultPeople, setVaultPeople] = useState([]);
  const [vaultRoutine, setVaultRoutine] = useState([]);
  const [viewingPatientId, setViewingPatientId] = useState(null);
  const [caregiverName, setCaregiverName] = useState("");

  const reload = async () => {
    const patientId = await getActivePatientId();
    const [patientRow, allPatients, recent, people, routine, difficulties, ...latestPerGame] =
      await Promise.all([
        getPatient(patientId),
        listPatients(),
        getRecentSessions(12),
        listVaultPeople(),
        listVaultRoutineSteps(),
        listDifficultyState(),
        ...GAME_ORDER.map((gameType) => getLatestSessionForGame(gameType)),
      ]);

    setActivePatient(patientRow);
    setPatients(allPatients);
    setRecentSessions(recent);
    setVaultPeople(people);
    setVaultRoutine(routine);
    setDifficultyRows(difficulties);
    setPerGameLatest(
      GAME_ORDER.reduce(
        (acc, gameType, index) => ({ ...acc, [gameType]: latestPerGame[index] }),
        {}
      )
    );
    setIsLoading(false);
  };

  useEffect(() => {
    (async () => {
      // Server → Dexie first, so a caregiver signing in on a fresh device
      // sees their patient instead of "No patients yet".
      await hydratePatientsFromServer().catch(() => {});
      await reload();
    })();
    getMe()
      .then((me) => setCaregiverName(me?.name || ""))
      .catch(() => {});
  }, []);

  const handleOpenPatient = async (patientId) => {
    setIsLoading(true);
    await setActivePatientId(patientId);
    setViewingPatientId(patientId);
    await reload();
  };

  const handlePatientCreated = async (patientId) => {
    setShowAddForm(false);
    setIsLoading(true);
    await setActivePatientId(patientId);
    setViewingPatientId(patientId);
    await reload();
  };

  const handleResetDemo = async () => {
    setIsLoading(true);
    await resetDemoPatientData();
    await reload();
  };

  if (viewingPatientId) {
    return (
      <PatientDetailDashboard
        isLoading={isLoading}
        patient={activePatient}
        recentSessions={recentSessions}
        perGameLatest={perGameLatest}
        difficultyRows={difficultyRows}
        vaultPeople={vaultPeople}
        vaultRoutine={vaultRoutine}
        onBack={() => setViewingPatientId(null)}
        onReload={reload}
        onResetDemo={handleResetDemo}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="px-5 pt-6 pb-5 border-b border-neutral-200">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-neutral-500">Caregiver</p>
            <h1 className="text-xl font-medium text-neutral-800 mt-0.5">
              Welcome{caregiverName ? `, ${caregiverName}` : ", caregiver"}
            </h1>
          </div>
          <Link
            to="/login"
            className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-700"
          >
            <SignOut size={18} weight="regular" />
            Exit
          </Link>
        </div>
      </header>

      <main className="px-5 py-8 max-w-2xl">
        <section className="mb-10">
          <h2 className="text-sm font-medium text-neutral-500 mb-3">
            Your tools
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <CaregiverTool
              icon={<House size={20} />}
              title="Patient home"
              detail="Preview how games look — nothing you play here is recorded"
              to="/patient"
              onClick={() => setPreviewMode(true)}
            />
            <CaregiverTool
              icon={<Heart size={20} />}
              title="Memory Vault"
              detail="Add people and daily guidance after opening a patient"
              onClick={() => {
                if (patients[0]) handleOpenPatient(patients[0].id);
              }}
            />
            <CaregiverTool
              icon={<Gear size={20} />}
              title="How this works"
              detail="Tap a patient below to see memory, levels, and alerts"
            />
          </div>
        </section>

        <section className="mb-8">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-neutral-500 mb-3">
            <Users size={16} weight="regular" />
            Patient accounts
          </h2>
          <p className="text-sm text-neutral-500 mb-3">
            Open a patient to see how they are performing.
          </p>

          <div className="space-y-3">
            {patients.map((patient) => (
              <button
                key={patient.id}
                onClick={() => handleOpenPatient(patient.id)}
                className="flex items-center gap-3 w-full text-left bg-white border border-neutral-200 hover:border-primary-300 rounded-lg px-5 py-4 transition-colors"
              >
                <Avatar patient={patient} />
                <div className="flex-1">
                  <p className="font-medium text-neutral-800">{patient.name}</p>
                  <p className="text-sm text-neutral-500">Open dashboard</p>
                </div>
              </button>
            ))}

            {patients.length === 0 && !showAddForm && (
              <p className="text-sm text-neutral-500 bg-white border border-neutral-200 rounded-lg px-5 py-4">
                No patients yet. Add one below to start tracking games and
                memory.
              </p>
            )}
          </div>
        </section>

        <section>
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-neutral-500 mb-3">
            <Plus size={16} weight="regular" />
            Add a patient
          </h2>
          {!showAddForm ? (
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-2 w-full justify-center text-sm text-primary-700 border border-dashed border-neutral-300 hover:border-primary-300 rounded-lg px-5 py-3.5 transition-colors"
            >
              <Plus size={18} weight="regular" />
              Add a patient
            </button>
          ) : (
            <AddPatientForm
              onCreated={handlePatientCreated}
              onCancel={() => setShowAddForm(false)}
            />
          )}
        </section>
      </main>
    </div>
  );
}

function CaregiverTool({ icon, title, detail, to, onClick }) {
  const className =
    "flex flex-col gap-2 bg-white border border-neutral-200 hover:border-primary-300 rounded-lg px-4 py-4 text-left transition-colors h-full";

  const inner = (
    <>
      <span className="text-neutral-500">{icon}</span>
      <span className="font-medium text-neutral-800">{title}</span>
      <span className="text-sm text-neutral-500">{detail}</span>
    </>
  );

  if (to) {
    return (
      <Link to={to} className={className} onClick={onClick}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {inner}
    </button>
  );
}

function levelDetail(gameType, level) {
  // `if (!level)` used to be here, which read a real level 0 as "not played
  // yet". Level 0 is the bottom of the scale, not the absence of one --
  // see shared/levels.js. Only null/undefined means unplayed.
  if (level === null || level === undefined) return "Not played yet";
  if (gameType === "memory") {
    return `Level ${level} · ${memoryGridLabel(level)} cards`;
  }
  if (gameType === "objects") {
    return `Level ${level} · ${objectsQuestionCount(level)} objects`;
  }
  if (gameType === "routine") {
    return `Level ${level} · ${level * 4} steps`;
  }
  const circle = NAME_CIRCLE_OPTIONS.find((c) => c.level === level);
  return `Level ${level} · ${circle?.title || "names"}`;
}

function buildAlerts(recentSessions, perGameLatest) {
  const alerts = [];
  if (!recentSessions.length) {
    alerts.push({
      title: "No activity yet",
      detail: "Once a game is finished on this device, it will show here.",
    });
    return alerts;
  }

  const last = recentSessions[0];
  const days = (Date.now() - new Date(last.createdAt).getTime()) / 86400000;
  if (days >= 3) {
    alerts.push({
      title: "Quiet for a few days",
      detail: "No games have been completed in the last 3 days.",
    });
  }

  for (const gameType of GAME_ORDER) {
    const session = perGameLatest[gameType];
    if (!session) continue;
    if (
      typeof session.score === "number" &&
      session.total > 0 &&
      session.score / session.total < 0.4
    ) {
      alerts.push({
        title: `Low score on ${GAME_LABELS[gameType]}`,
        detail: describeSession(session),
      });
    }
    if (
      typeof session.newLevel === "number" &&
      typeof session.level === "number" &&
      session.newLevel < session.level
    ) {
      alerts.push({
        title: `${GAME_LABELS[gameType]} was eased`,
        detail: "The next round will be a little simpler.",
      });
    }
  }

  if (alerts.length === 0) {
    alerts.push({
      title: "No alerts at the moment",
      detail: "You will see a note here if activity drops or scores fall.",
    });
  }
  return alerts;
}

function memoryRead(recentSessions, difficultyRows) {
  // `|| 1` here silently promoted every level-0 patient to level 1.
  const memoryLevel = levelOrNull(
    difficultyRows.find((row) => row.gameType === "memory")?.level
  );
  const scored = recentSessions.filter(
    (s) => typeof s.score === "number" && s.total > 0
  );
  const accuracy =
    scored.length > 0
      ? Math.round(
          (scored.reduce((sum, s) => sum + s.score / s.total, 0) / scored.length) *
            100
        )
      : null;
  const lastActive = recentSessions[0]?.createdAt;
  return { memoryLevel, accuracy, lastActive };
}

function PatientDetailDashboard({
  isLoading,
  patient,
  recentSessions,
  perGameLatest,
  difficultyRows,
  vaultPeople,
  vaultRoutine,
  onBack,
  onReload,
  onResetDemo,
}) {
  const { memoryLevel, accuracy, lastActive } = memoryRead(
    recentSessions,
    difficultyRows
  );
  const alerts = buildAlerts(recentSessions, perGameLatest);
  const levelByGame = Object.fromEntries(
    GAME_ORDER.map((gameType) => [
      gameType,
      levelOrNull(
        difficultyRows.find((row) => row.gameType === gameType)?.level
      ),
    ])
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="px-5 pt-6 pb-5 border-b border-neutral-200">
        <div className="flex items-center justify-between gap-3">
          <div>
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-700 mb-2"
            >
              <ArrowLeft size={18} />
              All patients
            </button>
            <h1 className="text-xl font-medium text-neutral-800">
              {patient?.name || "Patient"}
            </h1>
            <p className="text-sm text-neutral-500 mt-0.5">
              Last active: {formatRelativeDay(lastActive)}
            </p>
          </div>
          <Link
            to="/login"
            className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-700"
          >
            <SignOut size={18} weight="regular" />
            Exit
          </Link>
        </div>
      </header>

      <main className="px-5 py-6 max-w-6xl">
        {isLoading ? (
          <p className="text-neutral-400">Loading…</p>
        ) : (
          <div className="caregiver-patient-grid">
            <section className="area-info bg-white border border-neutral-200 rounded-xl px-5 py-5">
              <h2 className="flex items-center gap-1.5 text-sm font-medium text-neutral-500 mb-3">
                <UserCircle size={16} />
                Patient
              </h2>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  {patient && <Avatar patient={patient} />}
                  <div>
                    <p className="text-lg font-medium text-neutral-800">
                      {patient?.name || "Unnamed patient"}
                    </p>
                    <p className="text-sm text-neutral-500 mt-1">
                      {recentSessions.length} recent game
                      {recentSessions.length === 1 ? "" : "s"} on this device
                    </p>
                  </div>
                </div>
                {patient?.isDemo === 1 && (
                  <button
                    onClick={onResetDemo}
                    className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-700 border border-neutral-200 hover:border-neutral-300 rounded-lg px-3 py-2 transition-colors"
                  >
                    <ArrowClockwise size={16} />
                    Reset demo
                  </button>
                )}
              </div>
            </section>

            <section className="area-memory bg-white border border-neutral-200 rounded-xl px-5 py-5">
              <h2 className="flex items-center gap-1.5 text-sm font-medium text-neutral-500 mb-3">
                <FirstAid size={16} />
                Memory
              </h2>
              <p className="text-2xl font-medium text-neutral-800">
                {accuracy == null ? "—" : `${accuracy}%`}
              </p>
              <p className="text-sm text-neutral-500 mt-1">
                Average correctness across recent scored rounds
              </p>
              <p className="text-sm text-neutral-600 mt-3">
                {memoryLevel === null
                  ? "Memory Matching has not been played yet"
                  : `Memory Matching is on ${levelDetail("memory", memoryLevel)}`}
              </p>
            </section>

            <section className="area-perf bg-white border border-neutral-200 rounded-xl px-5 py-5">
              <h2 className="flex items-center gap-1.5 text-sm font-medium text-neutral-500 mb-3">
                <ChartLine size={16} />
                How they are doing
              </h2>
              <div className="space-y-3">
                {GAME_ORDER.map((gameType) => (
                  <div key={gameType} className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-neutral-800">
                        {GAME_LABELS[gameType]}
                      </p>
                      <p className="text-sm text-neutral-500">
                        {levelDetail(gameType, levelByGame[gameType])}
                      </p>
                    </div>
                    <p className="text-sm text-neutral-500 text-right">
                      {describeSession(perGameLatest[gameType])}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <section className="area-alerts bg-white border border-neutral-200 rounded-xl px-5 py-5">
              <h2 className="flex items-center gap-1.5 text-sm font-medium text-neutral-500 mb-3">
                <Bell size={16} />
                Alerts
              </h2>
              <div className="space-y-3">
                {alerts.map((alert) => (
                  <div key={alert.title}>
                    <p className="text-neutral-800">{alert.title}</p>
                    <p className="text-sm text-neutral-500 mt-0.5">
                      {alert.detail}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <section className="area-games bg-white border border-neutral-200 rounded-xl px-5 py-5">
              <h2 className="flex items-center gap-1.5 text-sm font-medium text-neutral-500 mb-3">
                <Gear size={16} />
                Adaptive levels
              </h2>
              <p className="text-sm text-neutral-500 mb-4">
                Levels move up or down from how the last round went. Layouts
                are shuffled every time, including when a level is lowered.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {GAME_ORDER.map((gameType) => {
                  const level = levelByGame[gameType];
                  const row = difficultyRows.find(
                    (row) => row.gameType === gameType
                  );
                  const reason = row?.reason;
                  return (
                    <div
                      key={gameType}
                      className="border border-neutral-200 rounded-lg px-4 py-3"
                    >
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-neutral-800">
                          {GAME_LABELS[gameType]}
                        </p>
                        {row?.source && <SourceBadge source={row.source} />}
                      </div>
                      <p className="text-sm text-neutral-600 mt-1">
                        {level === null ? "Not played yet" : `${level} / ${MAX_LEVEL}`}
                      </p>
                      {reason && (
                        <p className="text-sm text-neutral-500 mt-2">{reason}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="area-vault bg-white border border-neutral-200 rounded-xl px-5 py-5">
              <h2 className="flex items-center gap-1.5 text-sm font-medium text-neutral-500 mb-3">
                <Sun size={16} />
                Daily Guidance
              </h2>
              <VaultRoutineManager
                steps={vaultRoutine}
                isLoading={isLoading}
                onChanged={onReload}
              />
            </section>

            <section className="area-names bg-white border border-neutral-200 rounded-xl px-5 py-5">
              <h2 className="flex items-center gap-1.5 text-sm font-medium text-neutral-500 mb-3">
                <Heart size={16} />
                People for Name Recall
              </h2>
              <p className="text-sm text-neutral-500 mb-4">
                Add family, the nurse, the milkman, and others. These names
                appear in the matching Name Recall level.
              </p>
              <VaultPeopleManager
                people={vaultPeople}
                isLoading={isLoading}
                onChanged={onReload}
              />
            </section>

            <section className="area-activity">
              <h2 className="flex items-center gap-1.5 text-sm font-medium text-neutral-500 mb-3">
                <ChartLine size={16} />
                Recent activity
              </h2>
              <div className="space-y-3">
                {GAME_ORDER.map((gameType) => {
                  const session = perGameLatest[gameType];
                  return (
                    <ActivityRow
                      key={gameType}
                      title={GAME_LABELS[gameType]}
                      detail={describeSession(session)}
                      time={formatRelativeDay(session?.createdAt)}
                    />
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function Avatar({ patient }) {
  if (patient.photo) {
    return (
      <img
        src={patient.photo}
        alt=""
        className="w-10 h-10 rounded-full object-cover shrink-0"
      />
    );
  }

  const initial = patient.name?.trim()?.[0]?.toUpperCase() || "?";
  return (
    <div
      className="w-10 h-10 rounded-full flex items-center justify-center text-white font-medium shrink-0"
      style={{ backgroundColor: patient.avatarColor }}
    >
      {initial}
    </div>
  );
}

function AddPatientForm({ onCreated, onCancel }) {
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const handlePhotoChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || isSaving) return;

    setIsSaving(true);
    const id = await createPatient(trimmed, photo);
    onCreated(id);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white border border-neutral-200 rounded-lg px-5 py-4 space-y-4"
    >
      <div>
        <label className="block text-sm font-medium text-neutral-700 mb-1.5">
          Patient's name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Ramesh"
          autoFocus
          className="w-full px-4 py-2.5 rounded-lg border border-neutral-300 text-neutral-800 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-300"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-neutral-700 mb-1.5">
          Photo (optional)
        </label>
        <p className="text-sm text-neutral-500 mb-2">
          Helps tell profiles apart at a glance — useful if two patients
          share a name.
        </p>
        <input
          type="file"
          accept="image/*"
          onChange={handlePhotoChange}
          className="text-sm text-neutral-600"
        />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={!name.trim() || isSaving}
          className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:hover:bg-primary-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
        >
          {isSaving ? "Saving…" : "Save patient"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-neutral-500 hover:text-neutral-700 px-2 py-2.5"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function VaultPeopleManager({ people, isLoading, onChanged }) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [photo, setPhoto] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const handlePhotoChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || isSaving) return;

    setIsSaving(true);
    await addVaultPerson({ name: trimmed, relationship: relationship.trim(), photo });
    setName("");
    setRelationship("");
    setPhoto(null);
    setIsSaving(false);
    setShowForm(false);
    onChanged();
  };

  const handleDelete = async (id) => {
    await deleteVaultPerson(id);
    onChanged();
  };

  if (isLoading) {
    return (
      <div className="bg-white border border-neutral-200 rounded-lg px-5 py-4">
        <p className="text-neutral-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {people.map((person) => (
        <div
          key={person.id}
          className="flex items-center gap-3 bg-white border border-neutral-200 rounded-lg px-5 py-3.5"
        >
          <div className="flex-1">
            <p className="font-medium text-neutral-800">{person.name}</p>
            {person.relationship && (
              <p className="text-sm text-neutral-500">{person.relationship}</p>
            )}
          </div>
          <button
            onClick={() => handleDelete(person.id)}
            aria-label={`Remove ${person.name}`}
            className="text-neutral-400 hover:text-error p-1"
          >
            <Trash size={18} weight="regular" />
          </button>
        </div>
      ))}

      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 w-full justify-center text-sm text-primary-700 border border-dashed border-neutral-300 hover:border-primary-300 rounded-lg px-5 py-3.5 transition-colors"
        >
          <Plus size={18} weight="regular" />
          Add a person
        </button>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-neutral-200 rounded-lg px-5 py-4 space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1.5">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rahul"
              autoFocus
              className="w-full px-4 py-2.5 rounded-lg border border-neutral-300 text-neutral-800 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-300"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1.5">
              Relationship
            </label>
            <input
              type="text"
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              placeholder="e.g. Your grandson"
              className="w-full px-4 py-2.5 rounded-lg border border-neutral-300 text-neutral-800 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-300"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1.5">
              Photo (optional)
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={handlePhotoChange}
              className="text-sm text-neutral-600"
            />
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={!name.trim() || isSaving}
              className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-sm text-neutral-500 hover:text-neutral-700 px-2 py-2.5"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function VaultRoutineManager({ steps, isLoading, onChanged }) {
  const [showForm, setShowForm] = useState(false);
  const [time, setTime] = useState("");
  const [activity, setActivity] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmed = activity.trim();
    if (!trimmed || isSaving) return;

    setIsSaving(true);
    const nextOrder = steps.length > 0 ? Math.max(...steps.map((s) => s.order)) + 1 : 0;
    await addVaultRoutineStep({ time: time.trim(), activity: trimmed, order: nextOrder });
    setTime("");
    setActivity("");
    setIsSaving(false);
    setShowForm(false);
    onChanged();
  };

  const handleDelete = async (id) => {
    await deleteVaultRoutineStep(id);
    onChanged();
  };

  if (isLoading) {
    return (
      <div className="bg-white border border-neutral-200 rounded-lg px-5 py-4">
        <p className="text-neutral-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {steps.map((step) => (
        <div
          key={step.id}
          className="flex items-center gap-3 bg-white border border-neutral-200 rounded-lg px-5 py-3.5"
        >
          {step.time && (
            <span className="text-sm text-neutral-500 w-16 shrink-0">{step.time}</span>
          )}
          <span className="flex-1 text-neutral-800">{step.activity}</span>
          <button
            onClick={() => handleDelete(step.id)}
            aria-label={`Remove ${step.activity}`}
            className="text-neutral-400 hover:text-error p-1"
          >
            <Trash size={18} weight="regular" />
          </button>
        </div>
      ))}

      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 w-full justify-center text-sm text-primary-700 border border-dashed border-neutral-300 hover:border-primary-300 rounded-lg px-5 py-3.5 transition-colors"
        >
          <Plus size={18} weight="regular" />
          Add a step
        </button>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-neutral-200 rounded-lg px-5 py-4 space-y-4"
        >
          <div className="flex gap-3">
            <div className="w-28">
              <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                Time
              </label>
              <input
                type="text"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                placeholder="7:00 AM"
                className="w-full px-3 py-2.5 rounded-lg border border-neutral-300 text-neutral-800 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-300"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                Activity
              </label>
              <input
                type="text"
                value={activity}
                onChange={(e) => setActivity(e.target.value)}
                placeholder="e.g. Breakfast"
                autoFocus
                className="w-full px-4 py-2.5 rounded-lg border border-neutral-300 text-neutral-800 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-300"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={!activity.trim() || isSaving}
              className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-sm text-neutral-500 hover:text-neutral-700 px-2 py-2.5"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function ActivityRow({ title, detail, time }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-lg px-5 py-4 flex items-center justify-between">
      <div>
        <p className="font-medium text-neutral-800">{title}</p>
        <p className="text-sm text-neutral-500 mt-0.5">{detail}</p>
      </div>
      <p className="text-sm text-neutral-400">{time}</p>
    </div>
  );
}