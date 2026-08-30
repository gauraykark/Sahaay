import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "@phosphor-icons/react";
import { getDifficulty, logGameSession } from "../../lib/db";
import {
  dealMemoryCards,
  memoryGridDims,
  memoryGridLabel,
  MEMORY_MIN_LEVEL,
  MEMORY_MAX_LEVEL,
} from "../../lib/gameContent";
import { resolveNextLevel } from "../../lib/difficulty";
import { speak } from "../../lib/utils";
import { useAuth } from "../../lib/auth";
import { langToLocale } from "../../lib/i18n";
import { SourceBadge } from "../ui/Badge";

const GAME_TYPE = "memory";
const DEFAULT_LEVEL = 1;

const GRID_COLS = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};

export default function MemoryGame() {
  const { user } = useAuth();
  const locale = langToLocale(user?.preferred_language || "en");

  const [level, setLevel] = useState(DEFAULT_LEVEL);
  const [cards, setCards] = useState(() => dealMemoryCards(DEFAULT_LEVEL));
  const [flippedCards, setFlippedCards] = useState([]);
  const [moves, setMoves] = useState(0);
  const [errors, setErrors] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [nextHint, setNextHint] = useState("");
  const [nextSource, setNextSource] = useState(null);
  const startedAt = useRef(Date.now());
  const hasLogged = useRef(false);

  const { cols } = memoryGridDims(level);

  useEffect(() => {
    let cancelled = false;

    getDifficulty(GAME_TYPE, DEFAULT_LEVEL).then((saved) => {
      if (cancelled) return;
      const clamped = Math.max(MEMORY_MIN_LEVEL, Math.min(MEMORY_MAX_LEVEL, saved));
      setLevel(clamped);
      setCards(dealMemoryCards(clamped));
      startedAt.current = Date.now();
      hasLogged.current = false;
      setIsReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isReady || isComplete || hasLogged.current) return;
    if (cards.length === 0 || !cards.every((card) => card.matched)) return;

    hasLogged.current = true;
    setIsComplete(true);

    const pairCount = Math.floor(cards.length / 2);
    const durationMs = Date.now() - startedAt.current;

    (async () => {
      const { newLevel, reason, source } = await resolveNextLevel({
        gameType: GAME_TYPE,
        currentLevel: level,
        stats: {
          completed: true,
          moves,
          idealMoves: pairCount,
          errors,
          durationMs,
          score: pairCount,
          total: pairCount,
        },
      });

      await logGameSession({
        gameType: GAME_TYPE,
        completed: true,
        moves,
        errors,
        level,
        newLevel,
        durationMs,
        reason,
        score: pairCount,
        total: pairCount,
      });

      setNextHint(reason);
      setNextSource(source);
      speak(reason, { lang: locale });
    })();
  }, [cards, moves, errors, level, isReady, isComplete]);

  const handleCardClick = (id) => {
    if (isLocked || isComplete) return;

    const clickedCard = cards.find((card) => card.id === id);
    if (!clickedCard || clickedCard.flipped || clickedCard.matched) return;

    const newCards = cards.map((card) =>
      card.id === id ? { ...card, flipped: true } : card
    );

    setCards(newCards);

    const newFlipped = [...flippedCards, id];
    setFlippedCards(newFlipped);

    if (newFlipped.length === 2) {
      setIsLocked(true);
      setMoves((prev) => prev + 1);

      const [firstId, secondId] = newFlipped;
      const firstCard = newCards.find((c) => c.id === firstId);
      const secondCard = newCards.find((c) => c.id === secondId);

      if (firstCard.value === secondCard.value) {
        setTimeout(() => {
          setCards((prev) =>
            prev.map((card) =>
              card.id === firstId || card.id === secondId
                ? { ...card, matched: true }
                : card
            )
          );
          setFlippedCards([]);
          setIsLocked(false);
        }, 500);
      } else {
        setErrors((prev) => prev + 1);
        setTimeout(() => {
          setCards((prev) =>
            prev.map((card) =>
              card.id === firstId || card.id === secondId
                ? { ...card, flipped: false }
                : card
            )
          );
          setFlippedCards([]);
          setIsLocked(false);
        }, 900);
      }
    }
  };

  const handleRestart = async () => {
    const saved = await getDifficulty(GAME_TYPE, DEFAULT_LEVEL);
    const clamped = Math.max(MEMORY_MIN_LEVEL, Math.min(MEMORY_MAX_LEVEL, saved));
    setLevel(clamped);
    setCards(dealMemoryCards(clamped));
    setFlippedCards([]);
    setMoves(0);
    setErrors(0);
    setIsLocked(false);
    setIsComplete(false);
    setNextHint("");
    setNextSource(null);
    startedAt.current = Date.now();
    hasLogged.current = false;
  };

  const emojiSize = cols >= 4 ? "text-2xl" : "text-3xl";

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
          Memory Matching
        </h1>
        <div className="w-10" />
      </header>

      <main className="flex-1 px-5 pb-8 flex flex-col items-center">
        <div className="w-full max-w-md mb-6 flex items-center justify-between">
          <p className="text-neutral-600">
            Level {level} · {memoryGridLabel(level)} cards
          </p>
          <p className="text-sm text-neutral-500">Moves: {moves}</p>
        </div>

        <div
          className={`w-full max-w-md grid gap-2 sm:gap-3 ${GRID_COLS[cols]}`}
        >
          {cards.map((card) => (
            <button
              key={card.id}
              onClick={() => handleCardClick(card.id)}
              disabled={card.flipped || card.matched || isLocked}
              className={`
                aspect-square rounded-xl border ${emojiSize}
                flex items-center justify-center
                transition-all duration-200
                focus:outline-none focus:ring-2 focus:ring-primary-300
                ${
                  card.flipped || card.matched
                    ? "bg-primary-50 border-primary-300"
                    : "bg-white border-neutral-200 hover:border-neutral-300"
                }
                ${card.matched ? "opacity-80" : ""}
              `}
            >
              {(card.flipped || card.matched) && card.value}
            </button>
          ))}
        </div>

        {isComplete && (
          <div className="mt-10 text-center">
            <p className="text-lg font-medium text-neutral-800 mb-1">
              Well done
            </p>
            <p className="text-neutral-600 mb-2">
              Completed in {moves} moves
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
              Play again
            </button>
          </div>
        )}
      </main>
    </div>
  );
}