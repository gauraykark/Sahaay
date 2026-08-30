// Pre-Sprint-4 preview: one item per domain, at levels 0 / 7 / 15.
//
// A developer surface, not a patient one. It exists to answer two questions
// before six games are built on top of the item layer: do the images actually
// load, and does difficultyFor() move the knobs sensibly across the scale.
//
// Route: /preview/items   (see App.jsx)

import { useEffect, useState } from "react";

import { DOMAIN_LABELS_EN } from "@shared/domainLabels";
import { difficultyFor } from "@shared/levels";
import { objectUrl, selectSessionItems } from "@shared/itemBank";

const ALL_LEVELS = [0, 7, 15];

// ?level=7 renders one level on its own. The full page is very tall, which
// makes it awkward to capture or read; a single level fits on one screen.
function levelsFromUrl() {
  const raw = new URLSearchParams(window.location.search).get("level");
  if (raw === null) return ALL_LEVELS;
  const n = Number(raw);
  return Number.isFinite(n) ? [n] : ALL_LEVELS;
}

function Img({ src, alt, size = 96 }) {
  const [state, setState] = useState("loading");
  return (
    <figure className="m-0 flex flex-col items-center gap-1">
      <div
        style={{ width: size, height: size }}
        className={`rounded-lg overflow-hidden border flex items-center justify-center ${
          state === "error" ? "border-red-400 bg-red-50" : "border-neutral-300 bg-neutral-100"
        }`}
      >
        {state === "error" ? (
          <span className="text-[10px] text-red-600 px-1 text-center leading-tight">
            404
            <br />
            {src.split("/").pop()}
          </span>
        ) : (
          <img
            src={src}
            alt={alt}
            width={size}
            height={size}
            className="w-full h-full object-cover"
            onLoad={() => setState("ok")}
            onError={() => setState("error")}
          />
        )}
      </div>
      <figcaption className="text-[11px] text-neutral-600">{alt}</figcaption>
    </figure>
  );
}

function Shape({ name, rotation, size = 56 }) {
  const common = { fill: "#2f968c", stroke: "#1f625c", strokeWidth: 2 };
  const half = size / 2;
  const body = {
    circle: <circle cx={half} cy={half} r={half - 4} {...common} />,
    square: <rect x={4} y={4} width={size - 8} height={size - 8} rx={4} {...common} />,
    triangle: <polygon points={`${half},4 ${size - 4},${size - 4} 4,${size - 4}`} {...common} />,
    diamond: <polygon points={`${half},4 ${size - 4},${half} ${half},${size - 4} 4,${half}`} {...common} />,
    hexagon: <polygon points={`${half},4 ${size - 6},${size * 0.3} ${size - 6},${size * 0.7} ${half},${size - 4} 6,${size * 0.7} 6,${size * 0.3}`} {...common} />,
    star: <polygon points={`${half},4 ${half + 8},${half - 6} ${size - 4},${half - 4} ${half + 10},${half + 8} ${half + 14},${size - 4} ${half},${half + 14} ${half - 14},${size - 4} ${half - 10},${half + 8} 4,${half - 4} ${half - 8},${half - 6}`} {...common} />,
  }[name];
  return (
    <figure className="m-0 flex flex-col items-center gap-1">
      <svg width={size} height={size} style={{ transform: `rotate(${rotation}deg)` }}>
        {body}
      </svg>
      <figcaption className="text-[11px] text-neutral-600">{name}</figcaption>
    </figure>
  );
}

// Preview-only English. The games render these through t() -- see i18n.
const PROMPTS = {
  "go-no-go": () => "Tap the green circle. Do not tap the red one.",
  "put-in-order": () => "Put these in the order you do them.",
  "which-did-you-see": () => "Which one did you see?",
  "what-is-this": () => "What is this called?",
  "match-the-shape": () => "Tap the shape that matches.",
  "how-are-they-feeling": (i) => `How is ${i.pronoun} feeling?`,
};

function Chip({ children, tone = "neutral" }) {
  const tones = {
    neutral: "bg-neutral-100 text-neutral-700 border-neutral-300",
    teal: "bg-teal-50 text-teal-800 border-teal-300",
    amber: "bg-amber-50 text-amber-800 border-amber-300",
  };
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded border ${tones[tone]}`}>{children}</span>
  );
}

function ItemBody({ item }) {
  switch (item.template) {
    case "go-no-go":
      return (
        <div className="flex flex-wrap gap-1.5 items-center">
          {Array.from({ length: Math.min(item.goCount, 18) }).map((_, i) => (
            <span key={`g${i}`} className="w-6 h-6 rounded-full bg-emerald-500 inline-block" />
          ))}
          {Array.from({ length: Math.min(item.noGoCount, 18) }).map((_, i) => (
            <span key={`n${i}`} className="w-6 h-6 rounded-full bg-red-500 inline-block" />
          ))}
          <div className="w-full mt-2 flex gap-1.5 flex-wrap">
            <Chip>{item.stimuli} stimuli</Chip>
            <Chip tone={item.noGoRatio === 0 ? "teal" : "neutral"}>
              no-go {Math.round(item.noGoRatio * 100)}%
            </Chip>
            <Chip>{item.windowMs}ms window</Chip>
            <Chip>target {item.targetSize}</Chip>
          </div>
        </div>
      );

    case "put-in-order":
      return (
        <div>
          <ol className="text-sm text-neutral-800 pl-5 list-decimal space-y-0.5">
            {item.steps.map((s, i) => (
              <li key={s} className={i < item.prePlaced ? "text-teal-700 font-medium" : ""}>
                {s}
                {i < item.prePlaced && <span className="text-[11px] ml-1">(already placed)</span>}
              </li>
            ))}
          </ol>
          <div className="mt-2 flex gap-1.5 flex-wrap">
            <Chip>{item.steps.length} steps</Chip>
            {item.prePlaced > 0 && <Chip tone="teal">first step given</Chip>}
          </div>
        </div>
      );

    case "which-did-you-see":
      return (
        <div className="space-y-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-neutral-500 mb-1">
              shown for {item.show.durationMs}ms
            </p>
            <div className="flex flex-wrap gap-2">
              {item.show.images.map((k, i) => (
                <Img key={k + i} src={item.show.urls[i]} alt={k} size={64} />
              ))}
            </div>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-neutral-500 mb-1">
              after a {item.gap.durationMs}ms gap — which one did you see?
            </p>
            <div className="flex flex-wrap gap-2">
              {item.ask.options.map((k) => (
                <Img key={k} src={objectUrl(k)} alt={k} size={72} />
              ))}
            </div>
          </div>
        </div>
      );

    case "what-is-this":
      return (
        <div className="space-y-2">
          <Img src={item.imageUrl} alt={item.cue ?? "?"} size={120} />
          <div className="flex flex-wrap gap-2">
            {item.options.map((o) => (
              <span
                key={o}
                className="px-3 py-1.5 rounded-lg border border-neutral-300 bg-white text-sm"
              >
                {o}
              </span>
            ))}
          </div>
          <Chip tone={item.cue ? "teal" : "neutral"}>
            {item.cue ? `cue: ${item.cue}` : "no cue"}
          </Chip>
        </div>
      );

    case "match-the-shape":
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-[11px] uppercase tracking-wide text-neutral-500">match</span>
            <Shape name={item.target} rotation={0} size={44} />
          </div>
          <div className="flex flex-wrap gap-2">
            {item.options.map((s) => (
              <Shape key={s} name={s} rotation={item.rotationDeg} size={48} />
            ))}
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <Chip>{item.options.length} options</Chip>
            <Chip>rotated {item.rotationDeg}°</Chip>
            <Chip>grid {item.gridSize}×{item.gridSize}</Chip>
          </div>
        </div>
      );

    case "how-are-they-feeling":
      return (
        <div className="space-y-2">
          {/* ONE face. The options below are emotion words, never faces --
              that is what keeps actor identity out of the task. */}
          <Img src={item.imageUrl} alt={item.face} size={120} />
          <div className="flex flex-wrap gap-2">
            {item.options.map((o) => (
              <span
                key={o}
                className="px-3 py-1.5 rounded-lg border border-neutral-300 bg-white text-sm"
              >
                {o}
              </span>
            ))}
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <Chip>{item.options.length} emotion words</Chip>
            <Chip tone="teal">single face</Chip>
          </div>
        </div>
      );

    default:
      return <pre className="text-xs">{JSON.stringify(item, null, 2)}</pre>;
  }
}

export default function ItemPreview() {
  const [assets, setAssets] = useState({ checked: 0, failed: [] });
  const levels = levelsFromUrl();

  useEffect(() => {
    let cancelled = false;
    const urls = [
      ...new Set(
        ALL_LEVELS.flatMap((lvl) =>
          selectSessionItems({ level: lvl, seed: lvl }).flatMap(({ item }) => [
            ...(item.show?.urls ?? []),
            ...(item.ask?.options ? item.ask.options.map(objectUrl) : []),
            ...(item.imageUrl ? [item.imageUrl] : []),
          ])
        )
      ),
    ];
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
    ).then((results) => {
      if (!cancelled) {
        setAssets({ checked: urls.length, failed: results.filter(Boolean) });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-neutral-50 px-6 py-6">
      <header className="mb-5">
        <h1 className="text-xl font-medium text-neutral-900">Item preview</h1>
        <p className="text-sm text-neutral-600 mt-1">
          One item per domain. Developer surface — not a patient screen, and
          nothing here is scored or logged. Add <code>?level=7</code> to see a
          single level.
        </p>
        <div className="mt-2 flex gap-2 flex-wrap items-center">
          <Chip tone={assets.failed.length ? "amber" : "teal"}>
            {assets.checked === 0
              ? "checking assets…"
              : assets.failed.length === 0
                ? `all ${assets.checked} images loaded`
                : `${assets.failed.length} of ${assets.checked} images FAILED`}
          </Chip>
          {assets.failed.map((u) => (
            <Chip key={u} tone="amber">{u}</Chip>
          ))}
        </div>
      </header>

      {levels.map((level) => {
        const d = difficultyFor(level);
        const items = selectSessionItems({ level, seed: level }).map((r) => r.item);
        return (
          <section key={level} className="mb-8">
            <div className="flex items-baseline gap-3 mb-3 border-b border-neutral-300 pb-2">
              <h2 className="text-lg font-medium text-neutral-900">Level {level}</h2>
              <span className="text-xs text-neutral-600">
                grid {d.gridSize}×{d.gridSize} · itemCount {d.itemCount} · cue {d.cueLevel} ·
                timer {String(d.timerSec)}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {items.map((item) => (
                <article
                  key={item.id}
                  className="bg-white border border-neutral-300 rounded-xl p-4"
                >
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-medium text-neutral-900 text-sm">
                      {DOMAIN_LABELS_EN[item.domain]}
                    </h3>
                    {item.generated && <Chip tone="teal">generated</Chip>}
                  </div>
                  <p className="text-sm text-neutral-700 mb-3">{PROMPTS[item.template]?.(item) ?? item.template}</p>
                  <ItemBody item={item} />
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
