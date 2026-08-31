// The six domain mini-scores on a patient card, and the larger six-card
// breakdown on the clinical view.
//
// All six render now, including any with no data yet. The old rule was "do
// not show six abilities when four are measured", which was right when
// attention had no game behind it and would have been a permanently empty
// card. Every domain has a game as of Sprint 4, so an empty one means this
// patient has not played it -- which is a fact worth showing, not an
// embarrassment worth hiding.
//
// The bar is a plain div, not a chart. At this size a library would add
// weight to the PWA bundle and read no more clearly.

const BAR_TONE = (score) => {
  if (score === null || score === undefined) return "bg-neutral-200";
  if (score >= 70) return "bg-[#3d8b6e]";
  if (score >= 45) return "bg-[#c8933f]";
  return "bg-[#b86154]";
};

// Compact version — four across the bottom of a patient card.
export function DomainMiniScore({ domain }) {
  const { label, score } = domain;

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-xs text-neutral-500 truncate">{label}</span>
        <span className="text-xs font-medium text-neutral-700 tabular-nums shrink-0">
          {score === null ? "—" : `${score}%`}
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
        <div
          className={`h-full rounded-full ${BAR_TONE(score)}`}
          style={{ width: `${score ?? 0}%` }}
        />
      </div>
    </div>
  );
}

// Full version — the Cognitive Domains Breakdown, four cards side by side.
export function DomainCard({ domain }) {
  const { label, score, level, trend, sessions } = domain;

  const TREND_TEXT = {
    improving: "Improving",
    declining: "Easing",
    stable: "Steady",
    unknown: "Not enough data",
    insufficient_data: "Not enough data",
  };

  // "Level 0" and "not calibrated" are different facts and must not print the
  // same. 0 is a real level, the bottom of the scale, measured; null means
  // nobody has measured this domain yet. Rendering {level} raw printed
  // "Level  · Steady" for the second one.
  const levelText = level === null || level === undefined
    ? "Not calibrated"
    : `Level ${level}`;

  return (
    <div className="bg-white border border-neutral-200 rounded-xl px-4 py-4 min-w-0">
      <p className="text-sm text-neutral-500 truncate">{label}</p>

      <p className="mt-1.5 text-2xl font-medium text-neutral-800 tabular-nums">
        {score === null ? "—" : `${score}%`}
      </p>

      <div className="mt-2 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
        <div
          className={`h-full rounded-full ${BAR_TONE(score)}`}
          style={{ width: `${score ?? 0}%` }}
        />
      </div>

      <p className="mt-2.5 text-xs text-neutral-500">
        {levelText} · {TREND_TEXT[trend] ?? "Steady"}
      </p>
      <p className="text-xs text-neutral-400">
        {sessions === 0
          ? "No sessions yet"
          : `${sessions} session${sessions === 1 ? "" : "s"}, 30 days`}
      </p>
    </div>
  );
}
