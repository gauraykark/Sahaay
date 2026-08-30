// Today's Priority.
//
// This replaces the usual four-metric row. The requirements are explicit
// about why: "Total Patients 24 / Avg Score 72%" does not answer the only
// question a doctor opens this screen with, which is what to look at first.
//
// So it is one horizontal strip listing 2-3 named patients, each with the
// reason they are here. Every row is clickable straight through to that
// patient — a priority item you cannot act on is just a notification.

import { ArrowRight, Warning } from "@phosphor-icons/react";

const SEVERITY_DOT = {
  high: "bg-[#b33a3a]",
  medium: "bg-[#c47d2b]",
  low: "bg-[#3d8b6e]",
};

export default function PriorityStrip({ items, onOpenPatient }) {
  if (!items?.length) {
    return (
      <section className="bg-white border border-neutral-200 rounded-xl px-5 py-4">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-neutral-500">
          <Warning size={16} weight="regular" />
          Today's priority
        </h2>
        <p className="mt-2 text-neutral-600">
          Nothing needs attention today. All patients are stable or improving.
        </p>
      </section>
    );
  }

  return (
    <section className="bg-white border border-neutral-200 rounded-xl px-5 py-4">
      <h2 className="flex items-center gap-1.5 text-sm font-medium text-neutral-500">
        <Warning size={16} weight="regular" />
        Today's priority
        <span className="text-neutral-400 font-normal">
          · {items.length} {items.length === 1 ? "patient needs" : "patients need"} attention
        </span>
      </h2>

      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li key={item.patient_id}>
            <button
              type="button"
              onClick={() => onOpenPatient(item.patient_id)}
              className="group w-full text-left flex items-start gap-2.5 rounded-lg border
                border-neutral-200 hover:border-primary-300 px-3.5 py-3 transition-colors
                focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
            >
              <span
                className={`mt-2 w-2 h-2 rounded-full shrink-0 ${
                  SEVERITY_DOT[item.severity] ?? SEVERITY_DOT.low
                }`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-neutral-800 truncate">
                  {item.patient_name}
                </span>
                <span className="block text-sm text-neutral-600">{item.headline}</span>
                <span className="block text-xs text-neutral-500 mt-0.5">
                  {item.reason}
                </span>
              </span>
              <ArrowRight
                size={16}
                className="mt-1 shrink-0 text-neutral-300 group-hover:text-primary-600 transition-colors"
              />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
