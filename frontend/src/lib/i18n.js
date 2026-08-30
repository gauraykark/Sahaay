// src/lib/i18n.js
//
// Minimal i18n layer for Sahaay. Supports English (en), Hindi (hi), and
// Assamese (as). Only patient-facing strings are translated — caregiver and
// doctor surfaces remain in English.
//
// Usage:
//   import { useT, langToLocale } from "../lib/i18n";
//   const t = useT();
//   t("welcome_back") // → "ঘৰলৈ স্বাগতম" if preferred_language === "as"

import { useAuth } from "./auth";

const strings = {
  en: {
    greeting_morning: "Good morning",
    greeting_afternoon: "Good afternoon",
    greeting_evening: "Good evening",
    welcome_back: "Welcome back",
    choose_activity: "Choose an activity",
    your_day: "Your day",
    exit: "Exit",

    // Activity titles
    people_you_know: "People You Know",
    people_desc: "See familiar faces, or ask who someone is",
    memory_matching: "Memory Matching",
    memory_desc: "Match familiar objects and pictures",
    daily_routine: "Daily Routine",
    routine_desc: "Remember the order of daily activities",
    object_recognition: "Object Recognition",
    objects_desc: "Identify common objects around you",
    name_recall: "Name Recall",
    name_recall_desc: "Remember names of familiar people and places",

    // The six DSM-5 domains. The PATIENT never sees these — they are for the
    // caregiver's own screens, which follow the patient's language so a
    // family member reading the app in Assamese is not dropped into English
    // the moment they look at how things are going. Doctor-facing prose stays
    // English and comes from DOMAIN_LABELS on the server.
    domain_attention: "Attention",
    domain_executive: "Planning and Order",
    domain_memory: "Memory",
    domain_language: "Words and Naming",
    domain_perceptual_motor: "Shapes and Space",
    domain_social: "People and Feelings",

    // TTS phrases
    speak_greeting: (greeting) =>
      `${greeting}. Welcome back. Choose an activity when you are ready.`,
    this_is: (name, relationship) =>
      `This is ${name}. ${relationship || ""}`.trim(),
    not_sure_who: "I'm not sure who that is yet.",
  },

  hi: {
    greeting_morning: "सुप्रभात",
    greeting_afternoon: "नमस्कार",
    greeting_evening: "शुभ संध्या",
    welcome_back: "वापसी पर स्वागत है",
    choose_activity: "एक गतिविधि चुनें",
    your_day: "आपका दिन",
    exit: "बाहर जाएं",

    // Activity titles
    people_you_know: "आपके परिचित लोग",
    people_desc: "जाने-पहचाने चेहरे देखें, या पूछें कि कोई कौन है",
    memory_matching: "स्मृति मिलान",
    memory_desc: "परिचित वस्तुओं और चित्रों का मिलान करें",
    daily_routine: "दैनिक दिनचर्या",
    routine_desc: "दैनिक गतिविधियों का क्रम याद रखें",
    object_recognition: "वस्तु पहचान",
    objects_desc: "अपने आसपास की सामान्य वस्तुओं को पहचानें",
    name_recall: "नाम याद करना",
    name_recall_desc: "परिचित लोगों और स्थानों के नाम याद रखें",

    // छह क्षेत्र — रोगी इन्हें कभी नहीं देखता, ये देखभालकर्ता की स्क्रीन के लिए हैं।
    domain_attention: "ध्यान",
    domain_executive: "योजना और क्रम",
    domain_memory: "स्मृति",
    domain_language: "शब्द और नाम",
    domain_perceptual_motor: "आकार और स्थान",
    domain_social: "लोग और भावनाएँ",

    // TTS phrases
    speak_greeting: (greeting) =>
      `${greeting}। वापसी पर स्वागत है। तैयार होने पर एक गतिविधि चुनें।`,
    this_is: (name, relationship) =>
      `यह ${name} हैं। ${relationship || ""}`.trim(),
    not_sure_who: "मुझे अभी तक यकीन नहीं है कि यह कौन है।",
  },

  as: {
    greeting_morning: "শুভ পুৱা",
    greeting_afternoon: "শুভ অপৰাহ্ন",
    greeting_evening: "শুভ সন্ধিয়া",
    welcome_back: "ঘৰলৈ স্বাগতম",
    choose_activity: "এটা কাৰ্যকলাপ বাছনি কৰক",
    your_day: "আপোনাৰ দিন",
    exit: "ওলাই যাওক",

    // Activity titles
    people_you_know: "আপোনাৰ চিনাকি মানুহ",
    people_desc: "পৰিচিত মুখ চাওক, বা কোনোবাক চিনাক্ত কৰক",
    memory_matching: "স্মৃতি মিলান",
    memory_desc: "পৰিচিত বস্তু আৰু ছবি মিলাওক",
    daily_routine: "দৈনন্দিন ৰুটিন",
    routine_desc: "দৈনন্দিন কাৰ্যকলাপৰ ক্ৰম মনত ৰাখক",
    object_recognition: "বস্তু চিনাক্তকৰণ",
    objects_desc: "আপোনাৰ চাৰিওফালৰ সাধাৰণ বস্তু চিনাক্ত কৰক",
    name_recall: "নাম স্মৰণ",
    name_recall_desc: "পৰিচিত মানুহ আৰু ঠাইৰ নাম মনত ৰাখক",

    // The six domains, for the caregiver's screens. The patient never sees them.
    domain_attention: "মনোযোগ",
    domain_executive: "পৰিকল্পনা আৰু ক্ৰম",
    domain_memory: "স্মৃতি",
    domain_language: "শব্দ আৰু নাম",
    domain_perceptual_motor: "আকৃতি আৰু স্থান",
    domain_social: "মানুহ আৰু অনুভৱ",

    // TTS phrases
    speak_greeting: (greeting) =>
      `${greeting}। ঘৰলৈ স্বাগতম। আপুনি সাজু হ'লে এটা কাৰ্যকলাপ বাছনি কৰক।`,
    this_is: (name, relationship) =>
      `এইজন ${name}। ${relationship || ""}`.trim(),
    not_sure_who: "মই এতিয়াও নাজানো এইজন কোন।",
  },
};

/**
 * Maps a preferred_language code to a BCP-47 locale tag for the Web Speech API.
 * Falls back to en-IN for anything unrecognised.
 */
export function langToLocale(lang) {
  const map = {
    en: "en-IN",
    hi: "hi-IN",
    as: "as-IN",
  };
  return map[lang] || "en-IN";
}

/**
 * Hook that returns a translator function t(key, ...args) scoped to the
 * current user's preferred_language. Falls back to English if the key or
 * language is missing.
 *
 * For simple string keys: t("welcome_back")
 * For function keys:      t("speak_greeting", greeting)
 *                         t("this_is", name, relationship)
 */
export function useT() {
  const { user } = useAuth();
  const lang = user?.preferred_language || "en";
  const dict = strings[lang] || strings.en;

  return function t(key, ...args) {
    const value = dict[key] ?? strings.en[key];
    if (!value) return key; // key itself as last-resort fallback
    if (typeof value === "function") return value(...args);
    return value;
  };
}