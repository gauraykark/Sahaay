// My People — /patient/vault
//
// One of the three things the patient sees, alongside PLAY and My Day.
//
// Two modes, and the difference between them is the whole design:
//
//   REVISION is the album. Tap a name, the card opens in place and shows
//   whatever the caregiver filled in. Nothing is asked, nothing is scored,
//   nothing is written. Always available, never locked, and NOT where the
//   patient is sent after struggling with the Test -- it is its own thing,
//   chosen freely.
//
//   TEST is a short round of three-option questions built only from filled
//   fields, with the wrong options drawn from the other cards so they are
//   real names and real places. It scores into memory ("who is this") and
//   social (the detail questions). It is hidden below three cards, because
//   two cards cannot supply two plausible wrong answers.
//
// Errorless applies here more than anywhere else in the app. Getting your own
// son's name wrong is not like missing a shape match: there is no red, no X,
// no score, no count. A wrong pick lifts the right answer gently and moves on.
//
// Cards are local-only for now. Sprint 9 in the plan gives them a server home
// -- once the Test feeds two clinical domains the data is clinical, and a
// browser data clear currently destroys it with no recovery.

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Heart,
  Microphone,
  Question,
  SpeakerHigh,
} from "@phosphor-icons/react";

import {
  CLOSING_FIELDS,
  buildPeopleTest,
  canTest,
  fieldValue,
  filledFields,
} from "@shared/people";

import PersonPhoto from "../components/ui/PersonPhoto";
import { listVaultPeople, findVaultPersonByName, logGameSession } from "../lib/db";
import {
  speak,
  listenOnce,
  supportsVoiceInput,
  extractNameFromQuestion,
} from "../lib/utils";
import { useAuth } from "../lib/auth";
import { useT, langToLocale } from "../lib/i18n";

// How long the right answer stays up after a wrong pick. Same value the games
// use, so the two surfaces feel like one app.
const CORRECTION_MS = 2200;

// Ignore a second tap inside this window. Accidental double-taps are common
// with a tremor, and without this one would answer the next question too.
const DEBOUNCE_MS = 600;

// "Ask who is..." is off, not gone. It is the only speech INPUT anywhere in
// the app -- listenOnce, extractNameFromQuestion and findVaultPersonByName
// exist for this one button -- so the path stays wired and switchable rather
// than deleted and re-derived later. Flip this to bring it back.
const SHOW_ASK_WHO = false;

export default function MemoryVault() {
  // null while browsing; a {seed, sessionId} pair once a round has started.
  const [round, setRound] = useState(null);
  const [people, setPeople] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    listVaultPeople().then((rows) => {
      setPeople(rows);
      setIsLoading(false);
    });
  }, []);

  // The clock and the dice are read HERE, in the tap that starts the round,
  // and never during a render. That is what keeps PeopleTest a pure function
  // of its props -- the same seed always builds the same six questions, which
  // is also what makes the builder testable.
  const startTest = () =>
    setRound({
      seed: Math.floor(Math.random() * 1000000),
      sessionId: `people-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    });

  if (round) {
    return (
      <PeopleTest
        people={people}
        seed={round.seed}
        sessionId={round.sessionId}
        onExit={() => setRound(null)}
      />
    );
  }

  return (
    <Revision people={people} isLoading={isLoading} onStartTest={startTest} />
  );
}

// ── Revision ────────────────────────────────────────────────────────────────

function Revision({ people, isLoading, onStartTest }) {
  const { user } = useAuth();
  const t = useT();
  const locale = langToLocale(user?.preferred_language || "en");

  // One card open at a time: "one thing on screen at a time" is an interface
  // rule, and a list of seven open cards is a wall of text.
  const [openId, setOpenId] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [lastAnswer, setLastAnswer] = useState(null);
  // Read once, lazily. Browser capability cannot change while the page is
  // open, so an effect would only add a render that shows the wrong thing.
  const [voiceAvailable] = useState(() => supportsVoiceInput());

  const handleAsk = async () => {
    if (!voiceAvailable || isListening) return;

    setIsListening(true);
    setLastAnswer(null);

    try {
      const transcript = await listenOnce({ lang: locale });
      const name = extractNameFromQuestion(transcript);
      const match = await findVaultPersonByName(name);

      if (match) {
        setLastAnswer({ name: match.name, relationship: match.relationship });
        speak(t("this_is", match.name, match.relationship || ""), { lang: locale });
        // Open the card too, so the spoken answer and the card agree.
        setOpenId(match.id);
      } else {
        setLastAnswer({ notFound: true, heard: name });
        speak(t("not_sure_who"), { lang: locale });
      }
    } catch {
      setLastAnswer({ error: true });
    } finally {
      setIsListening(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-5 pt-5 pb-4 flex items-center justify-between">
        <Link
          to="/patient"
          className="flex items-center gap-1.5 text-base text-neutral-500 hover:text-neutral-700"
        >
          <ArrowLeft size={20} weight="regular" />
          Back
        </Link>
        <h1 className="text-lg font-medium text-neutral-800">
          {t("people_you_know")}
        </h1>
        <div className="w-10" />
      </header>

      <main className="flex-1 px-5 pb-10 max-w-5xl mx-auto w-full">
        {SHOW_ASK_WHO && voiceAvailable && (
          <div className="mb-8 text-center">
            <button
              type="button"
              onClick={handleAsk}
              disabled={isListening}
              className={`inline-flex flex-col items-center gap-2 rounded-full transition-colors ${
                isListening ? "text-primary-700" : "text-neutral-600 hover:text-primary-700"
              }`}
            >
              <span
                className={`w-16 h-16 rounded-full flex items-center justify-center border-2 ${
                  isListening
                    ? "border-primary-400 bg-primary-50"
                    : "border-neutral-300 bg-white"
                }`}
              >
                <Microphone size={28} weight="regular" />
              </span>
              <span className="text-sm">
                {isListening ? "Listening…" : "Ask “Who is...”"}
              </span>
            </button>

            {lastAnswer && (
              <div className="mt-4 bg-white border border-neutral-200 rounded-lg px-5 py-4 text-left">
                {lastAnswer.error && (
                  <p className="text-neutral-600">
                    Sorry, I couldn't hear that clearly. Please try again.
                  </p>
                )}
                {lastAnswer.notFound && (
                  <p className="text-neutral-600">
                    I'm not sure who "{lastAnswer.heard}" is yet.
                  </p>
                )}
                {!lastAnswer.error && !lastAnswer.notFound && (
                  <div className="flex items-center gap-2">
                    <SpeakerHigh size={20} weight="regular" className="text-primary-600 shrink-0" />
                    <p className="text-neutral-800">
                      <span className="font-medium">{lastAnswer.name}</span>
                      {lastAnswer.relationship ? ` — ${lastAnswer.relationship}` : ""}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* The Test entry. Hidden entirely below three cards -- a greyed-out
            button reads as broken, and "you cannot do this yet" is not
            something to put in front of the patient. */}
        {canTest(people) && (
          <button
            type="button"
            onClick={onStartTest}
            className="w-full max-w-md mx-auto mb-6 flex items-center justify-center gap-3
              rounded-2xl bg-primary-600 text-white px-6 py-5 text-2xl font-medium"
          >
            <Question size={26} weight="regular" />
            {t("people_test_start")}
          </button>
        )}

        {isLoading ? (
          <p className="text-neutral-400 text-center">Loading…</p>
        ) : people.length === 0 ? (
          <div className="text-center py-10">
            <Heart size={28} weight="regular" className="text-neutral-300 mx-auto mb-3" />
            <p className="text-neutral-600 text-lg">{t("people_no_one_yet")}</p>
            <p className="text-base text-neutral-500 mt-1">
              {t("people_caregiver_adds")}
            </p>
          </div>
        ) : (
          <>
            <p className="text-base text-neutral-500 text-center mb-4">
              {t("people_tap_to_see")}
            </p>
            {/* One column on a narrow phone, two on a wider one, three from a
                tablet up, inside a reading width so a large monitor does not
                stretch seven faces across a metre of glass.

                items-start is what keeps expansion calm. Under the default
                stretch, opening one card pulls every card beside it to the
                same new height and the whole row lurches; starting them means
                the open card grows down its own column and the only thing
                that moves is what was already below it. The equal-height rule
                is then bought back by the card itself -- see PersonCard. */}
            <div className="grid items-start gap-4 sm:gap-5 grid-cols-1
              min-[400px]:grid-cols-2 md:grid-cols-3">
              {people.map((person) => (
                <PersonCard
                  key={person.id}
                  person={person}
                  expanded={openId === person.id}
                  onToggle={() =>
                    setOpenId((current) => (current === person.id ? null : person.id))
                  }
                  t={t}
                />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/**
 * One card, expanding in place.
 *
 * Shut, it is a photo with a name under it and nothing else -- no age, no
 * occupation, no chevron. The face is the largest thing on it because the
 * face is the thing being recognised: someone who cannot retrieve a name can
 * very often still know a face on sight, and a 68px avatar is not a face, it
 * is a thumbnail of one.
 *
 * The photo and the name are the toggle; the details, once open, are not.
 * Tapping the shut card is therefore tapping the whole shut card, and tapping
 * the photo again closes it -- but wrapping the OPEN card in one button would
 * close it under the finger of anyone steadying the phone while they read.
 */
function PersonCard({ person, expanded, onToggle, t }) {
  const details = filledFields(person);
  const relationship = fieldValue(person, "relationship");
  const middle = details.filter(
    (f) => f.key !== "relationship" && !CLOSING_FIELDS.includes(f.key)
  );
  // Rendered in CLOSING_FIELDS order rather than whatever order they were
  // filled in, so "visits" always sits above the shared memory.
  const closing = CLOSING_FIELDS.map((key) =>
    details.find((f) => f.key === key)
  ).filter(Boolean);

  return (
    <div
      className={`bg-white border-2 rounded-2xl overflow-hidden transition-colors ${
        expanded ? "border-primary-400" : "border-neutral-200"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="block w-full text-left"
      >
        {/* Full card width, 4:3, and cropped rather than squashed -- a face
            stretched to fit a box is a face that is harder to recognise, which
            is the one thing this card exists to make easy. */}
        <div className="w-full aspect-[4/3] bg-neutral-100 overflow-hidden">
          <PersonPhoto person={person} fill rounded={false} />
        </div>

        {/* The floor that makes a row of cards line up. It is tall enough for
            a name that wraps to two lines plus a relationship, so a card whose
            name fits on one line -- or that has no relationship at all --
            still measures exactly the same as the card beside it. Without it,
            grid items-start would leave a row of ragged card bottoms. */}
        <div className="px-4 pt-3 pb-4 min-h-[7.25rem]">
          <p className="text-2xl font-bold text-neutral-900 leading-tight break-words">
            {person.name}
          </p>
          {relationship && (
            <p className="text-lg text-neutral-600 mt-1 leading-tight break-words">
              {relationship}
            </p>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-5">
          {middle.length > 0 && (
            <dl className="border-t border-neutral-200 pt-4 space-y-3">
              {middle.map((field) => (
                <div key={field.key}>
                  <dt className="text-sm text-neutral-500">{t(field.labelKey)}</dt>
                  <dd className="text-xl text-neutral-800">{field.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {/* How often they visit, and the one shared memory. These are set
              apart on purpose: they are what places someone in a daily life
              rather than on a CV, and they are the two a patient can most
              often still reach for. */}
          {closing.length > 0 && (
            <div className="mt-4 rounded-xl bg-primary-50 border border-primary-100 px-4 py-4 space-y-3">
              {closing.map((field) => (
                <div key={field.key}>
                  <dt className="text-sm text-primary-700">{t(field.labelKey)}</dt>
                  <dd className="text-xl text-neutral-800">{field.value}</dd>
                </div>
              ))}
            </div>
          )}

          {middle.length === 0 && closing.length === 0 && (
            <p className="border-t border-neutral-200 pt-4 text-base text-neutral-500">
              {t("people_caregiver_adds")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Test ────────────────────────────────────────────────────────────────────

function PeopleTest({ people, seed, sessionId, onExit }) {
  const t = useT();

  // Built ONCE, on entry, from a seed fixed before this component existed.
  // The same rule the play session runs under: getting question 3 wrong must
  // not change question 4. A wrong answer moves a base level in seven days;
  // it changes nothing inside the round in front of the patient.
  const [questions] = useState(() => buildPeopleTest(people, { seed }));

  const [index, setIndex] = useState(0);
  const [correcting, setCorrecting] = useState(false);
  const startedRef = useRef(0);
  const lastTapRef = useRef(0);
  const answeredRef = useRef(false);
  // Leaving is allowed at any moment, including in the middle of a correction
  // or an await. Both would otherwise land on a component that is gone.
  const liveRef = useRef(true);
  const timerRef = useRef(null);

  const question = questions[index];

  // Reading the clock is impure, so it happens on mount and on each advance
  // rather than during a render. `correcting` needs no reset here: advance()
  // clears it in the same update that moves the index.
  useEffect(() => {
    startedRef.current = Date.now();
    answeredRef.current = false;
  }, [index]);

  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const advance = useCallback(() => {
    if (!liveRef.current) return;
    setCorrecting(false);
    setIndex((i) => i + 1);
  }, []);

  const answer = useCallback(
    async (choice) => {
      if (!question || answeredRef.current || correcting) return;

      const now = Date.now();
      if (now - lastTapRef.current < DEBOUNCE_MS) return;
      lastTapRef.current = now;

      answeredRef.current = true;
      const wasCorrect = choice === question.correct;

      // One row per question, scored into the domain the question belongs to.
      // Accuracy is correct-over-attempted, the same meaning every other row
      // in the app carries. `level` is null because this content is not built
      // from a base level -- the cards are whatever the family filled in.
      //
      // logGameSession is a no-op under preview mode, so a caregiver trying
      // the Test from the dashboard writes nothing.
      await logGameSession({
        gameType: "people",
        domain: question.domain,
        status: "completed",
        score: wasCorrect ? 1 : 0,
        total: 1,
        errors: wasCorrect ? 0 : 1,
        level: null,
        newLevel: null,
        durationMs: now - startedRef.current,
        itemIds: [question.id],
        sessionId,
      });

      if (wasCorrect) {
        advance();
        return;
      }

      // Errorless. The right answer lifts, the patient's pick is left exactly
      // as it was, and we move on. Nothing marks the miss.
      if (!liveRef.current) return;
      setCorrecting(true);
      timerRef.current = setTimeout(advance, CORRECTION_MS);
    },
    [advance, correcting, question, sessionId]
  );

  if (!question) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6">
        {/* Always this, whatever happened. No score, ever. */}
        <p className="text-4xl font-medium text-neutral-800 text-center">
          {t("well_done_today")}
        </p>
        <button
          type="button"
          onClick={onExit}
          className="mt-8 px-10 py-5 rounded-2xl bg-primary-600 text-white text-2xl font-medium"
        >
          {t("next")}
        </button>
      </div>
    );
  }

  const prompt = question.promptName
    ? t(question.promptKey, question.promptName)
    : t(question.promptKey);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="flex justify-end px-5 pt-5">
        {/* The way out. Always visible, never treated as failure. No progress
            counter: "3 of 6" is pressure, and pressure is what this removes. */}
        <button
          type="button"
          onClick={onExit}
          className="px-6 py-3 rounded-xl border-2 border-neutral-400 text-neutral-700 text-xl"
        >
          {t("stop")}
        </button>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-10">
        <PersonPhoto person={question} size={180} rounded={false} className="mb-6" />

        <h1 className="text-3xl md:text-4xl font-medium text-neutral-800 text-center mb-8 max-w-2xl">
          {prompt}
        </h1>

        <div className="flex flex-col gap-4 w-full max-w-md">
          {question.options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => answer(option)}
              className={`px-8 py-6 rounded-2xl border-2 text-2xl font-medium transition-transform ${
                correcting && option === question.correct
                  ? "border-primary-500 bg-teal-50 text-neutral-900 scale-105"
                  : "border-neutral-300 bg-white text-neutral-800"
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        {correcting && (
          <p className="mt-6 text-xl text-neutral-600 text-center">
            {t("lets_look_together")}
          </p>
        )}
      </main>
    </div>
  );
}
