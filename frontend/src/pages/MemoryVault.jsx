import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Heart,
  Microphone,
  SpeakerHigh,
} from "@phosphor-icons/react";
import { listVaultPeople, findVaultPersonByName } from "../lib/db";
import {
  speak,
  listenOnce,
  supportsVoiceInput,
  extractNameFromQuestion,
} from "../lib/utils";
import { useT, langToLocale, useActivePatientLanguage } from "../lib/i18n";

export default function MemoryVault() {
  const t = useT();
  const patientLang = useActivePatientLanguage();
  const locale = langToLocale(patientLang);

  const [people, setPeople] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [lastAnswer, setLastAnswer] = useState(null);
  const [voiceAvailable] = useState(() => supportsVoiceInput());

  useEffect(() => {
    listVaultPeople().then((rows) => {
      setPeople(rows);
      setIsLoading(false);
    });
  }, []);

  const announcePerson = (person) => {
    const phrase = t("this_is", person.name, person.relationship || "");
    setLastAnswer({ name: person.name, relationship: person.relationship });
    speak(phrase, { lang: locale });
  };

  const handleAsk = async () => {
    if (!voiceAvailable || isListening) return;

    setIsListening(true);
    setLastAnswer(null);

    try {
      const transcript = await listenOnce({ lang: locale });
      const name = extractNameFromQuestion(transcript);
      const match = await findVaultPersonByName(name);

      if (match) {
        announcePerson(match);
      } else {
        setLastAnswer({ notFound: true, heard: name });
        speak(t("not_sure_who"), { lang: locale });
      }
    } catch {
      setLastAnswer({ error: true });
    } finally {
      setIsListening(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="px-5 pt-5 pb-4 flex items-center justify-between">
        <Link
          to="/patient"
          className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-700"
        >
          <ArrowLeft size={18} weight="regular" />
          Back
        </Link>
        <h1 className="text-lg font-medium text-neutral-800">
          {t("people_you_know")}
        </h1>
        <div className="w-10" />
      </header>

      <main className="flex-1 px-5 pb-10 max-w-md mx-auto w-full">
        {/* Voice Q&A */}
        {voiceAvailable && (
          <div className="mb-8 text-center">
            <button
              onClick={handleAsk}
              disabled={isListening}
              className={`inline-flex flex-col items-center gap-2 rounded-full transition-colors ${
                isListening ? "text-primary-700" : "text-neutral-600 hover:text-primary-700"
              }`}
            >
              <span
                className={`w-16 h-16 rounded-full flex items-center justify-center border-2 ${
                  isListening
                    ? "border-primary-400 bg-primary-50"
                    : "border-neutral-300 bg-white"
                }`}
              >
                <Microphone size={28} weight="regular" />
              </span>
              <span className="text-sm">
                {isListening ? "Listening…" : "Ask \u201cWho is...\u201d"}
              </span>
            </button>

            {lastAnswer && (
              <div className="mt-4 bg-white border border-neutral-200 rounded-lg px-5 py-4 text-left">
                {lastAnswer.error && (
                  <p className="text-neutral-600">
                    Sorry, I couldn't hear that clearly. Please try again.
                  </p>
                )}
                {lastAnswer.notFound && (
                  <p className="text-neutral-600">
                    I'm not sure who "{lastAnswer.heard}" is yet.
                  </p>
                )}
                {!lastAnswer.error && !lastAnswer.notFound && (
                  <div className="flex items-center gap-2">
                    <SpeakerHigh size={20} weight="regular" className="text-primary-600 shrink-0" />
                    <p className="text-neutral-800">
                      <span className="font-medium">{lastAnswer.name}</span>
                      {lastAnswer.relationship ? ` — ${lastAnswer.relationship}` : ""}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* People list */}
        {isLoading ? (
          <p className="text-neutral-400 text-center">Loading…</p>
        ) : people.length === 0 ? (
          <div className="text-center py-10">
            <Heart size={28} weight="regular" className="text-neutral-300 mx-auto mb-3" />
            <p className="text-neutral-600">No one added yet</p>
            <p className="text-sm text-neutral-500 mt-1">
              A caregiver can add family and friends here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {people.map((person) => (
              <button
                key={person.id}
                onClick={() => announcePerson(person)}
                className="flex items-center gap-3 w-full text-left bg-white border border-neutral-200 hover:border-primary-300 rounded-lg px-5 py-4 transition-colors"
              >
                <PersonAvatar person={person} />
                <div className="flex-1">
                  <p className="font-medium text-neutral-800 text-lg">
                    {person.name}
                  </p>
                  {person.relationship && (
                    <p className="text-sm text-neutral-500 mt-0.5">
                      {person.relationship}
                    </p>
                  )}
                </div>
                <SpeakerHigh size={18} weight="regular" className="text-neutral-400 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function PersonAvatar({ person }) {
  if (person.photo) {
    return (
      <img
        src={person.photo}
        alt=""
        className="w-12 h-12 rounded-full object-cover shrink-0"
      />
    );
  }
  const initial = person.name?.trim()?.[0]?.toUpperCase() || "?";
  return (
    <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-medium text-lg bg-primary-500 shrink-0">
      {initial}
    </div>
  );
}