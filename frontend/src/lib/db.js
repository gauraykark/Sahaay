// src/lib/db.js
//
// Offline-first persistence layer for Sahaay.
// Uses Dexie (IndexedDB) so patient progress, difficulty state, and
// caregiver-visible activity all survive with zero internet connection.
// This is the local source of truth; a backend sync (when online) is a
// later, additive step and must never be required for the app to function.

import Dexie from "dexie";

import { levelOrNull } from "@shared/levels";

export const db = new Dexie("sahaay");

// v1 schema.
// `++id` = auto-incrementing primary key.
// Indexed fields are the ones we actually query/filter/sort by.
db.version(1).stores({
  // One row per patient profile. `photo` (optional base64 data URL) and
  // `avatarColor` (auto-assigned) don't need to be listed here — Dexie
  // only requires indexed/queried fields in the schema string.
  patients: "++id, name, isDemo, createdAt",

  // One row per completed (or abandoned) game round. This is what the
  // Caregiver Dashboard reads to show real recent activity instead of
  // placeholder data.
  gameSessions:
    "++id, patientId, gameType, score, moves, completed, createdAt, synced",

  // Current rule-based difficulty level per patient, per game.
  // Replaces the old localStorage("memory-difficulty") approach so all
  // games can eventually have adaptive difficulty stored consistently.
  difficultyState: "[patientId+gameType], patientId, gameType, level",

  // Small generic key/value table for app-wide state that isn't really
  // "data" — e.g. which patient is currently active on this device.
  settings: "key",
});

// v2: Personal Memory Vault (see SPEC_ADDENDUM_MEMORY_VAULT.md).
// Places and Favorites are intentionally not modeled yet — People and
// Routine steps are the pieces actually implemented in this pass.
db.version(2).stores({
  patients: "++id, name, isDemo, createdAt",
  gameSessions:
    "++id, patientId, gameType, score, moves, completed, createdAt, synced",
  difficultyState: "[patientId+gameType], patientId, gameType, level",
  settings: "key",

  // One row per person in a patient's life. `relationship` is the answer
  // to "Who is X?" (e.g. "your grandson"). `photo` is optional base64.
  vaultPeople: "++id, patientId, name, relationship, createdAt",

  // One row per step in a patient's day, in order, for Daily Guidance
  // (Wake up → Breakfast → Medicine → ...). `order` is a plain integer
  // used for sorting, not an auto-incrementing key.
  vaultRoutineSteps: "++id, patientId, order, time, activity, createdAt",
});

// v3: server identity + the cached AI difficulty plans.
//
// Two additions, both required for the app to adapt while offline:
//
//   patients.serverId — Dexie ids are device-local autoincrements and have no
//     relationship to patients.id on the server. Without this mapping a synced
//     session attaches to whichever patient happens to hold that integer.
//
//   aiPlans — the multi-branch plans the Cognitive Coach writes. The device
//     plays from these, so a finished round adapts instantly with no network.
//     See g_prop_02_architecture.md D3.
db.version(3).stores({
  patients: "++id, name, isDemo, serverId, createdAt",
  gameSessions:
    "++id, patientId, gameType, score, moves, completed, createdAt, synced",
  difficultyState: "[patientId+gameType], patientId, gameType, level",
  settings: "key",
  vaultPeople: "++id, patientId, name, relationship, createdAt",
  vaultRoutineSteps: "++id, patientId, order, time, activity, createdAt",

  // One row per patient per game. Primary key is the pair, so a refresh
  // replaces rather than accumulates.
  aiPlans: "[patientId+gameType], patientId, gameType, generatedAt",
});

// ---------------------------------------------------------------------
// Active patient helpers
// ---------------------------------------------------------------------

const ACTIVE_PATIENT_KEY = "activePatientId";
const DEMO_PATIENT_NAME = "Demo";

// ---------------------------------------------------------------------
// Caregiver preview mode
// ---------------------------------------------------------------------
//
// The caregiver dashboard links to the patient's own home screen so the
// caregiver can see what the patient sees. That screen is fully playable,
// and the active patient at that moment is a REAL patient — so without a
// guard, a caregiver trying out a game writes a real session, syncs it, and
// it lands in the doctor's trend graph as the patient's performance.
//
// While this flag is set, rounds are played but nothing is written: no
// session row, no difficulty change, no sync. sessionStorage, so it dies
// with the tab and can never strand a real patient in a silent no-log state.

const PREVIEW_MODE_KEY = "sahaay-preview-mode";

export function isPreviewMode() {
  if (typeof sessionStorage === "undefined") return false;
  return sessionStorage.getItem(PREVIEW_MODE_KEY) === "true";
}

export function setPreviewMode(on) {
  if (typeof sessionStorage === "undefined") return;
  if (on) sessionStorage.setItem(PREVIEW_MODE_KEY, "true");
  else sessionStorage.removeItem(PREVIEW_MODE_KEY);
}

// Calm, in-palette colors (drawn from the same teal/neutral system as the
// rest of the app) used as automatic avatar backgrounds when a patient has
// no photo. Cycled by id so colors stay stable and distinct per profile.
const AVATAR_COLORS = ["#2f968c", "#4bb3a8", "#78716c", "#a8a29e", "#1f625c"];

function colorForPatient(id) {
  return AVATAR_COLORS[id % AVATAR_COLORS.length];
}

/**
 * Ensures a demo patient exists and returns its id. Used so games and the
 * dashboard always have a valid patientId to write to, even before the
 * full Login/PIN flow is built out.
 */
export async function ensureDemoPatient() {
  const existing = await db.patients.where({ isDemo: 1 }).first();
  if (existing) return existing.id;

  const id = await db.patients.add({
    name: DEMO_PATIENT_NAME,
    isDemo: 1,
    photo: null,
    createdAt: new Date().toISOString(),
  });
  return id;
}

/** Returns the id of the currently active patient, creating a demo patient if none is set. */
export async function getActivePatientId() {
  const setting = await db.settings.get(ACTIVE_PATIENT_KEY);
  if (setting?.value) return setting.value;

  const demoId = await ensureDemoPatient();
  await setActivePatientId(demoId);
  return demoId;
}

/** Sets which patient is active on this device (e.g. after tapping their name on Login). */
export async function setActivePatientId(patientId) {
  await db.settings.put({ key: ACTIVE_PATIENT_KEY, value: patientId });
}

/**
 * Creates a new named patient profile. Caregiver-facing (Decision 10):
 * the caregiver creates the profile, the patient later just taps their
 * own name/photo to continue — no PIN or typing required on their side.
 *
 * @param {string} name
 * @param {string|null} [photo] - optional base64 data URL
 */
export async function createPatient(name, photo = null) {
  const id = await db.patients.add({
    name,
    isDemo: 0,
    photo,
    createdAt: new Date().toISOString(),
  });
  return id;
}

export async function updatePatient(patientId, changes) {
  return db.patients.update(patientId, changes);
}

export async function getPatient(patientId) {
  const patient = await db.patients.get(patientId);
  if (!patient) return patient;
  return { ...patient, avatarColor: colorForPatient(patient.id) };
}

/** Returns every non-demo patient profile, for the Login screen's list of named profiles. */
export async function listPatients() {
  const rows = await db.patients.where("isDemo").equals(0).toArray();
  return rows.map((row) => ({ ...row, avatarColor: colorForPatient(row.id) }));
}

/**
 * Clears all data (sessions + difficulty) for the demo patient, without
 * deleting the profile itself. Used by the "Reset demo" action so judges
 * always see a clean run, on demand, without losing an in-progress demo
 * mid-showcase (see Decision 10 / F-014 Demo Mode).
 */
export async function resetDemoPatientData() {
  const demoId = await ensureDemoPatient();
  await db.transaction(
    "rw",
    db.gameSessions,
    db.difficultyState,
    async () => {
      await db.gameSessions.where("patientId").equals(demoId).delete();
      await db.difficultyState.where("patientId").equals(demoId).delete();
    }
  );
}

// ---------------------------------------------------------------------
// Game session logging (used by all four games)
// ---------------------------------------------------------------------

/**
 * Logs one completed round of any game. Call this from a game's
 * completion handler.
 *
 * @param {Object} session
 * @param {string} session.gameType - "memory" | "routine" | "objects" | "name-recall"
 * @param {boolean} session.completed
 * @param {number} [session.score] - correct answers, for scored games
 * @param {number} [session.total] - total questions, for scored games
 * @param {number} [session.moves] - moves taken, for MemoryGame
 */
export async function logGameSession({
  gameType,
  completed = true,
  score = null,
  total = null,
  moves = null,
  errors = null,
  level = null,
  newLevel = null,
  durationMs = null,
  reason = null,
} = {}) {
  // A caregiver previewing the patient's screen must not write to that
  // patient's clinical record. Nothing is stored and nothing syncs.
  if (isPreviewMode()) return null;

  const patientId = await getActivePatientId();

  const id = await db.gameSessions.add({
    patientId,
    gameType,
    score,
    total,
    moves,
    errors,
    level,
    newLevel,
    durationMs,
    reason,
    completed: completed ? 1 : 0,
    createdAt: new Date().toISOString(),
    synced: 0, // flips to 1 once pushed to the backend
  });

  // Push in the background right away — waiting for the browser's "online"
  // event means a device that never went offline never syncs at all.
  // Dynamic import keeps db.js ↔ api.js from forming a static cycle.
  import("./api.js")
    .then(({ runSyncOnReconnect }) => runSyncOnReconnect())
    .catch(() => {});

  return id;
}

/** Returns the most recent sessions for the active patient, newest first. */
export async function getRecentSessions(limit = 10) {
  const patientId = await getActivePatientId();
  return db.gameSessions
    .where("patientId")
    .equals(patientId)
    .reverse()
    .sortBy("createdAt")
    .then((rows) => rows.slice(0, limit));
}

/** Recent sessions for one game (oldest → newest), used to build AI signals. */
export async function getRecentSessionsForGame(gameType, limit = 8) {
  const patientId = await getActivePatientId();
  const rows = await db.gameSessions
    .where("patientId")
    .equals(patientId)
    .and((row) => row.gameType === gameType)
    .sortBy("createdAt");
  return rows.slice(-limit);
}

/** Current difficulty row for every game the patient has played. */
export async function listDifficultyState() {
  const patientId = await getActivePatientId();
  return db.difficultyState.where("patientId").equals(patientId).toArray();
}

/** Returns the most recent session for a specific game, or undefined if never played. */
export async function getLatestSessionForGame(gameType) {
  const patientId = await getActivePatientId();
  const rows = await db.gameSessions
    .where("patientId")
    .equals(patientId)
    .and((row) => row.gameType === gameType)
    .sortBy("createdAt");
  return rows[rows.length - 1];
}

/** Returns all sessions not yet pushed to the backend (for future sync). */
export async function getUnsyncedSessions() {
  return db.gameSessions.where("synced").equals(0).toArray();
}

export async function markSessionsSynced(ids) {
  return db.transaction("rw", db.gameSessions, async () => {
    for (const id of ids) {
      await db.gameSessions.update(id, { synced: 1 });
    }
  });
}

// ---------------------------------------------------------------------
// Difficulty state (rule-based, offline, per REQ-003 / F-013)
// ---------------------------------------------------------------------

// DELETED: migrateLegacyMemoryLevels() and its "memoryDifficultyV2" settings
// flag. It remapped memory levels {2:1, 3:2, 4:3} on the first read for any
// device whose flag was unset. On the 0-15 scale that is not a migration, it
// is silent corruption: a real level 2 would be rewritten to 1 and a real
// level 3 to 2, with no record that it happened and no way back. Levels are
// now defined once in shared/levels.js and never remapped on read.
//
// Devices that already ran it keep an inert { key: "memoryDifficultyV2" } row
// in `settings` with no reader left. The v4 upgrade sweeps it.

/**
 * Returns the saved difficulty level for a game.
 *
 * `defaultLevel` is returned only when this patient has no stored level for
 * this game at all. A stored level of 0 is a real level and comes back as 0 --
 * see shared/levels.js. Never re-introduce `row?.level || defaultLevel` here.
 */
export async function getDifficulty(gameType, defaultLevel) {
  const patientId = await getActivePatientId();
  const row = await db.difficultyState.get([patientId, gameType]);
  const stored = levelOrNull(row?.level);
  return stored === null ? defaultLevel : stored;
}

/**
 * Saves the difficulty level for a game for the active patient.
 *
 * `source` ("ai" | "rule") is stored alongside the reason so the caregiver
 * dashboard can show whether this guidance came from the Cognitive Coach or
 * the offline rule engine. See g_prop_02_architecture.md D11.
 */
export async function setDifficulty(gameType, level, reason = null, source = null) {
  const patientId = await getActivePatientId();
  return db.difficultyState.put({
    patientId,
    gameType,
    level,
    reason,
    source,
    updatedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------
// Caregiver PIN (Decision 10, revised)
// ---------------------------------------------------------------------
//
// The PIN protects the *caregiver* side of the app, not the patient side.
// A dementia patient tapping their own name/photo to continue (see
// Login.jsx) is a recognition action, not an authentication step — asking
// them to recall and type a PIN would work against the app's purpose.
// The boundary that actually needs protecting is "patient shouldn't end
// up in caregiver settings," which is an adult-facing PIN and a
// reasonable fit for a caregiver's cognitive load.
//
// This is prototype-grade, device-local protection (there is no backend
// account system yet) — it stops a patient from wandering into the
// dashboard, not a determined attacker. The PIN is hashed with SubtleCrypto
// before storage so it isn't sitting in IndexedDB as plain text.

const CAREGIVER_PIN_KEY = "caregiverPinHash";

async function hashPin(pin) {
  const encoded = new TextEncoder().encode(pin);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** True if a caregiver PIN has already been set on this device. */
export async function hasCaregiverPin() {
  const row = await db.settings.get(CAREGIVER_PIN_KEY);
  return Boolean(row?.value);
}

/** Sets (or replaces) the caregiver PIN. Expects a 4-digit string. */
export async function setCaregiverPin(pin) {
  const hash = await hashPin(pin);
  await db.settings.put({ key: CAREGIVER_PIN_KEY, value: hash });
}

/** Checks a candidate PIN against the stored one. */
export async function verifyCaregiverPin(pin) {
  const row = await db.settings.get(CAREGIVER_PIN_KEY);
  if (!row?.value) return false;
  const candidateHash = await hashPin(pin);
  return candidateHash === row.value;
}

// ---------------------------------------------------------------------
// Personal Memory Vault — People
// (SPEC_ADDENDUM_MEMORY_VAULT.md, Section 4)
// ---------------------------------------------------------------------

/** Adds a person to the active patient's Memory Vault. */
export async function addVaultPerson({
  name,
  relationship,
  photo = null,
  circle = 1,
}) {
  const patientId = await getActivePatientId();
  return db.vaultPeople.add({
    patientId,
    name,
    relationship,
    photo,
    circle,
    createdAt: new Date().toISOString(),
  });
}

export async function updateVaultPerson(id, changes) {
  return db.vaultPeople.update(id, changes);
}

export async function deleteVaultPerson(id) {
  return db.vaultPeople.delete(id);
}

/** Lists everyone in the active patient's Memory Vault. */
export async function listVaultPeople() {
  const patientId = await getActivePatientId();
  return db.vaultPeople.where("patientId").equals(patientId).toArray();
}

/**
 * Finds the best-matching person for a spoken/typed name fragment.
 * Simple substring match in both directions — not full NLP — since the
 * realistic question shape in this prototype is narrow ("who is <name>").
 * See SPEC_ADDENDUM_MEMORY_VAULT.md Section 5 for why this is intentional.
 */
export async function findVaultPersonByName(nameFragment) {
  const people = await listVaultPeople();
  const needle = nameFragment.trim().toLowerCase();
  if (!needle) return null;

  return (
    people.find((p) => p.name.toLowerCase() === needle) ||
    people.find(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        needle.includes(p.name.toLowerCase())
    ) ||
    null
  );
}

// ---------------------------------------------------------------------
// Personal Memory Vault — Daily Guidance (routine steps)
// ---------------------------------------------------------------------

/** Adds a step to the active patient's day plan. */
export async function addVaultRoutineStep({ time, activity, order }) {
  const patientId = await getActivePatientId();
  return db.vaultRoutineSteps.add({
    patientId,
    time,
    activity,
    order,
    createdAt: new Date().toISOString(),
  });
}

export async function updateVaultRoutineStep(id, changes) {
  return db.vaultRoutineSteps.update(id, changes);
}

export async function deleteVaultRoutineStep(id) {
  return db.vaultRoutineSteps.delete(id);
}

/** Lists the active patient's day plan, in order. */
export async function listVaultRoutineSteps() {
  const patientId = await getActivePatientId();
  const rows = await db.vaultRoutineSteps
    .where("patientId")
    .equals(patientId)
    .toArray();
  return rows.sort((a, b) => a.order - b.order);
}

// ---------------------------------------------------------------------
// Server identity mapping (v3)
// ---------------------------------------------------------------------
//
// Dexie ids are device-local. The server assigns its own. Every sync needs
// the server's id, so it is stored on the patient row the first time the
// backend hands one back.

/** Server-side patient id for the active patient, or null if never synced. */
export async function getServerPatientId() {
  const patientId = await getActivePatientId();
  const patient = await db.patients.get(patientId);
  return patient?.serverId ?? null;
}

/** Records the server id after a remote patient is created or fetched. */
export async function setServerPatientId(serverId, patientId = null) {
  const localId = patientId ?? (await getActivePatientId());
  return db.patients.update(localId, { serverId });
}

// ---------------------------------------------------------------------
// Cached AI difficulty plans (v3)
// ---------------------------------------------------------------------
//
// A plan holds three branches — what to do if the next round goes well,
// acceptably, or poorly — because the outcome is not known when the plan is
// written. The device applies whichever branch matches, offline, instantly.

// A plan older than this is no longer trusted. A patient offline for three
// weeks should not keep receiving guidance built on last month's data.
const PLAN_MAX_AGE_DAYS = 7;
const PLAN_MAX_ROUNDS = 10;

/** Stores every game plan from one /ai/adapt-difficulty response. */
export async function saveAIPlan(response) {
  const patientId = await getActivePatientId();
  const generatedAt = response.generated_at ?? new Date().toISOString();

  return db.transaction("rw", db.aiPlans, async () => {
    for (const plan of response.plans ?? []) {
      await db.aiPlans.put({
        patientId,
        gameType: plan.game_type,
        currentLevel: plan.current_level,
        ifGood: plan.if_good,
        ifOk: plan.if_ok,
        ifPoor: plan.if_poor,
        nextGame: response.next_game ?? null,
        source: response.source ?? "rule",
        generatedAt,
        roundsSince: 0,
      });
    }
  });
}

/**
 * The plan for one game, or null when there is none or it has gone stale.
 *
 * Returning null is the signal to fall back to the rule engine — which is
 * why staleness is checked here rather than at the call site.
 */
export async function getAIPlan(gameType) {
  const patientId = await getActivePatientId();
  const plan = await db.aiPlans.get([patientId, gameType]);
  if (!plan) return null;

  const ageDays = (Date.now() - new Date(plan.generatedAt).getTime()) / 86400000;
  if (ageDays > PLAN_MAX_AGE_DAYS) return null;
  if ((plan.roundsSince ?? 0) >= PLAN_MAX_ROUNDS) return null;

  return plan;
}

/** Counts a round against the plan, so it expires on use as well as on age. */
export async function markPlanUsed(gameType) {
  const patientId = await getActivePatientId();
  const plan = await db.aiPlans.get([patientId, gameType]);
  if (!plan) return;
  await db.aiPlans.put({ ...plan, roundsSince: (plan.roundsSince ?? 0) + 1 });
}