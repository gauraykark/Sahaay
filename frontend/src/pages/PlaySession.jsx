// The session runner: /patient/play
//
// One sitting = all six domains, two items each, shuffled, and FROZEN at the
// start. Replaces the one-domain-per-day stand-in.
//
// What this file is responsible for:
//   * asking the gate whether play is allowed, and showing the waiting screen
//     rather than a dead button if it is not
//   * building the session ONCE and storing it, so a wrong answer cannot
//     change what comes next and a reopened app resumes the same questions
//   * accumulating PLAY time for the daily cap
//   * "Well done today" at the end, unconditionally
//
// The gate's preview bypass lives in shared/sessionRules.js, in one place. It
// is deliberately not re-checked here.

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { selectItem } from "@shared/itemBank";
import { seededShuffle } from "@shared/itemBank";
import { MIN_LEVEL } from "@shared/levels";
import {
  ITEMS_PER_SESSION,
  LOCK,
  buildSessionItems,
  dayKey,
  sessionGate,
} from "@shared/sessionRules";

import ItemStage from "../components/games/ItemStage";
import { preloadItems } from "../lib/preload";
import WaitingScreen from "../components/games/WaitingScreen";
import {
  advancePlaySession,
  endPlaySession,
  getDomainLevels,
  getPlaySession,
  isPreviewMode,
  listPlaySessions,
  logGameSession,
  recentItemIds,
  startPlaySession,
} from "../lib/db";
import { DOMAINS } from "@shared/domains";
import { useT } from "../lib/i18n";

export default function PlaySession() {
  const t = useT();
  const navigate = useNavigate();

  const [state, setState] = useState({ phase: "loading" });
  const sessionRef = useRef(null);
  const itemStartRef = useRef(0); // set on mount, see below
  const closedRef = useRef(false);

  // Read once, lazily: sessionStorage is external state, and reading it on
  // every render is both impure and pointless -- preview cannot change
  // mid-session.
  const [preview] = useState(() => isPreviewMode());

  useEffect(() => {
    itemStartRef.current = Date.now();
  }, []);

  // ── Gate, then build or resume ───────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const history = await listPlaySessions();
      const gate = sessionGate({ sessions: history, now: Date.now(), isPreview: preview });

      if (!gate.unlocked) {
        if (!cancelled) setState({ phase: "waiting", gate });
        return;
      }

      // Resume wins: the session is already frozen, and rebuilding it would
      // hand the patient a different set of questions than they left.
      if (gate.resumeId) {
        const existing = await getPlaySession(gate.resumeId);
        if (existing) {
          await preloadItems(existing.items);
          sessionRef.current = existing;
          itemStartRef.current = Date.now();
          if (!cancelled) setState({ phase: "playing", session: existing, gate });
          return;
        }
      }

      const levels = await getDomainLevels();
      const recentIdsByDomain = {};
      for (const domain of DOMAINS) {
        recentIdsByDomain[domain] = await recentItemIds(domain);
      }

      const seed = Date.now() % 1000000;
      const items = buildSessionItems({
        select: selectItem,
        levels: Object.fromEntries(
          DOMAINS.map((d) => [d, levels[d] ?? MIN_LEVEL])
        ),
        recentIdsByDomain,
        seed,
        shuffle: seededShuffle,
      });

      const sessionId = `s-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      const row = await startPlaySession({
        sessionId,
        dayKey: dayKey(Date.now()),
        items,
        levels,
      });

      // Warm the images BEFORE the first item paints. An <img> only starts
      // fetching when it mounts, so without this a memory item spends part of
      // its four-second exposure window on a blank grid -- and the exposure
      // time is the measurement.
      await preloadItems(row.items);

      sessionRef.current = row;
      itemStartRef.current = Date.now();
      if (!cancelled) setState({ phase: "playing", session: row, gate });
    })();
    return () => {
      cancelled = true;
    };
  }, [preview]);

  // ── One item finished ────────────────────────────────────────────────────

  const handleItemDone = useCallback(
    async ({ item, correct, attempted, latencyMs, status }) => {
      const session = sessionRef.current;
      if (!session) return;

      const spent = Date.now() - itemStartRef.current;
      itemStartRef.current = Date.now();

      // A row for every item, always -- completed or abandoned.
      await logGameSession({
        gameType: item.domain,
        domain: item.domain,
        status,
        // One meaning for score everywhere: correct over attempted.
        score: attempted ? (correct ? 1 : 0) : null,
        total: attempted ? 1 : null,
        errors: attempted ? (correct ? 0 : 1) : null,
        level: session.levels?.[item.domain] ?? null,
        newLevel: null, // levels move weekly, never from one round
        durationMs: latencyMs,
        itemIds: [item.id],
        sessionId: session.sessionId,
      });

      const nextIndex = session.index + 1;

      if (nextIndex >= session.items.length) {
        const closed = await endPlaySession(session.sessionId, "completed", spent);
        sessionRef.current = closed;
        closedRef.current = true;
        setState({ phase: "done" });
        return;
      }

      const advanced = await advancePlaySession(session.sessionId, {
        index: nextIndex,
        addPlayMs: spent,
      });
      sessionRef.current = advanced;
      setState((prev) => ({ ...prev, session: advanced }));
    },
    []
  );

  // ── Leaving ──────────────────────────────────────────────────────────────
  //
  // Never treated as failure. The session stays "in_progress" so the same
  // frozen questions come back; only the play time is banked.

  const leave = useCallback(async () => {
    const session = sessionRef.current;
    if (session && !closedRef.current) {
      await advancePlaySession(session.sessionId, {
        index: session.index,
        addPlayMs: Date.now() - itemStartRef.current,
      });
    }
    navigate("/patient");
  }, [navigate]);

  useEffect(() => {
    const onHide = () => {
      const session = sessionRef.current;
      if (session && !closedRef.current) {
        advancePlaySession(session.sessionId, {
          index: session.index,
          addPlayMs: Date.now() - itemStartRef.current,
        });
      }
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────

  if (state.phase === "loading") {
    return (
      <Shell preview={preview}>
        <p className="text-2xl text-neutral-600">{t("ready")}</p>
      </Shell>
    );
  }

  if (state.phase === "waiting") {
    return <WaitingScreen gate={state.gate} onExit={() => navigate("/patient")} />;
  }

  if (state.phase === "done") {
    return (
      <Shell preview={preview}>
        {/* Always this, whatever happened. No score, ever. */}
        <p className="text-4xl font-medium text-neutral-800 text-center">
          {t("well_done_today")}
        </p>
        <button
          type="button"
          onClick={() => navigate("/patient")}
          className="mt-8 px-10 py-5 rounded-2xl bg-primary-600 text-white text-2xl font-medium"
        >
          {t("next")}
        </button>
      </Shell>
    );
  }

  const session = state.session;
  const item = session.items[session.index];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <PreviewBadge on={preview} />
      <header className="flex justify-end px-5 pt-5">
        {/* The way out. Always visible. No progress counter: "3 of 12" is
            pressure, and pressure is the thing this design removes. */}
        <button
          type="button"
          onClick={leave}
          className="px-6 py-3 rounded-xl border-2 border-neutral-400 text-neutral-700 text-xl"
        >
          {t("stop")}
        </button>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-10">
        <ItemStage
          key={`${session.sessionId}-${session.index}`}
          item={item}
          onDone={handleItemDone}
        />
      </main>
    </div>
  );
}

export function PreviewBadge({ on }) {
  if (!on) return null;
  return (
    <div className="bg-amber-200 text-amber-900 text-base font-medium px-4 py-2 text-center">
      Preview mode — limits off
    </div>
  );
}

function Shell({ children, preview }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <PreviewBadge on={preview} />
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        {children}
      </div>
    </div>
  );
}

export { ITEMS_PER_SESSION, LOCK };
