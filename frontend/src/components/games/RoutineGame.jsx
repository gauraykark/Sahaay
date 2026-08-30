import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "@phosphor-icons/react";
import { getDifficulty, logGameSession } from "../../lib/db";
import {
  getRoutineForLevel,
  ROUTINE_MIN_LEVEL,
  ROUTINE_MAX_LEVEL,
} from "../../lib/gameContent";
import { resolveNextLevel } from "../../lib/difficulty";
import { speak } from "../../lib/utils";
import { useAuth } from "../../lib/auth";
import { langToLocale } from "../../lib/i18n";
import { SourceBadge } from "../ui/Badge";

const GAME_TYPE = "routine";
const DEFAULT_LEVEL = 1;

function deal(level) {
  return getRoutineForLevel(level);
}

export default function RoutineGame() {
  const { user } = useAuth();
  const locale = langToLocale(user?.preferred_language || "en");

  const [level, setLevel] = useState(DEFAULT_LEVEL);
  const [routine, setRoutine] = useState(() => deal(DEFAULT_LEVEL));
  const [selected, setSelected] = useState([]);
  const [isComplete, setIsComplete] = useState(false);
  const [isWrong, setIsWrong] = useState(false);
  const [errors, setErrors] = useState(0);
  const [nextHint, setNextHint] = useState("");
  const [nextSource, setNextSource] = useState(null);
  const startedAt = useRef(Date.now());
  const hasLogged = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getDifficulty(GAME_TYPE, DEFAULT_LEVEL).then((saved) => {
      if (cancelled) return;
      const clamped = Math.max(ROUTINE_MIN_LEVEL, Math.min(ROUTINE_MAX_LEVEL, saved));
      setLevel(clamped);
      setRoutine(deal(clamped));
      startedAt.current = Date.now();
      hasLogged.current = false;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = (item) => {
    if (isComplete || selected.find((s) => s.id === item.id)) return;

    const newSelected = [...selected, item];
    setSelected(newSelected);
    setIsWrong(false);

    const isCorrectSoFar = newSelected.every(
      (selectedItem, index) => selectedItem.order === index + 1
    );

    if (!isCorrectSoFar) {
      setIsWrong(true);
      setErrors((prev) => prev + 1);
      setTimeout(() => {
        setSelected([]);
        setIsWrong(false);
      }, 800);
      return;
    }

    if (newSelected.length === routine.stepCount && !hasLogged.current) {
      hasLogged.current = true;
      setIsComplete(true);
      const durationMs = Date.now() - startedAt.current;
      const currentErrors = errors;
      (async () => {
        const { newLevel, reason, source } = await resolveNextLevel({
          gameType: GAME_TYPE,
          currentLevel: level,
          stats: {
            completed: true,
            errors: currentErrors,
            total: routine.stepCount,
            durationMs,
            score: routine.stepCount,
          },
        });
        await logGameSession({
          gameType: GAME_TYPE,
          completed: true,
          score: routine.stepCount,
          total: routine.stepCount,
          errors: currentErrors,
          level,
          newLevel,
          durationMs,
          reason,
        });
        setNextHint(reason);
        setNextSource(source);
        speak(reason, { lang: locale });
      })();
    }
  };

  const handleRestart = async () => {
    const saved = await getDifficulty(GAME_TYPE, DEFAULT_LEVEL);
    const clamped = Math.max(ROUTINE_MIN_LEVEL, Math.min(ROUTINE_MAX_LEVEL, saved));
    setLevel(clamped);
    setRoutine(deal(clamped));
    setSelected([]);
    setIsComplete(false);
    setIsWrong(false);
    setErrors(0);
    setNextHint("");
    setNextSource(null);
    startedAt.current = Date.now();
    hasLogged.current = false;
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-5 pt-5 pb-4 flex items-center justify-between">
        <Link
          to="/patient"
          className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-700"
        >
          <ArrowLeft size={18} weight="regular" />
          Back
        </Link>
        <h1 className="text-lg font-medium text-neutral-800">
          Daily Routine
        </h1>
        <div className="w-10" />
      </header>

      <main className="flex-1 px-5 pb-8 flex flex-col">
        <p className="text-center text-neutral-800 font-medium mb-1">
          {routine.title}
        </p>
        <p className="text-neutral-600 mb-2 text-center">
          {routine.hint}. Tap the steps in order.
        </p>
        <p className="text-sm text-neutral-500 mb-6 text-center">
          Level {level} · {routine.stepCount} steps
        </p>

        <div className="mb-6">
          <p className="text-sm text-neutral-500 mb-3">Your order</p>
          <div className="min-h-[52px] flex flex-wrap gap-2">
            {selected.length === 0 && (
              <p className="text-neutral-400 text-sm">Tap a step below to begin</p>
            )}
            {selected.map((item, index) => (
              <div
                key={item.id}
                className="bg-primary-50 border border-primary-200 text-primary-800 px-3 py-1.5 rounded-lg text-sm"
              >
                {index + 1}. {item.label}
              </div>
            ))}
          </div>
        </div>

        <p className="text-sm text-neutral-500 mb-3">To-do row</p>
        <div
          className={`flex flex-wrap gap-2 ${isWrong ? "opacity-60" : ""}`}
        >
          {routine.items.map((item) => {
            const isSelected = selected.find((s) => s.id === item.id);
            return (
              <button
                key={item.id}
                onClick={() => handleSelect(item)}
                disabled={isSelected || isComplete}
                className={`
                  px-4 py-3 rounded-lg border text-base
                  transition-all duration-150
                  ${
                    isSelected
                      ? "bg-neutral-100 border-neutral-200 text-neutral-400"
                      : "bg-white border-neutral-200 hover:border-primary-300 text-neutral-800"
                  }
                `}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {isComplete && (
          <div className="mt-10 text-center">
            <p className="text-lg font-medium text-neutral-800 mb-1">
              Correct order
            </p>
            <p className="text-neutral-600 mb-2">
              You remembered this routine well
            </p>
            <p className="text-sm text-neutral-500 mb-3">
              {nextHint || "Difficulty will adjust for next round"}
            </p>
            {nextSource && (
              <div className="flex justify-center mb-6">
                <SourceBadge source={nextSource} />
              </div>
            )}
            <button
              onClick={handleRestart}
              className="bg-primary-600 hover:bg-primary-700 text-white px-6 py-2.5 rounded-lg text-base font-medium transition-colors"
            >
              Try again
            </button>
          </div>
        )}
      </main>
    </div>
  );
}