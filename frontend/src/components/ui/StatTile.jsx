// A single number with a label under it.
//
// Used on the clinical view header, not the dashboard — the requirements
// deliberately replace the usual four-metric row with the Today's Priority
// strip, because "24 patients / 72% average" does not tell a doctor what to
// look at first.

export default function StatTile({ label, value, suffix = "", detail = null }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-neutral-500">{label}</p>
      <p className="mt-0.5 text-2xl font-medium text-neutral-800 tabular-nums">
        {value === null || value === undefined ? "—" : `${value}${suffix}`}
      </p>
      {detail ? <p className="text-xs text-neutral-500 mt-0.5">{detail}</p> : null}
    </div>
  );
}

// Score with its change against the previous period, as the requirements ask
// for on the clinical header. The delta is the point — a bare percentage
// says nothing without a direction.
export function ComparisonStat({ label, value, previous, percentile }) {
  const delta =
    value !== null && previous !== null && previous !== undefined
      ? value - previous
      : null;

  const deltaText =
    delta === null
      ? "No previous period to compare"
      : delta === 0
        ? "Unchanged from previous 30 days"
        : `${delta > 0 ? "+" : ""}${delta} points vs previous 30 days`;

  const deltaTone =
    delta === null || delta === 0
      ? "text-neutral-500"
      : delta > 0
        ? "text-[#2f7355]"
        : "text-[#9c3227]";

  return (
    <div className="min-w-0">
      <p className="text-sm text-neutral-500">{label}</p>
      <p className="mt-0.5 text-3xl font-medium text-neutral-800 tabular-nums">
        {value === null ? "—" : `${value}%`}
      </p>
      <p className={`text-xs mt-1 ${deltaTone}`}>{deltaText}</p>
      {percentile !== null && percentile !== undefined ? (
        <p className="text-xs text-neutral-400 mt-0.5">
          {percentile}th percentile among your patients
        </p>
      ) : null}
    </div>
  );
}
