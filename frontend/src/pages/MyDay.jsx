// My Day — /patient/day
//
// One of the three things the patient sees, alongside PLAY and My People.
// Medicines, water, meals, visits: what the day holds, in order, with one tap
// to mark a thing done.
//
// It is NOT a game and NOTHING here is scored. Reminder completion is an
// engagement signal for the report's secondary layer -- it explains and
// supports the verdict, it never moves a cognitive level. Someone missing
// their water reminders is worth a caregiver knowing; it is not evidence
// about their memory.
//
// Sprint 15 polishes this (voice reminders on a schedule, notification
// timing). What it needs now is to exist and to work.

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Sun } from "@phosphor-icons/react";
import { Link } from "react-router-dom";

import { listVaultRoutineSteps } from "../lib/db";
import { useSpeak, useT } from "../lib/i18n";

const DONE_KEY = "sahaay-day-done";

/** Ticks live per day, in localStorage, and reset when the date changes. */
function loadDone() {
  try {
    const raw = JSON.parse(localStorage.getItem(DONE_KEY) ?? "{}");
    const today = new Date().toLocaleDateString("en-CA");
    return raw.day === today ? new Set(raw.ids) : new Set();
  } catch {
    return new Set();
  }
}

function saveDone(ids) {
  try {
    localStorage.setItem(
      DONE_KEY,
      JSON.stringify({ day: new Date().toLocaleDateString("en-CA"), ids: [...ids] })
    );
  } catch {
    /* a full or blocked store must not break the screen */
  }
}

export default function MyDay() {
  const t = useT();
  const say = useSpeak();
  const [steps, setSteps] = useState([]);
  const [done, setDone] = useState(() => loadDone());
  const [loading, setLoading] = useState(true);
  // useSpeak refuses to repeat the same key, and marking the same step done
  // twice should speak twice. A counter gives a fresh key without reading the
  // clock during render.
  const utteranceRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    listVaultRoutineSteps()
      .then((rows) => {
        if (!cancelled) {
          setSteps(rows);
          setLoading(false);
        }
      })
      .catch(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (step) => {
    const next = new Set(done);
    if (next.has(step.id)) next.delete(step.id);
    else {
      next.add(step.id);
      // Read it back so the patient hears what they just marked.
      utteranceRef.current += 1;
      say(step.activity, `done-${step.id}-${utteranceRef.current}`);
    }
    setDone(next);
    saveDone(next);
  };

  const allDone = steps.length > 0 && steps.every((s) => done.has(s.id));

  return (
    <div className="min-h-screen bg-background">
      <header className="px-5 pt-6 pb-4 flex items-center gap-3">
        <Link
          to="/patient"
          className="p-3 rounded-xl border-2 border-neutral-300 text-neutral-700"
          aria-label={t("exit")}
        >
          <ArrowLeft size={24} />
        </Link>
        <h1 className="flex items-center gap-2 text-3xl font-medium text-neutral-800">
          <Sun size={28} weight="regular" />
          {t("my_day")}
        </h1>
      </header>

      <main className="px-5 pb-12">
        {loading ? null : steps.length === 0 ? (
          <p className="text-2xl text-neutral-500 mt-8 text-center">
            {t("nothing_today")}
          </p>
        ) : (
          <>
            {allDone && (
              <p className="text-2xl text-primary-700 mb-5 text-center">
                {t("all_done_today")}
              </p>
            )}
            <ul className="space-y-3">
              {steps.map((step) => {
                const isDone = done.has(step.id);
                return (
                  <li key={step.id}>
                    {/* One big tap target. Marking something done is a warm
                        confirmation, and un-marking is allowed -- a patient
                        who taps the wrong row must not be stuck with it. */}
                    <button
                      type="button"
                      onClick={() => toggle(step)}
                      className={`w-full flex items-center gap-4 rounded-2xl border-2 px-5 py-6 text-left transition-colors ${
                        isDone
                          ? "border-primary-500 bg-teal-50"
                          : "border-neutral-300 bg-white"
                      }`}
                    >
                      <span
                        className={`shrink-0 w-12 h-12 rounded-full border-2 flex items-center justify-center ${
                          isDone
                            ? "border-primary-600 bg-primary-600 text-white"
                            : "border-neutral-300 text-transparent"
                        }`}
                      >
                        <Check size={26} weight="bold" />
                      </span>
                      <span className="flex-1">
                        <span className="block text-2xl text-neutral-800">
                          {step.activity}
                        </span>
                        {step.time && (
                          <span className="block text-lg text-neutral-500 mt-0.5">
                            {step.time}
                          </span>
                        )}
                      </span>
                      {!isDone && (
                        <span className="text-lg text-neutral-400">{t("mark_done")}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
