
# ── Domains (displayed) ───────────────────────────────────────────────────────

DOMAIN_MEMORY = "memory"
DOMAIN_ATTENTION = "attention"
DOMAIN_ROUTINE = "routine"
DOMAIN_RECOGNITION = "recognition"

DOMAINS = [DOMAIN_MEMORY, DOMAIN_ATTENTION, DOMAIN_ROUTINE, DOMAIN_RECOGNITION]

DOMAIN_LABELS = {
    DOMAIN_MEMORY: "Memory",
    DOMAIN_ATTENTION: "Attention",
    DOMAIN_ROUTINE: "Daily Routine",
    DOMAIN_RECOGNITION: "Object Recognition",
}


# ── Abilities (structural, six) ───────────────────────────────────────────────

ABILITIES = ["recall", "naming", "order", "attention", "numbers", "shapes"]

# Only these four have games behind them today.
ABILITIES_BUILT = ["recall", "naming", "order", "attention"]

ABILITY_LABELS = {
    "recall": "Recall",
    "naming": "Naming",
    "order": "Order",
    "attention": "Attention",
    "numbers": "Numbers",
    "shapes": "Shapes",
}


# ── Game mapping ──────────────────────────────────────────────────────────────

GAME_TYPES = ["memory", "routine", "objects", "name-recall"]

GAME_LABELS = {
    "memory": "Memory Matching",
    "routine": "Daily Routine",
    "objects": "Object Recognition",
    "name-recall": "Name Recall",
}

# A game writes into exactly one domain.
GAME_TO_DOMAIN = {
    "memory": DOMAIN_MEMORY,
    "name-recall": DOMAIN_MEMORY,
    "objects": DOMAIN_RECOGNITION,
    "routine": DOMAIN_ROUTINE,
}

GAME_TO_ABILITY = {
    "memory": "recall",
    "name-recall": "recall",
    "objects": "naming",
    "routine": "order",
}


def domain_for_game(game_type: str) -> str:
    """Domain a session belongs to. Resolved at write time, not read time."""
    return GAME_TO_DOMAIN.get(game_type, DOMAIN_MEMORY)


def ability_for_game(game_type: str) -> str:
    return GAME_TO_ABILITY.get(game_type, "recall")


# Attention is not owned by any single game — it is derived from behavioural
# signals (response-time consistency, completion rate) across all of them.
# See analytics.attention_score().
DERIVED_DOMAINS = [DOMAIN_ATTENTION]
