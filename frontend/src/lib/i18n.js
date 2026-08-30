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

    // ── Games ──────────────────────────────────────────────────────────────
    // Every string a patient can see during play. Nothing here may describe a
    // mistake: no "wrong", no "incorrect", no score. See the errorless rule.
    play: "Play",
    stop: "Stop",
    well_done_today: "Well done today",
    thats_it: "That's it",
    lets_look_together: "Let's look at this one together",
    next: "Next",
    ready: "Ready?",
    start: "Start",
    remember_these: "Look at these",
    now_answer: "Now, a question",

    ask_which_did_you_see: "Which one did you see?",
    ask_what_is_this: "What is this called?",
    ask_how_feeling: (pronoun) => `How is ${pronoun} feeling?`,
    ask_put_in_order: "Put these in the order you do them",
    ask_match_shape: "Tap the shape that matches",
    ask_tap_green: "Tap the green circle. Leave the red one",

    he: "he",
    she: "she",

    emotion_angry: "Angry",
    emotion_calm: "Calm",
    emotion_happy: "Happy",
    emotion_sad: "Sad",
    emotion_surprised: "Surprised",
    emotion_worried: "Worried",

    obj_banana: "Banana", obj_basket: "Basket", obj_bicycle: "Bicycle",
    obj_bucket: "Bucket", obj_clock: "Clock", obj_coconut: "Coconut",
    obj_comb: "Comb", obj_cow: "Cow", obj_fish: "Fish",
    obj_jackfruit: "Jackfruit", obj_kettle: "Kettle", obj_lamp: "Lamp",
    obj_plate: "Plate", obj_pot: "Pot", obj_rice: "Rice",
    obj_slippers: "Slippers", obj_soap: "Soap", obj_spoon: "Spoon",
    obj_teacup: "Teacup", obj_umbrella: "Umbrella",

    shape_circle: "Circle", shape_square: "Square", shape_triangle: "Triangle",
    shape_diamond: "Diamond", shape_hexagon: "Hexagon", shape_star: "Star",

    next_games_at: (time) => `Next games at ${time}`,
    come_back_later: "You have played today. Come back later.",

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

    // UNVERIFIED — needs native review.
    // The six domain names below were written by Claude, not by a Hindi
    // speaker. They render as-is: Hindi and Assamese are a problem-statement
    // requirement, so an unreviewed term beats an English one. But they are
    // clinical vocabulary on a caregiver's screen, so a native speaker should
    // read them and delete this marker. Until then, treat them as a draft.
    // छह क्षेत्र — रोगी इन्हें कभी नहीं देखता, ये देखभालकर्ता की स्क्रीन के लिए हैं।
    domain_attention: "ध्यान",
    domain_executive: "योजना और क्रम",
    domain_memory: "स्मृति",
    domain_language: "शब्द और नाम",
    domain_perceptual_motor: "आकार और स्थान",
    domain_social: "लोग और भावनाएँ",

    // ── Games ──────────────────────────────────────────────────────────────
    // UNVERIFIED — needs native review. Machine-written, never checked by a
    // Hindi speaker. See the note on the domain names above.
    play: "खेलें",
    stop: "रुकें",
    well_done_today: "आज बहुत अच्छा किया",
    thats_it: "यही है",
    lets_look_together: "आइए इसे साथ में देखें",
    next: "आगे",
    ready: "तैयार हैं?",
    start: "शुरू करें",
    remember_these: "इन्हें देखिए",
    now_answer: "अब, एक सवाल",

    ask_which_did_you_see: "आपने कौन सा देखा था?",
    ask_what_is_this: "इसे क्या कहते हैं?",
    ask_how_feeling: (pronoun) => `${pronoun} कैसा महसूस कर रहे हैं?`,
    ask_put_in_order: "इन्हें उसी क्रम में रखें जैसे आप करते हैं",
    ask_match_shape: "मिलती-जुलती आकृति पर टैप करें",
    ask_tap_green: "हरे गोले पर टैप करें। लाल को छोड़ दें",

    he: "वह",
    she: "वह",

    emotion_angry: "गुस्सा", emotion_calm: "शांत", emotion_happy: "खुश",
    emotion_sad: "उदास", emotion_surprised: "हैरान", emotion_worried: "चिंतित",

    obj_banana: "केला", obj_basket: "टोकरी", obj_bicycle: "साइकिल",
    obj_bucket: "बाल्टी", obj_clock: "घड़ी", obj_coconut: "नारियल",
    obj_comb: "कंघी", obj_cow: "गाय", obj_fish: "मछली",
    obj_jackfruit: "कटहल", obj_kettle: "केतली", obj_lamp: "दीपक",
    obj_plate: "थाली", obj_pot: "बर्तन", obj_rice: "चावल",
    obj_slippers: "चप्पल", obj_soap: "साबुन", obj_spoon: "चम्मच",
    obj_teacup: "चाय का कप", obj_umbrella: "छाता",

    shape_circle: "गोल", shape_square: "चौकोर", shape_triangle: "तिकोना",
    shape_diamond: "चौकोन", shape_hexagon: "षटकोण", shape_star: "तारा",

    next_games_at: (time) => `अगले खेल ${time} बजे`,
    come_back_later: "आपने आज खेल लिया है। बाद में आइए।",

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

    // UNVERIFIED — needs native review.
    // As above: written by Claude, not by an Assamese speaker. Assamese is the
    // language this app exists for, so these ship rather than falling back to
    // English — but nobody has checked that "পৰিকল্পনা আৰু ক্ৰম" is what a
    // clinician in Assam would actually say for executive function. A native
    // speaker should read all six and delete this marker.
    // The six domains, for the caregiver's screens. The patient never sees them.
    domain_attention: "মনোযোগ",
    domain_executive: "পৰিকল্পনা আৰু ক্ৰম",
    domain_memory: "স্মৃতি",
    domain_language: "শব্দ আৰু নাম",
    domain_perceptual_motor: "আকৃতি আৰু স্থান",
    domain_social: "মানুহ আৰু অনুভৱ",

    // ── Games ──────────────────────────────────────────────────────────────
    // UNVERIFIED — needs native review. Machine-written, never checked by an
    // Assamese speaker. See the note on the domain names above.
    play: "খেলক",
    stop: "ৰওক",
    well_done_today: "আজি বৰ ভাল কৰিলে",
    thats_it: "এইটোৱেই",
    lets_look_together: "আহক একেলগে চাওঁ",
    next: "পিছৰটো",
    ready: "সাজু নেকি?",
    start: "আৰম্ভ কৰক",
    remember_these: "এইবোৰ চাওক",
    now_answer: "এতিয়া, এটা প্ৰশ্ন",

    ask_which_did_you_see: "আপুনি কোনটো দেখিছিল?",
    ask_what_is_this: "ইয়াক কি বোলে?",
    ask_how_feeling: (pronoun) => `${pronoun} কেনে অনুভৱ কৰিছে?`,
    ask_put_in_order: "আপুনি যিদৰে কৰে সেই ক্ৰমত ৰাখক",
    ask_match_shape: "মিল খোৱা আকৃতিটোত টিপক",
    ask_tap_green: "সেউজীয়া বৃত্তত টিপক। ৰঙাটো এৰি দিয়ক",

    he: "তেওঁ",
    she: "তেওঁ",

    emotion_angry: "খং", emotion_calm: "শান্ত", emotion_happy: "সুখী",
    emotion_sad: "দুখী", emotion_surprised: "আচৰিত", emotion_worried: "চিন্তিত",

    obj_banana: "কল", obj_basket: "পাচি", obj_bicycle: "চাইকেল",
    obj_bucket: "বালটি", obj_clock: "ঘড়ী", obj_coconut: "নাৰিকল",
    obj_comb: "ফণী", obj_cow: "গৰু", obj_fish: "মাছ",
    obj_jackfruit: "কঠাল", obj_kettle: "কেটলি", obj_lamp: "চাকি",
    obj_plate: "থালী", obj_pot: "পাত্ৰ", obj_rice: "ভাত",
    obj_slippers: "চেণ্ডেল", obj_soap: "চাবোন", obj_spoon: "চামুচ",
    obj_teacup: "চাহৰ কাপ", obj_umbrella: "ছাতি",

    shape_circle: "বৃত্ত", shape_square: "বৰ্গ", shape_triangle: "ত্ৰিভুজ",
    shape_diamond: "হীৰক", shape_hexagon: "ষড়ভুজ", shape_star: "তৰা",

    next_games_at: (time) => `পিছৰ খেল ${time} বজাত`,
    come_back_later: "আপুনি আজি খেলিছে। পিছত আহক।",

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