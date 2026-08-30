// /patient/play/:domain — one domain, on its own.
//
// A DEVELOPER route, not a patient one. The patient plays /patient/play, which
// is the session runner: all six domains, twice a day, gated. This exists so a
// single domain can be exercised in isolation while building, and it sits
// deliberately outside the session model -- it creates no play session, counts
// against no daily cap, and consumes no session slot.
//
// It still logs rounds and still respects preview mode, because those are
// clinical guarantees and should not have a hole in them just because a
// developer took a shortcut.

import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";

import { DOMAINS } from "@shared/domains";
import { selectItem } from "@shared/itemBank";
import { MIN_LEVEL } from "@shared/levels";
import { ITEMS_PER_DOMAIN } from "@shared/sessionRules";

import ItemStage from "../components/games/ItemStage";
import { getDomainLevel, logGameSession, recentItemIds } from "../lib/db";
import { useT } from "../lib/i18n";

export default function PlayDomain() {
  const { domain } = useParams();
  const t = useT();
  const navigate = useNavigate();

  const [items, setItems] = useState(null);
  const [index, setIndex] = useState(0);
  const levelRef = useRef(null);

  const valid = DOMAINS.includes(domain);

  useEffect(() => {
    if (!valid) return undefined;
    let cancelled = false;
    (async () => {
      const level = (await getDomainLevel(domain)) ?? MIN_LEVEL;
      const seen = await recentItemIds(domain);
      const picked = [];
      const used = new Set(seen);
      for (let i = 0; i < ITEMS_PER_DOMAIN; i += 1) {
        const { item } = selectItem({ domain, level, recentIds: used, seed: Date.now() + i });
        used.add(item.id);
        picked.push(item);
      }
      if (cancelled) return;
      levelRef.current = level;
      setItems(picked);
      setIndex(0);
    })();
    return () => {
      cancelled = true;
    };
  }, [domain, valid]);

  const onDone = useCallback(async ({ item, correct, attempted, latencyMs, status }) => {
    await logGameSession({
      gameType: item.domain,
      domain: item.domain,
      status,
      score: attempted ? (correct ? 1 : 0) : null,
      total: attempted ? 1 : null,
      errors: attempted ? (correct ? 0 : 1) : null,
      level: levelRef.current,
      newLevel: null,
      durationMs: latencyMs,
      itemIds: [item.id],
      sessionId: null, // not part of a session, by design
    });
    setIndex((i) => i + 1);
  }, []);

  if (!valid) return <Navigate to="/patient" replace />;

  if (!items) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-2xl text-neutral-600">{t("ready")}</p>
      </div>
    );
  }

  if (index >= items.length) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-8 px-6">
        <p className="text-4xl font-medium text-neutral-800">{t("well_done_today")}</p>
        <button
          type="button"
          onClick={() => navigate("/patient")}
          className="px-10 py-5 rounded-2xl bg-primary-600 text-white text-2xl font-medium"
        >
          {t("next")}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="flex justify-end px-5 pt-5">
        <button
          type="button"
          onClick={() => navigate("/patient")}
          className="px-6 py-3 rounded-xl border-2 border-neutral-400 text-neutral-700 text-xl"
        >
          {t("stop")}
        </button>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-10">
        <ItemStage key={`${domain}-${index}`} item={items[index]} onDone={onDone} />
      </main>
    </div>
  );
}
