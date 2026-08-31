// The item bank: every question the app can ask, for all six domains.
//
// THE MODEL NEVER GENERATES A QUESTION AT RUNTIME. Three reasons: offline is a
// requirement, a hallucinated question shown to a dementia patient is a real
// harm, and latency loses an elderly user. Everything here is deterministic --
// same inputs, same items, forever.
//
// Three tiers, matching IMPLEMENTATION_PLAN Part 2:
//
//   Tier 1  attention, perceptual_motor -- generated from the level alone.
//           No assets, no bank, rotation is free.
//   Tier 2  memory, language -- template x content. A 20-image pool multiplies
//           out: memory alone is 20-choose-3 = 1,140 possible items, so the
//           bank is enumerated deterministically rather than hand-listed.
//   Tier 3  executive, social -- the real authoring work. Routine sequences
//           need real-world logic (brushing before eating) and faces need
//           verified emotion labels; no generator knows either.
//
// Asset keys come from tools/item_manifest.json, which must be CLEAN before
// anything here references them. Nothing in this file hardcodes a path.
//
// EVERY ITEM MUST BE STRUCTURED-CLONEABLE. A session's items are frozen into
// IndexedDB at the start, and IndexedDB cannot store functions -- a helper
// like `optionUrls: (opts) => ...` on an item throws DataCloneError and takes
// the whole session with it. Items are DATA; url building belongs to the
// renderer. test_item_bank.mjs asserts this with structuredClone.

import { DOMAINS } from "./domains.js";
import { MAX_LEVEL, MIN_LEVEL, difficultyFor, levelForPlay } from "./levels.js";

export const ITEMS_BASE = "/items";
export const objectUrl = (key) => `${ITEMS_BASE}/objects/${key}.jpg`;
export const faceUrl = (key) => `${ITEMS_BASE}/faces/${key}.jpg`;

// ── Asset keys (manifest-clean as of tools/item_manifest.json) ───────────────

export const OBJECT_KEYS = [
  "banana", "basket", "bicycle", "bucket", "clock", "coconut", "comb", "cow",
  "fish", "jackfruit", "kettle", "lamp", "plate", "pot", "rice", "slippers",
  "soap", "spoon", "teacup", "umbrella",
];

export const EMOTIONS = ["angry", "calm", "happy", "sad", "surprised", "worried"];
export const FACE_PEOPLE = ["man", "woman"];

// Every face is its own item. Identity is never compared -- see below.
export const FACE_KEYS = FACE_PEOPLE.flatMap((p) => EMOTIONS.map((e) => `${p}-${e}`));

// Pronoun per person, so the prompt reads naturally. The patient hears this
// aloud, so "How is this person feeling?" every time would be stilted.
const PRONOUN = { man: "he", woman: "she" };

// ── Deterministic helpers ────────────────────────────────────────────────────
//
// No Math.random anywhere in this file. An item must be identical every time
// it is selected, or the 14-day rotation cannot mean anything and two devices
// would disagree about what the patient saw.

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic shuffle. Same seed, same order, on every device. */
export function seededShuffle(list, seed) {
  const rnd = mulberry(seed);
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const pad = (n) => String(n).padStart(3, "0");

// ── Tier 2: memory ───────────────────────────────────────────────────────────

const MEMORY_BANK_SIZE = 60;

function memoryItems() {
  return Array.from({ length: MEMORY_BANK_SIZE }, (_, i) => {
    const order = seededShuffle(OBJECT_KEYS, 1000 + i);
    return {
      id: `mem-${pad(i + 1)}`,
      domain: "memory",
      template: "which-did-you-see",
      // Every level: the count of images shown and the gap come from the
      // level at selection time, not from the item.
      minLevel: MIN_LEVEL,
      maxLevel: MAX_LEVEL,
      pool: order,
    };
  });
}

function buildMemory(item, level) {
  const d = difficultyFor(level);
  // Capped at 8 on purpose. difficultyFor gives 17 at level 15, and flashing
  // seventeen pictures is not a harder memory test, it is an impossible one --
  // span is around 7 for a healthy adult and lower here. Difficulty above the
  // cap comes from the gap and the option count instead, so the level keeps
  // discriminating at the top of the scale.
  const shown = item.pool.slice(0, Math.min(d.itemCount, 8));
  const correct = shown[0];
  const optionCount = Math.min(2 + Math.floor(level / 3), 6);
  const distractors = item.pool
    .filter((k) => !shown.includes(k))
    .slice(0, optionCount - 1);

  return {
    ...item,
    level,
    show: { images: shown, urls: shown.map(objectUrl), durationMs: 4000 },
    gap: { type: "blank", durationMs: Math.min(2000 + level * 600, 12000) },
    ask: {
      promptKey: "ask_which_did_you_see",
      options: seededShuffle([correct, ...distractors], 7000 + level),
      correct,
    },
    cueLevel: d.cueLevel,
  };
}

// ── Tier 2: language ─────────────────────────────────────────────────────────

function languageItems() {
  return OBJECT_KEYS.map((key, i) => ({
    id: `lan-${pad(i + 1)}`,
    domain: "language",
    template: "what-is-this",
    minLevel: MIN_LEVEL,
    maxLevel: MAX_LEVEL,
    subject: key,
  }));
}

function buildLanguage(item, level) {
  const d = difficultyFor(level);
  const optionCount = Math.min(2 + Math.floor(level / 4), 5);
  const distractors = seededShuffle(
    OBJECT_KEYS.filter((k) => k !== item.subject),
    2000 + level
  ).slice(0, optionCount - 1);

  return {
    ...item,
    level,
    promptKey: "ask_what_is_this",
    image: item.subject,
    imageUrl: objectUrl(item.subject),
    options: seededShuffle([item.subject, ...distractors], 3000 + level),
    correct: item.subject,
    cueLevel: d.cueLevel,
    // Full cue names it outright; partial gives the first letter; none is none.
    cue:
      d.cueLevel === "full"
        ? item.subject
        : d.cueLevel === "partial"
          ? `${item.subject[0]}…`
          : null,
  };
}

// ── Tier 3: social ───────────────────────────────────────────────────────────
//
// SINGLE-FACE FORMAT. One image, and three EMOTION WORDS as the options.
//
// The options are never faces. That is what keeps identity out of the task:
// the patient is never asked to compare two people, so different actors across
// items cannot be used to answer anything. Clinical emotion tests use multiple
// actors deliberately, to stop the patient learning one face's quirks rather
// than reading expressions.
//
// If anyone ever changes this to show several faces at once, the actor
// variation in the asset set becomes a real confound. Do not.

function socialItems() {
  return FACE_KEYS.map((key, i) => {
    const [person, emotion] = key.split("-");
    return {
      id: `soc-${pad(i + 1)}`,
      domain: "social",
      template: "how-are-they-feeling",
      minLevel: MIN_LEVEL,
      maxLevel: MAX_LEVEL,
      face: key,
      person,
      emotion,
    };
  });
}

function buildSocial(item, level) {
  const d = difficultyFor(level);
  const optionCount = Math.min(2 + Math.floor(level / 4), 5);
  const distractors = seededShuffle(
    EMOTIONS.filter((e) => e !== item.emotion),
    4000 + level
  ).slice(0, optionCount - 1);

  return {
    ...item,
    level,
    promptKey: "ask_how_feeling",
    pronoun: PRONOUN[item.person],
    imageUrl: faceUrl(item.face),
    // Emotion WORDS. Never faces. See the note above.
    options: seededShuffle([item.emotion, ...distractors], 5000 + level),
    correct: item.emotion,
    optionsAreWords: true,
    cueLevel: d.cueLevel,
  };
}

// ── Tier 3: executive ────────────────────────────────────────────────────────
//
// Hand-authored, because "brush teeth before breakfast" is real-world logic no
// generator has. Each sequence is in its true order here; the game shuffles it
// for display and scores taps-to-complete.

const ROUTINES = [
  ["Wake up", "Brush teeth", "Have tea", "Have breakfast"],
  ["Take off slippers", "Fill the bucket", "Have a bath", "Get dressed"],
  ["Wash the rice", "Light the stove", "Cook the rice", "Serve the rice"],
  ["Pick up the cup", "Pour the tea", "Add sugar", "Drink the tea"],
  ["Open the door", "Step outside", "Lock the door", "Walk to the market"],
  ["Sit down", "Say a prayer", "Eat the meal", "Wash your hands"],
  ["Take the medicine box", "Open it", "Take the tablet", "Drink water"],
  ["Fold the clothes", "Put them in the cupboard", "Close the cupboard"],
  ["Switch on the fan", "Lie down", "Rest", "Switch off the fan"],
  ["Pick up the broom", "Sweep the floor", "Collect the dust", "Put the broom back"],
  ["Buy the fish", "Bring it home", "Clean it", "Cook it"],
  ["Water the plants", "Pull the weeds", "Wash your hands"],
  ["Put on your slippers", "Take the umbrella", "Step into the rain", "Walk on"],
  ["Take out the comb", "Comb your hair", "Put the comb back"],
  ["Boil the water", "Add the tea leaves", "Strain it", "Pour into the cup"],
  ["Greet your guest", "Offer them a seat", "Bring tea", "Sit and talk"],
  ["Take off your glasses", "Clean them", "Put them on"],
  ["Wake up", "Say good morning", "Open the window", "Look outside"],
  ["Collect the plates", "Wash them", "Dry them", "Stack them"],
  ["Change into night clothes", "Take night medicine", "Switch off the light", "Go to sleep"],

  // Longer sequences for the upper half of the scale. Without these the
  // domain plateaued at four steps from about level 4, because the formula
  // asks for more steps than the bank could offer and min() silently capped
  // it -- the level stopped discriminating exactly where it needs to.
  [
    "Wake up", "Brush teeth", "Have a bath", "Get dressed",
    "Have breakfast", "Take morning medicine",
  ],
  [
    "Fill the pot with water", "Wash the rice", "Light the stove",
    "Cook the rice", "Turn off the stove", "Serve the rice",
  ],
  [
    "Take the bag", "Walk to the market", "Choose the vegetables",
    "Pay the shopkeeper", "Carry the bag home", "Put them away",
  ],
  [
    "Wake up", "Open the window", "Have tea", "Read the newspaper",
    "Have breakfast", "Go for a walk", "Rest",
  ],
  [
    "Collect the dirty clothes", "Fill the bucket", "Add the soap",
    "Wash the clothes", "Rinse them", "Hang them out to dry",
    "Bring them in", "Fold them",
  ],
  [
    "Boil the water", "Add the tea leaves", "Add the milk", "Add sugar",
    "Let it boil", "Strain it", "Pour into cups", "Serve the guests",
  ],
  [
    "Wake up", "Brush teeth", "Have tea", "Have a bath", "Get dressed",
    "Have breakfast", "Take morning medicine", "Go for a walk", "Rest",
  ],
];

function executiveItems() {
  return ROUTINES.map((steps, i) => ({
    id: `exe-${pad(i + 1)}`,
    domain: "executive",
    template: "put-in-order",
    // This is the one domain where minLevel/maxLevel does real work: a
    // three-step routine is not a level-15 question however it is presented,
    // and a nine-step one is cruel at level 0. Bounds follow length.
    //
    // The formula wants 2 + floor(level/2) steps, so a routine of length N is
    // the right size around level 2*(N-2). Short routines are barred from the
    // top of the scale by minLevel.
    //
    // There is NO upper bound on a long routine, though. A symmetric band left
    // just three of twenty-seven routines eligible at level 15, which the
    // review page made obvious -- a rotation pool of three means a level-15
    // patient sees the same routine every other day and memorises it, which is
    // exactly what the 14-day rule exists to prevent. buildExecutive already
    // trims a long routine down to the level's step count, so offering it low
    // costs nothing; offering too few high costs the measurement.
    minLevel: Math.max(MIN_LEVEL, 2 * (steps.length - 2) - 6),
    maxLevel: MAX_LEVEL,
    steps,
  }));
}

// At least THREE steps, always. Two steps with the first pre-placed left a
// single tappable option -- there was no ordering decision to make, so the
// item measured nothing and looked broken to the patient.
const MIN_EXECUTIVE_STEPS = 3;

/** How many steps this level SHOULD present, ignoring what the bank holds. */
export function executiveStepsWanted(level) {
  const l = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, level));
  return Math.max(MIN_EXECUTIVE_STEPS, 2 + Math.floor(l / 2));
}

/** How many steps a given routine can actually present at this level. */
function executiveStepCount(level, available) {
  return Math.min(
    Math.max(Math.min(MIN_EXECUTIVE_STEPS, available), executiveStepsWanted(level)),
    available
  );
}

function buildExecutive(item, level) {
  const d = difficultyFor(level);

  const count = executiveStepCount(level, item.steps.length);
  const steps = item.steps.slice(0, count);

  return {
    ...item,
    level,
    promptKey: "ask_put_in_order",
    steps,
    // Display order is deterministic per item and level, never random, so a
    // resumed session shows the same board.
    display: seededShuffle(steps, 6000 + level + item.steps.length),
    correctOrder: steps,
    cueLevel: d.cueLevel,
    // Nothing is pre-placed any more. Every step stays tappable, so the task
    // exists at every level.
    prePlaced: 0,
    // A DELAYED prompt, not a standing one.
    //
    // This used to be `showNextHint: cueLevel === "full"`, which marked the
    // next correct step from the moment the board appeared. That is not a
    // gentle version of the task, it is the answer key: the patient taps the
    // highlighted button N times, taps-to-complete is always exactly N, and
    // executive scores a constant 1.0 for everyone at levels 0-4. A domain
    // that cannot produce a low score is not measuring anything -- the same
    // hollowness that made the old four-domain attention score meaningless.
    //
    // So the cue waits. The patient gets a few seconds to make the ordering
    // decision themselves; if they hesitate, the right step lifts before they
    // can feel stuck. Errorless is intact -- nobody fails, nobody stalls --
    // and the interval before the cue is where the measurement lives. A wrong
    // tap still surfaces the cue immediately, and still does nothing else.
    hintAfterMs: d.cueLevel === "full" ? 4000 : d.cueLevel === "partial" ? 9000 : null,
  };
}

// ── Tier 1: generated, no bank ───────────────────────────────────────────────

export function generateAttention(level, seed = 0) {
  const l = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, level));
  // Level 0 must be near-impossible to fail: no no-go stimuli at all, so every
  // tap is correct. The measure still runs, it just cannot punish anyone.
  const noGoRatio = l < 3 ? 0 : Math.min(0.1 + l * 0.015, 0.3);
  // Stimulus count is 4 + level, not 6 + level * 2.
  //
  // The old curve put 20 circles on the screen at level 7, and a trial can run
  // the full windowMs when nobody answers -- so one attention item cost about
  // 32 seconds, and three of them ran the block to roughly a minute and a half.
  // That is a sixth of the domains eating a third of a ten-minute session, and
  // the extra trials bought nothing: sustained attention and response
  // inhibition are already read off eleven trials. The go/no-go design, the
  // no-go ratio, the response window and the acknowledgement are unchanged --
  // this is the length of the block, not the difficulty of it.
  const stimuli = 4 + l;
  const noGoCount = Math.round(stimuli * noGoRatio);
  return {
    id: `att-gen-${l}-${seed}`,
    domain: "attention",
    template: "go-no-go",
    generated: true,
    level: l,
    seed,
    // THE INSTRUCTION IS DERIVED FROM THE STIMULUS SET, never assumed.
    //
    // Below level 3 noGoRatio is 0, so no red circle is ever drawn -- and
    // "Tap the green circle. Leave the red one" then describes a screen the
    // patient will not see. Telling someone with dementia to watch for
    // something that never arrives is not a harmless inaccuracy: they spend
    // the round waiting for it, and confusion at the instruction is measured
    // as inattention. Whatever the generator emits, the prompt matches it.
    promptKey: noGoCount > 0 ? "ask_tap_green" : "ask_tap_all",
    stimuli,
    noGoCount,
    goCount: stimuli - noGoCount,
    noGoRatio: Number(noGoRatio.toFixed(3)),
    // Visual only, no voice: a spoken cue would measure hearing as well.
    windowMs: Math.max(700, 2200 - l * 85),
    targetSize: l < 5 ? "xl" : l < 10 ? "lg" : "md",
    order: seededShuffle(
      [
        ...Array(stimuli - noGoCount).fill("go"),
        ...Array(noGoCount).fill("nogo"),
      ],
      8000 + l * 31 + seed
    ),
  };
}

const SHAPES = ["circle", "square", "triangle", "diamond", "hexagon", "star"];

// SHAPE MATCH ONLY. The spec lists "match shape / set clock hands" for this
// domain and there are no clock items; that is not an oversight left open, it
// is the tap-only rule (spec section 15) applied. Setting hands on a clock is
// a drag, and drag is ruled out because tremor is common -- a patient who
// cannot hold a drag would score as a perceptual-motor deficit they do not
// have, which is worse than not asking.
//
// A tap-only clock question is possible ("which clock shows half past four?"),
// but it reads a dial rather than judging space, so it measures something
// closer to language and numeracy than perceptual-motor. If it is ever wanted
// it should be added as its own template with that understood, not as a
// substitute for the missing one. Rotation does not need it either: this
// generator is infinite.
export function generatePerceptualMotor(level, seed = 0) {
  const l = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, level));
  const d = difficultyFor(l);
  const count = Math.min(2 + Math.floor(l / 2), SHAPES.length);
  const options = seededShuffle(SHAPES, 9000 + l * 17 + seed).slice(0, count);
  return {
    id: `pmo-gen-${l}-${seed}`,
    domain: "perceptual_motor",
    template: "match-the-shape",
    generated: true,
    level: l,
    seed,
    promptKey: "ask_match_shape",
    target: options[0],
    options: seededShuffle(options, 9500 + l + seed),
    correct: options[0],
    gridSize: d.gridSize,
    // Rotation is what makes this spatial rather than a colour match.
    rotationDeg: l < 5 ? 0 : l < 10 ? 45 : 90,
    cueLevel: d.cueLevel,
  };
}

// ── The bank ─────────────────────────────────────────────────────────────────

const BANKS = {
  memory: memoryItems(),
  language: languageItems(),
  social: socialItems(),
  executive: executiveItems(),
};


const GENERATORS = {
  attention: generateAttention,
  perceptual_motor: generatePerceptualMotor,
};

const BUILDERS = {
  memory: buildMemory,
  language: buildLanguage,
  social: buildSocial,
  executive: buildExecutive,
};

/**
 * Build one specific bank entry at a level, bypassing selection.
 *
 * selectItem() picks; this shapes a chosen entry. The review tool needs the
 * second without the first -- going through selectItem to reach a named item
 * silently returns a different one when that item is out of range at the
 * level, which showed up as duplicate ids in the listing.
 */
export function buildItemById(domain, id, level) {
  const entry = bankFor(domain).find((i) => i.id === id);
  if (!entry) return null;
  return BUILDERS[domain](entry, level);
}

/** True when a domain draws from a stored bank rather than a generator. */
export const isBanked = (domain) => domain in BANKS;

/** Raw bank entries for a domain (empty for generated domains). */
export function bankFor(domain) {
  return BANKS[domain] ?? [];
}

/** How many distinct items a domain can offer. Generated domains are endless. */
export function bankDepth(domain) {
  return isBanked(domain) ? BANKS[domain].length : Infinity;
}

/** Every item eligible at this level, before rotation is considered. */
export function eligibleItems(domain, level) {
  return bankFor(domain).filter(
    (item) => level >= item.minLevel && level <= item.maxLevel
  );
}

/**
 * Pick one item for a domain at a level, honouring the 14-day rotation.
 *
 * `recentIds` is the set of item ids this patient has already seen inside the
 * window (see db.recentItemIds). Without rotation the patient memorises the
 * same twenty pictures, scores climb, and the trend line reports improvement
 * where nothing changed -- the difference between a measurement and a number
 * that drifts upward on its own.
 *
 * When every eligible item has been seen it DEGRADES rather than throws:
 * the least-recently-seen item comes back. A patient must always get a
 * question. `exhausted: true` says the rotation guarantee has lapsed so the
 * caller can report honestly rather than silently pretend.
 */
/**
 * Narrow a pool to the items that can actually carry this level.
 *
 * Executive is the only domain where an eligible item can still be too easy.
 * Every routine is eligible to the top of the scale on purpose -- barring
 * short ones left three routines at level 15, and a pool of three means the
 * patient sees the same one every other day and memorises it, which is exactly
 * what the 14-day rule exists to stop. But eligibility alone let a three-step
 * routine be served at level 9, where `buildExecutive` can only trim it, never
 * extend it: the ordering decision was then trivial regardless of the level,
 * and the level had stopped controlling difficulty at all.
 *
 * So: prefer routines long enough to fill the level, and fall back to the
 * whole pool when none are. Deep rotation and a real task, rather than one at
 * the cost of the other. Rotation still wins -- this narrows what is already
 * unseen, and never reaches past it for a longer routine.
 */
function preferBestFit(domain, level, pool) {
  if (domain !== "executive") return pool;

  const wanted = executiveStepsWanted(level);
  const fits = pool.filter((item) => item.steps.length >= wanted);
  if (fits.length > 0) return fits;

  // Nothing is long enough. Take the longest on offer rather than any of them.
  const longest = Math.max(...pool.map((item) => item.steps.length));
  return pool.filter((item) => item.steps.length === longest);
}

export function selectItem({ domain, level, recentIds = new Set(), seed = 0, lastSeenAt = {} }) {
  if (!DOMAINS.includes(domain)) throw new Error(`unknown domain: ${domain}`);

  if (!isBanked(domain)) {
    // Generated domains cannot repeat in any meaningful sense -- the config is
    // rebuilt from level and seed. Rotation is logged as template+seed.
    return { item: GENERATORS[domain](level, seed), exhausted: false, generated: true };
  }

  const eligible = eligibleItems(domain, level);
  if (eligible.length === 0) {
    throw new Error(`no ${domain} items eligible at level ${level}`);
  }

  const unseen = eligible.filter((item) => !recentIds.has(item.id));
  const pool = preferBestFit(domain, level, unseen.length > 0 ? unseen : eligible);
  const exhausted = unseen.length === 0;

  let chosen;
  if (exhausted) {
    // Least recently seen first, so the repeat is as old as possible.
    chosen = [...pool].sort(
      (a, b) => (lastSeenAt[a.id] ?? 0) - (lastSeenAt[b.id] ?? 0)
    )[0];
  } else {
    chosen = seededShuffle(pool, seed + level * 13)[0];
  }

  return {
    item: BUILDERS[domain](chosen, level),
    exhausted,
    generated: false,
    poolSize: eligible.length,
    unseenCount: unseen.length,
  };
}

/** One item per domain, for a whole session. Order is the caller's business. */
export function selectSessionItems({ level, recentIdsByDomain = {}, seed = 0 }) {
  return DOMAINS.map((domain, i) =>
    selectItem({
      domain,
      // Uncalibrated resolves to STARTING_LEVEL, never to the floor.
      level: levelForPlay(typeof level === "object" ? level[domain] : level),
      recentIds: recentIdsByDomain[domain] ?? new Set(),
      seed: seed + i,
    })
  );
}
