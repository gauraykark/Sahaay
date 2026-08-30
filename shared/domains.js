// The six DSM-5 neurocognitive domains — one definition, both runtimes.
//
// The Python mirror is backend/app/domains.py. If you change one, change both;
// tools/check_level_parity.py fails if they disagree.
//
// The client needs these because it now stores six base levels locally and
// sends `domain` with every session row. It used to send only game_type and
// let the server resolve the domain, which froze a four-domain label into
// every historical row.
//
// All dementia types affect these same six. They differ in which one goes
// first and how fast, which is why domain is the right axis and subtype is
// not. The six move INDEPENDENTLY, and that independence is the whole signal.
//
// The patient never sees these names. Caregiver-facing labels come from
// i18n.js (`domain_*` keys); clinician-facing ones from DOMAIN_LABELS on the
// server.

export const DOMAIN_ATTENTION = "attention";
export const DOMAIN_EXECUTIVE = "executive";
export const DOMAIN_MEMORY = "memory";
export const DOMAIN_LANGUAGE = "language";
export const DOMAIN_PERCEPTUAL_MOTOR = "perceptual_motor";
export const DOMAIN_SOCIAL = "social";

export const DOMAINS = [
  DOMAIN_ATTENTION,
  DOMAIN_EXECUTIVE,
  DOMAIN_MEMORY,
  DOMAIN_LANGUAGE,
  DOMAIN_PERCEPTUAL_MOTOR,
  DOMAIN_SOCIAL,
];

/** The i18n key for a domain's caregiver-facing name. */
export function domainLabelKey(domain) {
  return `domain_${domain}`;
}

export function isDomain(value) {
  return DOMAINS.includes(value);
}

// Which domain each game writes into. Mirrors GAME_TO_DOMAIN on the server.
//
// A game type IS a domain now. The legacy four were retired in Sprint 4 --
// `memory` and `name-recall` used to both write into memory, which blended two
// unrelated tasks into a single number.
export const GAME_TO_DOMAIN = {
  attention: DOMAIN_ATTENTION,
  sequencing: DOMAIN_EXECUTIVE,
  recall: DOMAIN_MEMORY,
  naming: DOMAIN_LANGUAGE,
  shapes: DOMAIN_PERCEPTUAL_MOTOR,
  faces: DOMAIN_SOCIAL,
};

/** Domain a game writes into, or null for a game we do not recognise. */
export function domainForGame(gameType) {
  return GAME_TO_DOMAIN[gameType] ?? null;
}
