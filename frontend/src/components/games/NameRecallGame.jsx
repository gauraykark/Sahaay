import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "@phosphor-icons/react";
import { getDifficulty, logGameSession, listVaultPeople } from "../../lib/db";
import {
  dealNameRecallQuestions,
  NAME_RECALL_CIRCLES,
  NAME_RECALL_MIN_LEVEL,
  NAME_RECALL_MAX_LEVEL,
} from "../../lib/gameContent";
import { resolveNextLevel } from "../../lib/difficulty";
import { speak } from "../../lib/utils";
import { useAuth } from "../../lib/auth";
import { langToLocale } from "../../lib/i18n";
import { SourceBadge } from "../ui/Badge";

const GAME_TYPE = "name-recall";
const DEFAULT_LEVEL = 1;

export default function NameRecallGame() {
  const { user } = useAuth();
  const locale = langToLocale(user?.preferred_language || "en");

  const [level, setLevel] = useState(DEFAULT_LEVEL);
  const [questions, setQuestions] = useState(() => dealNameRecallQuestions(DEFAULT_LEVEL));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [selected, setSelected] = useState(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [nextHint, setNextHint] = useState("");
  const [nextSource, setNextSource] = useState(null);
  const startedAt = useRef(Date.now());

  const current = questions[currentIndex];
  const circleTitle =
    NAME_RECALL_CIRCLES.find((c) => c.level === level)?.title || "Names";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [saved, people] = await Promise.all([
        getDifficulty(GAME_TYPE, DEFAULT_LEVEL),
        listVaultPeople(),
      ]);
      if (cancelled) return;
      const clamped = Math.max(
        NAME_RECALL_MIN_LEVEL,
        Math.min(NAME_RECALL_MAX_LEVEL, saved)
      );
      setLevel(clamped);
      setQuestions(dealNameRecallQuestions(clamped, people));
      startedAt.current = Date.now();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const finishRound = async (finalScore, total) => {
    const durationMs = Date.now() - startedAt.current;
    const errors = total - finalScore;
    const { newLevel, reason, source } = await resolveNextLevel({
      gameType: GAME_TYPE,
      currentLevel: level,
      stats: {
        completed: true,
        score: finalScore,
        total,
        errors,
        durationMs,
      },
    });
    await logGameSession({
      gameType: GAME_TYPE,
      completed: true,
      score: finalScore,
      total,
      errors,
      level,
      newLevel,
      durationMs,
      reason,
    });
    setNextHint(reason);
    setNextSource(source);
    speak(reason, { lang: locale });
    setIsFinished(true);
  };

  const handleAnswer = (option) => {
    if (isAnswered || !current) return;

    setSelected(option);
    setIsAnswered(true);

    const isCorrect = option === current.correct;
    const finalScore = score + (isCorrect ? 1 : 0);
    if (isCorrect) setScore(finalScore);

    setTimeout(() => {
      if (currentIndex + 1 < questions.length) {
        setCurrentIndex((prev) => prev + 1);
        setSelected(null);
        setIsAnswered(false);
      } else {
        finishRound(finalScore, questions.length);
      }
    }, 900);
  };

  const handleRestart = async () => {
    const [saved, people] = await Promise.all([
      getDifficulty(GAME_TYPE, DEFAULT_LEVEL),
      listVaultPeople(),
    ]);
    const clamped = Math.max(
      NAME_RECALL_MIN_LEVEL,
      Math.min(NAME_RECALL_MAX_LEVEL, saved)
    );
    setLevel(clamped);
    setQuestions(dealNameRecallQuestions(clamped, people));
    setCurrentIndex(0);
    setScore(0);
    setSelected(null);
    setIsAnswered(false);
    setIsFinished(false);
    setNextHint("");
    setNextSource(null);
    startedAt.current = Date.now();
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
          Name Recall
        </h1>
        <div className="w-10" />
      </header>

      <main className="flex-1 px-5 pb-8 flex flex-col items-center">
        {!isFinished ? (
          <>
            <p className="text-sm text-neutral-500 mb-2">
              Level {level} · {circleTitle}
            </p>
            <p className="text-sm text-neutral-500 mb-8">
              {currentIndex + 1} of {questions.length}
            </p>

            <div className="w-full max-w-sm bg-white border border-neutral-200 rounded-xl px-6 py-8 mb-10 text-center">
              <p className="text-neutral-500 text-sm mb-2">Who is this?</p>
              <p className="text-lg text-neutral-800 leading-relaxed">
                {current?.label}
              </p>
            </div>

            <div className="w-full max-w-sm space-y-3">
              {(current?.options || []).map((option) => {
                let styles =
                  "w-full text-left px-5 py-4 rounded-lg border text-base transition-all ";

                if (!isAnswered) {
                  styles +=
                    "bg-white border-neutral-200 hover:border-primary-300 text-neutral-800";
                } else if (option === current.correct) {
                  styles +=
                    "bg-primary-50 border-primary-300 text-primary-800";
                } else if (option === selected) {
                  styles +=
                    "bg-neutral-100 border-neutral-200 text-neutral-500";
                } else {
                  styles += "bg-white border-neutral-200 text-neutral-400";
                }

                return (
                  <button
                    key={option}
                    onClick={() => handleAnswer(option)}
                    disabled={isAnswered}
                    className={styles}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <p className="text-lg font-medium text-neutral-800 mb-1">
              Round complete
            </p>
            <p className="text-neutral-600 mb-2">
              You got {score} out of {questions.length} correct
            </p>
            <p className="text-sm text-neutral-500 mb-3">
              {nextHint || "Difficulty will adjust for next round"}
            </p>
            {nextSource && (
              <div className="flex justify-center mb-8">
                <SourceBadge source={nextSource} />
              </div>
            )}
            <button
              onClick={handleRestart}
              className="bg-primary-600 hover:bg-primary-700 text-white px-6 py-2.5 rounded-lg text-base font-medium transition-colors"
            >
              Play again
            </button>
          </div>
        )}
      </main>
    </div>
  );
}