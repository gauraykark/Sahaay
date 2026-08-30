// Doctor Dashboard.
//
// Layout follows the requirements exactly:
//
//   Header        doctor name + designation · search · five filter chips
//   Insight strip Today's Priority — 2-3 patients with reasons
//   Main          two columns, 70 / 30
//                   left  : smart patient cards
//                   right : AI Clinical Assistant
//
// Everything renders from one request. Filtering and search run client-side
// over that payload — a caseload is tens of patients, not thousands, and a
// round trip per keystroke would make the search feel broken on a weak
// connection.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MagnifyingGlass, SignOut, Users } from "@phosphor-icons/react";

import ClinicalAssistant from "../components/doctor/ClinicalAssistant";
import PatientCard from "../components/doctor/PatientCard";
import PriorityStrip from "../components/doctor/PriorityStrip";
import FilterChips from "../components/ui/FilterChips";
import { EmptyState, SectionCard } from "../components/ui/Card";
import { fetchDoctorDashboard, generateReport } from "../lib/api";
import { useAuth } from "../lib/auth";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "attention", label: "Needs attention" },
  { id: "improving", label: "Improving" },
  { id: "stable", label: "Stable" },
  { id: "offline", label: "High offline usage" },
];

function matchesFilter(patient, filter) {
  switch (filter) {
    case "attention":
      return patient.risk === "high" || patient.trend === "declining";
    case "improving":
      return patient.trend === "improving";
    case "stable":
      return patient.trend === "stable";
    case "offline":
      return patient.is_offline;
    default:
      return true;
  }
}

export default function DoctorDashboard() {
  const navigate = useNavigate();
  const { signOut } = useAuth();

  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportNotice, setReportNotice] = useState("");

  useEffect(() => {
    let cancelled = false;

    fetchDoctorDashboard()
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || "Could not load your patients.");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const patients = data?.patients ?? [];

  const counts = useMemo(() => {
    const result = {};
    for (const option of FILTERS) {
      result[option.id] = patients.filter((p) => matchesFilter(p, option.id)).length;
    }
    return result;
  }, [patients]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return patients
      .filter((patient) => matchesFilter(patient, filter))
      .filter(
        (patient) =>
          !needle ||
          patient.name.toLowerCase().includes(needle) ||
          patient.caregiver_name.toLowerCase().includes(needle) ||
          String(patient.id) === needle
      );
  }, [patients, filter, query]);

  const openPatient = (patientId) => navigate(`/doctor/patient/${patientId}`);

  const handleGenerateReport = async () => {
    const target = visible[0] ?? patients[0];
    if (!target) return;

    setIsGenerating(true);
    setReportNotice("");
    try {
      await generateReport({
        patientId: target.id,
        audience: "doctor",
        periodDays: 7,
      });
      setReportNotice(`Weekly report saved for ${target.name}.`);
    } catch (err) {
      setReportNotice(err.message || "Could not generate the report.");
    } finally {
      setIsGenerating(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-background">
        <div className="px-5 py-8 max-w-7xl mx-auto">
          <p className="text-neutral-400">Loading your patients…</p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-screen bg-background">
        <div className="px-5 py-8 max-w-2xl mx-auto">
          <SectionCard>
            <h1 className="font-medium text-neutral-800 text-lg">
              Could not load your patients
            </h1>
            <p className="mt-1 text-neutral-600">{error}</p>
            <p className="mt-3 text-sm text-neutral-500">
              Check that the backend is running, then reload this page.
            </p>
          </SectionCard>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* ── Top header ───────────────────────────────────────────────── */}
      <header className="px-5 pt-6 pb-5 border-b border-neutral-200 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm text-neutral-500">Doctor</p>
              <h1 className="text-xl font-medium text-neutral-800 mt-0.5">
                {data.doctor_name}
                {data.designation ? (
                  <span className="text-neutral-500 font-normal">
                    {" "}
                    · {data.designation}
                  </span>
                ) : null}
              </h1>
              <p className="flex items-center gap-1.5 text-sm text-neutral-500 mt-1">
                <Users size={15} weight="regular" />
                {data.total_patients} patient
                {data.total_patients === 1 ? "" : "s"} under your care
              </p>
            </div>

            <div className="flex items-center gap-4">
              <label className="relative">
                <span className="sr-only">Search patients</span>
                <MagnifyingGlass
                  size={17}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by patient or caregiver"
                  className="w-64 rounded-lg border border-neutral-200 bg-white
                    pl-9 pr-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400
                    focus:border-primary-300 focus:outline-none transition-colors"
                />
              </label>

              <button
                type="button"
                onClick={() => {
                  signOut();
                  navigate("/login");
                }}
                className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-700 transition-colors"
              >
                <SignOut size={18} weight="regular" />
                Sign out
              </button>
            </div>
          </div>

          <div className="mt-4">
            <FilterChips
              options={FILTERS.map((option) => ({
                ...option,
                count: counts[option.id] ?? 0,
              }))}
              value={filter}
              onChange={setFilter}
            />
          </div>
        </div>
      </header>

      <main className="px-5 py-6 max-w-7xl mx-auto">
        {/* ── Top insight strip ──────────────────────────────────────── */}
        <PriorityStrip items={data.priority} onOpenPatient={openPatient} />

        {/* ── Two-column: 70 / 30 ────────────────────────────────────── */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] items-start">
          <div className="flex flex-col gap-4 min-w-0">
            {visible.length === 0 ? (
              <SectionCard>
                <EmptyState>
                  {patients.length === 0
                    ? "No patients are assigned to you yet."
                    : "No patients match this filter."}
                </EmptyState>
              </SectionCard>
            ) : (
              visible.map((patient) => (
                <PatientCard
                  key={patient.id}
                  patient={patient}
                  onOpen={openPatient}
                />
              ))
            )}
          </div>

          <aside className="min-w-0 lg:sticky lg:top-6">
            <ClinicalAssistant
              assistant={data.assistant}
              onOpenPatient={openPatient}
              onGenerateReport={handleGenerateReport}
              isGenerating={isGenerating}
            />
            {reportNotice ? (
              <p className="mt-3 text-sm text-neutral-600">{reportNotice}</p>
            ) : null}
          </aside>
        </div>
      </main>
    </div>
  );
}
