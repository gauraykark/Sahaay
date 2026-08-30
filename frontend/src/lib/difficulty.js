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

import { clampLevel } from "@shared/levels";

import { getAIPlan, isPreviewMode, markPlanUsed, setDifficulty } from "./db";
import { GAME_LEVEL_META } from "./gameContent";
import { nextDifficultyLevel, nextLevelByAccuracy } from "./utils";

// The local bound() is gone. It clamped to a per-game range AND to one step
// from the current level, and agents.py:clamp() did the same thing separately
// on the server -- two copies of one rule, already drifted (routine 4 vs 3,
// name-recall 5 vs 3), which is how whole levels of content became
// unreachable through the AI path.
//
// Bounds now come from shared/levels.js, imported by both sides. Step limiting
// is not a bound: it is a clinical rule (max +/-1 per domain per week) and it
// belongs to the weekly evaluator, in one place, not to every caller.

// ── How the round went ────────────────────────────────────────────────────────

/**
 * Classify a finished round into the branch the plan is keyed by.
 *
 * Thresholds match the rule engine's, so the plan and the fallback agree on
 * what "good" means. A patient should not see different behaviour depending
 * on whether a plan happened to be cached.
 *
 * Move ratio is tested BEFORE accuracy, and the order matters. Memory ends
 * only when every card is matched, so its score always equals its total —
 * checking accuracy first made every memory round "good" and left this
 * function unable to ever demote, which is the one thing it exists to do.
 * Games that measure right-vs-wrong answers send no `moves` and fall through
 * to accuracy.
 */
export function outcomeOf(stats) {
  if (!stats.completed) return "poor";

  if (typeof stats.moves === "number" && stats.idealMoves) {
    const ratio = stats.moves / stats.idealMoves;
    if (ratio <= 1.6) return "good";
    if (ratio >= 2.8) return "poor";
    return "ok";
  }

  if (typeof stats.total === "number" && stats.total > 0) {
    const accuracy = stats.score / stats.total;
    if (accuracy >= 0.8) return "good";
    if (accuracy < 0.5) return "poor";
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
  const preview = isPreviewMode();
  const plan = await getAIPlan(gameType);

  let newLevel;
  let reason;
  let source;

  // A plan's three branches are absolute levels, chosen by the coach for the
  // level the patient was on when it was written. Once they have moved off
  // that level the plan no longer describes their situation, and applying it
  // sends them somewhere nobody chose: a plan written at level 1 holds all
  // three branches at 1, which would pin a patient now on level 3 in place
  // however they play. A level mismatch is staleness, same as age or overuse,
  // so it falls through to the rule engine — which reads this round's own
  // moves and always steps in the right direction.
  const planFitsLevel = plan && plan.currentLevel === currentLevel;

  if (plan && planFitsLevel) {
    const branch = { good: plan.ifGood, ok: plan.ifOk, poor: plan.ifPoor }[
      outcomeOf(stats)
    ];

    newLevel = clampLevel(branch.level);
    reason = branch.reason;
    source = plan.source === "ai" ? "ai" : "rule";
    // A preview round must not age the patient's plan toward staleness.
    if (!preview) await markPlanUsed(gameType);
  } else {
    // No plan, or it expired. The rule engine has always worked offline and
    // still does — this is the floor, not an error path.
    newLevel = clampLevel(ruleBasedNext({ gameType, currentLevel, stats }));
    reason = ruleReason(newLevel, currentLevel);
    source = "rule";
  }

  // In preview the level is computed and shown, but never saved — the
  // patient's real difficulty is not the caregiver's to move by trying a game.
  if (!preview) await setDifficulty(gameType, newLevel, reason, source);
  return { newLevel, reason, source };
}