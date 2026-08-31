import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { speak } from "../lib/utils";
import { isPreviewMode, setPreviewMode } from "../lib/db";
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
    // `t` is deliberately NOT a dependency. useT() returns a new function on
    // every render, so including it re-runs this effect -- and the cleanup
    // cancels the pending greeting while the sessionStorage flag is already
    // set, so the greeting is silently lost rather than repeated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [greeting, locale]);

  useEffect(() => {
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
        {/* PLAY is the main thing, and it is one button. The five-card list
            that used to be here made the patient choose a game before they
            could start, which is a decision they should never have to make.
            Sprint 5 turns this into the real session runner (two sessions a
            day, all six domains, four-hour gap); for now it opens one domain,
            rotating by day so it is not the same one every time. */}
        <div className="space-y-4">
          <Link
            to="/patient/play"
            className="block w-full text-center bg-primary-600 text-white rounded-3xl py-12 text-4xl font-medium"
          >
            {t("play")}
          </Link>

          {/* THREE things, and only three: PLAY, My Day, My People. My Day is
              a problem-statement requirement, not an extra -- reminders are
              half of what the app is for, and it went missing when the old
              five-card game list was replaced. */}
          <ActivityCard
            icon={Sun}
            title={t("my_day")}
            description={t("my_day_desc")}
            to="/patient/day"
          />

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