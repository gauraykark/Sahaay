// The voice speaks once, and in the patient's language.
//
// This exists because three bugs shipped together and none of them threw:
//
// 1. `speak(text, langToLocale())` passes a STRING where an options object
//    goes. Destructuring a string yields undefined for every option, so `lang`
//    fell back to "en-IN" -- the Assamese voice never ran once, in an app whose
//    whole point is the patient's own language. It parses, it runs, it makes a
//    sound. Nothing complains.
//
// 2. An effect with `t` in its dependency array re-runs on every render,
//    because useT() returns a NEW function each time. The instruction repeated
//    several times per item.
//
// 3. speak() never cancelled the previous utterance, so they queued and a
//    patient heard the last three instructions stacked up.
//
// Run from the repo root:  node tools/test_voice.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "frontend", "src");

const passed = [];
const failed = [];
const ok = (n, c, d = "") => (c ? passed.push(n) : failed.push(d ? `${n}: ${d}` : n));

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(jsx?|tsx?)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Source with comments blanked, so a comment describing a bug is not the bug. */
function codeOf(file) {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

const files = walk(SRC);

// ── 1. speak() takes an options object ───────────────────────────────────────

const badSignature = [];
for (const file of files) {
  const rel = file.slice(SRC.length + 1).replace(/\\/g, "/");
  for (const m of codeOf(file).matchAll(/\bspeak\s*\(\s*[^,()]*(?:\([^)]*\))?[^,()]*,\s*([^)]*)\)/g)) {
    const arg = (m[1] ?? "").trim();
    if (arg && !arg.startsWith("{")) {
      badSignature.push(`${rel}: speak(..., ${arg}) — second argument must be an options object`);
    }
  }
}
ok(
  "every speak() passes an options object, not a bare locale",
  badSignature.length === 0,
  `\n      ${badSignature.join("\n      ")}`
);

// ── 2. No speaking effect depends on `t` ─────────────────────────────────────

const repeats = [];
for (const file of files) {
  const rel = file.slice(SRC.length + 1).replace(/\\/g, "/");
  const code = codeOf(file);
  for (const m of code.matchAll(/useEffect\(([\s\S]{0,600}?)\}, \[([^\]]*)\]\)/g)) {
    const [, body, deps] = m;
    const speaks = /\b(?:speak|say)\s*\(/.test(body);
    const dependsOnT = deps.split(",").map((d) => d.trim()).includes("t");
    if (speaks && dependsOnT) {
      repeats.push(`${rel}: a speaking effect depends on \`t\`, which useT recreates every render`);
    }
  }
}
ok(
  "no speaking effect depends on t (that is what made it repeat)",
  repeats.length === 0,
  `\n      ${repeats.join("\n      ")}`
);

// ── 3. speak() cancels what is already speaking ──────────────────────────────

const utils = readFileSync(join(SRC, "lib", "utils.js"), "utf8");
const speakBody = utils.slice(utils.indexOf("export function speak"));
ok(
  "speak() cancels the previous utterance before starting",
  /speechSynthesis\.cancel\(\)/.test(speakBody.slice(0, 800)),
  "utterances will queue"
);

// ── 4. The games go through useSpeak ─────────────────────────────────────────

const gameFiles = files.filter((f) => f.includes(join("components", "games")));
const rawSpeak = gameFiles.filter((f) => /\bspeak\s*\(/.test(codeOf(f)));
ok(
  "game components use useSpeak rather than calling speak directly",
  rawSpeak.length === 0,
  rawSpeak.map((f) => f.slice(SRC.length + 1)).join(", ")
);

const i18n = readFileSync(join(SRC, "lib", "i18n.js"), "utf8");
ok("useSpeak exists", /export function useSpeak/.test(i18n));
ok(
  "useSpeak resolves the locale from the patient's language",
  /langToLocale\(lang\)/.test(i18n),
  "it is not passing the patient's language through"
);
ok(
  "useSpeak refuses to repeat the same key",
  /spokenFor\.current === key/.test(i18n)
);

for (const n of passed) console.log(`  PASS  ${n}`);
for (const n of failed) console.log(`  FAIL  ${n}`);
console.log();
if (failed.length) {
  console.log(`VOICE: FAIL (${failed.length} of ${passed.length + failed.length})`);
  process.exit(1);
}
console.log(`VOICE: OK (${passed.length} checks)`);
