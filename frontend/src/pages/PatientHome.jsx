import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { speak } from "../lib/utils";
import { listVaultRoutineSteps } from "../lib/db";
import { useAuth } from "../lib/auth";
import { useT, langToLocale } from "../lib/i18n";
import {
  SignOut,
  Cards,
  ListChecks,
  MagnifyingGlass,
  UserCircle,
  Heart,
  Sun,
} from "@phosphor-icons/react";

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

  // Soft voice greeting (only once when page loads)
  useEffect(() => {
    const timer = setTimeout(() => {
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

        {/* Activity list — Memory Vault first, per the revised priority
            order in SPEC_ADDENDUM_MEMORY_VAULT.md: the Vault + voice
            companion is the core feature, games are one tool among several. */}
        <div className="space-y-3">
          <ActivityCard
            icon={Heart}
            title={t("people_you_know")}
            description={t("people_desc")}
            to="/patient/vault"
          />
          <ActivityCard
            icon={Cards}
            title={t("memory_matching")}
            description={t("memory_desc")}
            to="/patient/game/memory"
          />
          <ActivityCard
            icon={ListChecks}
            title={t("daily_routine")}
            description={t("routine_desc")}
            to="/patient/game/routine"
          />
          <ActivityCard
            icon={MagnifyingGlass}
            title={t("object_recognition")}
            description={t("objects_desc")}
            to="/patient/game/objects"
          />
          <ActivityCard
            icon={UserCircle}
            title={t("name_recall")}
            description={t("name_recall_desc")}
            to="/patient/game/name-recall"
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