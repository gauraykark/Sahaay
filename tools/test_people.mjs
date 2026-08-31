// Sprint 9 DoD: My People — the card, Revision, and the Test.
//
// The question builder is driven directly; the two screens are checked by
// reading their source, because the things that matter about them are
// absences -- Revision must write NOTHING, and the Test must show no failure
// signal anywhere. An absence is not something a rendered snapshot proves.
//
// Run from the repo root:  node tools/test_people.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLOSING_FIELDS,
  MIN_CARDS_FOR_TEST,
  OPTIONS_PER_QUESTION,
  PERSON_FIELDS,
  QUESTION_TEMPLATES,
  buildPeopleTest,
  canTest,
  fieldValue,
  filledFields,
  initialFor,
  questionCandidates,
} from "../shared/people.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "frontend", "src");

const passed = [];
const failed = [];
const ok = (n, c, d = "") => (c ? passed.push(n) : failed.push(d ? `${n}: ${d}` : n));
const eq = (n, got, want) =>
  ok(n, Object.is(got, want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

/** Source with comments stripped, so a comment about failure is not failure. */
function codeOf(...parts) {
  return readFileSync(join(...parts), "utf8")
    .split(/\r?\n/)
    .filter((l) => {
      const s = l.trim();
      return !s.startsWith("//") && !s.startsWith("*") && !s.startsWith("/*");
    })
    .join("\n");
}

/**
 * The body of a named function declaration, by brace matching.
 *
 * The parameter list has to be skipped by matching PARENTHESES first. Nearly
 * every component here destructures its props, so counting braces from the
 * declaration closes on `({ people, seed })` and returns an empty body -- and
 * an empty body makes every "this must not appear" assertion pass for the
 * wrong reason. Throws rather than returning "" for that reason.
 */
function functionBody(code, name) {
  const start = code.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`functionBody: no function ${name}`);

  const open = code.indexOf("(", start);
  let depth = 0;
  let paramsEnd = -1;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === "(") depth += 1;
    else if (code[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        paramsEnd = i;
        break;
      }
    }
  }
  if (paramsEnd === -1) throw new Error(`functionBody: unclosed params on ${name}`);

  const bodyStart = code.indexOf("{", paramsEnd);
  if (bodyStart === -1) throw new Error(`functionBody: no body on ${name}`);

  depth = 0;
  for (let i = bodyStart; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(bodyStart, i + 1);
    }
  }
  throw new Error(`functionBody: unclosed body on ${name}`);
}

// ── A family to ask about ────────────────────────────────────────────────────

const FAMILY = [
  {
    id: 1,
    name: "Rahul",
    photo: "blob-1",
    relationship: "Your son",
    age: "42",
    occupation: "Teacher",
    home: "Guwahati",
    spouse: "Priya",
    children: "Two — Aarav and Ria",
    likes: "Fishing",
    favouriteFood: "Fish curry",
    visits: "Every Sunday",
    sharedMemory: "You planted the lemon tree together",
  },
  {
    id: 2,
    name: "Priya",
    photo: "blob-2",
    relationship: "Your daughter-in-law",
    occupation: "Nurse",
    home: "Guwahati",
    visits: "Every Sunday",
  },
  {
    id: 3,
    name: "Aarav",
    photo: "blob-3",
    relationship: "Your grandson",
    occupation: "Student",
    home: "Jorhat",
    visits: "In the holidays",
  },
  {
    id: 4,
    name: "Bina",
    photo: "blob-4",
    relationship: "Your neighbour",
    occupation: "Shopkeeper",
    home: "Shillong",
    visits: "Most mornings",
  },
];

// ── 1. The card asks only about what is filled in ────────────────────────────

{
  // The plan's case: a card with nothing but a name and a photo.
  const bare = { id: 9, name: "Kamal", photo: "blob-9" };
  const people = [...FAMILY, bare];
  const mine = questionCandidates(people).filter((q) => q.personId === 9);

  eq("a name-and-photo card asks exactly one question", mine.length, 1);
  eq("and that question is 'who is this'", mine[0]?.template, "who");

  const empties = questionCandidates(people).filter((q) => !q.correct);
  eq("no question is ever generated with an empty answer", empties.length, 0);
}

{
  // Priya has no `age`, `likes` or `sharedMemory`. Nothing may ask about them.
  const priya = filledFields(FAMILY[1]).map((f) => f.key);
  ok("filledFields lists only the fields with a value", !priya.includes("age"));
  ok(
    "filledFields keeps the display order of PERSON_FIELDS",
    priya.join(",") ===
      PERSON_FIELDS.filter((f) => priya.includes(f.key)).map((f) => f.key).join(",")
  );
  eq(
    "a blank string counts as unfilled, not as an answer",
    filledFields({ name: "X", home: "   " }).length,
    0
  );
}

// ── 2. "Who is this" needs a face ────────────────────────────────────────────

{
  // The no-photo card renders a large initial -- which is the first letter of
  // the name sitting in the options. Asking would be handing over the answer.
  const noPhoto = { id: 10, name: "Dipak", occupation: "Driver", home: "Tezpur" };
  const asked = questionCandidates([...FAMILY, noPhoto]).filter(
    (q) => q.personId === 10
  );
  ok(
    "a card with no photo never asks 'who is this'",
    !asked.some((q) => q.template === "who"),
    asked.map((q) => q.template).join(",")
  );
  ok("but it still asks the detail questions", asked.length > 0);
  eq("and its card shows an initial, never a broken image", initialFor(noPhoto), "D");
  eq("a nameless card still has something to show", initialFor({}), "?");
}

// ── 3. Distractors are real, and never the answer twice ──────────────────────

{
  const round = buildPeopleTest(FAMILY, { seed: 3, count: 20 });
  ok("the family supports a full round", round.length > 0);

  const values = new Set();
  for (const person of FAMILY) {
    for (const field of ["name", ...PERSON_FIELDS.map((f) => f.key)]) {
      const v = fieldValue(person, field);
      if (v) values.add(v);
    }
  }

  let duplicated = 0;
  let invented = 0;
  let missingCorrect = 0;
  let wrongCount = 0;
  for (const q of round) {
    if (q.options.length !== OPTIONS_PER_QUESTION) wrongCount += 1;
    if (new Set(q.options).size !== q.options.length) duplicated += 1;
    if (!q.options.includes(q.correct)) missingCorrect += 1;
    for (const option of q.options) if (!values.has(option)) invented += 1;
  }

  eq("every question offers exactly three options", wrongCount, 0);
  eq("no option is ever repeated inside a question", duplicated, 0);
  eq("the correct answer is always among the options", missingCorrect, 0);
  eq("every wrong option is a real value off a real card", invented, 0);

  // Rahul and Priya both live in Guwahati. "Where does Rahul live?" must not
  // offer Guwahati twice.
  const rahulHome = round.find((q) => q.personId === 1 && q.template === "home");
  if (rahulHome) {
    eq(
      "a value two people share is not offered twice",
      new Set(rahulHome.options.map((o) => o.toLowerCase())).size,
      OPTIONS_PER_QUESTION
    );
  }
}

{
  // One teacher in the family means there is no honest way to ask what he
  // does -- there are no other occupations to draw two wrong options from.
  const thin = [
    { id: 1, name: "Rahul", photo: "b1", occupation: "Teacher" },
    { id: 2, name: "Priya", photo: "b2" },
    { id: 3, name: "Aarav", photo: "b3" },
  ];
  const asked = questionCandidates(thin);
  ok(
    "a field only one card fills is never asked about",
    !asked.some((q) => q.template === "occupation"),
    "it would need two invented distractors"
  );
  ok("but 'who is this' still works off three names", asked.some((q) => q.template === "who"));
}

// ── 4. Below three cards there is no Test ────────────────────────────────────

{
  eq("the threshold is three cards", MIN_CARDS_FOR_TEST, 3);
  ok("no cards, no Test", !canTest([]));
  ok("two cards, no Test", !canTest(FAMILY.slice(0, 2)));
  ok("three cards, Test", canTest(FAMILY.slice(0, 3)));

  // Three cards that cannot answer anything must not offer a Test either.
  const nameless = [
    { id: 1, name: "A" },
    { id: 2, name: "B" },
    { id: 3, name: "C" },
  ];
  ok(
    "three cards with no photos and no details offer no Test",
    !canTest(nameless),
    "it would open on an empty round"
  );
}

// ── 5. The Test feeds memory and social ──────────────────────────────────────

{
  const round = buildPeopleTest(FAMILY, { seed: 11, count: 30 });
  const domains = new Set(round.map((q) => q.domain));
  ok("the Test writes into memory", domains.has("memory"), [...domains].join(","));
  ok("the Test writes into social", domains.has("social"), [...domains].join(","));
  eq("and into nothing else", domains.size, 2);

  eq(
    "'who is this' is the memory question",
    QUESTION_TEMPLATES.find((q) => q.id === "who")?.domain,
    "memory"
  );
  ok(
    "every detail question is social",
    QUESTION_TEMPLATES.filter((q) => q.id !== "who").every((q) => q.domain === "social")
  );

  const ids = round.map((q) => q.id);
  eq("every question carries a distinct id for the row it writes", new Set(ids).size, ids.length);
}

{
  // The demo set: three cards, and only two of them carry a photo. "Who is
  // this" is then 2 candidates out of 11, and a plain round-robin produced
  // six social questions and no face at all -- a day where memory silently
  // got no data while the Test claimed to feed it. Caught by seeding the real
  // demo, not by the earlier tests, because the four-card family always
  // covered both domains by luck.
  const demo = [
    { id: 1, name: "Rahul", photo: "b1", relationship: "Your son", age: "42",
      occupation: "Teacher", home: "Guwahati", spouse: "Priya",
      children: "Two — Aarav and Ria", likes: "Fishing", favouriteFood: "Fish curry",
      visits: "Every Sunday", sharedMemory: "You planted the lemon tree together" },
    { id: 2, name: "Anil", photo: "b2", relationship: "Your brother", age: "68",
      occupation: "Farmer", home: "Jorhat", spouse: "Meena", children: "One — Deepak",
      likes: "Gardening", favouriteFood: "Rice and dal", visits: "Twice a month",
      sharedMemory: "You both went to the same school" },
    { id: 3, name: "Bina", relationship: "Your neighbour", age: "55",
      occupation: "Shopkeeper", home: "Next door", likes: "Singing",
      favouriteFood: "Pitha", visits: "Every morning",
      sharedMemory: "She brings you tea" },
  ];

  ok("the demo set unlocks the Test", canTest(demo));

  let missedMemory = 0;
  let missedSocial = 0;
  for (let seed = 0; seed < 200; seed += 1) {
    const domains = new Set(buildPeopleTest(demo, { seed }).map((q) => q.domain));
    if (!domains.has("memory")) missedMemory += 1;
    if (!domains.has("social")) missedSocial += 1;
  }
  eq("no round on the demo set skips memory, over 200 seeds", missedMemory, 0);
  eq("no round on the demo set skips social, over 200 seeds", missedSocial, 0);

  // The card with no photo must still never be the face question.
  let binaAsFace = 0;
  for (let seed = 0; seed < 200; seed += 1) {
    binaAsFace += buildPeopleTest(demo, { seed }).filter(
      (q) => q.template === "who" && q.name === "Bina"
    ).length;
  }
  eq("the photo-less card is never the face question", binaAsFace, 0);

  // The guarantee must not cost the round its variety.
  for (let seed = 0; seed < 50; seed += 1) {
    const round = buildPeopleTest(demo, { seed });
    if (new Set(round.map((q) => q.id)).size !== round.length) {
      failed.push(`the swap introduced a duplicate question at seed ${seed}`);
      break;
    }
  }
  ok("the domain guarantee never duplicates a question", true);
}

// ── 6. A round is deterministic, and spread across people ────────────────────

{
  const a = buildPeopleTest(FAMILY, { seed: 42 });
  const b = buildPeopleTest(FAMILY, { seed: 42 });
  const c = buildPeopleTest(FAMILY, { seed: 43 });

  eq(
    "the same seed builds the same round",
    JSON.stringify(a.map((q) => [q.id, q.options])),
    JSON.stringify(b.map((q) => [q.id, q.options]))
  );
  ok(
    "a different seed builds a different one",
    JSON.stringify(a.map((q) => q.id)) !== JSON.stringify(c.map((q) => q.id))
  );

  // Four cards, six questions: everybody should be asked about before anybody
  // is asked about twice.
  const firstFour = a.slice(0, 4).map((q) => q.personId);
  eq("the round reaches every card before repeating one", new Set(firstFour).size, 4);
  eq("a round is six questions by default", a.length, 6);

  const shortRound = buildPeopleTest(FAMILY.slice(0, 3), { seed: 1, count: 100 });
  ok(
    "asking for more questions than exist stops rather than looping",
    shortRound.length < 100 && shortRound.length > 0,
    `got ${shortRound.length}`
  );
}

// ── 7. The prompt names the person, except when the photo is the question ────

{
  const round = buildPeopleTest(FAMILY, { seed: 5, count: 30 });
  const who = round.filter((q) => q.template === "who");
  const detail = round.filter((q) => q.template !== "who");

  ok(
    "'who is this' never names the person it is asking about",
    who.every((q) => q.promptName === null),
    "the prompt would give away the answer"
  );
  ok(
    "every 'who is this' has a face to show",
    who.every((q) => Boolean(q.photo))
  );
  ok(
    "detail questions name the person",
    detail.every((q) => Boolean(q.promptName))
  );
}

// ── 8. Revision writes nothing; the Test writes once per answer ──────────────

{
  const page = codeOf(SRC, "pages", "MemoryVault.jsx");
  const revision = functionBody(page, "Revision");
  const card = functionBody(page, "PersonCard");
  const test = functionBody(page, "PeopleTest");

  ok("the page has a Revision mode", revision.length > 0);
  ok("the page has a Test mode", test.length > 0);

  ok(
    "Revision logs nothing",
    !/logGameSession|logAbandonedSession|recordItemsShown/.test(revision),
    "browsing the album must not touch the clinical record"
  );
  ok(
    "the expandable card logs nothing",
    !/logGameSession|logAbandonedSession|recordItemsShown/.test(card)
  );
  eq(
    "the Test logs exactly once, per answer",
    (test.match(/logGameSession\(/g) ?? []).length,
    1
  );
  ok(
    "and it logs the domain the question belongs to",
    /domain:\s*question\.domain/.test(test),
    "a People row must not be resolved from its game type"
  );
  ok(
    "accuracy is correct-over-attempted, the one meaning of score",
    /total:\s*1/.test(test) && /score:\s*wasCorrect\s*\?\s*1\s*:\s*0/.test(test)
  );

  // Preview mode is guarded inside logGameSession, which is the only write
  // path here. Assert there is no second one that could slip past it.
  ok(
    "the only write path is logGameSession, so preview mode still holds",
    !/db\.(gameSessions|itemHistory|playSessions)\./.test(page)
  );
}

// ── 9. Nothing on this page can read as failure ──────────────────────────────

{
  const page = codeOf(SRC, "pages", "MemoryVault.jsx");

  const red = page.match(/\b(?:text|bg|border|ring)-(?:red|rose)-\d{2,3}\b/g) ?? [];
  eq("no red anywhere on the page", red.length, 0);

  const words = page.match(/\b(?:wrong|incorrect|failed|mistake)\b/gi) ?? [];
  eq("the words for failure do not appear", words.length, 0, red.join(","));

  ok(
    "no score is shown",
    !/out of|\bscore\b\s*[}:]|{\s*score\s*}/i.test(page.replace(/score:\s*wasCorrect[^,]*,/, ""))
  );
  ok(
    "no progress counter",
    !/\b(?:index|current)\s*\+\s*1\s*\}?\s*(?:of|\/)\s*/.test(page),
    "'3 of 6' is pressure, which is the thing this removes"
  );
  ok(
    "a wrong pick lifts the right answer instead",
    /correcting\s*&&\s*option\s*===\s*question\.correct/.test(page)
  );
  ok(
    "and says so gently",
    /lets_look_together/.test(page)
  );
  ok(
    "the round always ends the same way",
    /well_done_today/.test(page),
    "regardless of performance"
  );
  ok(
    "there is always a way out",
    /onClick=\{onExit\}/.test(page)
  );
}

// ── 10. Photos are blobs, and a missing one is never a broken image ──────────

{
  const dash = codeOf(SRC, "pages", "CaregiverDashboard.jsx");
  const form = functionBody(dash, "PersonForm");
  ok("the caregiver form exists", form.length > 0);

  ok(
    "the photo goes to Dexie as a blob, not a base64 string",
    !/FileReader|readAsDataURL/.test(form),
    "a data URL costs a third more bytes and a decode on every render"
  );
  ok(
    "it stores the File straight off the input",
    /files\?\.\[0\]/.test(form)
  );
  ok(
    "every optional field is on the form",
    PERSON_FIELDS.every(() => /PERSON_FIELDS\.map/.test(form)),
    "the form is generated from the field list, so it cannot drift"
  );
  ok(
    "the form both adds and edits",
    /addVaultPerson\(/.test(form) && /updateVaultPerson\(/.test(form)
  );
  ok(
    "editing without touching the photo keeps the stored one",
    /photo\s*!==\s*undefined/.test(form),
    "an untouched file input must not blank the face"
  );

  const db = codeOf(SRC, "lib", "db.js");
  ok(
    "db stores the photo as given",
    !/FileReader|readAsDataURL/.test(functionBody(db, "addVaultPerson"))
  );

  const photo = codeOf(SRC, "components", "ui", "PersonPhoto.jsx");
  ok(
    "a blob photo becomes an object URL",
    /createObjectURL/.test(photo)
  );
  ok(
    "and is revoked, so seven faces do not leak seven decoded images",
    /revokeObjectURL/.test(photo)
  );
  ok(
    "a legacy data-URL photo still renders",
    /typeof photo === "string"/.test(photo)
  );
  ok(
    "no photo falls back to an initial",
    /initialFor\(person\)/.test(photo)
  );
  ok(
    "so does a photo that will not decode",
    /onError=/.test(photo),
    "a broken-image glyph where a face should be reads as something being wrong"
  );
}

// ── 11. The two fields that matter most are set apart ────────────────────────

{
  eq(
    "the closing fields are how often they visit and the shared memory",
    CLOSING_FIELDS.join(","),
    "visits,sharedMemory"
  );
  ok(
    "both are real card fields",
    CLOSING_FIELDS.every((k) => PERSON_FIELDS.some((f) => f.key === k))
  );

  const page = codeOf(SRC, "pages", "MemoryVault.jsx");
  ok(
    "the card renders them apart from the rest",
    /CLOSING_FIELDS/.test(page),
    "they place someone in a daily life, which is the point of the card"
  );

  const card = functionBody(page, "PersonCard");
  ok(
    "the card expands in place rather than routing or opening a modal",
    /aria-expanded/.test(card) && !/navigate\(|<Link/.test(card)
  );
}

for (const n of passed) console.log(`  PASS  ${n}`);
for (const n of failed) console.log(`  FAIL  ${n}`);
console.log();
if (failed.length) {
  console.log(`MY PEOPLE: FAIL (${failed.length} of ${passed.length + failed.length})`);
  process.exit(1);
}
console.log(`MY PEOPLE: OK (${passed.length} checks)`);
