// Six renderers, one per item template. Thin on purpose: GameShell owns the
// round, the logging, the abandon path and the errorless behaviour, so a
// renderer only draws the question and reports whether a tap was correct.
//
// Rules every renderer follows, from the interface section of the spec:
//   * tap only -- no drag, no swipe, no pinch. Tremor is common.
//   * big targets, big text, high contrast, no thin fonts.
//   * one thing on screen at a time.
//   * nothing that reads as failure: no red, no X, no counter, no score.
//   * `correcting` means "show the right answer gently" -- never "you were
//     wrong". The correct option lifts; the patient's pick is left alone.

import { useEffect, useRef, useState } from "react";

import { langToLocale } from "../../lib/i18n";
import { speak } from "../../lib/utils";

// Ignore a second tap inside this window. Accidental double-taps are common
// and would otherwise answer the next question too.
const DEBOUNCE_MS = 600;

function useDebouncedAnswer(onAnswer) {
  const lastRef = useRef(0);
  return (correct) => {
    const now = Date.now();
    if (now - lastRef.current < DEBOUNCE_MS) return;
    lastRef.current = now;
    onAnswer(correct);
  };
}

function Prompt({ children }) {
  return (
    <h1 className="text-3xl md:text-4xl font-medium text-neutral-800 text-center mb-8 max-w-2xl">
      {children}
    </h1>
  );
}

/** A large tappable word. `lift` marks the correct one during a correction. */
function WordButton({ label, onClick, lift }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-8 py-6 rounded-2xl border-2 text-2xl font-medium transition-transform ${
        lift
          ? "border-primary-500 bg-teal-50 text-neutral-900 scale-105"
          : "border-neutral-300 bg-white text-neutral-800"
      }`}
    >
      {label}
    </button>
  );
}

function PictureButton({ src, label, onClick, lift }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`p-2 rounded-2xl border-2 transition-transform ${
        lift ? "border-primary-500 bg-teal-50 scale-105" : "border-neutral-300 bg-white"
      }`}
    >
      <img
        src={src}
        alt=""
        className="w-36 h-36 md:w-44 md:h-44 object-cover rounded-xl"
      />
      <span className="block mt-2 text-xl text-neutral-800">{label}</span>
    </button>
  );
}

const objectLabel = (t, key) => t(`obj_${key}`);
const emotionLabel = (t, key) => t(`emotion_${key}`);
const shapeLabel = (t, key) => t(`shape_${key}`);

// ── memory: see pictures, gap, "which one did you see?" ─────────────────────

function WhichDidYouSee({ item, t, correcting, onAnswer }) {
  const [stage, setStage] = useState("show");
  const answer = useDebouncedAnswer(onAnswer);

  useEffect(() => {
    setStage("show");
    speak(t("remember_these"), langToLocale());
    const a = setTimeout(() => setStage("gap"), item.show.durationMs);
    const b = setTimeout(
      () => {
        setStage("ask");
        speak(t("ask_which_did_you_see"), langToLocale());
      },
      item.show.durationMs + item.gap.durationMs
    );
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [item, t]);

  if (stage === "show") {
    return (
      <>
        <Prompt>{t("remember_these")}</Prompt>
        <div className="flex flex-wrap gap-4 justify-center max-w-4xl">
          {item.show.urls.map((url, i) => (
            <img
              key={item.show.images[i]}
              src={url}
              alt=""
              className="w-40 h-40 object-cover rounded-2xl border-2 border-neutral-300"
            />
          ))}
        </div>
      </>
    );
  }

  if (stage === "gap") {
    // A blank, calm pause. Nothing to read, nothing counting down.
    return <div className="w-24 h-24 rounded-full bg-neutral-200" />;
  }

  return (
    <>
      <Prompt>{t("ask_which_did_you_see")}</Prompt>
      <div className="flex flex-wrap gap-5 justify-center">
        {item.ask.options.map((key) => (
          <PictureButton
            key={key}
            src={`/items/objects/${key}.jpg`}
            label={objectLabel(t, key)}
            lift={correcting && key === item.ask.correct}
            onClick={() => answer(key === item.ask.correct)}
          />
        ))}
      </div>
    </>
  );
}

// ── language: "what is this called?" ────────────────────────────────────────

function WhatIsThis({ item, t, correcting, onAnswer }) {
  const answer = useDebouncedAnswer(onAnswer);
  useEffect(() => {
    speak(t("ask_what_is_this"), langToLocale());
  }, [item, t]);

  return (
    <>
      <Prompt>{t("ask_what_is_this")}</Prompt>
      <img
        src={item.imageUrl}
        alt=""
        className="w-64 h-64 object-cover rounded-2xl border-2 border-neutral-300 mb-4"
      />
      {/* The cue is help, not a hint that something went wrong. It is
          translated here rather than in the bank: the bank stores asset keys,
          the view decides what the patient reads. */}
      {item.cue && (
        <p className="text-2xl text-neutral-500 mb-6">
          {item.cueLevel === "full"
            ? objectLabel(t, item.subject)
            : `${objectLabel(t, item.subject).slice(0, 1)}…`}
        </p>
      )}
      <div className="flex flex-wrap gap-4 justify-center max-w-3xl">
        {item.options.map((key) => (
          <WordButton
            key={key}
            label={objectLabel(t, key)}
            lift={correcting && key === item.correct}
            onClick={() => answer(key === item.correct)}
          />
        ))}
      </div>
    </>
  );
}

// ── social: ONE face, emotion WORDS as options ──────────────────────────────
//
// The options are words, never faces. That is what keeps actor identity out of
// the task -- the patient never compares two people, so the different actors
// across the asset set cannot be used to answer anything. Do not change this
// to show several faces at once.

function HowAreTheyFeeling({ item, t, correcting, onAnswer }) {
  const answer = useDebouncedAnswer(onAnswer);
  const pronoun = t(item.person === "man" ? "he" : "she");

  useEffect(() => {
    speak(t("ask_how_feeling", pronoun), langToLocale());
  }, [item, t, pronoun]);

  return (
    <>
      <Prompt>{t("ask_how_feeling", pronoun)}</Prompt>
      <img
        src={item.imageUrl}
        alt=""
        className="w-72 h-72 object-cover rounded-2xl border-2 border-neutral-300 mb-8"
      />
      <div className="flex flex-wrap gap-4 justify-center max-w-3xl">
        {item.options.map((key) => (
          <WordButton
            key={key}
            label={emotionLabel(t, key)}
            lift={correcting && key === item.correct}
            onClick={() => answer(key === item.correct)}
          />
        ))}
      </div>
    </>
  );
}

// ── executive: put the routine in order ─────────────────────────────────────
//
// RESCORED. The old Routine game wiped the whole sequence on a wrong tap --
// which was also the only reason errors were counted, so removing the
// punishment removed the measurement. Now a wrong tap does NOTHING: no reset,
// no dimming, no penalty. The next correct step lifts gently after a pause,
// and the score is taps-to-complete. Same signal, no punishment.

function PutInOrder({ item, t, correcting, onAnswer }) {
  const [placed, setPlaced] = useState([]);
  const [hint, setHint] = useState(false);
  const tapsRef = useRef(0);
  const reportedRef = useRef(false);

  useEffect(() => {
    setPlaced(item.correctOrder.slice(0, item.prePlaced));
    tapsRef.current = 0;
    reportedRef.current = false;
    speak(t("ask_put_in_order"), langToLocale());
  }, [item, t]);

  const nextStep = item.correctOrder[placed.length];

  const tap = (step) => {
    if (reportedRef.current) return;
    tapsRef.current += 1;

    if (step !== nextStep) {
      // Wrong tap does nothing at all. After a moment the right one lifts.
      setHint(true);
      setTimeout(() => setHint(false), 1600);
      return;
    }

    const next = [...placed, step];
    setPlaced(next);
    if (next.length === item.correctOrder.length) {
      reportedRef.current = true;
      // Perfect run = exactly one tap per step. More taps means more help was
      // needed; that is the measurement, and the patient never sees it.
      const perfect = tapsRef.current <= item.correctOrder.length - item.prePlaced;
      onAnswer(perfect);
    }
  };

  const remaining = item.display.filter((s) => !placed.includes(s));

  return (
    <>
      <Prompt>{t("ask_put_in_order")}</Prompt>
      {placed.length > 0 && (
        <ol className="mb-6 text-2xl text-neutral-700 space-y-1 text-center">
          {placed.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      )}
      <div className="flex flex-col gap-4 w-full max-w-xl">
        {remaining.map((step) => (
          <button
            key={step}
            type="button"
            onClick={() => tap(step)}
            className={`px-8 py-6 rounded-2xl border-2 text-2xl text-left transition-transform ${
              (hint || correcting) && step === nextStep
                ? "border-primary-500 bg-teal-50 scale-105"
                : "border-neutral-300 bg-white"
            }`}
          >
            {step}
          </button>
        ))}
      </div>
    </>
  );
}

// ── perceptual-motor: match the shape ───────────────────────────────────────

const SHAPE_PATH = {
  circle: (s) => <circle cx={s / 2} cy={s / 2} r={s / 2 - 6} />,
  square: (s) => <rect x={6} y={6} width={s - 12} height={s - 12} rx={6} />,
  triangle: (s) => <polygon points={`${s / 2},6 ${s - 6},${s - 6} 6,${s - 6}`} />,
  diamond: (s) => <polygon points={`${s / 2},6 ${s - 6},${s / 2} ${s / 2},${s - 6} 6,${s / 2}`} />,
  hexagon: (s) => (
    <polygon points={`${s / 2},6 ${s - 8},${s * 0.3} ${s - 8},${s * 0.7} ${s / 2},${s - 6} 8,${s * 0.7} 8,${s * 0.3}`} />
  ),
  star: (s) => (
    <polygon points={`${s / 2},6 ${s * 0.62},${s * 0.38} ${s - 6},${s * 0.4} ${s * 0.7},${s * 0.62} ${s * 0.78},${s - 6} ${s / 2},${s * 0.76} ${s * 0.22},${s - 6} ${s * 0.3},${s * 0.62} 6,${s * 0.4} ${s * 0.38},${s * 0.38}`} />
  ),
};

function ShapeGlyph({ name, size, rotation = 0 }) {
  return (
    <svg width={size} height={size} style={{ transform: `rotate(${rotation}deg)` }}>
      <g fill="#2f968c" stroke="#1f625c" strokeWidth="3">
        {SHAPE_PATH[name]?.(size)}
      </g>
    </svg>
  );
}

function MatchTheShape({ item, t, correcting, onAnswer }) {
  const answer = useDebouncedAnswer(onAnswer);
  useEffect(() => {
    speak(t("ask_match_shape"), langToLocale());
  }, [item, t]);

  return (
    <>
      <Prompt>{t("ask_match_shape")}</Prompt>
      <div className="mb-8 p-4 rounded-2xl border-2 border-neutral-400 bg-white">
        <ShapeGlyph name={item.target} size={110} />
      </div>
      <div className="flex flex-wrap gap-5 justify-center max-w-3xl">
        {item.options.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => answer(name === item.correct)}
            className={`p-4 rounded-2xl border-2 transition-transform ${
              correcting && name === item.correct
                ? "border-primary-500 bg-teal-50 scale-105"
                : "border-neutral-300 bg-white"
            }`}
          >
            <ShapeGlyph name={name} size={88} rotation={item.rotationDeg} />
            <span className="block mt-1 text-lg text-neutral-700">
              {shapeLabel(t, name)}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

// ── attention: go / no-go ───────────────────────────────────────────────────
//
// Visual only, no voice: a spoken cue would measure hearing as well as
// attention. Tap green, leave red. That measures sustained attention AND
// response inhibition, which reaction time alone does not.

function GoNoGo({ item, t, onAnswer }) {
  const [step, setStep] = useState(0);
  const [flash, setFlash] = useState(false);
  const hitsRef = useRef({ correct: 0, total: 0 });
  const respondedRef = useRef(false);
  const doneRef = useRef(false);

  useEffect(() => {
    hitsRef.current = { correct: 0, total: 0 };
    doneRef.current = false;
    setStep(0);
    speak(t("ask_tap_green"), langToLocale());
  }, [item, t]);

  useEffect(() => {
    if (doneRef.current || step >= item.order.length) return;
    respondedRef.current = false;
    const timer = setTimeout(() => {
      // No response inside the window. Correct for a red, a miss for a green.
      if (!respondedRef.current) {
        hitsRef.current.total += 1;
        if (item.order[step] === "nogo") hitsRef.current.correct += 1;
      }
      if (step + 1 >= item.order.length) {
        doneRef.current = true;
        const { correct, total } = hitsRef.current;
        onAnswer(total > 0 && correct / total >= 0.6);
      } else {
        setStep(step + 1);
      }
    }, item.windowMs);
    return () => clearTimeout(timer);
  }, [step, item, onAnswer]);

  const kind = item.order[step];
  const size = { xl: 220, lg: 170, md: 130 }[item.targetSize] ?? 170;

  const tap = () => {
    if (respondedRef.current || doneRef.current) return;
    respondedRef.current = true;
    hitsRef.current.total += 1;
    if (kind === "go") hitsRef.current.correct += 1;
    // A warm flash either way. Tapping a red one is not shown as a mistake.
    setFlash(true);
    setTimeout(() => setFlash(false), 200);
  };

  return (
    <>
      <Prompt>{t("ask_tap_green")}</Prompt>
      <button
        type="button"
        onClick={tap}
        aria-label={kind}
        style={{ width: size, height: size }}
        className={`rounded-full transition-opacity ${
          kind === "go" ? "bg-emerald-500" : "bg-red-500"
        } ${flash ? "opacity-60" : "opacity-100"}`}
      />
    </>
  );
}

const RENDERERS = {
  "which-did-you-see": WhichDidYouSee,
  "what-is-this": WhatIsThis,
  "how-are-they-feeling": HowAreTheyFeeling,
  "put-in-order": PutInOrder,
  "match-the-shape": MatchTheShape,
  "go-no-go": GoNoGo,
};

export default RENDERERS;
