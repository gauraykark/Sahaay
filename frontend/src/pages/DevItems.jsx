// /dev/items — every item in the bank, for human review.
//
// DEV ONLY. Not linked from anywhere on the patient side, and the route is
// registered only when import.meta.env.DEV is true, so it does not exist in a
// production build at all. A patient must never be able to reach a screen that
// marks the correct answer.
//
// It answers the question a test cannot: does this item make sense to a human?
// The gate proves options are non-empty and images resolve; it cannot tell you
// that "How is he feeling? / Worried / Sad" is a genuinely hard pair, or that a
// routine reads in the right order.

import { useEffect, useMemo, useState } from "react";

import { DOMAINS } from "@shared/domains";
import {
  bankDepth,
  bankFor,
  buildItemById,
  eligibleItems,
  generateAttention,
  generatePerceptualMotor,
  isBanked,
} from "@shared/itemBank";
import { MAX_LEVEL, MIN_LEVEL, difficultyFor } from "@shared/levels";

import RENDERERS from "../components/games/renderers";
import { DOMAIN_LABELS_EN } from "@shared/domainLabels";
import { useT } from "../lib/i18n";

const GENERATED_SAMPLES = 6;

/** Build every item in a domain at a level, banked or generated. */
function itemsAt(domain, level) {
  if (!isBanked(domain)) {
    const gen = domain === "attention" ? generateAttention : generatePerceptualMotor;
    return Array.from({ length: GENERATED_SAMPLES }, (_, seed) => gen(level, seed));
  }
  // buildItemById, not selectItem: selection would quietly hand back a
  // different item when the one asked for is out of range at this level, which
  // showed up as duplicate ids in the listing.
  return bankFor(domain)
    .map((entry) => buildItemById(domain, entry.id, level))
    .filter(Boolean);
}

// ── Problem detection ────────────────────────────────────────────────────────

function problemsFor(item, t) {
  const problems = [];

  const urls = [
    ...(item.show?.urls ?? []),
    ...(item.template === "which-did-you-see"
      ? (item.ask?.options ?? []).map((k) => `/items/objects/${k}.jpg`)
      : []),
    ...(item.imageUrl ? [item.imageUrl] : []),
  ];

  const options = item.options ?? item.ask?.options ?? item.display ?? [];
  const correct = item.correct ?? item.ask?.correct;

  if (item.template !== "go-no-go") {
    if (!options.length) problems.push("no options");
    if (options.some((o) => o === undefined || o === null || String(o).trim() === ""))
      problems.push("an option is empty");
    if (new Set(options).size !== options.length) problems.push("duplicate options");
    if (correct !== undefined && !options.includes(correct))
      problems.push("correct answer is not among the options");
  }

  // A string that comes back as its own key means the translation is missing.
  const keysToCheck = [];
  if (item.template === "what-is-this" || item.template === "which-did-you-see") {
    keysToCheck.push(...options.map((o) => `obj_${o}`));
  }
  if (item.template === "how-are-they-feeling") keysToCheck.push(...options.map((o) => `emotion_${o}`));
  if (item.template === "match-the-shape") keysToCheck.push(...options.map((o) => `shape_${o}`));
  if (item.promptKey) keysToCheck.push(item.promptKey);

  const untranslated = keysToCheck.filter((k) => t(k) === k);
  if (untranslated.length) problems.push(`untranslated: ${untranslated.join(", ")}`);

  // Executive steps are raw English strings in the bank, not i18n keys.
  if (item.template === "put-in-order") problems.push("steps are hardcoded English (known gap)");

  if (item.template === "put-in-order" && (item.display?.length ?? 0) < 2)
    problems.push("fewer than 2 tappable steps — no ordering decision");

  return { problems, urls, options, correct };
}

function ImageCheck({ urls, onResult }) {
  const [missing, setMissing] = useState([]);
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      urls.map(
        (u) =>
          new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(null);
            img.onerror = () => resolve(u);
            img.src = u;
          })
      )
    ).then((res) => {
      const bad = res.filter(Boolean);
      if (!cancelled) {
        setMissing(bad);
        onResult?.(bad);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [urls.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!urls.length) return <span className="text-xs text-neutral-400">no images</span>;
  return missing.length ? (
    <span className="text-xs text-red-700 font-medium">
      MISSING IMAGE: {missing.join(", ")}
    </span>
  ) : (
    <span className="text-xs text-emerald-700">{urls.length} image(s) ok</span>
  );
}

function ItemCard({ item, level, t }) {
  const { problems, urls, options, correct } = useMemo(() => problemsFor(item, t), [item, t]);
  const Renderer = RENDERERS[item.template];
  const inRange =
    item.minLevel === undefined || (level >= item.minLevel && level <= item.maxLevel);

  return (
    <article
      className={`border rounded-lg p-3 bg-white ${
        problems.length ? "border-amber-400" : "border-neutral-300"
      }`}
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2 text-xs">
        <code className="font-mono font-medium text-neutral-900">{item.id}</code>
        <span className="text-neutral-500">{item.template}</span>
        <span className={inRange ? "text-neutral-500" : "text-amber-700 font-medium"}>
          valid {item.minLevel ?? MIN_LEVEL}–{item.maxLevel ?? MAX_LEVEL}
          {!inRange && " (outside at this level)"}
        </span>
        <ImageCheck urls={urls} />
      </header>

      {/* THE ANSWER, shown on purpose. This screen is for the reviewer. */}
      <p className="text-xs mb-2">
        <span className="text-neutral-500">answer: </span>
        <span className="font-mono font-medium text-emerald-800">
          {item.template === "put-in-order"
            ? (item.correctOrder ?? []).join(" → ")
            : item.template === "go-no-go"
              ? `${item.goCount} go / ${item.noGoCount} no-go`
              : String(correct)}
        </span>
        {options.length > 0 && item.template !== "put-in-order" && (
          <span className="text-neutral-400"> · from {options.length} options</span>
        )}
      </p>

      {problems.length > 0 && (
        <ul className="mb-2 text-xs text-amber-800 list-disc pl-4">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      {/* Rendered exactly as the patient sees it. onAnswer is a no-op: this
          page never logs, never scores, never advances. */}
      <div className="border-t border-neutral-200 pt-3 mt-2 scale-[0.72] origin-top-left w-[139%]">
        {Renderer ? (
          <Renderer item={item} t={t} correcting={false} onAnswer={() => {}} />
        ) : (
          <p className="text-xs text-red-700">no renderer for {item.template}</p>
        )}
      </div>
    </article>
  );
}

export default function DevItems() {
  const t = useT();
  const [level, setLevel] = useState(7);
  const [domain, setDomain] = useState("all");
  const [onlyProblems, setOnlyProblems] = useState(false);

  const shownKey = domain;
  const shown = useMemo(
    () => DOMAINS.filter((d) => shownKey === "all" || d === shownKey),
    [shownKey]
  );

  const groups = useMemo(
    () =>
      shown.map((d) => {
        const items = itemsAt(d, level);
        return {
          domain: d,
          items: onlyProblems
            ? items.filter((i) => problemsFor(i, t).problems.length > 0)
            : items,
          total: items.length,
          eligible: isBanked(d) ? eligibleItems(d, level).length : Infinity,
          depth: bankDepth(d),
        };
      }),
    [shown, level, onlyProblems, t]
  );

  const d = difficultyFor(level);

  return (
    <div className="min-h-screen bg-neutral-50 px-4 py-4">
      <header className="mb-4 sticky top-0 bg-neutral-50 pb-3 border-b border-neutral-300 z-10">
        <h1 className="text-lg font-medium text-neutral-900">
          Item bank review · dev only
        </h1>
        <p className="text-xs text-neutral-600 mb-3">
          Every item, rendered as the patient sees it, with the answer marked.
          Not reachable from the patient side and not built in production.
        </p>

        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-neutral-700">Level</span>
            <input
              type="range"
              min={MIN_LEVEL}
              max={MAX_LEVEL}
              value={level}
              onChange={(e) => setLevel(Number(e.target.value))}
              className="w-56"
            />
            <span className="font-mono font-medium w-6">{level}</span>
          </label>

          <div className="flex gap-1">
            {[0, 7, 15].map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLevel(l)}
                className={`px-2 py-1 rounded border text-xs ${
                  level === l
                    ? "bg-primary-600 text-white border-primary-600"
                    : "bg-white border-neutral-300"
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          <select
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            className="border border-neutral-300 rounded px-2 py-1"
          >
            <option value="all">all six domains</option>
            {DOMAINS.map((dm) => (
              <option key={dm} value={dm}>
                {DOMAIN_LABELS_EN[dm]}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={onlyProblems}
              onChange={(e) => setOnlyProblems(e.target.checked)}
            />
            <span className="text-neutral-700">only flagged</span>
          </label>

          <span className="text-xs text-neutral-500 font-mono">
            grid {d.gridSize} · items {d.itemCount} · cue {d.cueLevel}
          </span>
        </div>
      </header>

      {groups.map((g) => (
        <section key={g.domain} className="mb-6">
          <h2 className="text-base font-medium text-neutral-900 mb-2">
            {DOMAIN_LABELS_EN[g.domain]}{" "}
            <span className="text-xs font-normal text-neutral-500">
              showing {g.items.length} of {g.total}
              {Number.isFinite(g.depth)
                ? ` · bank depth ${g.depth} · ${g.eligible} eligible at level ${level}`
                : " · generated, unlimited"}
            </span>
          </h2>
          {g.items.length === 0 ? (
            <p className="text-sm text-neutral-500">nothing to show</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
              {g.items.map((item) => (
                <ItemCard key={item.id} item={item} level={level} t={t} />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
