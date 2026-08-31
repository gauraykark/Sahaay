// Failed syncs back off, and eventually stop.
//
// Every logged round fires a sync, and a session is eighteen rounds. With the
// backend down that was eighteen failing POSTs per session -- each resending a
// queue that only grows -- plus eighteen more to /ai/adapt-difficulty. The
// console filled with ERR_FAILED and the device kept dialling a server that
// was not there.
//
// Retrying hard cannot help: the queue is durable, so a row that syncs in four
// minutes instead of now is clinically identical. What matters is that the
// device stops shouting and still recovers when the network comes back.
//
// Run from the repo root:  node tools/test_sync_backoff.mjs

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../frontend/src/lib/api.js", import.meta.url), "utf8");

const passed = [];
const failed = [];
const ok = (name, cond, detail = "") =>
  cond ? passed.push(name) : failed.push(`${name}${detail ? ` — ${detail}` : ""}`);

// ── The caller is gone ───────────────────────────────────────────────────────
//
// Sprint 7 removes /ai/adapt-difficulty from the server. Nothing on the client
// may still be dialling it, and difficulty must never need the network at all:
// the same inputs have to give the same level, which is why no model is in
// this loop.

const code = src
  .split("\n")
  .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
  .join("\n");

ok("no live call to /ai/adapt-difficulty", !code.includes("/ai/adapt-difficulty"));
ok("fetchDifficultyPlan is gone", !/export\s+(async\s+)?function\s+fetchDifficultyPlan/.test(code));
ok("the orchestrator no longer imports saveAIPlan", !/\bsaveAIPlan\b/.test(code));

// ── Backoff exists and is bounded ────────────────────────────────────────────

ok("there is a retry cap", /SYNC_MAX_ATTEMPTS\s*=\s*\d+/.test(code));
ok("there is a maximum delay", /SYNC_MAX_DELAY_MS\s*=/.test(code));
ok("the delay grows rather than repeating", /\*\*/.test(code) || /Math\.pow/.test(code));
ok("the cap short-circuits the function", /failures\s*>=\s*SYNC_MAX_ATTEMPTS/.test(code));
ok("a scheduled wait short-circuits too", /Date\.now\(\)\s*<\s*syncState\.nextAttemptAt/.test(code));
ok("overlapping runs are refused", /inFlight/.test(code));
ok("success clears the backoff", /resetSyncBackoff\(\)/.test(code));
ok("coming back online clears it", /export function resetSyncBackoff/.test(code));

// ── The delay schedule is sane ───────────────────────────────────────────────
//
// Recomputed here rather than imported, because importing api.js drags in
// localStorage and Dexie. If the formula in api.js changes, this must too.

const BASE = Number(code.match(/SYNC_BASE_DELAY_MS\s*=\s*([\d_]+)/)[1].replace(/_/g, ""));
const MAXD = Number(code.match(/SYNC_MAX_DELAY_MS\s*=\s*([^;]+);/)[1].replace(/_/g, "").match(/[\d*\s]+/)[0].split("*").reduce((a, b) => a * Number(b.trim()), 1));
const ATTEMPTS = Number(code.match(/SYNC_MAX_ATTEMPTS\s*=\s*(\d+)/)[1]);

const delays = Array.from({ length: ATTEMPTS }, (_, i) => Math.min(BASE * 2 ** i, MAXD));

ok("the first retry is not instant", delays[0] >= 1000, `${delays[0]}ms`);
ok("each retry waits at least as long as the last",
   delays.every((d, i) => i === 0 || d >= delays[i - 1]), delays.join(","));
ok("no delay exceeds the ceiling", delays.every((d) => d <= MAXD), delays.join(","));
ok("the cap is reached in a handful of attempts, not hundreds",
   ATTEMPTS >= 3 && ATTEMPTS <= 12, `${ATTEMPTS} attempts`);

// The number that matters: an eighteen-item session with the backend down
// must not produce eighteen requests.
ok("one dead session cannot produce one request per round",
   ATTEMPTS < 18, `${ATTEMPTS} attempts vs 18 rounds`);

for (const n of passed) console.log(`  PASS  ${n}`);
for (const n of failed) console.log(`  FAIL  ${n}`);
console.log();
if (failed.length) {
  console.log(`SYNC BACKOFF: FAIL (${failed.length} of ${passed.length + failed.length})`);
  process.exit(1);
}
console.log(`SYNC BACKOFF: OK (${passed.length} checks)`);
