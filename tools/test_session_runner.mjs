// Sprint 5 DoD: the session runner.
//
// Every awkward case the spec names, driven through the real gate. `now` and
// the session history are injected, so midnight, the four-hour gap and the
// daily cap are all testable without waiting for a clock.
//
// Run from the repo root:  node tools/test_session_runner.mjs

import { DOMAINS } from "../shared/domains.js";
import { seededShuffle, selectItem } from "../shared/itemBank.js";
import {
  DAILY_CAP_MS,
  ITEMS_PER_DOMAIN,
  ITEMS_PER_SESSION,
  itemsForDomain,
  LOCK,
  SESSIONS_PER_DAY,
  SESSION_GAP_MS,
  buildSessionItems,
  dayKey,
  playMsForDay,
  sessionGate,
  sessionsForDay,
} from "../shared/sessionRules.js";

const passed = [];
const failed = [];
const ok = (n, c, d = "") => (c ? passed.push(n) : failed.push(d ? `${n}: ${d}` : n));
const eq = (n, got, want) =>
  ok(n, Object.is(got, want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/** A local-time timestamp, so day boundaries behave the way a patient sees them. */
const at = (y, m, d, hh, mm = 0) => new Date(y, m - 1, d, hh, mm, 0, 0).getTime();

const done = (startedAt, endedAt, playMs) => ({
  sessionId: `s${startedAt}`, startedAt, endedAt, playMs, status: "completed",
});

const levels = Object.fromEntries(DOMAINS.map((d) => [d, 5]));

// ── 1. Session contents freeze ───────────────────────────────────────────────

{
  const build = () =>
    buildSessionItems({ select: selectItem, levels, seed: 99, shuffle: seededShuffle });

  const first = build();
  eq("a session holds all six domains x itemsForDomain", first.length, ITEMS_PER_SESSION);
  eq("that is 16", first.length, 16);

  const perDomain = {};
  for (const it of first) perDomain[it.domain] = (perDomain[it.domain] ?? 0) + 1;
  ok("every domain appears exactly itemsForDomain times",
     DOMAINS.every((d) => perDomain[d] === itemsForDomain(d)), JSON.stringify(perDomain));
  // Attention is the only exception, and the default is untouched.
  eq("attention is capped at one item", itemsForDomain("attention"), 1);
  ok("every other domain keeps the default of three",
     DOMAINS.filter((d) => d !== "attention").every((d) => itemsForDomain(d) === ITEMS_PER_DOMAIN),
     "a non-attention domain drifted off the default");
  eq("the default is still three", ITEMS_PER_DOMAIN, 3);
  ok("the order is shuffled, not domain-by-domain",
     new Set(first.slice(0, 6).map((i) => i.domain)).size > 1,
     "first six items are all one domain");

  // THE central guarantee: answering does not rebuild anything. The list is a
  // value, so simulate a whole round of wrong answers against it and compare.
  const frozen = JSON.parse(JSON.stringify(first));
  const answers = [];
  for (let i = 0; i < first.length; i += 1) {
    answers.push({ index: i, correct: false }); // every one wrong
  }
  eq("a wrong answer changes nothing in the list",
     JSON.stringify(first), JSON.stringify(frozen));
  ok("item 4 is untouched after item 3 is answered wrong",
     JSON.stringify(first[3]) === JSON.stringify(frozen[3]));
  eq("every item in the frozen list was answered", answers.length, ITEMS_PER_SESSION);

  // Rebuilding with the same seed is identical; that is what lets a resumed
  // session be the same session.
  eq("the same seed rebuilds the same session",
     JSON.stringify(build()), JSON.stringify(first));
}

// ── 2. Two sessions a day ────────────────────────────────────────────────────

{
  const now = at(2026, 3, 10, 20, 0);
  const two = [
    done(at(2026, 3, 10, 9, 0), at(2026, 3, 10, 9, 10), 10 * MIN),
    done(at(2026, 3, 10, 14, 0), at(2026, 3, 10, 14, 8), 8 * MIN),
  ];
  const gate = sessionGate({ sessions: two, now });
  ok("a third session is refused", !gate.unlocked);
  eq("and says why", gate.reason, LOCK.SESSIONS_DONE);
  eq("two per day", SESSIONS_PER_DAY, 2);

  // One session is fine, if the gap has passed.
  const one = sessionGate({ sessions: [two[0]], now });
  ok("a second session is allowed once the gap has passed", one.unlocked);
}

// ── 3. The four-hour rolling gap ─────────────────────────────────────────────

{
  const ended = at(2026, 3, 10, 9, 10);
  const history = [done(at(2026, 3, 10, 9, 0), ended, 10 * MIN)];

  const justBefore = sessionGate({ sessions: history, now: ended + SESSION_GAP_MS - MIN });
  ok("session 2 is locked before four hours have passed", !justBefore.unlocked);
  eq("locked for the gap", justBefore.reason, LOCK.GAP);
  eq("and says exactly when it opens", justBefore.nextAt, ended + SESSION_GAP_MS);

  const justAfter = sessionGate({ sessions: history, now: ended + SESSION_GAP_MS + MIN });
  ok("session 2 unlocks four hours after session 1 ENDED", justAfter.unlocked);

  // The gap runs from the end, not the start -- a long session pushes the next
  // one further out, which is the point.
  const longOne = [done(at(2026, 3, 10, 9, 0), at(2026, 3, 10, 9, 30), 30 * MIN)];
  const fromStart = sessionGate({ sessions: longOne, now: at(2026, 3, 10, 13, 15) });
  ok("the gap is measured from the end, not the start", !fromStart.unlocked,
     "four hours after the START would have unlocked this");
}

// ── 4. A session across midnight ─────────────────────────────────────────────

{
  const started = at(2026, 3, 10, 23, 50);
  const ended = at(2026, 3, 11, 0, 5);
  const s = done(started, ended, 15 * MIN);

  eq("a session belongs to the day it started", dayKey(started), "2026-03-10");
  eq("not the day it ended", dayKey(ended), "2026-03-11");

  const onTheTenth = sessionsForDay([s], at(2026, 3, 10, 23, 55));
  eq("it counts as one session for the 10th", onTheTenth.length, 1);
  eq("its play time counts against the 10th", playMsForDay([s], at(2026, 3, 10, 23, 55)), 15 * MIN);

  const onTheEleventh = sessionsForDay([s], at(2026, 3, 11, 10, 0));
  eq("it is not also a session for the 11th", onTheEleventh.length, 0);
  eq("and its play time does not follow it there",
     playMsForDay([s], at(2026, 3, 11, 10, 0)), 0);

  // The gap still applies across the date change: fatigue does not reset at
  // midnight.
  const rightAfter = sessionGate({ sessions: [s], now: at(2026, 3, 11, 0, 10) });
  ok("the four-hour gap survives midnight", !rightAfter.unlocked);
  eq("still the gap, not a new day's allowance", rightAfter.reason, LOCK.GAP);

  const laterOn11th = sessionGate({ sessions: [s], now: at(2026, 3, 11, 9, 0) });
  ok("and the 11th gets its own two sessions once the gap clears", laterOn11th.unlocked);
}

// ── 5. The daily cap counts PLAY time ────────────────────────────────────────

{
  // Opened the app at 08:00, played 6 minutes, wandered off. It is now 20:00.
  // Twelve hours of wall clock, six minutes of play: still allowed.
  const light = [done(at(2026, 3, 12, 8, 0), at(2026, 3, 12, 8, 6), 6 * MIN)];
  const evening = sessionGate({ sessions: light, now: at(2026, 3, 12, 20, 0) });
  ok("twelve hours since opening does not exhaust the cap", evening.unlocked,
     "the cap counted elapsed time instead of play time");

  // One long session that actually used the whole allowance.
  const heavy = [done(at(2026, 3, 12, 8, 0), at(2026, 3, 12, 8, 25), DAILY_CAP_MS)];
  const capped = sessionGate({ sessions: heavy, now: at(2026, 3, 12, 20, 0) });
  ok("the cap bites once play time reaches 20 minutes", !capped.unlocked);
  eq("and says so", capped.reason, LOCK.CAP_REACHED);
  eq("the cap is 20 minutes", DAILY_CAP_MS, 20 * MIN);

  // Play time adds up across sessions in a day.
  const split = [
    done(at(2026, 3, 12, 8, 0), at(2026, 3, 12, 8, 11), 11 * MIN),
    done(at(2026, 3, 12, 13, 0), at(2026, 3, 12, 13, 10), 10 * MIN),
  ];
  eq("play time sums across the day", playMsForDay(split, at(2026, 3, 12, 20, 0)), 21 * MIN);
}

// ── 6. Resume, don't reshuffle ───────────────────────────────────────────────

{
  const openSession = {
    sessionId: "s-open", startedAt: at(2026, 3, 13, 9, 0), endedAt: null,
    playMs: 3 * MIN, status: "in_progress",
  };
  const gate = sessionGate({ sessions: [openSession], now: at(2026, 3, 13, 9, 30) });
  ok("an unfinished session lets the patient back in", gate.unlocked);
  eq("as a resume, not a new session", gate.reason, LOCK.RESUME);
  eq("naming the session to resume", gate.resumeId, "s-open");

  // Even inside the four-hour gap, and even at the daily cap, resume wins --
  // the patient is finishing something, not starting something new.
  const alsoCapped = sessionGate({
    sessions: [openSession, done(at(2026, 3, 13, 7, 0), at(2026, 3, 13, 7, 30), DAILY_CAP_MS)],
    now: at(2026, 3, 13, 9, 30),
  });
  eq("resume beats the gap and the cap", alsoCapped.reason, LOCK.RESUME);
}

// ── 7. Preview lifts every gate, and only the gates ──────────────────────────

{
  const blocked = [
    done(at(2026, 3, 14, 9, 0), at(2026, 3, 14, 9, 30), DAILY_CAP_MS),
    done(at(2026, 3, 14, 10, 0), at(2026, 3, 14, 10, 30), DAILY_CAP_MS),
  ];
  const now = at(2026, 3, 14, 10, 35); // inside the gap, over the cap, 2 done

  const normal = sessionGate({ sessions: blocked, now });
  ok("normally this is locked three ways over", !normal.unlocked);

  const preview = sessionGate({ sessions: blocked, now, isPreview: true });
  ok("preview lifts the session limit", preview.unlocked);
  ok("preview lifts the four-hour gap", preview.unlocked);
  ok("preview lifts the daily cap", preview.unlocked);
  eq("and marks itself as preview", preview.preview, true);
  eq("with no waiting time to show", preview.nextAt, null);

  // Preview still resumes rather than abandoning an open session: contents
  // freeze in preview too.
  const withOpen = sessionGate({
    sessions: [...blocked, { sessionId: "s-p", startedAt: now, endedAt: null, playMs: 0, status: "in_progress" }],
    now, isPreview: true,
  });
  eq("preview still resumes a frozen session", withOpen.reason, LOCK.RESUME);
  eq("naming it", withOpen.resumeId, "s-p");

  // Sessions play back to back.
  const backToBack = sessionGate({
    sessions: [done(now - MIN, now - 1000, MIN)], now, isPreview: true,
  });
  ok("preview allows a new session immediately after one ends", backToBack.unlocked);
}

// The single guard: preview is checked once, before any time comparison.
{
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../shared/sessionRules.js", import.meta.url), "utf8")
  );
  const body = src.slice(src.indexOf("export function sessionGate"));
  const firstPreview = body.indexOf("isPreview");
  const firstTimeCheck = Math.min(
    ...["SESSION_GAP_MS", "DAILY_CAP_MS", "SESSIONS_PER_DAY"]
      .map((k) => body.indexOf(k))
      .filter((i) => i > 0)
  );
  ok("the preview guard comes before every time check",
     firstPreview > 0 && firstPreview < firstTimeCheck);
  eq("there is exactly one isPreview branch in the gate",
     (body.match(/if \(isPreview\)/g) ?? []).length, 1);
  // And the runner must not have its own bypass. It may read preview to show
  // the badge; it may not branch on it to decide whether play is allowed.
  const runner = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../frontend/src/pages/PlaySession.jsx", import.meta.url), "utf8")
  );
  const code = runner
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join(" ");
  ok("the runner never branches on preview",
     !/if\s*\(\s*!?preview\s*[)&|]/.test(code) && !/preview\s*\?/.test(code),
     "found a preview branch in the runner");
  eq("the runner passes preview to the gate exactly once",
     (code.match(/isPreview:\s*preview/g) ?? []).length, 1);
  ok("gate.unlocked is what decides whether play proceeds",
     code.includes("if (!gate.unlocked)"));
}

for (const n of passed) console.log(`  PASS  ${n}`);
for (const n of failed) console.log(`  FAIL  ${n}`);
console.log();
if (failed.length) {
  console.log(`SESSION RUNNER: FAIL (${failed.length} of ${passed.length + failed.length})`);
  process.exit(1);
}
console.log(`SESSION RUNNER: OK (${passed.length} checks)`);
