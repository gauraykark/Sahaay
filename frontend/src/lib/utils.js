// src/lib/utils.js
//
// Small, pure, shared helpers used across pages and games. Kept dependency-free
// and framework-agnostic so they're easy to test and reuse.

import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { MAX_LEVEL, MIN_LEVEL } from "@shared/levels";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/** Time-of-day greeting used on Patient Home and in the voice greeting. */
export function getGreeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * Formats an ISO timestamp as a short, calm relative label for the
 * caregiver dashboard: "Today", "Yesterday", or a short date.
 * Deliberately avoids precise timestamps/"3 hours ago" style copy,
 * which reads as more clinical/anxious than the product's tone calls for.
 */
export function formatRelativeDay(isoString) {
  if (!isoString) return "—";

  const date = new Date(isoString);
  const now = new Date();

  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round(
    (startOf(now) - startOf(date)) / (1000 * 60 * 60 * 24)
  );

  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Yesterday";

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/**
 * Turns a raw session row into a short, human-readable detail line for the
 * dashboard, e.g. "Completed · 6 moves" or "4 of 5 correct".
 * Centralized here so every game's session shape is described consistently.
 */
export function describeSession(session) {
  if (!session) return "Not played yet";

  const levelBit =
    typeof session.level === "number" ? ` · Level ${session.level}` : "";

  if (typeof session.moves === "number") {
    return session.completed
      ? `Completed · ${session.moves} moves${levelBit}`
      : `Not finished · ${session.moves} moves${levelBit}`;
  }

  if (typeof session.score === "number" && typeof session.total === "number") {
    return `${session.score} of ${session.total} correct${levelBit}`;
  }

  return session.completed ? `Completed${levelBit}` : `Not finished${levelBit}`;
}

/**
 * Rule-based adaptive difficulty (REQ-003 / F-013): fully offline, no AI.
 *
 * The minLevel/maxLevel defaults used to be a third private copy of the level
 * range (2-4 here, 1-5 below, neither matching GAME_LEVEL_META or the server).
 * They defer to shared/levels.js now. Callers that want a narrower window
 * still pass one explicitly.
 * Given how many moves a game took relative to the "ideal" number of moves,
 * decide whether to raise, lower, or hold the difficulty level.
 *
 * Extracted from MemoryGame so the same rule can be reused/tested and so
 * the thresholds live in one documented place.
 */
export function nextDifficultyLevel({
  currentLevel,
  moves,
  idealMoves,
  minLevel = MIN_LEVEL,
  maxLevel = MAX_LEVEL,
  raiseThreshold = 1.6,
  lowerThreshold = 2.8,
}) {
  const ratio = moves / idealMoves;

  if (ratio <= raiseThreshold && currentLevel < maxLevel) {
    return currentLevel + 1;
  }
  if (ratio >= lowerThreshold && currentLevel > minLevel) {
    return currentLevel - 1;
  }
  return currentLevel;
}

/**
 * Accuracy-based adaptive difficulty for scored games (objects, name recall).
 * Raise when most answers are right; lower when fewer than half are.
 */
export function nextLevelByAccuracy({
  currentLevel,
  correct,
  total,
  minLevel = MIN_LEVEL,
  maxLevel = MAX_LEVEL,
  raiseThreshold = 0.8,
  lowerThreshold = 0.5,
}) {
  if (!total) return currentLevel;
  const rate = correct / total;

  if (rate >= raiseThreshold && currentLevel < maxLevel) {
    return currentLevel + 1;
  }
  if (rate < lowerThreshold && currentLevel > minLevel) {
    return currentLevel - 1;
  }
  return currentLevel;
}

/**
 * Returns true if the user has requested reduced motion at the OS/browser
 * level. Games and pages should check this before running non-essential
 * animations (Rule 9 in the design spec).
 */
export function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Speaks a short phrase via the Web Speech API at the elderly-friendly rate
 * used app-wide. Pass lang (BCP-47 tag) to speak in the patient's preferred
 * language — e.g. "as-IN" for Assamese, "en-IN" for English (default).
 */
export function speak(text, { rate = 0.9, pitch = 1, volume = 0.85, lang = "en-IN" } = {}) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  if (!text) return;

  // Cancel whatever is still speaking. Without this the utterances QUEUE, and
  // a patient who moves through three items hears three instructions stacked
  // up, the last of them describing a screen that is no longer there.
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = rate;
  utterance.pitch = pitch;
  utterance.volume = volume;
  utterance.lang = lang;
  window.speechSynthesis.speak(utterance);
}

/**
 * True if the browser supports the SpeechRecognition API. Support is
 * inconsistent (notably Safari/iOS), so the UI must check this and hide
 * or disable voice-input affordances rather than fail silently.
 * See SPEC_ADDENDUM_MEMORY_VAULT.md Section 5.
 */
export function supportsVoiceInput() {
  if (typeof window === "undefined") return false;
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * Listens for a single spoken phrase and resolves with the transcript.
 * Used for the "Who is X?" voice Q&A over the Memory Vault. This is a
 * one-shot listen (not continuous dictation) — appropriate for a single
 * short question, and easier for an elderly user to understand ("it
 * listens once, then answers") than an always-on microphone.
 *
 * Rejects if the browser doesn't support SpeechRecognition, if nothing
 * is heard in time, or if the user denies microphone permission.
 */
export function listenOnce({ lang = "en-IN", timeoutMs = 6000 } = {}) {
  return new Promise((resolve, reject) => {
    const SpeechRecognitionImpl =
      typeof window !== "undefined" &&
      (window.SpeechRecognition || window.webkitSpeechRecognition);

    if (!SpeechRecognitionImpl) {
      reject(new Error("Voice input is not supported on this device."));
      return;
    }

    const recognizer = new SpeechRecognitionImpl();
    recognizer.lang = lang;
    recognizer.continuous = false;
    recognizer.interimResults = false;
    recognizer.maxAlternatives = 1;

    const timeout = setTimeout(() => {
      recognizer.stop();
      reject(new Error("Didn't hear anything. Please try again."));
    }, timeoutMs);

    recognizer.onresult = (event) => {
      clearTimeout(timeout);
      const transcript = event.results?.[0]?.[0]?.transcript || "";
      resolve(transcript);
    };

    recognizer.onerror = (event) => {
      clearTimeout(timeout);
      reject(new Error(event.error || "Voice input failed."));
    };

    recognizer.onend = () => {
      clearTimeout(timeout);
    };

    recognizer.start();
  });
}

/**
 * Extracts a likely name from a spoken question about a person, e.g.
 * "who is Rahul" -> "Rahul". Falls back to the raw transcript if no
 * recognizable question pattern is found, so a direct name ("Rahul")
 * still works.
 */
export function extractNameFromQuestion(transcript) {
  const match = transcript.match(/who\s+is\s+(.+)/i);
  return (match ? match[1] : transcript).replace(/[?.!]/g, "").trim();
}