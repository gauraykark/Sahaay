// Filter chips for the doctor's header.
//
// The five the requirements name:
//   All | Needs Attention | Improving | Stable | High Offline Usage
//
// Counts sit inside each chip so the doctor can see there is nothing behind a
// filter before tapping it — a chip that leads to an empty list is a wasted
// interaction on a screen meant for triage.

export default function FilterChips({ options, value, onChange }) {
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label="Filter patients"
    >
      {options.map((option) => {
        const isActive = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            aria-pressed={isActive}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5
              text-sm font-medium transition-colors
              focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600
              ${
                isActive
                  ? "bg-primary-600 border-primary-600 text-white"
                  : "bg-white border-neutral-200 text-neutral-600 hover:border-primary-300"
              }`}
          >
            {option.label}
            <span
              className={`text-xs tabular-nums ${
                isActive ? "text-primary-100" : "text-neutral-400"
              }`}
            >
              {option.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
