// Clinician-facing English domain names, mirroring DOMAIN_LABELS in
// backend/app/domains.py. Used by developer surfaces (the item preview) that
// are not patient-facing and so do not go through i18n.
//
// PATIENT and caregiver screens must use i18n.js `domain_*` keys instead --
// those follow the patient's language.

export const DOMAIN_LABELS_EN = {
  attention: "Attention",
  executive: "Executive Function",
  memory: "Memory",
  language: "Language",
  perceptual_motor: "Perceptual-Motor",
  social: "Social Cognition",
};
