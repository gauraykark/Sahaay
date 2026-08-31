// A tap on the attention stimulus has to be felt, and has to end the trial.
//
// The bug: the go/no-go circle stayed on screen for the whole response window
// (1605ms at level 7) no matter what the patient did, and the only sign a tap
// had registered was a 200ms dip to opacity-60. Tapping the green circle
// therefore looked like nothing at all -- the control read as dead, and a
// patient who cannot tell whether they answered taps again. What that measures
// is their confusion, not their attention.
//
// Two properties are asserted, and the second one is a clinical rule rather
// than a nicety: green and red must respond IDENTICALLY. Any difference in
// what the screen does is a failure signal, which section 8 forbids outright.
//
// Run from the repo root:  node tools/test_gonogo_response.mjs

import { readFileSync } from "node:fs";

const src = readFileSync(
  new URL("../frontend/src/components/games/renderers.jsx", import.meta.url),
  "utf8"
);

const passed = [];
const failed = [];
const ok = (n, c, d = "") => (c ? passed.push(n) : failed.push(`${n}${d ? ` — ${d}` : ""}`));

// Isolate the GoNoGo component so nothing here matches a different renderer.
const start = src.indexOf("function GoNoGo(");
ok("GoNoGo exists", start !== -1);
const end = src.indexOf("\nconst RENDERERS", start);
const body = src.slice(start, end === -1 ? undefined : end);

const code = body
  .split("\n")
  .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
  .join("\n");

// ── A response ends the trial ────────────────────────────────────────────────

ok("the tap handler can advance the stimulus",
   /advanceRef/.test(code) && /const tap = \(\) => \{[\s\S]*advance/.test(code),
   "tap() never reaches an advance");

ok("advancing is guarded so a stale tap cannot skip a stimulus",
   /let advanced = false/.test(code) && /if \(advanced \|\| doneRef\.current\) return/.test(code));

ok("the window timer still advances an UNANSWERED trial",
   /setTimeout\([\s\S]*respondedRef\.current[\s\S]*advance\(\)/.test(code),
   "an untapped no-go would never resolve");

ok("a second tap in the same trial is ignored",
   /if \(respondedRef\.current \|\| doneRef\.current\) return/.test(code));

// ── The tap is visible ───────────────────────────────────────────────────────

ok("there is an acknowledgement state", /\backs?\b/.test(code) && /setAck/.test(code));

ok("the acknowledgement is more than a faint opacity nudge",
   /scale-\d+/.test(code) && /opacity-\d+/.test(code), "no scale change on tap");

ok("opacity-60 (the old, unnoticeable flash) is gone", !/opacity-60/.test(code));

const ackMs = code.match(/GONOGO_ACK_MS\s*=\s*(\d+)/) || src.match(/GONOGO_ACK_MS\s*=\s*(\d+)/);
ok("the acknowledgement has an explicit duration", !!ackMs);
if (ackMs) {
  const ms = Number(ackMs[1]);
  ok("it is long enough to see", ms >= 100, `${ms}ms`);
  ok("it is short enough to keep the task brisk", ms <= 400, `${ms}ms`);
}

// ── ERRORLESS: green and red must be indistinguishable ───────────────────────
//
// The score records which was which. The screen must not.

const tapBody = (code.match(/const tap = \(\) => \{([\s\S]*?)\n  \};/) || [])[1] ?? "";
ok("the tap handler was located", tapBody.length > 0);

// The soundest statement of "green and red behave the same": `kind` is read
// ONCE in the handler, and that read is the score line. If nothing else in the
// handler can see `kind`, nothing else in it can branch on `kind` — which
// covers the acknowledgement and the advance together, without a regex having
// to reason about nesting, which it cannot do.
const kindReads = (tapBody.match(/\bkind\b/g) || []).length;
ok("the tap handler reads `kind` exactly once", kindReads === 1, `reads it ${kindReads} times`);
ok("...and that one read only feeds the score",
   /if \(kind === "go"\) hitsRef\.current\.correct \+= 1;/.test(tapBody));

// Belt and braces: every `if` in the handler is a one-liner, so none of them
// can open a block around the acknowledgement or the advance.
const ifs = tapBody.split("\n").filter((l) => /^\s*if \(/.test(l));
ok("every branch in the handler is a single statement",
   ifs.length > 0 && ifs.every((l) => l.trim().endsWith(";")),
   ifs.map((l) => l.trim()).join(" | "));

// And both are reached unconditionally, at the handler's own indentation.
ok("setAck runs on every tap", /^ {4}setAck\(true\);/m.test(tapBody));
ok("the advance is scheduled on every tap",
   /^ {4}ackTimerRef\.current = setTimeout\(/m.test(tapBody));

// No failure vocabulary anywhere in this renderer.
for (const word of ["wrong", "incorrect", "mistake", "error", "✗", "✘"]) {
  ok(`no "${word}" shown to the patient`, !code.toLowerCase().includes(word));
}

// ── The window is still the ceiling ──────────────────────────────────────────

ok("windowMs still bounds a trial", /item\.windowMs/.test(code));
ok("no timer is shown to the patient",
   !/countdown|timeLeft|secondsLeft|remaining/i.test(code));

for (const n of passed) console.log(`  PASS  ${n}`);
for (const n of failed) console.log(`  FAIL  ${n}`);
console.log();
if (failed.length) {
  console.log(`GO/NO-GO RESPONSE: FAIL (${failed.length} of ${passed.length + failed.length})`);
  process.exit(1);
}
console.log(`GO/NO-GO RESPONSE: OK (${passed.length} checks)`);
