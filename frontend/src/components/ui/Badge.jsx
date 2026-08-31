// Status badges.
//
// Rule: semantic colour (risk, trend) is separate from the primary green.
// Primary green means "this is the app's accent / a primary action". It never
// also means "good", or the two readings collide on a dense screen.
//
// Every badge carries a word, not just a colour — colour alone fails for
// colour-blind users and prints badly.

import { ArrowDown, ArrowRight, ArrowUp, WifiSlash } from "@phosphor-icons/react";

const TONES = {
  neutral: "bg-neutral-100 text-neutral-600 border-neutral-200",
  good: "bg-[#e8f3ed] text-[#2f7355] border-[#c3e0d1]",
  warn: "bg-[#fbf3e6] text-[#8a5a12] border-[#eddcbe]",
  bad: "bg-[#fbeeec] text-[#9c3227] border-[#f0d2cd]",
};

export function Badge({ tone = "neutral", icon: Icon, children, className = "" }) {
  return (
    <span
      className={`inline-flex items-center gap-1 border rounded-md px-2 py-0.5 text-xs font-medium ${TONES[tone]} ${className}`}
    >
      {Icon ? <Icon size={12} weight="bold" /> : null}
      {children}
    </span>
  );
}

const RISK_TONE = { low: "good", medium: "warn", high: "bad" };
const RISK_LABEL = { low: "Low risk", medium: "Medium risk", high: "High risk" };

export function RiskBadge({ risk }) {
  return <Badge tone={RISK_TONE[risk] ?? "neutral"}>{RISK_LABEL[risk] ?? "Unknown"}</Badge>;
}

const TREND_META = {
  improving: { tone: "good", icon: ArrowUp, label: "Improving" },
  stable: { tone: "neutral", icon: ArrowRight, label: "Stable" },
  declining: { tone: "warn", icon: ArrowDown, label: "Declining" },
  // Two different gaps, deliberately worded the same way to the reader and
  // kept apart in the data. `unknown` is one domain with too few scored
  // rounds; `insufficient_data` is the patient not having sat down often
  // enough for any of their six lines to be trustworthy. Both must read as an
  // absence of evidence, never as a flat line -- a flat line and no data look
  // identical on a graph and mean opposite things.
  unknown: { tone: "neutral", icon: ArrowRight, label: "Not enough data" },
  insufficient_data: {
    tone: "neutral",
    icon: ArrowRight,
    label: "Not enough data",
  },
};

export function TrendBadge({ trend }) {
  const meta = TREND_META[trend] ?? TREND_META.unknown;
  return (
    <Badge tone={meta.tone} icon={meta.icon}>
      {meta.label}
    </Badge>
  );
}

// A domain whose stored base level has fallen two or more steps and stayed
// down. Amber, not red: this is "look at this", not "something has gone
// wrong", and the distinction matters to a caregiver reading it about their
// own parent.
//
// It names the domain. A flag that only says "declining" tells a caregiver
// something is wrong without telling them what changed, which is the exact
// failure of a single overall score.
export function DomainFlagBadge({ flag }) {
  if (!flag) return null;
  return (
    <Badge tone="warn" icon={ArrowDown}>
      {flag.label} down {Math.abs(flag.delta)}
    </Badge>
  );
}

export function OfflineBadge({ isOffline }) {
  if (!isOffline) return null;
  // Offline is a normal state in the NER, not a fault. Neutral, not red.
  return (
    <Badge tone="neutral" icon={WifiSlash}>
      Offline
    </Badge>
  );
}

// Says whether guidance came from the AI or the offline rule engine.
// Shown on purpose: graceful degradation only reads as deliberate if it is
// visible. See g_prop_02_architecture.md D11.
export function SourceBadge({ source }) {
  return (
    <Badge tone="neutral" className="font-normal">
      {source === "ai" ? "Updated by AI" : "Saved guidance"}
    </Badge>
  );
}
