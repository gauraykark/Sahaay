// Adaptive difficulty.
//
// THE GAME LOOP NEVER TOUCHES THE NETWORK.
//
// It reads a cached plan written earlier by the Cognitive Coach, picks the
// branch matching how the round actually went, and returns instantly. No
// fetch, no await on a request, no 4-second stall before the patient sees
// their result.
//
// Refreshing that plan happens in the background afterwards — see
// api.runSyncOnReconnect(). If the refresh never lands, nothing breaks: the
// device keeps playing on the plan it has, and once that goes stale it falls
// back to the rule engine below. Three layers, each usable alone:
//
//   1. Cached plan  — normal path, online and offline alike
//   2. Rule engine  — no plan yet, or the plan expired
//   3. Clamp        — bounds whatever either produced
//
// See g_prop_02_architecture.md D3-D5, D9, D10.

import { getAIPlan, markPlanUsed, setDifficulty } from "./db";
import { GAME_LEVEL_META } from "./gameContent";
import { nextDifficultyLevel, nextLevelByAccuracy } from "./utils";

export function clampLevel(level, min, max) {
  return Math.max(min, Math.min(max, level));
}

/** Bound a level to the game's range and to one step from where it is now. */
function bound(level, currentLevel, meta) {
  let next = clampLevel(level, meta.min, meta.max);
  if (next > currentLevel + 1) next = currentLevel + 1;
  if (next < currentLevel - 1) next = currentLevel - 1;
  return next;
}

// ── How the round went ────────────────────────────────────────────────────────

/**
 * Classify a finished round into the branch the plan is keyed by.
 *
 * Thresholds match the rule engine's, so the plan and the fallback agree on
 * what "good" means. A patient should not see different behaviour depending
 * on whether a plan happened to be cached.
 */
export function outcomeOf(stats) {
  if (!stats.completed) return "poor";

  if (typeof stats.total === "number" && stats.total > 0) {
    const accuracy = stats.score / stats.total;
    if (accuracy >= 0.8) return "good";
    if (accuracy < 0.5) return "poor";
    return "ok";
  }

  // Memory is scored on moves against the ideal, not on accuracy.
  if (typeof stats.moves === "number" && stats.idealMoves) {
    const ratio = stats.moves / stats.idealMoves;
    if (ratio <= 1.6) return "good";
    if (ratio >= 2.8) return "poor";
    return "ok";
  }

  return "ok";
}

// ── Rule engine (layer 2) ─────────────────────────────────────────────────────

function ruleBasedNext({ gameType, currentLevel, stats }) {
  const { min, max } = GAME_LEVEL_META[gameType];

  if (gameType === "memory") {
    return nextDifficultyLevel({
      currentLevel,
      moves: stats.moves,
      idealMoves: stats.idealMoves,
      minLevel: min,
      maxLevel: max,
    });
  }

  if (gameType === "routine") {
    const errorRate = stats.errors / Math.max(1, stats.total);
    if (errorRate === 0 && stats.completed && currentLevel < max) return currentLevel + 1;
    if (errorRate >= 0.5 && currentLevel > min) return currentLevel - 1;
    return currentLevel;
  }

  return nextLevelByAccuracy({
    currentLevel,
    correct: stats.score,
    total: stats.total,
    minLevel: min,
    maxLevel: max,
  });
}

const RULE_REASON = {
  up: "Next round will be a little harder.",
  same: "Next round stays at the same level.",
  down: "Next round will be a little gentler.",
};

function ruleReason(nextLevel, currentLevel) {
  if (nextLevel > currentLevel) return RULE_REASON.up;
  if (nextLevel < currentLevel) return RULE_REASON.down;
  return RULE_REASON.same;
}

// ── Resolve (the only entry point games use) ──────────────────────────────────

/**
 * Decide and persist the next level. Synchronous as far as the network is
 * concerned — everything it reads is local.
 *
 * @returns {{ newLevel: number, reason: string, source: "ai"|"rule" }}
 *          `source` is surfaced in the UI so the patient's caregiver can see
 *          whether guidance came from the AI or the offline fallback.
 */
export async function resolveNextLevel({ gameType, currentLevel, stats }) {
  const meta = GAME_LEVEL_META[gameType];
  const plan = await getAIPlan(gameType);

  let newLevel;
  let reason;
  let source;

  if (plan) {
    const branch = { good: plan.ifGood, ok: plan.ifOk, poor: plan.ifPoor }[
      outcomeOf(stats)
    ];

    newLevel = bound(branch.level, currentLevel, meta);
    reason = branch.reason;
    source = plan.source === "ai" ? "ai" : "rule";
    await markPlanUsed(gameType);
  } else {
    // No plan, or it expired. The rule engine has always worked offline and
    // still does — this is the floor, not an error path.
    newLevel = bound(
      ruleBasedNext({ gameType, currentLevel, stats }),
      currentLevel,
      meta
    );
    reason = ruleReason(newLevel, currentLevel);
    source = "rule";
  }

  await setDifficulty(gameType, newLevel, reason, source);
  return { newLevel, reason, source };
}