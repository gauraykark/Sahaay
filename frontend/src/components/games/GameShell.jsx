// The one place a round is run.
//
// Every game is a renderer plugged into this shell. The shell owns the things
// that must behave identically in all six, because those are the things that
// were inconsistent before and the things a patient actually feels:
//
//   * ERRORLESS. A wrong answer is never shown as wrong. No red, no X, no
//     score, no counter, no "N of M". The correct answer appears gently, the
//     tone stays warm, and we move on. Failure creates anxiety in dementia
//     patients, anxiety makes them stop opening the app, and an app they will
//     not open helps nobody.
//
//   * THE ROUND IS FIXED WHEN IT STARTS. Getting item 3 wrong does not change
//     item 4. Wrong answers move the base level in seven days; they change
//     nothing inside the session. If struggling changed what happened next,
//     the patient would be punished for struggling.
//
//   * EVERY ROUND WRITES A ROW. Win, quit, or walk away mid-question. Logging
//     only the finished ones is what made the old attention score a constant.
//     A quit writes status "abandoned" with NULL for what was not played --
//     never 0, because a zero from quitting looks exactly like a zero from
//     decline.
//
//   * NO TIMERS. Response time is measured and logged, never displayed.
//
//   * ONE OBVIOUS WAY OUT, always visible, never treated as failure.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { selectItem } from "@shared/itemBank";
import { MIN_LEVEL } from "@shared/levels";
import {
  getDomainLevel,
  isPreviewMode,
  logGameSession,
  recentItemIds,
} from "../../lib/db";
import { useT, langToLocale } from "../../lib/i18n";
import { speak } from "../../lib/utils";
import RENDERERS from "./renderers";

// How long the gentle correction stays on screen before moving on. Long
// enough to read, short enough not to dwell on it.
const CORRECTION_MS = 2200;

export default function GameShell({ domain, itemCount = 3, onFinish }) {
  const t = useT();
  const navigate = useNavigate();

  const [phase, setPhase] = useState("loading"); // loading | playing | done
  const [round, setRound] = useState(null);
  const [index, setIndex] = useState(0);
  const [showing, setShowing] = useState(null); // null | "correction"

  // Results accumulate here and are written once, at the end or on exit.
  const resultsRef = useRef([]);
  const startedAtRef = useRef(Date.now());
  const questionStartRef = useRef(Date.now());
  const loggedRef = useRef(false);
  const roundRef = useRef(null);

  // ── Build the round once, then freeze it ─────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await getDomainLevel(domain);
      // An uncalibrated domain starts at the bottom of the scale rather than a
      // guess. Level 0 is fully playable, so nobody is blocked by this.
      const level = stored ?? MIN_LEVEL;
      const seen = await recentItemIds(domain);

      const items = [];
      const used = new Set(seen);
      for (let i = 0; i < itemCount; i += 1) {
        const { item } = selectItem({
          domain,
          level,
          recentIds: used,
          seed: Date.now() % 100000 + i,
        });
        items.push(item);
        used.add(item.id);
      }
      if (cancelled) return;

      const built = { domain, level, items };
      roundRef.current = built;
      setRound(built);
      setPhase("playing");
      questionStartRef.current = Date.now();
    })();
    return () => {
      cancelled = true;
    };
  }, [domain, itemCount]);

  // ── Logging ──────────────────────────────────────────────────────────────

  const writeRow = useCallback(
    async (status) => {
      if (loggedRef.current) return;
      loggedRef.current = true;

      const built = roundRef.current;
      if (!built) return;

      const answered = resultsRef.current;
      const attempted = answered.length;
      const correct = answered.filter((r) => r.correct).length;

      await logGameSession({
        gameType: domain,
        domain,
        status,
        // ONE MEANING FOR SCORE, in all six domains: correct over attempted.
        // Memory's move-efficiency used to live in these columns while every
        // other game put accuracy here, and both were averaged together.
        score: attempted > 0 ? correct : null,
        total: attempted > 0 ? attempted : null,
        // Unplayed is NULL, never 0.
        errors: attempted > 0 ? attempted - correct : null,
        level: built.level,
        newLevel: null, // the weekly evaluator moves levels, not a round
        durationMs: Date.now() - startedAtRef.current,
        itemIds: built.items.slice(0, Math.max(attempted, 1)).map((i) => i.id),
        sessionId: null,
      });
    },
    [domain]
  );

  // Leaving is never failure, but it must still be measured. This covers the
  // back button, a route change, and the tab closing.
  useEffect(() => {
    const onHide = () => {
      if (!loggedRef.current && phase === "playing") writeRow("abandoned");
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      onHide();
    };
  }, [phase, writeRow]);

  // ── Answering ────────────────────────────────────────────────────────────

  const handleAnswer = useCallback(
    (wasCorrect) => {
      if (showing) return; // ignore taps during the correction

      resultsRef.current.push({
        correct: wasCorrect,
        latencyMs: Date.now() - questionStartRef.current,
      });

      const advance = () => {
        setShowing(null);
        const next = index + 1;
        if (next >= (roundRef.current?.items.length ?? 0)) {
          setPhase("done");
          writeRow("completed");
          speak(t("well_done_today"), langToLocale());
        } else {
          setIndex(next);
          questionStartRef.current = Date.now();
        }
      };

      if (wasCorrect) {
        advance();
        return;
      }

      // Errorless: no failure signal. Show the right answer warmly, then move
      // on. The patient should not be able to tell they got it wrong.
      setShowing("correction");
      speak(t("lets_look_together"), langToLocale());
      setTimeout(advance, CORRECTION_MS);
    },
    [index, showing, t, writeRow]
  );

  const exit = useCallback(async () => {
    await writeRow(phase === "done" ? "completed" : "abandoned");
    if (onFinish) onFinish();
    else navigate("/patient");
  }, [navigate, onFinish, phase, writeRow]);

  // ── Render ───────────────────────────────────────────────────────────────

  const item = round?.items[index];
  const Renderer = item ? RENDERERS[item.template] : null;

  const preview = useMemo(() => isPreviewMode(), []);

  if (phase === "loading" || !item) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-2xl text-neutral-600">{t("ready")}</p>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-8 px-6">
        {/* Always this, whatever happened. No score, ever. */}
        <p className="text-4xl font-medium text-neutral-800 text-center">
          {t("well_done_today")}
        </p>
        <button
          type="button"
          onClick={exit}
          className="px-10 py-5 rounded-2xl bg-primary text-white text-2xl font-medium"
        >
          {t("next")}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {preview && (
        <div className="bg-amber-100 text-amber-900 text-sm px-4 py-2 text-center">
          Preview — nothing you play here is recorded
        </div>
      )}

      {/* The way out. Always visible, never styled as giving up. There is no
          progress counter here on purpose: "3 of 15" is pressure. */}
      <header className="flex justify-end px-5 pt-5">
        <button
          type="button"
          onClick={exit}
          className="px-6 py-3 rounded-xl border-2 border-neutral-400 text-neutral-700 text-xl"
        >
          {t("stop")}
        </button>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-10">
        <Renderer
          item={item}
          t={t}
          correcting={showing === "correction"}
          onAnswer={handleAnswer}
        />
      </main>
    </div>
  );
}
