// The AI Clinical Assistant panel — the right 30% column.
//
// Three lists and one button, exactly as the requirements specify:
//   Patients improving · Patients with sudden drop · AI difficulty changes today
//   [ Generate Weekly Clinical Report ]
//
// Named "AI Clinical Assistant" per the requirements, but note what it
// actually shows: everything here is computed deterministically today. The
// report button is the only thing that will call a model, and it is a
// deliberate click by an adult who can wait three seconds — never something
// that fires on page load.

import {
  ArrowsClockwise,
  FileText,
  TrendDown,
  TrendUp,
} from "@phosphor-icons/react";

import Button from "../ui/Button";
import { SectionCard, SectionHeading, EmptyState } from "../ui/Card";

function PatientLine({ item, onOpenPatient }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpenPatient(item.patient_id)}
        className="w-full text-left rounded-md px-2 -mx-2 py-1.5 hover:bg-neutral-50
          transition-colors focus-visible:outline-2 focus-visible:outline-offset-2
          focus-visible:outline-primary-600"
      >
        <span className="block font-medium text-neutral-800 text-sm truncate">
          {item.patient_name}
        </span>
        <span className="block text-xs text-neutral-500">{item.reason}</span>
      </button>
    </li>
  );
}

export default function ClinicalAssistant({
  assistant,
  onOpenPatient,
  onGenerateReport,
  isGenerating,
}) {
  const { improving = [], sudden_drop = [], difficulty_changes_today = [] } = assistant ?? {};

  return (
    <div className="flex flex-col gap-4">
      <SectionCard>
        <SectionHeading icon={TrendUp}>Improving this week</SectionHeading>
        {improving.length ? (
          <ul className="space-y-1">
            {improving.map((item) => (
              <PatientLine
                key={item.patient_id}
                item={item}
                onOpenPatient={onOpenPatient}
              />
            ))}
          </ul>
        ) : (
          <EmptyState>No clear improvement to report this week.</EmptyState>
        )}
      </SectionCard>

      <SectionCard>
        <SectionHeading icon={TrendDown}>Sudden drop</SectionHeading>
        {sudden_drop.length ? (
          <ul className="space-y-1">
            {sudden_drop.map((item) => (
              <PatientLine
                key={item.patient_id}
                item={item}
                onOpenPatient={onOpenPatient}
              />
            ))}
          </ul>
        ) : (
          <EmptyState>No sudden drops detected.</EmptyState>
        )}
      </SectionCard>

      <SectionCard>
        <SectionHeading icon={ArrowsClockwise}>Difficulty changes today</SectionHeading>
        {difficulty_changes_today.length ? (
          <ul className="space-y-2.5">
            {difficulty_changes_today.map((change) => (
              <li key={change.id} className="text-sm">
                <span className="text-neutral-800">
                  {change.game_type.replace("-", " ")}: level {change.from_level} →{" "}
                  {change.to_level}
                </span>
                {change.reason ? (
                  <span className="block text-xs text-neutral-500">{change.reason}</span>
                ) : null}
                <span className="block text-xs text-neutral-400">
                  {change.source === "ai" ? "Decided by AI" : "Decided offline by rules"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>No difficulty changes in the last 24 hours.</EmptyState>
        )}
      </SectionCard>

      <Button
        icon={FileText}
        onClick={onGenerateReport}
        disabled={isGenerating}
        className="w-full"
      >
        {isGenerating ? "Generating…" : "Generate weekly clinical report"}
      </Button>
    </div>
  );
}
