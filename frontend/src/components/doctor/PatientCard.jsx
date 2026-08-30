// One Smart Patient Card.
//
// Carries everything the requirements list: name, age, last active, caregiver
// name, four domain mini-scores, trend with its reason, offline indicator,
// risk badge, and the button through to the clinical view.
//
// It is a card, not a table row — the requirements are specific that the
// doctor's list should use the same soft card style as the caregiver's
// "Recent activity" list, not a dense clinical table.
//
// Everything here arrives precomputed in one payload. No per-card request, no
// per-card model call: at 20 patients either would make the screen unusable.

import { ArrowRight, User } from "@phosphor-icons/react";

import Avatar from "../ui/Avatar";
import { OfflineBadge, RiskBadge, TrendBadge } from "../ui/Badge";
import { DomainMiniScore } from "../ui/DomainScore";

function relativeDay(iso) {
  if (!iso) return "Never";

  const then = new Date(iso);
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((startOf(new Date()) - startOf(then)) / 86400000);

  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default function PatientCard({ patient, onOpen }) {
  const {
    id,
    name,
    age,
    photo,
    caregiver_name,
    last_active,
    is_offline,
    adherence,
    overall_score,
    trend,
    reason,
    risk,
    domains,
  } = patient;

  return (
    <article className="bg-white border border-neutral-200 rounded-xl px-5 py-5">
      <div className="flex items-start gap-3">
        <Avatar name={name} photo={photo} id={id} size="md" />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-medium text-neutral-800 text-lg truncate">{name}</h3>
              <p className="text-sm text-neutral-500">
                {age ? `${age} years` : "Age not recorded"} · Last active{" "}
                {relativeDay(last_active)}
              </p>
            </div>

            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <RiskBadge risk={risk} />
              <OfflineBadge isOffline={is_offline} />
            </div>
          </div>

          <p className="mt-1 flex items-center gap-1 text-sm text-neutral-500">
            <User size={14} weight="regular" />
            Caregiver: {caregiver_name}
          </p>
        </div>
      </div>

      {/* Trend + the reason behind it. The reason is the point — the
          requirements call out that the doctor dashboard should say WHY,
          not just show an arrow. */}
      <div className="mt-4 flex items-start gap-2.5 flex-wrap">
        <TrendBadge trend={trend} />
        <p className="text-sm text-neutral-600 flex-1 min-w-[12rem]">{reason}</p>
      </div>

      {/* Four domain mini-scores */}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
        {domains.map((domain) => (
          <DomainMiniScore key={domain.domain} domain={domain} />
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-neutral-100 flex items-center justify-between gap-3">
        <div className="flex gap-5 text-sm text-neutral-500">
          <span>
            Overall{" "}
            <span className="text-neutral-800 font-medium tabular-nums">
              {overall_score === null ? "—" : `${overall_score}%`}
            </span>
          </span>
          <span>
            Adherence{" "}
            <span className="text-neutral-800 font-medium tabular-nums">
              {adherence === null ? "—" : `${adherence}%`}
            </span>
          </span>
        </div>

        <button
          type="button"
          onClick={() => onOpen(id)}
          className="inline-flex items-center gap-1.5 text-sm font-medium rounded-lg
            border border-neutral-200 hover:border-primary-300 px-3.5 py-2
            text-neutral-700 transition-colors
            focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
        >
          Clinical view
          <ArrowRight size={15} />
        </button>
      </div>
    </article>
  );
}
