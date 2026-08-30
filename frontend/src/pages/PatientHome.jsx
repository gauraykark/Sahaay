import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { speak } from "../lib/utils";
import { isPreviewMode, listVaultRoutineSteps, setPreviewMode } from "../lib/db";
import { useAuth } from "../lib/auth";
import { useT, langToLocale } from "../lib/i18n";
import {
  SignOut,
  Heart,
  Sun,
} from "@phosphor-icons/react";

const GREETED_KEY = "sahaay-greeted";

export default function PatientHome() {
  const { user } = useAuth();
  const t = useT();
  const locale = langToLocale(user?.preferred_language || "en");

  const [greeting] = useState(() => {
    const hour = new Date().getHours();
    if (hour < 12) return t("greeting_morning");
    if (hour < 17) return t("greeting_afternoon");
    return t("greeting_evening");
  });

  const [routineSteps, setRoutineSteps] = useState([]);
  const [isRoutineLoading, setIsRoutineLoading] = useState(true);
  const [preview, setPreview] = useState(() => isPreviewMode());

  // Soft voice greeting — once per browser session, not once per mount.
  // Returning to this screen between games remounts it, and re-greeting every
  // time talks over whoever is mid-sentence. sessionStorage (not IndexedDB)
  // so a genuinely new visit is greeted again.
  useEffect(() => {
    if (sessionStorage.getItem(GREETED_KEY) === "true") return;

    const timer = setTimeout(() => {
      sessionStorage.setItem(GREETED_KEY, "true");
      speak(t("speak_greeting", greeting), { lang: locale });
    }, 600);

    return () => {
      clearTimeout(timer);
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, [greeting, locale, t]);

  useEffect(() => {
    listVaultRoutineSteps().then((steps) => {
      setRoutineSteps(steps);
      setIsRoutineLoading(false);
    });
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="px-5 pt-6 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-neutral-500">{greeting}</p>
            <h1 className="text-xl font-medium text-neutral-800 mt-0.5">
              {t("welcome_back")}
            </h1>
          </div>
          <Link
            to="/login"
            className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-700"
          >
            <SignOut size={18} weight="regular" />
            {t("exit")}
          </Link>
        </div>
      </header>

      {preview && (
        <div className="mx-5 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-900">
            <span className="font-medium">Caregiver preview.</span> Games are
            fully playable, but nothing is saved to this patient's record.
          </p>
          <button
            type="button"
            onClick={() => {
              setPreviewMode(false);
              setPreview(false);
            }}
            className="text-sm font-medium text-amber-900 underline underline-offset-2
              focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
          >
            Hand over to the patient
          </button>
        </div>
      )}

      {/* Main content */}
      <main className="px-5 pb-10">
        {/* Daily Guidance — step-by-step day plan, replaces the old
            static "no reminders" placeholder. Only shown once a caregiver
            has actually set steps, per Rule 6 (no fake placeholder data). */}
        {!isRoutineLoading && routineSteps.length > 0 && (
          <div className="mb-8">
            <h2 className="flex items-center gap-1.5 text-sm font-medium text-neutral-500 mb-3">
              <Sun size={16} weight="regular" />
              {t("your_day")}
            </h2>
            <div className="bg-white border border-neutral-200 rounded-lg divide-y divide-neutral-100">
              {routineSteps.map((step) => (
                <div key={step.id} className="flex items-center gap-3 px-5 py-3">
                  {step.time && (
                    <span className="text-sm text-neutral-500 w-16 shrink-0">
                      {step.time}
                    </span>
                  )}
                  <span className="text-neutral-800">{step.activity}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-neutral-600 mb-6">
          {t("choose_activity")}
        </p>

        {/* PLAY is the main thing, and it is one button. The five-card list
            that used to be here made the patient choose a game before they
            could start, which is a decision they should never have to make.
            Sprint 5 turns this into the real session runner (two sessions a
            day, all six domains, four-hour gap); for now it opens one domain,
            rotating by day so it is not the same one every time. */}
        <div className="space-y-4">
          <Link
            to="/patient/play"
            className="block w-full text-center bg-primary text-white rounded-3xl py-12 text-4xl font-medium"
          >
            {t("play")}
          </Link>

          <ActivityCard
            icon={Heart}
            title={t("people_you_know")}
            description={t("people_desc")}
            to="/patient/vault"
          />
        </div>
      </main>
    </div>
  );
}

function ActivityCard({ icon: Icon, title, description, to }) {
  return (
    <Link
      to={to}
      className="flex items-start gap-3 bg-white border border-neutral-200 rounded-lg px-5 py-4 hover:border-primary-300 transition-colors"
    >
      <Icon size={24} weight="regular" className="mt-0.5 text-primary-600 shrink-0" />
      <div>
        <div className="font-medium text-neutral-800 text-lg">
          {title}
        </div>
        <div className="mt-1 text-sm text-neutral-500">
          {description}
        </div>
      </div>
    </Link>
  );
}