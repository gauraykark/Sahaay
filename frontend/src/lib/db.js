// src/lib/db.js
//
// Offline-first persistence layer for Sahaay.
// Uses Dexie (IndexedDB) so patient progress, difficulty state, and
// caregiver-visible activity all survive with zero internet connection.
// This is the local source of truth; a backend sync (when online) is a
// later, additive step and must never be required for the app to function.

import Dexie from "dexie";

import { DOMAINS, domainForGame } from "@shared/domains";
import { clampLevel, levelOrNull } from "@shared/levels";

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

// v4: six stored base levels, a real abandon path, and item rotation.
//
// Three additions and one removal:
//
//   domainLevels — the six DSM-5 base levels, one row per patient per domain,
//     moving independently. Before this the level was inferred from the newest
//     session, which cannot represent six numbers on separate weekly cadences.
//     `level` is NULL for uncalibrated and 0 for measured-at-the-bottom, and
//     those are different facts — see shared/levels.js.
//
//   itemHistory — when each item was last shown, for the 14-day no-repeat
//     rule. Without it a patient memorises the same twenty pictures and the
//     trend line reports improvement that never happened.
//
//   gameSessions gains status / itemIds / sessionId. Every game used to
//     hardcode completed:true, so no round could be logged as abandoned.
//
//   aiPlans is DROPPED. Per-round AI difficulty is being replaced by a
//     deterministic formula; the readers are stubbed here and removed with
//     the rest of the coach in Sprint 7.
//
// Dexie carries every unlisted table forward untouched, so patients,
// difficultyState, settings and both vault tables survive as they are.
db.version(4)
  .stores({
    patients: "++id, name, isDemo, serverId, createdAt",
    gameSessions:
      "++id, patientId, gameType, domain, score, moves, completed, status, sessionId, createdAt, synced",
    difficultyState: "[patientId+gameType], patientId, gameType, level",
    settings: "key",
    vaultPeople: "++id, patientId, name, relationship, createdAt",
    vaultRoutineSteps: "++id, patientId, order, time, activity, createdAt",

    // One row per patient per domain. The pair is the primary key, so a
    // level write replaces rather than accumulates.
    domainLevels: "[patientId+domain], patientId, domain, level, updatedAt",

    // One row per item shown. Queried by [patientId+domain] to find what is
    // still eligible, and by playedAt to age rows out.
    itemHistory: "++id, [patientId+domain], patientId, domain, itemId, playedAt",

    // Dropped — see above.
    aiPlans: null,
  })
  .upgrade(async (tx) => {
    // Existing rounds all predate the abandon path, and every one of them was
    // written by a game that hardcoded completed:true. Stamping them
    // "completed" is not an assumption, it is what the old column already
    // meant. Anything genuinely incomplete stays honest via `completed`.
    await tx
      .table("gameSessions")
      .toCollection()
      .modify((row) => {
        if (row.status === undefined) {
          row.status = row.completed ? "completed" : "abandoned";
        }
      });

    // The inert flag left behind by migrateLegacyMemoryLevels(), deleted in
    // Sprint 0. Nothing reads it; sweep it so the table stays legible.
    await tx.table("settings").delete("memoryDifficultyV2");
  });

// v5: frozen play sessions.
//
// A session's contents are decided once, at the start, and stored. They are
// never rebuilt -- that is what makes "getting item 3 wrong does not change
// item 4" true rather than merely intended, and it is what lets a patient who
// closed the app mid-session come back to the SAME questions instead of a
// reshuffled set.
//
// `playMs` accumulates actual play time, which is what the 20-minute daily cap
// counts. Wall-clock time since the app was opened would punish a patient who
// put the phone down to answer the door.
db.version(5).stores({
  patients: "++id, name, isDemo, serverId, createdAt",
  gameSessions:
    "++id, patientId, gameType, domain, score, moves, completed, status, sessionId, createdAt, synced",
  difficultyState: "[patientId+gameType], patientId, gameType, level",
  settings: "key",
  vaultPeople: "++id, patientId, name, relationship, createdAt",
  vaultRoutineSteps: "++id, patientId, order, time, activity, createdAt",
  domainLevels: "[patientId+domain], patientId, domain, level, updatedAt",
  itemHistory: "++id, [patientId+domain], patientId, domain, itemId, playedAt",

  // One row per sitting. `sessionId` is the client-generated id that every
  // round of that sitting carries, so the two can be joined later.
  playSessions:
    "sessionId, patientId, [patientId+dayKey], dayKey, startedAt, endedAt, status",
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
  domain = null,
  completed = true,
  status = null,
  score = null,
  total = null,
  moves = null,
  errors = null,
  level = null,
  newLevel = null,
  durationMs = null,
  reason = null,
  itemIds = null,
  sessionId = null,
} = {}) {
  // A caregiver previewing the patient's screen must not write to that
  // patient's clinical record. Nothing is stored and nothing syncs.
  if (isPreviewMode()) return null;

  const patientId = await getActivePatientId();

  // A row is written EVERY time a game ends — win, lose or quit. Logging only
  // some of them makes the tracking blind: an abandoned round that writes
  // nothing looks identical to a round that never started.
  const resolvedStatus = status ?? (completed ? "completed" : "abandoned");

  // The device knows which domain it was measuring, so it says so. Resolving
  // this server-side stamped a four-domain label into every historical row.
  const resolvedDomain = domain ?? domainForGame(gameType);

  const id = await db.gameSessions.add({
    patientId,
    gameType,
    domain: resolvedDomain,
    score,
    total,
    moves,
    errors,
    level,
    newLevel,
    durationMs,
    reason,
    itemIds,
    sessionId,
    // `completed` stays for the existing dashboard readers; `status` is what
    // the clinical layer uses from here on.
    completed: resolvedStatus === "completed" ? 1 : 0,
    status: resolvedStatus,
    createdAt: new Date().toISOString(),
    synced: 0, // flips to 1 once pushed to the backend
  });

  // Rotation bookkeeping travels with the round, so an abandoned round still
  // burns the items it actually showed — the patient saw them either way.
  if (resolvedDomain && itemIds?.length) {
    await recordItemsShown(resolvedDomain, itemIds);
  }

  // Push in the background right away — waiting for the browser's "online"
  // event means a device that never went offline never syncs at all.
  // Dynamic import keeps db.js ↔ api.js from forming a static cycle.
  import("./api.js")
    .then(({ runSyncOnReconnect }) => runSyncOnReconnect())
    .catch(() => {});

  return id;
}

/**
 * Log a round the patient walked away from.
 *
 * Unplayed domains get NULL, never 0. A zero from quitting is
 * indistinguishable from a zero from decline, and mixing them would poison
 * every trend line built on top. Leaving is never treated as failure — this
 * exists so that quitting is *measured*, not punished.
 */
export async function logAbandonedSession({
  gameType,
  domain = null,
  level = null,
  durationMs = null,
  itemIds = null,
  sessionId = null,
} = {}) {
  return logGameSession({
    gameType,
    domain,
    status: "abandoned",
    completed: false,
    // Explicitly null: nothing was measured, so nothing is claimed.
    score: null,
    total: null,
    moves: null,
    errors: null,
    level,
    newLevel: null,
    durationMs,
    itemIds,
    sessionId,
  });
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
// The aiPlans table is gone as of schema v4. Per-round AI difficulty is
// replaced by a deterministic formula: the same inputs must always give the
// same level, which no model can promise.
//
// The sync orchestrator no longer calls saveAIPlan() -- api.js dropped the
// plan fetch along with the last client call to /ai/adapt-difficulty, which
// was firing after every synced round against an endpoint Sprint 7 deletes.
//
// These three are now unreferenced. They stay as no-ops only so that anything
// still importing them resolves; getAIPlan() returning null is already the
// "fall back to the deterministic path" signal.
//
// SPRINT 7: delete all three outright. There are no call sites left to fix.

/** No-op. The plan table is gone; kept so Sprint 7's callers still resolve. */
export async function saveAIPlan() {
  return null;
}

/** Always null — the signal to use the deterministic path. */
export async function getAIPlan() {
  return null;
}

/** No-op. Nothing to age when there are no plans. */
export async function markPlanUsed() {}

// ---------------------------------------------------------------------
// Base levels — the six DSM-5 domains
// ---------------------------------------------------------------------
//
// Six numbers per patient, one per domain, moving INDEPENDENTLY. Memory
// sliding while executive holds flat is a different clinical picture from a
// global decline, and one number cannot show the difference.
//
// null means UNCALIBRATED — nobody has measured this domain yet.
// 0 means measured, at the bottom of the 0-15 scale.
// Those are different facts. Never collapse them; never write `|| 1`.

/** The six base levels for the active patient. Always six keys. */
export async function getDomainLevels(patientId = null) {
  const id = patientId ?? (await getActivePatientId());
  const rows = await db.domainLevels.where("patientId").equals(id).toArray();
  const stored = Object.fromEntries(rows.map((r) => [r.domain, levelOrNull(r.level)]));
  return Object.fromEntries(DOMAINS.map((d) => [d, stored[d] ?? null]));
}

/** One domain's base level, or null when uncalibrated. */
export async function getDomainLevel(domain) {
  const patientId = await getActivePatientId();
  const row = await db.domainLevels.get([patientId, domain]);
  return levelOrNull(row?.level);
}

/**
 * Write one domain's base level.
 *
 * Respects preview mode for the same reason logGameSession does: a caregiver
 * trying a game must not move the patient's real clinical numbers.
 */
export async function setDomainLevel(domain, level, reason = null, source = "rule") {
  if (isPreviewMode()) return null;
  if (!DOMAINS.includes(domain)) {
    throw new Error(`unknown domain: ${domain}`);
  }
  const patientId = await getActivePatientId();
  return db.domainLevels.put({
    patientId,
    domain,
    level: clampLevel(level),
    reason,
    source,
    updatedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------
// Item rotation — the 14-day no-repeat rule
// ---------------------------------------------------------------------
//
// If the same twenty pictures come round every day the patient memorises
// those specific pictures, scores climb, and the trend line reports
// improvement where nothing changed. This is the difference between a
// measurement and a number that drifts upward on its own.

export const ITEM_ROTATION_DAYS = 14;

/** Record that these items were shown, so rotation can exclude them. */
export async function recordItemsShown(domain, itemIds, playedAt = null) {
  if (isPreviewMode()) return null;
  if (!itemIds?.length) return null;

  const patientId = await getActivePatientId();
  const when = playedAt ?? new Date().toISOString();
  return db.itemHistory.bulkAdd(
    itemIds.map((itemId) => ({ patientId, domain, itemId, playedAt: when }))
  );
}

/** Item ids shown in this domain within the rotation window. */
export async function recentItemIds(domain, days = ITEM_ROTATION_DAYS) {
  const patientId = await getActivePatientId();
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const rows = await db.itemHistory
    .where("[patientId+domain]")
    .equals([patientId, domain])
    .toArray();
  return new Set(rows.filter((r) => r.playedAt >= cutoff).map((r) => r.itemId));
}

/** Drop history well past the window so the table cannot grow without bound. */
export async function pruneItemHistory(days = ITEM_ROTATION_DAYS * 3) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const stale = await db.itemHistory.filter((r) => r.playedAt < cutoff).toArray();
  if (stale.length) await db.itemHistory.bulkDelete(stale.map((r) => r.id));
  return stale.length;
}
// ---------------------------------------------------------------------
// Play sessions — the frozen sitting
// ---------------------------------------------------------------------

/**
 * Every session for the active patient, newest first.
 *
 * The gate needs a few days of history, not all of it: the four-hour rule
 * looks at the most recent end time, and the per-day rules look at today.
 */
export async function listPlaySessions(days = 3) {
  const patientId = await getActivePatientId();
  const cutoff = Date.now() - days * 86400000;
  const rows = await db.playSessions.where("patientId").equals(patientId).toArray();
  return rows
    .filter((r) => (r.startedAt ?? 0) >= cutoff || r.status === "in_progress")
    .sort((a, b) => b.startedAt - a.startedAt);
}

export async function getPlaySession(sessionId) {
  return db.playSessions.get(sessionId);
}

/**
 * Store a freshly built session. Called once; the items never change after.
 *
 * Preview mode still freezes and still stores: a caregiver walking through the
 * app must see the same resume behaviour a patient would. What preview blocks
 * is CLINICAL writes -- game rounds and level changes -- not the scaffolding
 * that makes the app navigable.
 */
export async function startPlaySession({ sessionId, dayKey, items, levels }) {
  const patientId = await getActivePatientId();

  // IDEMPOTENT, AND ATOMIC. If a session is already open for this patient,
  // return it instead of creating a second one.
  //
  // The transaction is the point. A plain check-then-create loses the race:
  // React StrictMode double-invokes effects in development, both calls read
  // "no open session" before either writes, and two sessions land one
  // millisecond apart. That is not a development-only problem -- two open
  // sessions both count against the two-a-day limit, the gate resumes
  // whichever it finds first, and the other silently eats a slot.
  //
  // Dexie serialises operations on a table inside an rw transaction, so the
  // read and the write cannot interleave.
  return db.transaction("rw", db.playSessions, async () => {
    const existing = await db.playSessions
      .where("patientId")
      .equals(patientId)
      .filter((r) => r.status === "in_progress")
      .first();
    if (existing) return existing;

    const row = {
      sessionId,
      patientId,
      dayKey,
      // Item ids alongside the items themselves, so a query can find a
      // session by item without deserialising every row.
      itemIds: items.map((i) => i.id),
      items,
      levels,
      index: 0,
      playMs: 0,
      startedAt: Date.now(),
      endedAt: null,
      status: "in_progress",
    };
    await db.playSessions.put(row);
    return row;
  });
}

/** Advance the frozen session. Never touches `items`. */
export async function advancePlaySession(sessionId, { index, addPlayMs = 0 }) {
  const row = await db.playSessions.get(sessionId);
  if (!row) return null;
  const next = {
    ...row,
    index: index ?? row.index,
    playMs: (row.playMs ?? 0) + addPlayMs,
  };
  await db.playSessions.put(next);
  return next;
}

/** Close a session. `status` is "completed" or "abandoned". */
export async function endPlaySession(sessionId, status, addPlayMs = 0) {
  const row = await db.playSessions.get(sessionId);
  if (!row) return null;
  const next = {
    ...row,
    playMs: (row.playMs ?? 0) + addPlayMs,
    endedAt: Date.now(),
    status,
  };
  await db.playSessions.put(next);
  return next;
}
