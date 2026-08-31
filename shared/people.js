// My People — the card, and the questions a card can ask.
//
// One person, one card, like a simple ID card. Every field except the name is
// optional, and the card IS the question bank: the Test only ever asks about
// fields somebody actually filled in, so there is no such thing as an empty
// question.
//
// Pure functions only -- no React, no Dexie, no DOM. That is what lets
// tools/test_people.mjs drive the whole question builder in Node, and it is
// the same split itemBank.js and sessionRules.js already use.
//
// Two rules from the spec shape almost everything below:
//
//   * Errorless applies here MORE than anywhere else. Getting your own son's
//     name wrong is not like missing a shape match. Nothing in this file
//     produces a score, a count or a notion of failure -- it produces
//     questions, and the caller shows the right answer warmly either way.
//
//   * Distractors come from the OTHER cards. "Where does Rahul live?" offers
//     Guwahati / Jorhat / Shillong, all real places real family members live,
//     rather than three invented towns. Plausible for free, and it means the
//     wrong options are never obviously wrong.

import { DOMAIN_MEMORY, DOMAIN_SOCIAL } from "./domains.js";
import { seededShuffle } from "./itemBank.js";

// ── The card ─────────────────────────────────────────────────────────────────

// Every field on a card, in the order they are shown. `name` is not here: it
// is the card's title, not one of its details, and it is the only field that
// is required.
//
// Two labels per field, because they have two audiences:
//
//   `labelKey` is an i18n key for the PATIENT's card, which follows the
//   patient's own language.
//
//   `label` and `placeholder` are for the CAREGIVER's form. That whole
//   dashboard is English by design (see the note at the top of i18n.js), and
//   the placeholder is doing real work there -- "Two — Aarav and Ria" tells a
//   caregiver to write one short line, where "Children" alone invites a
//   paragraph the card cannot lay out.
export const PERSON_FIELDS = [
  {
    key: "relationship",
    labelKey: "person_relationship",
    label: "Relationship",
    placeholder: "e.g. Your son",
  },
  { key: "age", labelKey: "person_age", label: "Age", placeholder: "e.g. 42" },
  {
    key: "occupation",
    labelKey: "person_occupation",
    label: "What they do",
    placeholder: "e.g. Teacher",
  },
  {
    key: "home",
    labelKey: "person_home",
    label: "Where they live",
    placeholder: "e.g. Guwahati",
  },
  {
    key: "spouse",
    labelKey: "person_spouse",
    label: "Married to",
    placeholder: "e.g. Priya",
  },
  {
    key: "children",
    labelKey: "person_children",
    label: "Children",
    placeholder: "e.g. Two — Aarav and Ria",
  },
  {
    key: "likes",
    labelKey: "person_likes",
    label: "What they like",
    placeholder: "e.g. Fishing",
  },
  {
    key: "favouriteFood",
    labelKey: "person_favourite_food",
    label: "Favourite food",
    placeholder: "e.g. Fish curry",
  },
  {
    key: "visits",
    labelKey: "person_visits",
    label: "How often they visit",
    placeholder: "e.g. Every Sunday",
  },
  {
    key: "sharedMemory",
    labelKey: "person_shared_memory",
    label: "One thing you shared",
    placeholder: "e.g. You planted the lemon tree together",
  },
];

// The two that matter most, and the reason the card is not just a CV.
//
// Age and occupation place someone in the world; "she comes every Sunday" and
// "we planted the lemon tree together" place them in a life. A patient who
// cannot retrieve that their daughter is an accountant can very often still
// retrieve that she visits on Sundays, and that is the connection worth
// keeping. The card renders these two apart from the rest for that reason.
export const CLOSING_FIELDS = ["visits", "sharedMemory"];

export const PERSON_FIELD_KEYS = PERSON_FIELDS.map((f) => f.key);

/** Trimmed string value of a field, or "" when it is blank or absent. */
export function fieldValue(person, key) {
  const raw = person?.[key];
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
}

/** Case-insensitive comparison key, so "Guwahati" and "guwahati" are one value. */
const matchKey = (value) => value.trim().toLowerCase();

/**
 * The fields this person actually has, in display order.
 *
 * Render only what is filled: a card showing "Age: —" invites the reader to
 * notice a gap, and there is nothing useful behind the gap.
 */
export function filledFields(person) {
  return PERSON_FIELDS.filter((f) => fieldValue(person, f.key) !== "").map((f) => ({
    ...f,
    value: fieldValue(person, f.key),
  }));
}

/** First letter of a name, for the no-photo card. Never empty, never broken. */
export function initialFor(person) {
  const name = fieldValue(person, "name");
  return name ? name[0].toUpperCase() : "?";
}

// ── The Test ─────────────────────────────────────────────────────────────────

export const OPTIONS_PER_QUESTION = 3;

// Below this there are not enough cards to draw two plausible wrong options,
// and the Test is hidden rather than shown with invented ones.
export const MIN_CARDS_FOR_TEST = 3;

// One short round. Long enough to be worth opening, short enough that nobody
// is asked to sit through twenty questions about their own family.
export const TEST_QUESTION_COUNT = 6;

// The four question shapes, and the domain each one scores into.
//
// "Who is this?" is recognition of a face -- learning and memory. The detail
// questions are knowledge about a person and their place in the patient's
// life, which is social cognition. That split is why the Test feeds two
// domains rather than one.
export const QUESTION_TEMPLATES = [
  {
    id: "who",
    field: "name",
    domain: DOMAIN_MEMORY,
    promptKey: "q_who_is_this",
    // Without a photo this question answers itself: the no-photo card shows a
    // large initial, and the initial is the first letter of the name sitting
    // in the options list. A card with no photo simply does not ask it.
    requiresPhoto: true,
    // The photo IS the question, so the name must not appear in the prompt.
    namesPerson: false,
  },
  {
    id: "occupation",
    field: "occupation",
    domain: DOMAIN_SOCIAL,
    promptKey: "q_what_do_they_do",
    namesPerson: true,
  },
  {
    id: "home",
    field: "home",
    domain: DOMAIN_SOCIAL,
    promptKey: "q_where_do_they_live",
    namesPerson: true,
  },
  {
    id: "visits",
    field: "visits",
    domain: DOMAIN_SOCIAL,
    promptKey: "q_how_often_visit",
    namesPerson: true,
  },
];

/**
 * Every question the current set of cards can support.
 *
 * A question survives only if the card has the field filled AND at least two
 * OTHER cards offer a different value for the same field. That second half is
 * what keeps the wrong options real: with one teacher in the family there is
 * no honest way to ask what he does.
 */
export function questionCandidates(people = []) {
  const out = [];

  for (const template of QUESTION_TEMPLATES) {
    for (const person of people) {
      const correct = fieldValue(person, template.field);
      if (!correct) continue;
      if (template.requiresPhoto && !person.photo) continue;

      // Distinct values from the other cards. Seeded with the correct answer
      // so it can never also arrive as a distractor -- two people who both
      // live in Guwahati must not produce Guwahati / Guwahati / Jorhat.
      const seen = new Set([matchKey(correct)]);
      const distractors = [];
      for (const other of people) {
        if (other.id === person.id) continue;
        const value = fieldValue(other, template.field);
        if (!value || seen.has(matchKey(value))) continue;
        seen.add(matchKey(value));
        distractors.push(value);
      }

      if (distractors.length < OPTIONS_PER_QUESTION - 1) continue;

      out.push({
        id: `people-${person.id}-${template.id}`,
        personId: person.id,
        template: template.id,
        domain: template.domain,
        promptKey: template.promptKey,
        // The prompt names the person for the detail questions and stays
        // silent for "who is this". Carried here so the renderer does not
        // need to know which is which.
        promptName: template.namesPerson ? fieldValue(person, "name") : null,
        name: fieldValue(person, "name"),
        // The photo rides along on every question, not just "who is this". A
        // face next to "Where does Rahul live?" is a cue, and cueing is the
        // whole point -- it cannot leak the answer to a question about a
        // place.
        photo: person.photo ?? null,
        correct,
        distractors,
      });
    }
  }

  return out;
}

/** True when the Test has enough cards behind it to be worth showing. */
export function canTest(people = []) {
  return (
    people.length >= MIN_CARDS_FOR_TEST && questionCandidates(people).length > 0
  );
}

/**
 * A round of questions, spread across people.
 *
 * Candidates are grouped per person and taken round-robin, so six questions
 * reach six different family members before they come back for a second one
 * about anybody. Straight shuffling would quite happily ask four questions
 * about the same son.
 *
 * Deterministic in `seed`: the same cards and the same seed give the same
 * round, which is what makes this testable.
 */
export function buildPeopleTest(
  people = [],
  { seed = 0, count = TEST_QUESTION_COUNT } = {}
) {
  const candidates = questionCandidates(people);
  if (candidates.length === 0) return [];

  const byPerson = new Map();
  for (const candidate of candidates) {
    if (!byPerson.has(candidate.personId)) byPerson.set(candidate.personId, []);
    byPerson.get(candidate.personId).push(candidate);
  }

  const queues = seededShuffle([...byPerson.keys()], seed).map((personId, i) =>
    seededShuffle(byPerson.get(personId), seed + i + 1)
  );

  const picked = [];
  let round = 0;
  while (picked.length < count) {
    const before = picked.length;
    for (const queue of queues) {
      if (picked.length >= count) break;
      if (round < queue.length) picked.push(queue[round]);
    }
    if (picked.length === before) break; // every queue is drained
    round += 1;
  }

  // Every domain that CAN be asked gets asked.
  //
  // "Who is this" needs a photo, so on a set where only two of three cards
  // have one it is a small minority of the candidates -- and a six-question
  // round can quite easily come out entirely social, with the two faces never
  // shown. The Test is supposed to feed memory AND social; a round that feeds
  // one is not a lighter version of that, it is a day where a domain silently
  // got no data.
  //
  // The swap goes in from the BACK and only ever displaces a domain that
  // still has another question left, so the spread across people at the front
  // of the round survives untouched. On a set that already covers both
  // domains this loop does nothing at all.
  for (const domain of [...new Set(candidates.map((c) => c.domain))].sort()) {
    if (picked.some((q) => q.domain === domain)) continue;

    const chosenIds = new Set(picked.map((q) => q.id));
    const pool = candidates.filter(
      (c) => c.domain === domain && !chosenIds.has(c.id)
    );
    if (pool.length === 0) continue;

    const counts = new Map();
    for (const q of picked) counts.set(q.domain, (counts.get(q.domain) ?? 0) + 1);

    const victim = picked.findLastIndex((q) => (counts.get(q.domain) ?? 0) > 1);
    if (victim === -1) continue;

    picked[victim] = seededShuffle(pool, seed + 303)[0];
  }

  return picked.map((candidate, i) => {
    const chosen = seededShuffle(candidate.distractors, seed + i + 101).slice(
      0,
      OPTIONS_PER_QUESTION - 1
    );
    return {
      id: candidate.id,
      personId: candidate.personId,
      template: candidate.template,
      domain: candidate.domain,
      promptKey: candidate.promptKey,
      promptName: candidate.promptName,
      name: candidate.name,
      photo: candidate.photo,
      correct: candidate.correct,
      options: seededShuffle([candidate.correct, ...chosen], seed + i + 202),
    };
  });
}
