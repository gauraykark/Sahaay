// Shown when the next session is not yet available.
//
// NEVER a greyed-out button. A disabled control reads as broken, and a patient
// who thinks the app is broken stops opening it -- which costs the daily data
// the whole model depends on. So: a clock, a real time, and a warm sentence.

import { useState } from "react";

import { LOCK } from "@shared/sessionRules";
import { useT } from "../../lib/i18n";

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** A clock face drawn to the given time. Recognisable without reading. */
function ClockFace({ at, size = 200 }) {
  const d = new Date(at);
  const minute = d.getMinutes();
  const hour = d.getHours() % 12 + minute / 60;
  const r = size / 2;
  const hand = (angleDeg, length, width, color) => {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return (
      <line
        x1={r}
        y1={r}
        x2={r + Math.cos(rad) * length}
        y2={r + Math.sin(rad) * length}
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
      />
    );
  };
  return (
    <svg width={size} height={size} aria-hidden="true">
      <circle cx={r} cy={r} r={r - 6} fill="#fff" stroke="#78716c" strokeWidth="6" />
      {[...Array(12)].map((_, i) => {
        const rad = ((i * 30 - 90) * Math.PI) / 180;
        return (
          <circle
            key={i}
            cx={r + Math.cos(rad) * (r - 22)}
            cy={r + Math.sin(rad) * (r - 22)}
            r="4"
            fill="#a8a29e"
          />
        );
      })}
      {hand(hour * 30, r * 0.5, 8, "#44403c")}
      {hand(minute * 6, r * 0.72, 6, "#2f968c")}
      <circle cx={r} cy={r} r="7" fill="#44403c" />
    </svg>
  );
}

export default function WaitingScreen({ gate, onExit }) {
  const t = useT();
  // Frozen once. The clock face shows when play reopens, not a ticking now.
  const [fallback] = useState(() => Date.now());
  const soon = gate.reason === LOCK.GAP && gate.nextAt;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 gap-8">
      <ClockFace at={gate.nextAt ?? fallback} />

      <p className="text-3xl md:text-4xl font-medium text-neutral-800 text-center max-w-xl">
        {soon ? t("next_games_at", formatTime(gate.nextAt)) : t("come_back_later")}
      </p>

      {/* A real way onward, never a dead control. */}
      <button
        type="button"
        onClick={onExit}
        className="px-10 py-5 rounded-2xl bg-primary-600 text-white text-2xl font-medium"
      >
        {t("next")}
      </button>
    </div>
  );
}
