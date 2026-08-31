// Six renderers, one per item template.
//
// Rules every renderer follows:
//   * tap only -- no drag, no swipe, no pinch. Tremor is common.
//   * big targets, big text, high contrast, no thin fonts.
//   * one thing on screen at a time.
//   * clear persistent green border on right option with Next button.
//   * gentle retry option on mistake so the patient can try again.

import { useEffect, useRef, useState } from "react";

import { useSpeak } from "../../lib/i18n";

function Prompt({ children }) {
  return (
    <h1 className="text-3xl md:text-4xl font-medium text-neutral-800 text-center mb-8 max-w-2xl">
      {children}
    </h1>
  );
}

function QuestionFeedback({ status, onNext, onRetry, t }) {
  if (status === "correct") {
    return (
      <div className="mt-8 flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={onNext}
          className="px-10 py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-2xl font-medium shadow-lg transition-all flex items-center gap-3 cursor-pointer"
        >
          <span>{t("next")}</span>
          <span className="text-2xl font-bold leading-none">→</span>
        </button>
      </div>
    );
  }
  if (status === "wrong") {
    return (
      <div className="mt-8 flex flex-col items-center gap-3">
        <p className="text-xl text-neutral-600 font-medium">
          {t("lets_look_together")}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="px-8 py-3.5 rounded-2xl bg-amber-500 hover:bg-amber-600 active:scale-95 text-white text-xl font-medium shadow-md transition-all flex items-center gap-2.5 cursor-pointer"
        >
          <span className="text-xl font-bold">↻</span>
          <span>{t("retry")}</span>
        </button>
      </div>
    );
  }
  return null;
}

/** A large tappable word. */
function WordButton({ label, onClick, selectedState, lift, disabled }) {
  let borderClasses = "border-2 border-neutral-300 bg-white text-neutral-800 hover:border-neutral-400";
  if (selectedState === "correct" || lift) {
    borderClasses = "border-4 border-emerald-500 bg-emerald-50 text-emerald-950 scale-105 shadow-md ring-4 ring-emerald-200/60 font-semibold";
  } else if (selectedState === "wrong") {
    borderClasses = "border-4 border-amber-500 bg-amber-50 text-amber-950 scale-100 ring-4 ring-amber-200/50";
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-8 py-6 rounded-2xl text-2xl font-medium transition-all duration-200 cursor-pointer ${borderClasses}`}
    >
      {label}
    </button>
  );
}

function PictureButton({ src, label, onClick, selectedState, lift, disabled }) {
  let borderClasses = "border-2 border-neutral-300 bg-white hover:border-neutral-400";
  if (selectedState === "correct" || lift) {
    borderClasses = "border-4 border-emerald-500 bg-emerald-50 scale-105 shadow-md ring-4 ring-emerald-200/60 font-semibold";
  } else if (selectedState === "wrong") {
    borderClasses = "border-4 border-amber-500 bg-amber-50 ring-4 ring-amber-200/50";
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`p-2 rounded-2xl transition-all duration-200 flex flex-col items-center cursor-pointer ${borderClasses}`}
    >
      <img
        src={src}
        alt=""
        className="w-36 h-36 md:w-44 md:h-44 object-cover rounded-xl"
      />
      <span className="block mt-2 text-xl text-neutral-800 font-medium">{label}</span>
    </button>
  );
}

const objectLabel = (t, key) => t(`obj_${key}`);
const emotionLabel = (t, key) => t(`emotion_${key}`);
const shapeLabel = (t, key) => t(`shape_${key}`);

// ── memory: see pictures, gap, "which one did you see?" ─────────────────────

function WhichDidYouSee({ item, t, correcting, onAnswer }) {
  const [stage, setStage] = useState("show");
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState(null);
  const firstAttemptCorrectRef = useRef(true);
  const say = useSpeak();

  useEffect(() => {
    setStage("show");
    setSelected(null);
    setStatus(null);
    firstAttemptCorrectRef.current = true;
    say(t("remember_these"), `${item.id}-show`);
    const a = setTimeout(() => setStage("gap"), item.show.durationMs);
    const b = setTimeout(
      () => {
        setStage("ask");
        say(t("ask_which_did_you_see"), `${item.id}-ask`);
      },
      item.show.durationMs + item.gap.durationMs
    );
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const handleSelect = (key) => {
    if (status === "correct") return;
    const isRight = key === item.ask.correct;
    setSelected(key);
    if (isRight) {
      setStatus("correct");
      say(t("thats_it"), `${item.id}-correct`);
    } else {
      setStatus("wrong");
      firstAttemptCorrectRef.current = false;
      say(t("lets_look_together"), `${item.id}-retry`);
    }
  };

  const handleRetry = () => {
    setSelected(null);
    setStatus(null);
  };

  const handleNext = () => {
    onAnswer(firstAttemptCorrectRef.current);
  };

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
    return <div className="w-24 h-24 rounded-full bg-neutral-200" />;
  }

  return (
    <>
      <Prompt>{t("ask_which_did_you_see")}</Prompt>
      <div className="flex flex-wrap gap-5 justify-center">
        {item.ask.options.map((key) => {
          const isSelected = selected === key;
          const selectedState = isSelected ? status : null;
          return (
            <PictureButton
              key={key}
              src={`/items/objects/${key}.jpg`}
              label={objectLabel(t, key)}
              selectedState={selectedState}
              lift={correcting && key === item.ask.correct}
              disabled={status === "correct"}
              onClick={() => handleSelect(key)}
            />
          );
        })}
      </div>
      <QuestionFeedback
        status={status}
        onNext={handleNext}
        onRetry={handleRetry}
        t={t}
      />
    </>
  );
}

// ── language: "what is this called?" ────────────────────────────────────────

function WhatIsThis({ item, t, correcting, onAnswer }) {
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState(null);
  const firstAttemptCorrectRef = useRef(true);
  const say = useSpeak();

  useEffect(() => {
    setSelected(null);
    setStatus(null);
    firstAttemptCorrectRef.current = true;
    say(t("ask_what_is_this"), item.id);
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = (key) => {
    if (status === "correct") return;
    const isRight = key === item.correct;
    setSelected(key);
    if (isRight) {
      setStatus("correct");
      say(t("thats_it"), `${item.id}-correct`);
    } else {
      setStatus("wrong");
      firstAttemptCorrectRef.current = false;
      say(t("lets_look_together"), `${item.id}-retry`);
    }
  };

  const handleRetry = () => {
    setSelected(null);
    setStatus(null);
  };

  const handleNext = () => {
    onAnswer(firstAttemptCorrectRef.current);
  };

  return (
    <>
      <Prompt>{t("ask_what_is_this")}</Prompt>
      <img
        src={item.imageUrl}
        alt=""
        className="w-64 h-64 object-cover rounded-2xl border-2 border-neutral-300 mb-4"
      />
      {item.cue && (
        <p className="text-2xl text-neutral-500 mb-6">
          {item.cueLevel === "full"
            ? objectLabel(t, item.subject)
            : `${objectLabel(t, item.subject).slice(0, 1)}…`}
        </p>
      )}
      <div className="flex flex-wrap gap-4 justify-center max-w-3xl">
        {item.options.map((key) => {
          const isSelected = selected === key;
          const selectedState = isSelected ? status : null;
          return (
            <WordButton
              key={key}
              label={objectLabel(t, key)}
              selectedState={selectedState}
              lift={correcting && key === item.correct}
              disabled={status === "correct"}
              onClick={() => handleSelect(key)}
            />
          );
        })}
      </div>
      <QuestionFeedback
        status={status}
        onNext={handleNext}
        onRetry={handleRetry}
        t={t}
      />
    </>
  );
}

// ── social: ONE face, emotion WORDS as options ──────────────────────────────

function HowAreTheyFeeling({ item, t, correcting, onAnswer }) {
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState(null);
  const firstAttemptCorrectRef = useRef(true);
  const pronoun = t(item.person === "man" ? "he" : "she");
  const say = useSpeak();

  useEffect(() => {
    setSelected(null);
    setStatus(null);
    firstAttemptCorrectRef.current = true;
    say(t("ask_how_feeling", pronoun), item.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const handleSelect = (key) => {
    if (status === "correct") return;
    const isRight = key === item.correct;
    setSelected(key);
    if (isRight) {
      setStatus("correct");
      say(t("thats_it"), `${item.id}-correct`);
    } else {
      setStatus("wrong");
      firstAttemptCorrectRef.current = false;
      say(t("lets_look_together"), `${item.id}-retry`);
    }
  };

  const handleRetry = () => {
    setSelected(null);
    setStatus(null);
  };

  const handleNext = () => {
    onAnswer(firstAttemptCorrectRef.current);
  };

  return (
    <>
      <Prompt>{t("ask_how_feeling", pronoun)}</Prompt>
      <img
        src={item.imageUrl}
        alt=""
        className="w-72 h-72 object-cover rounded-2xl border-2 border-neutral-300 mb-8"
      />
      <div className="flex flex-wrap gap-4 justify-center max-w-3xl">
        {item.options.map((key) => {
          const isSelected = selected === key;
          const selectedState = isSelected ? status : null;
          return (
            <WordButton
              key={key}
              label={emotionLabel(t, key)}
              selectedState={selectedState}
              lift={correcting && key === item.correct}
              disabled={status === "correct"}
              onClick={() => handleSelect(key)}
            />
          );
        })}
      </div>
      <QuestionFeedback
        status={status}
        onNext={handleNext}
        onRetry={handleRetry}
        t={t}
      />
    </>
  );
}

// ── executive: put the routine in order ─────────────────────────────────────

function PutInOrder({ item, t, correcting, onAnswer }) {
  const say = useSpeak();
  const [placed, setPlaced] = useState([]);
  const [hint, setHint] = useState(false);
  const [wrongStep, setWrongStep] = useState(null);
  const tapsRef = useRef(0);
  const firstAttemptCorrectRef = useRef(true);

  useEffect(() => {
    setPlaced(item.correctOrder.slice(0, item.prePlaced));
    setWrongStep(null);
    tapsRef.current = 0;
    firstAttemptCorrectRef.current = true;
    say(t("ask_put_in_order"), item.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const nextStep = item.correctOrder[placed.length];
  const isComplete = placed.length === item.correctOrder.length;

  useEffect(() => {
    if (item.hintAfterMs === null || item.hintAfterMs === undefined) return undefined;
    if (placed.length >= item.correctOrder.length) return undefined;
    const timer = setTimeout(() => setHint(true), item.hintAfterMs);
    return () => clearTimeout(timer);
  }, [item.id, item.hintAfterMs, item.correctOrder.length, placed.length]);

  const tap = (step) => {
    if (isComplete) return;
    tapsRef.current += 1;

    if (step !== nextStep) {
      setWrongStep(step);
      firstAttemptCorrectRef.current = false;
      setHint(true);
      say(t("lets_look_together"), `${item.id}-retry`);
      return;
    }

    setWrongStep(null);
    const next = [...placed, step];
    setPlaced(next);
    setHint(false);

    if (next.length === item.correctOrder.length) {
      say(t("thats_it"), `${item.id}-complete`);
    }
  };

  const handleRetry = () => {
    setWrongStep(null);
  };

  const handleNext = () => {
    const perfect = tapsRef.current <= item.correctOrder.length - item.prePlaced;
    onAnswer(perfect && firstAttemptCorrectRef.current);
  };

  const remaining = item.display.filter((s) => !placed.includes(s));

  return (
    <>
      <Prompt>{t("ask_put_in_order")}</Prompt>
      {placed.length > 0 && (
        <ol className="mb-6 space-y-2 text-center w-full max-w-xl">
          {placed.map((s) => (
            <li
              key={s}
              className="px-6 py-4 rounded-xl border-2 border-emerald-500 bg-emerald-50/80 text-emerald-950 text-2xl font-medium shadow-sm flex items-center justify-between"
            >
              <span>{s}</span>
              <span className="text-emerald-600 font-bold">✓</span>
            </li>
          ))}
        </ol>
      )}
      {!isComplete && (
        <div className="flex flex-col gap-4 w-full max-w-xl">
          {remaining.map((step) => {
            const isWrong = wrongStep === step;
            let borderClasses = "border-2 border-neutral-300 bg-white hover:border-neutral-400";
            if (isWrong) {
              borderClasses = "border-4 border-amber-500 bg-amber-50 ring-4 ring-amber-200/50";
            } else if ((hint || correcting) && step === nextStep) {
              borderClasses = "border-primary-500 bg-teal-50 scale-105";
            }

            return (
              <button
                key={step}
                type="button"
                onClick={() => tap(step)}
                className={`px-8 py-6 rounded-2xl text-2xl text-left transition-all duration-200 cursor-pointer ${borderClasses}`}
              >
                {step}
              </button>
            );
          })}
        </div>
      )}
      {wrongStep && (
        <div className="mt-6 flex flex-col items-center gap-3">
          <p className="text-xl text-neutral-600 font-medium">
            {t("lets_look_together")}
          </p>
          <button
            type="button"
            onClick={handleRetry}
            className="px-8 py-3.5 rounded-2xl bg-amber-500 hover:bg-amber-600 active:scale-95 text-white text-xl font-medium shadow-md transition-all flex items-center gap-2.5 cursor-pointer"
          >
            <span className="text-xl font-bold">↻</span>
            <span>{t("retry")}</span>
          </button>
        </div>
      )}
      {isComplete && (
        <div className="mt-8 flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={handleNext}
            className="px-10 py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-2xl font-medium shadow-lg transition-all flex items-center gap-3 cursor-pointer"
          >
            <span>{t("next")}</span>
            <span className="text-2xl font-bold leading-none">→</span>
          </button>
        </div>
      )}
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
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState(null);
  const firstAttemptCorrectRef = useRef(true);
  const say = useSpeak();

  useEffect(() => {
    setSelected(null);
    setStatus(null);
    firstAttemptCorrectRef.current = true;
    say(t("ask_match_shape"), item.id);
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = (name) => {
    if (status === "correct") return;
    const isRight = name === item.correct;
    setSelected(name);
    if (isRight) {
      setStatus("correct");
      say(t("thats_it"), `${item.id}-correct`);
    } else {
      setStatus("wrong");
      firstAttemptCorrectRef.current = false;
      say(t("lets_look_together"), `${item.id}-retry`);
    }
  };

  const handleRetry = () => {
    setSelected(null);
    setStatus(null);
  };

  const handleNext = () => {
    onAnswer(firstAttemptCorrectRef.current);
  };

  return (
    <>
      <Prompt>{t("ask_match_shape")}</Prompt>
      <div className="mb-8 p-4 rounded-2xl border-2 border-neutral-400 bg-white">
        <ShapeGlyph name={item.target} size={110} />
      </div>
      <div className="flex flex-wrap gap-5 justify-center max-w-3xl">
        {item.options.map((name) => {
          const isSelected = selected === name;
          let borderClasses = "border-2 border-neutral-300 bg-white hover:border-neutral-400";
          if ((isSelected && status === "correct") || (correcting && name === item.correct)) {
            borderClasses = "border-4 border-emerald-500 bg-emerald-50 scale-105 shadow-md ring-4 ring-emerald-200/60 font-semibold";
          } else if (isSelected && status === "wrong") {
            borderClasses = "border-4 border-amber-500 bg-amber-50 ring-4 ring-amber-200/50";
          }

          return (
            <button
              key={name}
              type="button"
              onClick={() => handleSelect(name)}
              disabled={status === "correct"}
              className={`p-4 rounded-2xl transition-all duration-200 flex flex-col items-center cursor-pointer ${borderClasses}`}
            >
              <ShapeGlyph name={name} size={88} rotation={item.rotationDeg} />
              <span className="block mt-1 text-lg text-neutral-700 font-medium">
                {shapeLabel(t, name)}
              </span>
            </button>
          );
        })}
      </div>
      <QuestionFeedback
        status={status}
        onNext={handleNext}
        onRetry={handleRetry}
        t={t}
      />
    </>
  );
}

// ── attention: go / no-go ───────────────────────────────────────────────────
//
// Visual only, no voice: a spoken cue would measure hearing as well as
// attention. Tap green, leave red. That measures sustained attention AND
// response inhibition, which reaction time alone does not.

// How long the tap acknowledgement shows before the next stimulus. Short
// enough to keep the task brisk, long enough to be seen.
const GONOGO_ACK_MS = 180;

function GoNoGo({ item, t, onAnswer }) {
  const say = useSpeak();
  const [step, setStep] = useState(0);
  const [ack, setAck] = useState(false);
  const [completed, setCompleted] = useState(false);
  const hitsRef = useRef({ correct: 0, total: 0 });
  const respondedRef = useRef(false);
  const doneRef = useRef(false);
  // This step's advance, so a tap can end the trial the same way the window
  // does. Replaced whenever the step changes; each one refuses to run twice.
  const advanceRef = useRef(() => {});
  const ackTimerRef = useRef(null);

  const startTrial = () => {
    hitsRef.current = { correct: 0, total: 0 };
    doneRef.current = false;
    setStep(0);
    setAck(false);
    setCompleted(false);
    say(t(item.promptKey), item.id);
  };

  useEffect(() => {
    startTrial();
    return () => clearTimeout(ackTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  useEffect(() => {
    if (doneRef.current || step >= item.order.length) return undefined;
    respondedRef.current = false;

    // One advance per step, whoever calls it first -- the response or the
    // window running out. A stale call from a tap whose acknowledgement
    // outlived its step is a no-op rather than a skipped stimulus.
    let advanced = false;
    const advance = () => {
      if (advanced || doneRef.current) return;
      advanced = true;
      if (step + 1 >= item.order.length) {
        doneRef.current = true;
        setCompleted(true);
      } else {
        setStep(step + 1);
      }
    };
    advanceRef.current = advance;

    const timer = setTimeout(() => {
      // No response inside the window. Correct for a red, a miss for a green.
      if (!respondedRef.current) {
        hitsRef.current.total += 1;
        if (item.order[step] === "nogo") hitsRef.current.correct += 1;
      }
      advance();
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

    // A RESPONSE ENDS THE TRIAL, and it does so identically for green and
    // red. Both halves of that matter.
    const advance = advanceRef.current;
    setAck(true);
    clearTimeout(ackTimerRef.current);
    ackTimerRef.current = setTimeout(() => {
      setAck(false);
      advance();
    }, GONOGO_ACK_MS);
  };

  const handleNext = () => {
    const { correct, total } = hitsRef.current;
    onAnswer(total > 0 && correct / total >= 0.6);
  };

  if (completed) {
    return (
      <div className="flex flex-col items-center gap-6 animate-fade-in max-w-lg text-center">
        <Prompt>{t(item.promptKey)}</Prompt>
        <div className="p-8 rounded-3xl border-4 border-emerald-500 bg-emerald-50 text-emerald-950 shadow-md ring-4 ring-emerald-200/60 flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-emerald-500 text-white flex items-center justify-center text-3xl font-bold">
            ✓
          </div>
          <p className="text-2xl font-medium">{t("thats_it")}</p>
        </div>
        <button
          type="button"
          onClick={handleNext}
          className="px-10 py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-2xl font-medium shadow-lg transition-all flex items-center gap-3 cursor-pointer"
        >
          <span>{t("next")}</span>
          <span className="text-2xl font-bold leading-none">→</span>
        </button>
      </div>
    );
  }

  return (
    <>
      <Prompt>{t(item.promptKey)}</Prompt>
      <button
        type="button"
        onClick={tap}
        aria-label={kind}
        data-ack={ack ? "true" : "false"}
        style={{ width: size, height: size }}
        className={`rounded-full transition-all duration-150 ease-out ${
          kind === "go" ? "bg-emerald-500" : "bg-red-500"
        } ${ack ? "scale-75 opacity-30" : "scale-100 opacity-100"}`}
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
