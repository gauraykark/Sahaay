// Single Patient Clinical View.
//
// Reuses the caregiver detail layout, with the differences the requirements
// call for:
//
//   Header          clinical tone — patient ID, age, diagnosis stage
//   Score           with comparison against the previous period + percentile
//   Adaptive levels history + the reason behind each AI recommendation
//   Daily Guidance  READ-ONLY, with adherence %
//   People          READ-ONLY
//   New sections    Clinical notes + AI summary
//                   Cognitive domains breakdown (4 cards)
//                   Trend graph (last 30 days)
//                   Recommended actions
//
// Read-only is enforced on the server too — the doctor role cannot write
// reminders or vault entries. The UI simply does not offer it.

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ChartLine,
  ClipboardText,
  FirstAid,
  Heart,
  ListChecks,
  Note,
  SignOut,
  Sun,
  UserCircle,
} from "@phosphor-icons/react";

import Avatar from "../components/ui/Avatar";
import Button from "../components/ui/Button";
import TrendGraph from "../components/ui/TrendGraph";
import { DomainFlagBadge } from "../components/ui/Badge";
import { DomainCard } from "../components/ui/DomainScore";
import { EmptyState, SectionCard, SectionHeading } from "../components/ui/Card";
import StatTile, { ComparisonStat } from "../components/ui/StatTile";
import { addClinicalNote, fetchClinicalView, generateReport } from "../lib/api";
import { useAuth } from "../lib/auth";

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function PatientClinicalView() {
  const { patientId } = useParams();
  const navigate = useNavigate();
  const { signOut } = useAuth();

  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  const [noteBody, setNoteBody] = useState("");
  const [needsFollowup, setNeedsFollowup] = useState(false);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const load = async () => {
    try {
      const payload = await fetchClinicalView(patientId);
      setData(payload);
      setStatus("ready");
    } catch (err) {
      setError(err.message || "Could not load this patient.");
      setStatus("error");
    }
  };

  useEffect(() => {
    setStatus("loading");
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const handleSaveNote = async (event) => {
    event.preventDefault();
    if (!noteBody.trim()) return;

    setIsSavingNote(true);
    try {
      await addClinicalNote(patientId, {
        body: noteBody,
        needsFollowup,
      });
      setNoteBody("");
      setNeedsFollowup(false);
      await load();
    } catch (err) {
      setError(err.message || "Could not save the note.");
    } finally {
      setIsSavingNote(false);
    }
  };

  const handleGenerateSummary = async () => {
    setIsGenerating(true);
    try {
      await generateReport({
        patientId: Number(patientId),
        audience: "doctor",
        periodDays: 30,
      });
      await load();
    } catch (err) {
      setError(err.message || "Could not generate the summary.");
    } finally {
      setIsGenerating(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-background px-5 py-8">
        <p className="text-neutral-400 max-w-6xl mx-auto">Loading patient…</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-screen bg-background px-5 py-8">
        <div className="max-w-2xl mx-auto">
          <SectionCard>
            <h1 className="font-medium text-neutral-800 text-lg">
              Could not load this patient
            </h1>
            <p className="mt-1 text-neutral-600">{error}</p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              onClick={() => navigate("/doctor")}
            >
              Back to all patients
            </Button>
          </SectionCard>
        </div>
      </div>
    );
  }

  const {
    patient,
    caregiver_name,
    caregiver_email,
    overall_score,
    previous_score,
    percentile,
    adherence,
    domains,
    trend_30d,
    difficulty_history,
    notes,
    recommended_actions,
    routine_steps,
    latest_report,
    has_enough_data: hasEnoughData = true,
    sittings_14d: sittings = 0,
    flagged_domains: flags = [],
  } = data;

  return (
    <div className="min-h-screen bg-background">
      {/* ── Clinical header ───────────────────────────────────────────── */}
      <header className="px-5 pt-6 pb-5 border-b border-neutral-200 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => navigate("/doctor")}
                className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-700 mb-3 transition-colors"
              >
                <ArrowLeft size={18} />
                All patients
              </button>

              <div className="flex items-center gap-3">
                <Avatar
                  name={patient.name}
                  photo={patient.photo}
                  id={patient.id}
                  size="lg"
                />
                <div className="min-w-0">
                  <h1 className="text-xl font-medium text-neutral-800 truncate">
                    {patient.name}
                  </h1>
                  {/* Clinical tone: identifiers, not a greeting. */}
                  <p className="text-sm text-neutral-500 tabular-nums">
                    Patient ID {String(patient.id).padStart(4, "0")}
                    {patient.age ? ` · ${patient.age} years` : ""}
                    {patient.diagnosis_stage
                      ? ` · ${patient.diagnosis_stage} stage`
                      : ""}
                  </p>
                  <p className="text-sm text-neutral-500">
                    Enrolled {formatDate(patient.created_at)} · Last sync{" "}
                    {formatDate(patient.last_sync_at)}
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                signOut();
                navigate("/login");
              }}
              className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-700 shrink-0 transition-colors"
            >
              <SignOut size={18} weight="regular" />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="px-5 py-6 max-w-6xl mx-auto flex flex-col gap-4">
        {/* ── Score + caregiver ─────────────────────────────────────── */}
        <div className="grid gap-4 lg:grid-cols-3">
          <SectionCard className="lg:col-span-2">
            <SectionHeading icon={ChartLine}>Cognitive performance</SectionHeading>
            <div className="grid gap-6 sm:grid-cols-3">
              <ComparisonStat
                label="Overall, last 30 days"
                value={overall_score}
                previous={previous_score}
                percentile={percentile}
              />
              <StatTile
                label="Reminder adherence"
                value={adherence}
                suffix="%"
                detail="Last 7 days"
              />
              <StatTile
                label="Sessions on record"
                value={trend_30d.reduce((sum, day) => sum + day.sessions, 0)}
                detail="Last 30 days"
              />
            </div>
          </SectionCard>

          <SectionCard>
            <SectionHeading icon={UserCircle}>Caregiver</SectionHeading>
            <p className="font-medium text-neutral-800">{caregiver_name}</p>
            <p className="text-sm text-neutral-500 break-all">{caregiver_email}</p>
            <p className="text-xs text-neutral-400 mt-2">
              One caregiver supports this patient.
            </p>
          </SectionCard>
        </div>

        {/* ── Cognitive domains breakdown ───────────────────────────── */}
        <section>
          <SectionHeading icon={FirstAid}>Cognitive domains</SectionHeading>
          {flags.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {flags.map((flag) => (
                <DomainFlagBadge key={flag.domain} flag={flag} />
              ))}
              <p className="text-sm text-neutral-600">
                Base level down {Math.abs(flags[0].delta)} steps over 30 days
                while the other domains held.
              </p>
            </div>
          ) : null}
          {/* Six now, so 3x2 on large screens rather than 4 across. */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {domains.map((domain) => (
              <DomainCard key={domain.domain} domain={domain} />
            ))}
          </div>
        </section>

        {/* ── Trend graph ───────────────────────────────────────────── */}
        <SectionCard>
          <SectionHeading icon={ChartLine}>Last 30 days</SectionHeading>
          {/* NEVER DRAW A LINE THE DATA CANNOT SUPPORT. Below the trust
              threshold the dots stay -- they are real measurements that
              really happened -- but the graph is not offered as a trend, and
              the reader is told the count so they can judge it themselves.
              A flat line and no data look identical and mean the opposite. */}
          {hasEnoughData ? null : (
            <p className="mb-3 text-sm text-neutral-600 bg-[#fbf3e6] border border-[#eddcbe] rounded-lg px-3 py-2">
              Not enough data to read a trend — {sittings} session
              {sittings === 1 ? "" : "s"} in the last 14 days. The points below
              are what was measured, not a direction.
            </p>
          )}
          <TrendGraph data={trend_30d} />
          <p className="text-xs text-neutral-400 mt-2">
            Each dot is a day with sessions. A dashed line spans days with no
            sessions — no score was measured across it.
          </p>
        </SectionCard>

        {/* ── Adaptive levels + recommended actions ─────────────────── */}
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard>
            <SectionHeading icon={ListChecks}>Adaptive level history</SectionHeading>
            {difficulty_history.length === 0 ? (
              <EmptyState>No difficulty changes recorded yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {difficulty_history.map((change) => (
                  <li key={change.id} className="py-2.5 first:pt-0 last:pb-0">
                    <p className="text-neutral-800">
                      {change.game_type.replace("-", " ")}: level{" "}
                      <span className="tabular-nums">{change.from_level}</span> →{" "}
                      <span className="tabular-nums">{change.to_level}</span>
                    </p>
                    {change.reason ? (
                      <p className="text-sm text-neutral-600">{change.reason}</p>
                    ) : null}
                    <p className="text-xs text-neutral-400">
                      {formatDate(change.created_at)} ·{" "}
                      {change.source === "ai"
                        ? "decided by AI"
                        : "decided offline by rules"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard>
            <SectionHeading icon={ClipboardText}>Recommended actions</SectionHeading>
            {recommended_actions.length === 0 ? (
              <EmptyState>No actions suggested for this period.</EmptyState>
            ) : (
              <ul className="space-y-2">
                {recommended_actions.map((action) => (
                  <li key={action} className="flex items-start gap-2 text-neutral-700">
                    <span
                      className="mt-2 w-1.5 h-1.5 rounded-full bg-primary-500 shrink-0"
                      aria-hidden="true"
                    />
                    {action}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>

        {/* ── Daily guidance (read-only) + people (read-only) ───────── */}
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard>
            <SectionHeading icon={Sun}>
              Daily guidance
              <span className="font-normal text-neutral-400"> · read-only</span>
            </SectionHeading>
            {routine_steps.length === 0 ? (
              <EmptyState>The caregiver has not set a daily routine yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {routine_steps.map((step) => (
                  <li key={step} className="py-2 first:pt-0 last:pb-0 text-neutral-700">
                    {step}
                  </li>
                ))}
              </ul>
            )}
            {adherence !== null ? (
              <p className="text-sm text-neutral-500 mt-3 pt-3 border-t border-neutral-100">
                Adherence over the last 7 days:{" "}
                <span className="text-neutral-800 font-medium tabular-nums">
                  {adherence}%
                </span>
              </p>
            ) : null}
          </SectionCard>

          <SectionCard>
            <SectionHeading icon={Heart}>
              People for name recall
              <span className="font-normal text-neutral-400"> · read-only</span>
            </SectionHeading>
            <EmptyState>
              People are stored on the patient's own device and are not synced to the
              server yet.
            </EmptyState>
          </SectionCard>
        </div>

        {/* ── Clinical notes + AI summary ───────────────────────────── */}
        <SectionCard>
          <SectionHeading
            icon={Note}
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={handleGenerateSummary}
                disabled={isGenerating}
              >
                {isGenerating ? "Generating…" : "Generate AI summary"}
              </Button>
            }
          >
            Clinical notes
          </SectionHeading>

          {latest_report ? (
            <div className="rounded-lg bg-primary-50 border border-primary-100 px-4 py-3 mb-4">
              <p className="text-xs font-medium text-primary-700 uppercase tracking-wide">
                AI progress summary
              </p>
              <p className="mt-1 text-neutral-700">{latest_report.summary}</p>
              {latest_report.observations?.length ? (
                <ul className="mt-2 space-y-0.5">
                  {latest_report.observations.map((line) => (
                    <li key={line} className="text-sm text-neutral-600">
                      {line}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <form onSubmit={handleSaveNote} className="flex flex-col gap-3">
            <label className="block">
              <span className="sr-only">New clinical note</span>
              <textarea
                value={noteBody}
                onChange={(event) => setNoteBody(event.target.value)}
                rows={3}
                placeholder="Add a clinical note…"
                className="w-full rounded-lg border border-neutral-200 px-4 py-3
                  text-neutral-800 placeholder:text-neutral-400
                  focus:border-primary-300 focus:outline-none transition-colors resize-y"
              />
            </label>

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <label className="flex items-center gap-2 text-sm text-neutral-600">
                <input
                  type="checkbox"
                  checked={needsFollowup}
                  onChange={(event) => setNeedsFollowup(event.target.checked)}
                  className="w-4 h-4 accent-primary-600"
                />
                Mark as needs follow-up
              </label>

              <Button type="submit" size="sm" disabled={isSavingNote || !noteBody.trim()}>
                {isSavingNote ? "Saving…" : "Save note"}
              </Button>
            </div>
          </form>

          {notes.length > 0 ? (
            <ul className="divide-y divide-neutral-100 mt-4 pt-2">
              {notes.map((note) => (
                <li key={note.id} className="py-3">
                  <p className="text-neutral-800 whitespace-pre-wrap">{note.body}</p>
                  <p className="text-xs text-neutral-400 mt-1">
                    {formatDate(note.created_at)}
                    {note.needs_followup ? " · flagged for follow-up" : ""}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
        </SectionCard>
      </main>
    </div>
  );
}
