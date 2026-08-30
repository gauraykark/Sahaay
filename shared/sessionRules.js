// When may a patient play, and what is in a session.
//
// Pure functions, no storage and no clock of their own -- `now` and the day's
// sessions are always passed in. That is what makes the awkward cases
// testable: a session that runs across midnight, a four-hour gap that has to
// survive a date change, a daily cap that counts play time rather than the
// hours since someone first opened the app.
//
// The dosing comes from the clinical programme: roughly 90 minutes a week,
// split small because we need daily data and short sessions suit short
// attention spans. Past about fifteen minutes people get tired, and a tired
// score looks exactly like a declining one -- which would quietly poison the
// only number this app produces.

import { DOMAINS } from "./domains.js";

export const SESSIONS_PER_DAY = 2;
export const ITEMS_PER_DOMAIN = 2;
export const ITEMS_PER_SESSION = DOMAINS.length * ITEMS_PER_DOMAIN; // 12

/** Rolling gap from the END of the previous session, never a clock time. */
export const SESSION_GAP_MS = 4 * 60 * 60 * 1000;

/** Hard cap on PLAY time per day. Not time since first open. */
export const DAILY_CAP_MS = 20 * 60 * 1000;

export const LOCK = {
  UNLOCKED: "unlocked",
  RESUME: "resume",
  GAP: "gap",
  SESSIONS_DONE: "sessions_done",
  CAP_REACHED: "cap_reached",
};

/**
 * The local calendar day a timestamp belongs to, as YYYY-MM-DD.
 *
 * Local, not UTC: a patient in Assam playing at 23:50 is playing on that
 * evening's date, and a UTC key would file it under the next day.
 */
export function dayKey(ts, tzOffsetMinutes = null) {
  const d = new Date(ts);
  if (tzOffsetMinutes !== null) {
    const shifted = new Date(ts - tzOffsetMinutes * 60000);
    return shifted.toISOString().slice(0, 10);
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * A session belongs to the day it STARTED.
 *
 * One that begins at 23:50 and ends at 00:05 is one session for the evening it
 * began, and its play time counts against that day. Filing it under the end
 * time would let a patient get a third session by starting just before
 * midnight, and would split one sitting's play time across two days.
 */
export const sessionDay = (session) => dayKey(session.startedAt);

/** Sessions belonging to the day that contains `now`. */
export function sessionsForDay(sessions, now) {
  const key = dayKey(now);
  return sessions.filter((s) => sessionDay(s) === key);
}

/** Play time already spent on the day containing `now`. */
export function playMsForDay(sessions, now) {
  return sessionsForDay(sessions, now).reduce((sum, s) => sum + (s.playMs ?? 0), 0);
}

/**
 * May the patient start (or resume) a session right now?
 *
 * @returns {{unlocked: boolean, reason: string, nextAt: number|null,
 *            resumeId: string|null, preview: boolean}}
 */
export function sessionGate({ sessions = [], now = Date.now(), isPreview = false } = {}) {
  // ── The one preview guard ────────────────────────────────────────────────
  //
  // Every time gate lifts here and nowhere else. A caregiver has to be able to
  // walk through the whole app in one sitting, and scattering `isPreview`
  // through the runner is how a real lock ends up half-bypassed and nobody can
  // tell a genuine gate from a bug.
  //
  // Note what does NOT lift: contents still freeze at session start, rounds
  // still log, errorless still applies, abandons still write. Only time moves.
  // Whether those writes actually reach the database is a separate question,
  // answered by db.isPreviewMode() at each write site.
  if (isPreview) {
    const open = sessions.find((s) => s.status === "in_progress");
    return {
      unlocked: true,
      reason: open ? LOCK.RESUME : LOCK.UNLOCKED,
      nextAt: null,
      resumeId: open?.sessionId ?? null,
      preview: true,
    };
  }

  // An unfinished session always wins. It is already frozen, and resuming it
  // is the whole reason contents are stored rather than rebuilt.
  const open = sessions.find((s) => s.status === "in_progress");
  if (open) {
    return {
      unlocked: true,
      reason: LOCK.RESUME,
      nextAt: null,
      resumeId: open.sessionId,
      preview: false,
    };
  }

  const today = sessionsForDay(sessions, now);
  const finished = today.filter((s) => s.status !== "in_progress");

  if (finished.length >= SESSIONS_PER_DAY) {
    return { unlocked: false, reason: LOCK.SESSIONS_DONE, nextAt: startOfNextDay(now), resumeId: null, preview: false };
  }

  if (playMsForDay(sessions, now) >= DAILY_CAP_MS) {
    return { unlocked: false, reason: LOCK.CAP_REACHED, nextAt: startOfNextDay(now), resumeId: null, preview: false };
  }

  // The gap runs from the last session's END, whenever that was. It does not
  // reset at midnight: fatigue and spacing do not care about the date, and a
  // session finished at 00:05 should still hold the next one off until 04:05.
  const lastEnd = sessions
    .filter((s) => s.endedAt)
    .reduce((max, s) => Math.max(max, s.endedAt), 0);

  if (lastEnd > 0 && now < lastEnd + SESSION_GAP_MS) {
    return { unlocked: false, reason: LOCK.GAP, nextAt: lastEnd + SESSION_GAP_MS, resumeId: null, preview: false };
  }

  return { unlocked: true, reason: LOCK.UNLOCKED, nextAt: null, resumeId: null, preview: false };
}

function startOfNextDay(now) {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

/**
 * Build the frozen contents of one session.
 *
 * Called ONCE, at session start. The list is then stored and never rebuilt --
 * getting item 3 wrong must not change item 4. Wrong answers move the base
 * level in seven days; they change nothing inside the session. If struggling
 * changed what came next, the patient would be punished for struggling.
 *
 * Every session contains all six domains, shuffled, ITEMS_PER_DOMAIN each.
 * Not "today is memory day" -- everything, every session, so all six lines on
 * the trend graph get a point.
 *
 * @param select  ({domain, level, recentIds, seed}) => {item}
 */
export function buildSessionItems({ select, levels, recentIdsByDomain = {}, seed = 0, shuffle }) {
  const picked = [];

  for (const domain of DOMAINS) {
    const level = levels?.[domain] ?? 0;
    const used = new Set(recentIdsByDomain[domain] ?? []);
    for (let n = 0; n < ITEMS_PER_DOMAIN; n += 1) {
      const { item } = select({ domain, level, recentIds: used, seed: seed + picked.length });
      used.add(item.id);
      picked.push(item);
    }
  }

  // Shuffled so the patient is not walked through six domains in a fixed
  // order, which would let them learn the shape of a session.
  return shuffle ? shuffle(picked, seed) : picked;
}
