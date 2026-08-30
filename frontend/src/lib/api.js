// src/lib/api.js
//
// Client for the Sahaay FastAPI backend.
//
// The offline contract: nothing the patient does ever waits on this file. The
// games read a cached plan from IndexedDB and play; these calls run in the
// background afterwards. Dashboard calls (doctor, caregiver) are allowed to
// block — an adult reading a screen can wait three seconds, a patient who has
// just finished a game cannot.

import { domainForGame } from "@shared/domains";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const TOKEN_KEY = "sahaay-auth-token";
const ROLE_KEY = "sahaay-auth-role";

// ── Token storage ─────────────────────────────────────────────────────────────

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getStoredRole() {
  return localStorage.getItem(ROLE_KEY);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ROLE_KEY);
}

// ── Base fetch ────────────────────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.detail ?? `HTTP ${res.status}`), {
      status: res.status,
    });
  }

  if (res.status === 204) return null;
  return res.json();
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function register({
  name,
  email,
  password,
  role = "caregiver",
  designation = null,
  preferredLanguage = "en",
}) {
  return apiFetch("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name,
      email,
      password,
      role,
      designation,
      preferred_language: preferredLanguage,
    }),
  });
}

/**
 * Log in and persist the JWT.
 *
 * Returns { token, role, name } — the role comes back with the token so the
 * caller can route straight to the right dashboard without a second request.
 */
export async function login({ email, password }) {
  const form = new URLSearchParams({ username: email, password });

  const res = await fetch(`${BASE_URL}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });

  if (!res.ok) throw new Error("Incorrect email or password");

  const data = await res.json();
  setToken(data.access_token);
  localStorage.setItem(ROLE_KEY, data.role);

  return { token: data.access_token, role: data.role, name: data.name };
}

export async function getMe() {
  return apiFetch("/auth/me");
}

export async function listDoctors() {
  return apiFetch("/auth/doctors");
}

// ── Patients ──────────────────────────────────────────────────────────────────

export async function createPatientRemote({
  name,
  age = null,
  diagnosisStage = null,
  photo = null,
  doctorId = null,
  isDemo = false,
}) {
  return apiFetch("/patients", {
    method: "POST",
    body: JSON.stringify({
      name,
      age,
      diagnosis_stage: diagnosisStage,
      photo,
      doctor_id: doctorId,
      is_demo: isDemo,
    }),
  });
}

export async function listPatientsRemote() {
  return apiFetch("/patients");
}

/**
 * Pull the signed-in caregiver's patients from the server into Dexie.
 *
 * The dashboard and login list read IndexedDB only (offline-first), so a
 * caregiver signing in on a fresh device would otherwise see "No patients
 * yet" while GET /patients happily returns their patient. Upserts by
 * serverId; adopts a same-named local profile instead of duplicating it.
 * Safe to call on every dashboard open — offline it is a silent no-op.
 */
export async function hydratePatientsFromServer() {
  if (!getToken()) return [];

  let remote;
  try {
    remote = await listPatientsRemote();
  } catch {
    return []; // offline or expired token — local data stays the state
  }

  const { db } = await import("./db");

  for (const patient of remote) {
    const existing = await db.patients
      .where("serverId")
      .equals(patient.id)
      .first();

    if (existing) {
      await db.patients.update(existing.id, {
        name: patient.name,
        photo: existing.photo ?? patient.photo ?? null,
      });
      continue;
    }

    // A profile created locally before it ever reached the server: link it
    // rather than adding a twin.
    const unlinked = await db.patients
      .filter(
        (row) => !row.serverId && row.isDemo === 0 && row.name === patient.name
      )
      .first();

    if (unlinked) {
      await db.patients.update(unlinked.id, { serverId: patient.id });
    } else {
      await db.patients.add({
        name: patient.name,
        isDemo: 0,
        photo: patient.photo ?? null,
        serverId: patient.id,
        createdAt: patient.created_at ?? new Date().toISOString(),
      });
    }
  }

  return remote;
}

export async function updatePatientRemote(patientId, changes) {
  return apiFetch(`/patients/${patientId}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

// ── Doctor ────────────────────────────────────────────────────────────────────

/** The whole dashboard in one request — cards, priority strip, assistant. */
export async function fetchDoctorDashboard() {
  return apiFetch("/doctors/me/patients");
}

export async function fetchClinicalView(patientId) {
  return apiFetch(`/doctors/patients/${patientId}/clinical`);
}

export async function addClinicalNote(patientId, { body, needsFollowup = false }) {
  return apiFetch(`/doctors/patients/${patientId}/notes`, {
    method: "POST",
    body: JSON.stringify({ body, needs_followup: needsFollowup }),
  });
}

/** Removes a patient entirely from the doctor's caseload and the database. */
export async function deletePatientAsDoctor(patientId) {
  return apiFetch(`/doctors/patients/${patientId}`, { method: "DELETE" });
}

/** Detaches a patient from this doctor, leaving the record intact for another doctor to pick up. */
export async function unassignPatient(patientId) {
  return apiFetch(`/doctors/patients/${patientId}/unassign`, { method: "POST" });
}

/** Every caregiver in the system, for the doctor's Manage screen. */
export async function fetchCaregivers() {
  return apiFetch("/doctors/caregivers");
}

// ── Session sync ──────────────────────────────────────────────────────────────

/**
 * Map a Dexie row onto the backend schema.
 *
 * Dexie stores camelCase and uses `id` as its own primary key; the API wants
 * snake_case and expects that id as `dexie_id` so re-sends deduplicate. Every
 * sync must go through here — passing raw rows was the bug that silently
 * 422'd the entire queue.
 */
export function toSyncPayload(row) {
  return {
    dexie_id: row.id ?? null,
    patient_id: row.serverPatientId ?? row.patientId,
    game_type: row.gameType,
    // The device sends the domain it measured. The server used to resolve it
    // from game_type, which froze a four-domain label into every row.
    domain: row.domain ?? domainForGame(row.gameType),
    score: row.score ?? null,
    total: row.total ?? null,
    moves: row.moves ?? null,
    errors: row.errors ?? null,
    level: row.level ?? null,
    new_level: row.newLevel ?? null,
    duration_ms: row.durationMs ?? null,
    completed: Boolean(row.completed),
    // Rows written before schema v4 have no status; they all came from games
    // that hardcoded completed:true, so `completed` is what it meant.
    status: row.status ?? (row.completed ? "completed" : "abandoned"),
    item_ids: row.itemIds ?? null,
    session_id: row.sessionId ?? null,
    created_at: row.createdAt ?? null,
    reason: row.reason ?? null,
    source: row.source ?? "rule",
  };
}

export async function syncSessions(rows) {
  return apiFetch("/sessions/sync", {
    method: "POST",
    body: JSON.stringify({ sessions: rows.map(toSyncPayload) }),
  });
}

export async function listSessionsRemote(patientId, { gameType, limit } = {}) {
  const params = new URLSearchParams();
  if (gameType) params.set("game_type", gameType);
  if (limit) params.set("limit", limit);
  return apiFetch(`/sessions/${patientId}?${params}`);
}

// ── Reminders ─────────────────────────────────────────────────────────────────

export async function createReminderRemote(data) {
  return apiFetch("/reminders", { method: "POST", body: JSON.stringify(data) });
}

export async function listRemindersRemote(patientId) {
  return apiFetch(`/reminders/${patientId}`);
}

export async function updateReminderRemote(reminderId, changes) {
  return apiFetch(`/reminders/${reminderId}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

export async function deleteReminderRemote(reminderId) {
  return apiFetch(`/reminders/${reminderId}`, { method: "DELETE" });
}

/** Records whether a reminder was acted on. The only source for adherence %. */
export async function logReminderEvent({ reminderId, patientId, dueAt, actedAt, status }) {
  return apiFetch("/reminders/logs", {
    method: "POST",
    body: JSON.stringify({
      reminder_id: reminderId,
      patient_id: patientId,
      due_at: dueAt,
      acted_at: actedAt ?? null,
      status,
    }),
  });
}

// ── AI ────────────────────────────────────────────────────────────────────────

/** Whether the AI layer is live, so the UI can label guidance honestly. */
export async function fetchAIStatus() {
  try {
    return await apiFetch("/ai/status");
  } catch {
    return { mode: "rule", key_configured: false, chains_implemented: false };
  }
}

/**
 * Fetch a fresh difficulty plan and hand it to the caller to cache.
 *
 * Background only — never awaited on a path the patient is waiting on. Returns
 * null on any failure, because failing to refresh a plan is not an error: the
 * device keeps playing on the plan it already has.
 */
export async function fetchDifficultyPlan(patientId, { lookback = 8 } = {}) {
  try {
    return await apiFetch("/ai/adapt-difficulty", {
      method: "POST",
      body: JSON.stringify({ patient_id: patientId, lookback_sessions: lookback }),
    });
  } catch {
    return null;
  }
}

/**
 * Generate a progress report. This one is allowed to block — it is triggered
 * by a deliberate button press on a dashboard.
 */
export async function generateReport({
  patientId,
  audience = "caregiver",
  periodDays = 7,
  language = "en",
}) {
  return apiFetch("/ai/generate-report", {
    method: "POST",
    body: JSON.stringify({
      patient_id: patientId,
      audience,
      period_days: periodDays,
      language,
    }),
  });
}

// ── Online sync orchestrator ──────────────────────────────────────────────────

/**
 * Push queued sessions, then pull a fresh plan.
 *
 * Fire and forget. Called on the browser's `online` event and after a session
 * is logged. Nothing in the UI waits for it to finish.
 */
export async function runSyncOnReconnect() {
  if (!getToken()) return;

  const {
    getActivePatientId,
    getUnsyncedSessions,
    markSessionsSynced,
    getServerPatientId,
    saveAIPlan,
  } = await import("./db");

  const activePatientId = await getActivePatientId();
  const serverPatientId = await getServerPatientId();

  // Only the active patient's rows: theirs is the only server identity we
  // know. Rounds from other local profiles (e.g. the Demo patient) must not
  // be attached to this patient's server record.
  const unsynced = (await getUnsyncedSessions()).filter(
    (row) => row.patientId === activePatientId
  );

  if (unsynced.length && serverPatientId) {
    try {
      const rows = unsynced.map((row) => ({ ...row, serverPatientId }));
      const result = await syncSessions(rows);
      if (result) {
        // Rows the server skipped are duplicates it already holds — marking
        // them synced stops the queue from resending them forever.
        await markSessionsSynced(unsynced.map((row) => row.id));
      }
    } catch {
      // Stays queued. Retries on the next reconnect — the queue is the state.
    }
  }

  // Refresh the cached plan while there is signal, so the next offline
  // stretch adapts on current guidance rather than last week's.
  if (serverPatientId) {
    const plan = await fetchDifficultyPlan(serverPatientId);
    if (plan) await saveAIPlan(plan);
  }
}