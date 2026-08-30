"""The six DSM-5 neurocognitive domains.

This replaces four invented domains (memory, attention, routine, recognition).
Three things were wrong with those:

* they are not a recognised framework, so nothing a clinician reads maps onto
  them;
* ``memory`` and ``name-recall`` both wrote into ``memory``, blending two
  different tasks into one number; and
* ``attention`` had no game at all -- it was synthesised from completion rate
  and pace variance, and completion rate is a constant 1.0 because no game can
  log an abandoned round.

All dementia types affect these same six. They differ in which one goes first
and how fast, which is why domain is the right axis to track and subtype is
not. The six move INDEPENDENTLY, and that independence is the entire clinical
signal: memory sliding while executive holds flat looks different from a global
decline, and that difference is what a caregiver needs to see between visits.

The patient never sees these names.
"""

# ── Domains (six, DSM-5) ──────────────────────────────────────────────────────

DOMAIN_ATTENTION = "attention"                  # complex attention
DOMAIN_EXECUTIVE = "executive"                  # executive function
DOMAIN_MEMORY = "memory"                        # learning and memory
DOMAIN_LANGUAGE = "language"                    # language
DOMAIN_PERCEPTUAL_MOTOR = "perceptual_motor"    # perceptual-motor
DOMAIN_SOCIAL = "social"                        # social cognition

DOMAINS = [
    DOMAIN_ATTENTION,
    DOMAIN_EXECUTIVE,
    DOMAIN_MEMORY,
    DOMAIN_LANGUAGE,
    DOMAIN_PERCEPTUAL_MOTOR,
    DOMAIN_SOCIAL,
]

# Clinician-facing English. The patient-facing strings are in the client's
# i18n dictionaries (en / hi / as) -- these are for the doctor and caregiver
# dashboards and for the report agent's prose.
DOMAIN_LABELS = {
    DOMAIN_ATTENTION: "Attention",
    DOMAIN_EXECUTIVE: "Executive Function",
    DOMAIN_MEMORY: "Memory",
    DOMAIN_LANGUAGE: "Language",
    DOMAIN_PERCEPTUAL_MOTOR: "Perceptual-Motor",
    DOMAIN_SOCIAL: "Social Cognition",
}

# Nothing is derived any more. Attention gets a real go/no-go game in Sprint 4;
# until then it reports "no data" rather than a synthesised number, because a
# number nobody measured is worse than an honest gap on a clinical trend line.
DERIVED_DOMAINS: list[str] = []


# ── Game mapping ──────────────────────────────────────────────────────────────
#
# Two generations of games live here at once. The six below are built in
# Sprint 4, one per domain. The four legacy games stay playable until then, so
# the app keeps working through the rewrite -- they are mapped to whichever of
# the six they genuinely exercise, not to a placeholder.

# The six built in Sprint 4, one per domain.
TARGET_GAME_TYPES = [
    "attention",         # go/no-go: tap green, not red
    "sequencing",        # put a daily routine in order
    "recall",            # see pictures, recall after a gap
    "naming",            # "what is this called?"
    "shapes",            # match shape / set clock hands
    "faces",             # which face is happy?
]

# The legacy four are gone as of Sprint 4 -- their components, their routes and
# lib/difficulty.js were deleted together. A game type IS a domain now: the
# client plays /patient/play/<domain> and sends the domain with every row.
GAME_TYPES = TARGET_GAME_TYPES

GAME_LABELS = {
    "attention": "Attention",
    "sequencing": "Putting Things In Order",
    "recall": "Remembering Pictures",
    "naming": "Naming Things",
    "shapes": "Shapes and Space",
    "faces": "Faces and Feelings",
}

# A game writes into exactly one domain.
GAME_TO_DOMAIN = {
    "attention": DOMAIN_ATTENTION,
    "sequencing": DOMAIN_EXECUTIVE,
    "recall": DOMAIN_MEMORY,
    "naming": DOMAIN_LANGUAGE,
    "shapes": DOMAIN_PERCEPTUAL_MOTOR,
    "faces": DOMAIN_SOCIAL,
}


# Domains a patient can actually reach with the games that exist on the client
# today. Attention and perceptual-motor have no game until Sprint 4, so telling
# a caregiver to "try the untouched activity types" for those would point at
# something that is not there. Once Sprint 4 lands and the legacy four are
# retired, this equals DOMAINS.
PLAYABLE_DOMAINS = [d for d in DOMAINS if d in {GAME_TO_DOMAIN[g] for g in GAME_TYPES}]


def domain_for_game(game_type: str) -> str | None:
    """Domain a session belongs to, or None for a game we do not recognise.

    Returns None rather than defaulting to memory. A silent default is how
    every unmapped game type ended up inflating the Memory score; an unknown
    game is a bug, and the caller should be able to see it.
    """
    return GAME_TO_DOMAIN.get(game_type)
