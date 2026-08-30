// Every Tailwind colour class in the app resolves to a real colour.
//
// This exists because `bg-primary` shipped. The palette in index.css defines
// primary-50 through primary-900 and no bare `primary`, so `bg-primary`
// resolved to nothing -- and the PLAY button, the single most important
// control in the app, rendered as white text on a white background. It looked
// fine in code review and passed lint and the build; only a computed style in
// a real browser showed it.
//
// A class that silently resolves to transparent is the worst kind of CSS bug:
// it never errors, it just makes something invisible. So: check the classes
// against the palette that actually exists.
//
// Run from the repo root:  node tools/test_tailwind_colors.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not .pathname: a space in the path arrives percent-encoded
// and fs cannot open "Bhavik%20Mahajan".
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "frontend", "src");
const CSS = join(SRC, "index.css");

const passed = [];
const failed = [];
const ok = (n, c, d = "") => (c ? passed.push(n) : failed.push(d ? `${n}: ${d}` : n));

// ── What the palette actually defines ────────────────────────────────────────

const css = readFileSync(CSS, "utf8");
const defined = new Set();
for (const m of css.matchAll(/--color-([a-z]+)-(\d+)\s*:/g)) defined.add(`${m[1]}-${m[2]}`);
for (const m of css.matchAll(/--color-([a-z]+)\s*:/g)) defined.add(m[1]);

// Custom palette families -- the ones Tailwind does NOT ship by default and
// which therefore only work with a shade this project declared.
const families = new Set([...defined].map((k) => k.split("-")[0]));

ok("index.css declares a custom palette", families.size > 0, "found none");
ok("primary is one of them", families.has("primary"));

// ── Every usage in the app ───────────────────────────────────────────────────

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(jsx?|tsx?)$/.test(entry)) out.push(full);
  }
  return out;
}

const UTILITIES = "bg|text|border|ring|from|via|to|fill|stroke|divide|outline|accent|shadow|caret";
const badRefs = [];

for (const file of walk(SRC)) {
  const src = readFileSync(file, "utf8");
  const rel = file.slice(SRC.length + 1).replace(/\\/g, "/");

  for (const m of src.matchAll(
    new RegExp(`\\b(?:${UTILITIES})-([a-z]+)(-\\d+)?(?![-\\w])`, "g")
  )) {
    const family = m[1];
    const shade = m[2]?.slice(1);
    if (!families.has(family)) continue; // a stock Tailwind colour, fine

    const key = shade ? `${family}-${shade}` : family;
    if (!defined.has(key)) {
      badRefs.push(`${rel}: "${m[0]}" — ${family} has no ${shade ? `shade ${shade}` : "bare value"}`);
    }
  }
}

ok(
  "no class references a custom colour that does not exist",
  badRefs.length === 0,
  `\n      ${badRefs.slice(0, 8).join("\n      ")}`
);

// The specific shape of the bug that got through, named so it stays named.
const bare = [];
for (const file of walk(SRC)) {
  const src = readFileSync(file, "utf8");
  for (const family of families) {
    if (defined.has(family)) continue; // this family DOES have a bare value
    const re = new RegExp(`\\b(?:${UTILITIES})-${family}(?![-\\w])`, "g");
    for (const m of src.matchAll(re)) {
      bare.push(`${file.slice(SRC.length + 1).replace(/\\/g, "/")}: ${m[0]}`);
    }
  }
}
ok(
  "no shade-less use of a shaded-only palette (this is what made PLAY invisible)",
  bare.length === 0,
  `\n      ${bare.slice(0, 8).join("\n      ")}`
);

for (const n of passed) console.log(`  PASS  ${n}`);
for (const n of failed) console.log(`  FAIL  ${n}`);
console.log();
if (failed.length) {
  console.log(`TAILWIND COLOURS: FAIL (${failed.length} of ${passed.length + failed.length})`);
  process.exit(1);
}
console.log(`TAILWIND COLOURS: OK (${passed.length} checks)`);
