// Sprint 3 DoD: the item bank serves all six domains, at every level, without
// repeating inside the rotation window.
//
// Run from the repo root:  node tools/test_item_bank.mjs

import { readFileSync } from "node:fs";

import { DOMAINS } from "../shared/domains.js";
import { MAX_LEVEL, MIN_LEVEL, difficultyFor } from "../shared/levels.js";
import {
  EMOTIONS,
  FACE_KEYS,
  OBJECT_KEYS,
  bankDepth,
  bankFor,
  eligibleItems,
  generateAttention,
  generatePerceptualMotor,
  isBanked,
  seededShuffle,
  selectItem,
  selectSessionItems,
} from "../shared/itemBank.js";

const passed = [];
const failed = [];
const ok = (n, c, d = "") => (c ? passed.push(n) : failed.push(d ? `${n}: ${d}` : n));
const eq = (n, got, want) =>
  ok(n, Object.is(got, want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const LEVELS = Array.from({ length: MAX_LEVEL - MIN_LEVEL + 1 }, (_, i) => i);

// ── The bank matches the manifest ────────────────────────────────────────────

const manifest = JSON.parse(readFileSync(new URL("./item_manifest.json", import.meta.url)));
ok("manifest is clean before the bank references it", manifest.clean === true,
   "run tools/normalise_item_images.py first");

const manifestObjects = Object.keys(manifest.sets.objects.present).sort();
const manifestFaces = Object.keys(manifest.sets.faces.present).sort();
ok("object keys match the manifest exactly",
   JSON.stringify([...OBJECT_KEYS].sort()) === JSON.stringify(manifestObjects),
   `bank has ${OBJECT_KEYS.length}, manifest has ${manifestObjects.length}`);
ok("face keys match the manifest exactly",
   JSON.stringify([...FACE_KEYS].sort()) === JSON.stringify(manifestFaces),
   `bank has ${FACE_KEYS.length}, manifest has ${manifestFaces.length}`);

// ── Every domain can serve every level ───────────────────────────────────────

for (const domain of DOMAINS) {
  let broke = null;
  for (const level of LEVELS) {
    try {
      const { item } = selectItem({ domain, level });
      if (!item || item.domain !== domain) broke = `level ${level}: wrong domain`;
    } catch (e) {
      broke = `level ${level}: ${e.message}`;
    }
    if (broke) break;
  }
  ok(`${domain} serves every level 0-15`, broke === null, broke ?? "");
}

// ── Level bounds are respected ───────────────────────────────────────────────

for (const domain of DOMAINS.filter(isBanked)) {
  let bad = null;
  for (const level of LEVELS) {
    for (const item of eligibleItems(domain, level)) {
      if (level < item.minLevel || level > item.maxLevel) {
        bad = `${item.id} offered at ${level} but bounds are ${item.minLevel}-${item.maxLevel}`;
      }
    }
  }
  ok(`${domain} never offers an item outside its level bounds`, bad === null, bad ?? "");
}

// ── Rotation ─────────────────────────────────────────────────────────────────

for (const domain of DOMAINS.filter(isBanked)) {
  const depth = bankDepth(domain);
  const seen = new Set();
  let repeatedEarly = null;

  for (let i = 0; i < depth; i += 1) {
    const { item, exhausted } = selectItem({ domain, level: 7, recentIds: seen, seed: i });
    if (seen.has(item.id) && !exhausted) repeatedEarly = item.id;
    seen.add(item.id);
  }
  ok(`${domain} never repeats while unseen items remain`, repeatedEarly === null,
     `${repeatedEarly} came back early`);

  // Exhaustion must degrade, not throw.
  const all = new Set(eligibleItems(domain, 7).map((i) => i.id));
  let degraded = null;
  try {
    const r = selectItem({ domain, level: 7, recentIds: all });
    degraded = r.exhausted === true && r.item ? null : "did not report exhausted";
  } catch (e) {
    degraded = `threw: ${e.message}`;
  }
  ok(`${domain} degrades gracefully when exhausted`, degraded === null, degraded ?? "");
}

// Least-recently-seen wins when exhausted.
{
  const all = new Set(eligibleItems("language", 7).map((i) => i.id));
  const oldest = bankFor("language")[3].id;
  const lastSeenAt = {};
  [...all].forEach((id, i) => (lastSeenAt[id] = i + 100));
  lastSeenAt[oldest] = 1;
  const { item } = selectItem({ domain: "language", level: 7, recentIds: all, lastSeenAt });
  eq("exhausted rotation returns the least recently seen", item.id, oldest);
}

// ── Determinism ──────────────────────────────────────────────────────────────

for (const domain of DOMAINS) {
  const a = JSON.stringify(selectItem({ domain, level: 9, seed: 42 }).item);
  const b = JSON.stringify(selectItem({ domain, level: 9, seed: 42 }).item);
  ok(`${domain} is deterministic for the same inputs`, a === b);
}
eq("seededShuffle is stable",
   seededShuffle([1, 2, 3, 4, 5], 7).join(),
   seededShuffle([1, 2, 3, 4, 5], 7).join());

// ── Social: options are emotion WORDS, never faces ───────────────────────────
//
// The single-face format is what keeps actor identity out of the task. If the
// options ever become faces, the mixed actors in the asset set turn into a
// real confound.

{
  let bad = null;
  for (const level of LEVELS) {
    for (let seed = 0; seed < 12; seed += 1) {
      const { item } = selectItem({ domain: "social", level, seed });
      if (!item.optionsAreWords) bad = `level ${level}: optionsAreWords not set`;
      if (item.options.some((o) => !EMOTIONS.includes(o)))
        bad = `level ${level}: option is not an emotion word (${item.options})`;
      if (item.options.some((o) => o.includes("-") || o.includes("/")))
        bad = `level ${level}: option looks like an asset key (${item.options})`;
      if (!item.options.includes(item.correct))
        bad = `level ${level}: correct answer missing from options`;
      if (new Set(item.options).size !== item.options.length)
        bad = `level ${level}: duplicate options`;
      if (typeof item.imageUrl !== "string" || !item.imageUrl.includes("/faces/"))
        bad = `level ${level}: no single face image`;
    }
    if (bad) break;
  }
  ok("social options are always emotion words, never faces", bad === null, bad ?? "");
}
eq("social shows exactly one face", selectItem({ domain: "social", level: 15 }).item.face.split(",").length, 1);
ok("social covers all 12 faces", bankDepth("social") === 12, `depth ${bankDepth("social")}`);

// ── Generators ───────────────────────────────────────────────────────────────

eq("generateAttention(0) has noGoRatio 0", generateAttention(0).noGoRatio, 0);
eq("generateAttention(0) has no no-go stimuli", generateAttention(0).noGoCount, 0);
{
  const a = generateAttention(7);
  const b = generateAttention(15);
  ok("attention gets harder on every axis from 7 to 15",
     b.stimuli > a.stimuli && b.noGoRatio > a.noGoRatio && b.windowMs < a.windowMs,
     JSON.stringify({ a: [a.stimuli, a.noGoRatio, a.windowMs], b: [b.stimuli, b.noGoRatio, b.windowMs] }));
  ok("attention order length matches its stimulus count",
     generateAttention(11).order.length === generateAttention(11).stimuli);
}
{
  const a = generatePerceptualMotor(7);
  const b = generatePerceptualMotor(15);
  ok("perceptual-motor gets harder from 7 to 15",
     b.options.length >= a.options.length && b.rotationDeg > a.rotationDeg);
  let bad = null;
  for (const level of LEVELS) {
    const it = generatePerceptualMotor(level);
    if (!it.options.includes(it.correct)) bad = `level ${level}: correct not in options`;
    if (it.options.length < 2) bad = `level ${level}: fewer than 2 options`;
  }
  ok("perceptual-motor always offers the right answer", bad === null, bad ?? "");
}

// ── Every item is answerable ─────────────────────────────────────────────────

{
  let bad = null;
  for (const level of [0, 7, 15]) {
    for (const { item } of selectSessionItems({ level })) {
      const opts = item.options ?? item.ask?.options;
      const correct = item.correct ?? item.ask?.correct;
      if (item.template === "put-in-order") {
        if (!item.steps?.length) bad = `${item.domain}@${level}: no steps`;
        if (item.display?.length !== item.steps?.length)
          bad = `${item.domain}@${level}: display and steps differ`;
        continue;
      }
      if (item.template === "go-no-go") continue;
      if (!opts?.length) bad = `${item.domain}@${level}: no options`;
      else if (!opts.includes(correct)) bad = `${item.domain}@${level}: correct not offered`;
    }
  }
  ok("every selected item is answerable", bad === null, bad ?? "");
}

// ── A whole session ──────────────────────────────────────────────────────────

{
  const session = selectSessionItems({ level: 7 });
  eq("a session has one item per domain", session.length, 6);
  ok("all six domains present",
     JSON.stringify(session.map((s) => s.item.domain)) === JSON.stringify(DOMAINS));

  // Per-domain levels, since the six move independently.
  const mixed = selectSessionItems({
    level: { attention: 0, executive: 3, memory: 15, language: 7, perceptual_motor: 11, social: 5 },
  });
  eq("memory used its own level", mixed.find((m) => m.item.domain === "memory").item.level, 15);
  eq("attention used its own level", mixed.find((m) => m.item.domain === "attention").item.level, 0);
}

// ── No timers, ever ──────────────────────────────────────────────────────────

ok("difficultyFor never sets a timer", LEVELS.every((l) => difficultyFor(l).timerSec === null));

for (const n of passed) console.log(`  PASS  ${n}`);
for (const n of failed) console.log(`  FAIL  ${n}`);
console.log();
if (failed.length) {
  console.log(`ITEM BANK: FAIL (${failed.length} of ${passed.length + failed.length})`);
  process.exit(1);
}
console.log(`ITEM BANK: OK (${passed.length} checks)`);
