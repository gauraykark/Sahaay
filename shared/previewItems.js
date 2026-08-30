// One representative item per domain, for the pre-Sprint-4 preview.
//
// This is a SPIKE, not the item bank. Sprint 3 writes 20 items per banked
// domain and the generators for the two that need none. The point here is
// narrower: prove the images load, prove difficultyFor() moves the knobs
// sensibly, and see all six domains beside each other before six games are
// built on top of them.
//
// Item shape follows IMPLEMENTATION_PLAN Part 2. `assetsFrom` names the folder
// under /items/ so nothing here hardcodes a path the manifest has not blessed.

import { DOMAINS } from "./domains.js";
import { difficultyFor } from "./levels.js";

export const ITEMS_BASE = "/items";

// Assets confirmed present by tools/item_manifest.json. Kept as keys, never
// as paths -- the manifest is the contract, this is a reader of it.
const OBJECT_KEYS = [
  "banana", "basket", "bicycle", "bucket", "clock", "coconut", "comb", "cow",
  "fish", "jackfruit", "kettle", "lamp", "plate", "pot", "rice", "slippers",
  "soap", "spoon", "teacup", "umbrella",
];

// man-angry is deliberately absent: the manifest reports it missing, and the
// preview should show that gap rather than paper over it.
const FACE_KEYS = [
  "man-calm", "man-happy", "man-sad", "man-surprised", "man-worried",
  "woman-angry", "woman-calm", "woman-happy", "woman-sad", "woman-surprised",
  "woman-worried",
];

export const objectUrl = (key) => `${ITEMS_BASE}/objects/${key}.jpg`;
export const faceUrl = (key) => `${ITEMS_BASE}/faces/${key}.jpg`;

/** Deterministic pick so a preview at the same level always looks the same. */
function pick(list, n, seed = 0) {
  const out = [];
  for (let i = 0; i < n && i < list.length; i += 1) {
    out.push(list[(seed + i * 7) % list.length]);
  }
  return out;
}

// ── One item per domain ──────────────────────────────────────────────────────

function attentionItem(level, d) {
  // Go/no-go, visual only: tap green, do not tap red. Measures sustained
  // attention AND response inhibition, not just reaction time.
  const noGoRatio = level < 3 ? 0 : Math.min(0.1 + level * 0.015, 0.3);
  const stimuli = 6 + level * 2;
  const noGo = Math.round(stimuli * noGoRatio);
  return {
    id: "att-preview",
    domain: "attention",
    template: "go-no-go",
    generated: true,
    prompt: "Tap the green circle. Do not tap the red one.",
    config: {
      stimuli,
      noGoCount: noGo,
      goCount: stimuli - noGo,
      noGoRatio: Number(noGoRatio.toFixed(3)),
      windowMs: Math.max(700, 2200 - level * 85),
      targetSize: level < 5 ? "xl" : level < 10 ? "lg" : "md",
    },
    cueLevel: d.cueLevel,
  };
}

function executiveItem(level, d) {
  // Putting a daily routine in order. Hand-authored, because "brushing before
  // eating" is real-world logic no generator knows.
  const full = [
    "Wake up", "Brush teeth", "Have tea", "Have breakfast",
    "Take morning medicine", "Have a bath", "Get dressed", "Go for a walk",
    "Have lunch", "Rest", "Have dinner", "Take night medicine",
    "Change clothes", "Go to sleep",
  ];
  const steps = full.slice(0, Math.min(2 + level, full.length));
  return {
    id: "exe-preview",
    domain: "executive",
    template: "put-in-order",
    prompt: "Put these in the order you do them.",
    steps,
    correctOrder: steps.map((_, i) => i + 1),
    cueLevel: d.cueLevel,
    // At full cue the first step is already placed.
    prePlaced: d.cueLevel === "full" ? 1 : 0,
  };
}

function memoryItem(level, d) {
  // See pictures, gap, then "which one did you see?".
  //
  // The shown count is capped at 8 ON PURPOSE. difficultyFor gives itemCount
  // 17 at level 15, and flashing seventeen pictures is not a harder memory
  // test, it is an impossible one -- span is around 7 for a healthy adult and
  // well below that here. So the shown count plateaus from level 6.
  //
  // Difficulty above that has to come from somewhere else, or the level stops
  // discriminating at exactly the end of the scale where we most need it to.
  // Two knobs carry it: the gap grows (2s -> 11s) and the option count grows,
  // so more distractors have to be held off.
  const SHOWN_CAP = 8;
  const shown = pick(OBJECT_KEYS, Math.min(d.itemCount, SHOWN_CAP), 3);
  const correct = shown[0];
  const optionCount = Math.min(2 + Math.floor(level / 3), 6);
  const distractors = OBJECT_KEYS.filter((k) => !shown.includes(k)).slice(
    0,
    optionCount - 1
  );
  return {
    id: "mem-preview",
    domain: "memory",
    template: "which-did-you-see",
    show: { images: shown, urls: shown.map(objectUrl), durationMs: 4000 },
    gap: { type: "blank", durationMs: Math.min(2000 + level * 600, 12000) },
    ask: {
      prompt: "Which one did you see?",
      options: [correct, ...distractors],
      urls: [correct, ...distractors].map(objectUrl),
      correct,
    },
    cueLevel: d.cueLevel,
  };
}

function languageItem(level, d) {
  // Naming: "what is this called?". One picture, three words.
  const [correct, a, b] = pick(OBJECT_KEYS, 3, 11);
  return {
    id: "lan-preview",
    domain: "language",
    template: "what-is-this",
    prompt: "What is this called?",
    image: correct,
    imageUrl: objectUrl(correct),
    options: [correct, a, b],
    correct,
    cueLevel: d.cueLevel,
    // Full cue shows the word under the picture; partial shows a first letter.
    cue:
      d.cueLevel === "full"
        ? correct
        : d.cueLevel === "partial"
          ? `${correct[0]}…`
          : null,
  };
}

function perceptualMotorItem(level, d) {
  // Shape and space, generated from the level. No asset bank at all.
  const shapes = ["circle", "square", "triangle", "diamond", "hexagon", "star"];
  const count = Math.min(2 + Math.floor(level / 2), shapes.length);
  const options = shapes.slice(0, count);
  return {
    id: "pmo-preview",
    domain: "perceptual_motor",
    template: "match-the-shape",
    generated: true,
    prompt: "Tap the shape that matches.",
    target: options[0],
    options,
    gridSize: d.gridSize,
    // Rotation is what makes it spatial rather than a colour match.
    rotationDeg: level < 5 ? 0 : level < 10 ? 45 : 90,
    cueLevel: d.cueLevel,
  };
}

function socialItem(level, d) {
  // Faces and feelings. Options are drawn from ONE person on purpose -- see
  // tools/ITEM_ASSETS_REVIEW.md. Mixing people turns emotion reading into
  // person discrimination and the score stops meaning what the report says.
  const person = "woman";
  const emotions = ["happy", "sad", "calm", "surprised", "worried", "angry"];
  const count = Math.min(2 + Math.floor(level / 3), emotions.length);
  const options = emotions.slice(0, count);
  const correct = options[0];
  return {
    id: "soc-preview",
    domain: "social",
    template: "which-face",
    prompt: `Which face looks ${correct}?`,
    person,
    options,
    faces: options.map((e) => ({
      emotion: e,
      key: `${person}-${e}`,
      url: faceUrl(`${person}-${e}`),
    })),
    correct: `${person}-${correct}`,
    cueLevel: d.cueLevel,
  };
}

const BUILDERS = {
  attention: attentionItem,
  executive: executiveItem,
  memory: memoryItem,
  language: languageItem,
  perceptual_motor: perceptualMotorItem,
  social: socialItem,
};

/** One preview item for every domain, at the given level. */
export function previewItemsFor(level) {
  const d = difficultyFor(level);
  return DOMAINS.map((domain) => ({
    ...BUILDERS[domain](level, d),
    level,
    difficulty: d,
  }));
}

/** Every asset URL the preview will request, for a load check. */
export function allPreviewAssetUrls() {
  const urls = new Set();
  for (const level of [0, 7, 15]) {
    for (const item of previewItemsFor(level)) {
      item.show?.urls?.forEach((u) => urls.add(u));
      item.ask?.urls?.forEach((u) => urls.add(u));
      if (item.imageUrl) urls.add(item.imageUrl);
      item.faces?.forEach((f) => urls.add(f.url));
    }
  }
  return [...urls];
}
