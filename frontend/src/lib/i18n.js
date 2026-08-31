// src/lib/i18n.js
//
// Minimal i18n layer for Sahaay. Supports English (en), Hindi (hi), and
// Assamese (as) as fully-translated languages, plus five additional
// languages (Bengali, Khasi, Meitei/Manipuri, Mizo/Lushai, Konyak, Nyishi)
// shipped as UNVERIFIED stubs — see the note above each block. Only
// patient-facing strings are translated — caregiver and doctor surfaces
// remain in English.
//
// Language now lives on the PATIENT record (Dexie `patients.preferredLanguage`),
// not on the caregiver's JWT account. A caregiver sets it from the patient's
// profile screen; the patient-facing hooks below read whichever patient is
// currently active on this device.
//
// Usage:
//   import { useT, langToLocale } from "../lib/i18n";
//   const t = useT();
//   t("welcome_back") // → "ঘৰলৈ স্বাগতম" if the active patient's language is "as"

import { useEffect, useRef, useState } from "react";

import { getActivePatientId, getPatient } from "./db";
import { speak } from "./utils";

export const DEFAULT_LANGUAGE = "en";

// Rendered in the caregiver's language picker on the patient's profile.
// `verified: true` means a native speaker has reviewed the full dictionary;
// `false` means it's currently an English-fallback stub — see the blocks below.
export const LANGUAGE_OPTIONS = [
  { code: "en", label: "English", status: "verified" },
  { code: "as", label: "Assamese (অসমীয়া)", status: "verified" },
  { code: "hi", label: "Hindi (हिन्दी)", status: "review" },
  { code: "bn", label: "Bengali (বাংলা)", status: "review" },
  { code: "mni", label: "Meitei / Manipuri (মৈতৈলোন্)", status: "draft" },
  { code: "lus", label: "Mizo / Lushai", status: "draft" },
  { code: "kha", label: "Khasi", status: "untranslated" },
  { code: "nqo", label: "Konyak", status: "untranslated" },
  { code: "njz", label: "Nyishi / Dafla", status: "untranslated" },
];
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
    retry: "Try Again",
    try_again: "Try Again",
    ready: "Ready?",
    start: "Start",
    remember_these: "Look at these",
    now_answer: "Now, a question",

    ask_which_did_you_see: "Which one did you see?",
    ask_what_is_this: "What is this called?",
    ask_how_feeling: (pronoun) => `How is ${pronoun} feeling?`,
    ask_put_in_order: "Put these in the order you do them",
    ask_match_shape: "Tap the shape that matches",
    // Two instructions because there are two stimulus sets. Below level 3
    // the generator emits no red circle at all, and the prompt must not
    // describe one -- see generateAttention in shared/itemBank.js.
    ask_tap_green: "Tap the green circle. Leave the red one",
    ask_tap_all: "Tap each circle you see",

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

    my_day: "My Day",
    my_day_desc: "Your medicines, water, meals and visits",
    nothing_today: "Nothing to do right now",
    mark_done: "Done",
    all_done_today: "Everything done for today",

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
    retry: "पुनः प्रयास करें",
    try_again: "पुनः प्रयास करें",
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
    ask_tap_all: "हर गोले पर टैप करें",

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

    my_day: "मेरा दिन",
    my_day_desc: "आपकी दवाइयाँ, पानी, भोजन और मुलाक़ातें",
    nothing_today: "अभी कुछ नहीं करना है",
    mark_done: "हो गया",
    all_done_today: "आज का सब कुछ हो गया",

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
    retry: "পুনৰ চেষ্টা কৰক",
    try_again: "পুনৰ চেষ্টা কৰক",
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
    ask_tap_all: "প্ৰতিটো বৃত্ততে টিপক",

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

    my_day: "মোৰ দিন",
    my_day_desc: "আপোনাৰ ঔষধ, পানী, আহাৰ আৰু সাক্ষাৎ",
    nothing_today: "এতিয়া একো কৰিবলগীয়া নাই",
    mark_done: "হৈ গ'ল",
    all_done_today: "আজিৰ সকলো হৈ গ'ল",

    speak_greeting: (greeting) =>
      `${greeting}। ঘৰলৈ স্বাগতম। আপুনি সাজু হ'লে এটা কাৰ্যকলাপ বাছনি কৰক।`,
    this_is: (name, relationship) =>
      `এইজন ${name}। ${relationship || ""}`.trim(),
    not_sure_who: "মই এতিয়াও নাজানো এইজন কোন।",
  },
};

// ── Bengali, Khasi, Meitei, Mizo, Konyak, Nyishi — UNVERIFIED STUBS ────────
//
// No translator has been through these yet. Each is cloned from `en` so the
// app never shows a blank string or crashes for a patient set to one of
// these languages — it just silently displays English until someone
// replaces the values key-by-key with a native speaker's review. Remove this
// block comment (and the `verified: false` flag in LANGUAGE_OPTIONS above)
// once a given language has been checked.
strings.bn = { ...strings.en };
strings.kha = { ...strings.en };
strings.mni = { ...strings.en };
strings.lus = { ...strings.en };
strings.nqo = { ...strings.en };
strings.njz = { ...strings.en };

/**
 * Reads the ACTIVE PATIENT's preferredLanguage from Dexie (set on the
 * patient record, changeable by the caregiver from the patient's profile
 * screen) — not the logged-in caregiver's own account language.
 *
 * Falls back to DEFAULT_LANGUAGE ("en") while loading or if no patient/
 * field is set yet.
 */
export function useActivePatientLanguage() {
  const [lang, setLang] = useState(DEFAULT_LANGUAGE);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const id = await getActivePatientId();
        const patient = id ? await getPatient(id) : null;
        if (!cancelled) {
          setLang(patient?.preferredLanguage || DEFAULT_LANGUAGE);
        }
      } catch {
        if (!cancelled) setLang(DEFAULT_LANGUAGE);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return lang;
}

/**
 * Speak a phrase ONCE per `key`, in the patient's own language.
 *
 * Three bugs live in the naive version of this, and all three were shipped:
 *
 * 1. `useT()` returns a NEW function every render, so an effect with `t` in
 *    its dependency array re-runs on every render and speaks again. The
 *    instruction repeated several times per item.
 * 2. `speak(text, langToLocale())` passes a STRING where an options object is
 *    expected. Destructuring a string yields undefined for every option, so
 *    `lang` fell back to "en-IN" -- the Assamese voice never once ran, no
 *    matter what the patient's language was set to.
 * 3. Nothing cancelled the previous utterance, so they queued.
 *
 * Pass a stable `key` (an item id, usually). The phrase is spoken when the key
 * changes and never again for the same key.
 */
export function useSpeak() {
  const lang = useActivePatientLanguage();
  const spokenFor = useRef(null);

  return function say(text, key) {
    if (!text || spokenFor.current === key) return;
    spokenFor.current = key;
    speak(text, { lang: langToLocale(lang) });
  };
}

/**
 * Maps a preferredLanguage code to a BCP-47 locale tag for the Web Speech API.
 * Falls back to en-IN for anything unrecognised, and for languages without a
 * known speech-synthesis voice (the browser will pick its closest fallback).
 */
export function langToLocale(lang) {
  const map = {
    en: "en-IN",
    hi: "hi-IN",
    as: "as-IN",
    bn: "bn-IN",
    kha: "en-IN", // no known Khasi TTS voice — falls back
    mni: "en-IN", // no known Meitei TTS voice — falls back
    lus: "en-IN", // no known Mizo TTS voice — falls back
    nqo: "en-IN", // no known Konyak TTS voice — falls back
    njz: "en-IN", // no known Nyishi TTS voice — falls back
  };
  return map[lang] || "en-IN";
}

/**
 * Hook that returns a translator function t(key, ...args) scoped to the
 * ACTIVE PATIENT's preferredLanguage. Falls back to English if the key or
 * language is missing.
 *
 * For simple string keys: t("welcome_back")
 * For function keys:      t("speak_greeting", greeting)
 *                         t("this_is", name, relationship)
 */
export function useT() {
  const lang = useActivePatientLanguage();
  const dict = strings[lang] || strings.en;

  return function t(key, ...args) {
    const value = dict[key] ?? strings.en[key];
    if (!value) return key; // key itself as last-resort fallback
    if (typeof value === "function") return value(...args);
    return value;
  };
}

// ── Bengali — first-pass translation, needs native review before shipping ──
strings.bn = {
  greeting_morning: "শুভ সকাল",
  greeting_afternoon: "শুভ অপরাহ্ন",
  greeting_evening: "শুভ সন্ধ্যা",
  welcome_back: "ফিরে আসার জন্য স্বাগতম",
  choose_activity: "একটি কার্যকলাপ বেছে নিন",
  your_day: "আপনার দিন",
  exit: "বেরিয়ে যান",

  people_you_know: "আপনার পরিচিত মানুষ",
  people_desc: "চেনা মুখ দেখুন, বা জিজ্ঞাসা করুন কেউ কে",
  memory_matching: "স্মৃতি মেলানো",
  memory_desc: "পরিচিত জিনিস ও ছবি মেলান",
  daily_routine: "দৈনন্দিন রুটিন",
  routine_desc: "দৈনন্দিন কাজের ক্রম মনে রাখুন",
  object_recognition: "বস্তু চেনা",
  objects_desc: "আপনার চারপাশের সাধারণ জিনিস চিনুন",
  name_recall: "নাম মনে করা",
  name_recall_desc: "পরিচিত মানুষ ও জায়গার নাম মনে রাখুন",

  // UNVERIFIED — needs native review.
  domain_attention: "মনোযোগ",
  domain_executive: "পরিকল্পনা ও ক্রম",
  domain_memory: "স্মৃতি",
  domain_language: "শব্দ ও নামকরণ",
  domain_perceptual_motor: "আকৃতি ও স্থান",
  domain_social: "মানুষ ও অনুভূতি",

  // ── Games ──────────────────────────────────────────────────────────────
  play: "খেলুন",
  stop: "থামুন",
  well_done_today: "আজ খুব ভালো করেছেন",
  thats_it: "এটাই",
  lets_look_together: "চলুন একসাথে এটা দেখি",
  next: "পরবর্তী",
  ready: "প্রস্তুত?",
  start: "শুরু করুন",
  remember_these: "এগুলো দেখুন",
  now_answer: "এখন, একটি প্রশ্ন",

  ask_which_did_you_see: "আপনি কোনটি দেখেছিলেন?",
  ask_what_is_this: "এটাকে কী বলে?",
  ask_how_feeling: (pronoun) => `${pronoun} কেমন অনুভব করছেন?`,
  ask_put_in_order: "আপনি যেভাবে করেন সেই ক্রমে সাজান",
  ask_match_shape: "মিলে যাওয়া আকৃতিতে চাপ দিন",
  ask_tap_green: "সবুজ বৃত্তে চাপ দিন। লাল বৃত্তটি ছেড়ে দিন",
  ask_tap_all: "প্রতিটি বৃত্তে চাপ দিন",

  he: "তিনি",
  she: "তিনি",

  emotion_angry: "রাগান্বিত", emotion_calm: "শান্ত", emotion_happy: "খুশি",
  emotion_sad: "দুঃখিত", emotion_surprised: "অবাক", emotion_worried: "চিন্তিত",

  obj_banana: "কলা", obj_basket: "ঝুড়ি", obj_bicycle: "সাইকেল",
  obj_bucket: "বালতি", obj_clock: "ঘড়ি", obj_coconut: "নারকেল",
  obj_comb: "চিরুনি", obj_cow: "গরু", obj_fish: "মাছ",
  obj_jackfruit: "কাঁঠাল", obj_kettle: "কেটলি", obj_lamp: "প্রদীপ",
  obj_plate: "থালা", obj_pot: "হাঁড়ি", obj_rice: "ভাত",
  obj_slippers: "চপ্পল", obj_soap: "সাবান", obj_spoon: "চামচ",
  obj_teacup: "চায়ের কাপ", obj_umbrella: "ছাতা",

  shape_circle: "বৃত্ত", shape_square: "বর্গক্ষেত্র", shape_triangle: "ত্রিভুজ",
  shape_diamond: "হীরক", shape_hexagon: "ষড়ভুজ", shape_star: "তারা",

  next_games_at: (time) => `পরবর্তী খেলা ${time} সময়ে`,
  come_back_later: "আপনি আজ খেলেছেন। পরে আসুন।",

  my_day: "আমার দিন",
  my_day_desc: "আপনার ওষুধ, পানি, খাবার এবং সাক্ষাৎ",
  nothing_today: "এখন করার কিছু নেই",
  mark_done: "হয়ে গেছে",
  all_done_today: "আজকের সব কাজ শেষ",

  speak_greeting: (greeting) =>
    `${greeting}। ফিরে আসার জন্য স্বাগতম। প্রস্তুত হলে একটি কার্যকলাপ বেছে নিন।`,
  this_is: (name, relationship) =>
    `ইনি ${name}। ${relationship || ""}`.trim(),
  not_sure_who: "আমি এখনও নিশ্চিত নই ইনি কে।",
};

// ── Meitei / Manipuri — first-pass translation, LOW CONFIDENCE.
// This is a lower-resource language for me; several game/domain terms are
// best-effort renderings, not idiomatic phrasing a Manipuri clinician or
// caregiver would necessarily use. Do not ship to a real patient without a
// native speaker reading through every line.
strings.mni = {
  greeting_morning: "নুংথিল ফৌবা",
  greeting_afternoon: "নুমিৎ ফৌবা",
  greeting_evening: "নুংশিত ফৌবা",
  welcome_back: "হালহনবা ওকচরি",
  choose_activity: "থৌদাং অमा খল্লু",
  your_day: "নহাক্কী নুমিৎ",
  exit: "থোরক্কনু",

  people_you_know: "নহাক্না খংবা মিয়ামগী",
  people_desc: "মমী খংবা মায় য়েংবিয়ু, নত্রগা কনানো হায়না হংবিয়ু",
  memory_matching: "নিংশিং চন্নবা",
  memory_desc: "খংবা পোৎলোন অমসুং ফটোশিং চন্নবিয়ু",
  daily_routine: "নুমিৎখুদিংগী থৌরাং",
  routine_desc: "নুমিৎখুদিংগী থৌরাংগী মথৌ নিংশিংবিয়ু",
  object_recognition: "পোৎলোন খংবা",
  objects_desc: "নহাক্কী মপান্দা লৈবা পোৎলোনশিং খংবিয়ু",
  name_recall: "মিং নিংশিংবা",
  name_recall_desc: "খংবা মিয়ামগা মফমশিংগী মিং নিংশিংবিয়ু",

  // UNVERIFIED — LOW CONFIDENCE, needs native review.
  domain_attention: "থৌনা য়েংবা",
  domain_executive: "থৌराংগী মথৌ",
  domain_memory: "নিংশিংবা",
  domain_language: "লোন অমসুং মিং",
  domain_perceptual_motor: "মখল অমসুং মফম",
  domain_social: "মিয়াম অমসুং পুক্নিং",

  play: "শানৌ",
  stop: "লেপ্পু",
  well_done_today: "ঙসি ফবা তৌখ্রে",
  thats_it: "মসিনি",
  lets_look_together: "মপুংফাওবা য়েংশি",
  next: "মথং",
  ready: "থৌগৎলবরা?",
  start: "হৌ",
  remember_these: "মসিশিং য়েংবিয়ু",
  now_answer: "হৌজিক, ওয়াহং অমা",

  ask_which_did_you_see: "নহাক্না করিগুম্বা উবা?",
  ask_what_is_this: "মসিদা করি কৌবগে?",
  ask_how_feeling: (pronoun) => `${pronoun}না করমনা পুক্নিং তৌরিবগে?`,
  ask_put_in_order: "নহাক্না তৌবা মানুংদা থমজৌ",
  ask_match_shape: "চন্নরকপা মখল অদুদা থীন্নবিয়ু",
  ask_tap_green: "অশাংবা সর্কেলদা থীন্নবিয়ু। অংগাংবা অদু হায়ফম্মু",
  ask_tap_all: "সর্কেল খুদিংমক থীন্নবিয়ু",

  he: "মহাক্না",
  she: "মহাক্না",

  emotion_angry: "সাউবা", emotion_calm: "ঙাইথীবা", emotion_happy: "হরাউবা",
  emotion_sad: "ওইবা", emotion_surprised: "অংকৌবা", emotion_worried: "থৌঙাংবা",

  obj_banana: "লৈহাউ", obj_basket: "খুংগা", obj_bicycle: "চিংশাইকেল",
  obj_bucket: "বালতি", obj_clock: "ফুংগা", obj_coconut: "মহৈরোই",
  obj_comb: "চফু", obj_cow: "সানবী", obj_fish: "নুমা",
  obj_jackfruit: "থেইনৌ", obj_kettle: "কেটলি", obj_lamp: "থাওমী",
  obj_plate: "ফলেট", obj_pot: "চরুক", obj_rice: "চাক",
  obj_slippers: "চপ্পল", obj_soap: "শাবোন", obj_spoon: "চামুচ",
  obj_teacup: "চাগী কপ", obj_umbrella: "লুহুপ",

  shape_circle: "সর্কেল", shape_square: "স্কোয়ার", shape_triangle: "ত্রিয়াংগেল",
  shape_diamond: "ডায়মন্ড", shape_hexagon: "হেক্সাগন", shape_star: "থবি",

  next_games_at: (time) => `মথং শানবগী ${time} তমক্তা`,
  come_back_later: "নহাক্না ঙসি শানরে। মথং তরে হালল্লু।",

  my_day: "ঐগী নুমিৎ",
  my_day_desc: "নহাক্কী মানপাং, ঈশিং, চাক অমসুং য়েংবা",
  nothing_today: "হৌজিক তৌগদবা করিও লৈতে",
  mark_done: "লোইখ্রে",
  all_done_today: "ঙসিগী পুম্নমক লোইখ্রে",

  speak_greeting: (greeting) =>
    `${greeting}। হালহনবা ওকচরি। থৌগৎলবা মতমদা থৌদাং অমা খনবিয়ু।`,
  this_is: (name, relationship) =>
    `মসি ${name}নি। ${relationship || ""}`.trim(),
  not_sure_who: "ঐহাক্না হৌজিক ফাওবা মসি কনানো হায়বা খংদে।",
};

// ── Mizo / Lushai — first-pass translation, MODERATE-LOW CONFIDENCE.
// Latin script, so less transliteration risk than the Meitei-script block
// above, but game/clinical vocabulary here is still an approximation.
// Needs a native Mizo speaker's review before shipping.
strings.lus = {
  greeting_morning: "Chibai, Zing Ṭha",
  greeting_afternoon: "Chibai, Chhun Ṭha",
  greeting_evening: "Chibai, Tlai Ṭha",
  welcome_back: "Kal leh chuan lawm kan ti che",
  choose_activity: "Thil ti tur pakhat thlang rawh",
  your_day: "I ni",
  exit: "Chhuak",

  people_you_know: "I Hriat Mite",
  people_desc: "Hmai hriat tak en emaw, tumah po chu tunge tih zawt",
  memory_matching: "Hriatna Zoem",
  memory_desc: "Thil hriat leh mêl inzomkim zoem rawh",
  daily_routine: "Ni tin Ṭante",
  routine_desc: "Ni tin thil ti dan hun leh chu hre reng rawh",
  object_recognition: "Thil Hriatna",
  objects_desc: "I vêl thil azir azir hriat rawh",
  name_recall: "Hming Hriat",
  name_recall_desc: "Hriat mite leh hmun hmingte hre reng rawh",

  // UNVERIFIED — needs native review.
  domain_attention: "Ngaihsakna",
  domain_executive: "Ruahmanna leh Ṭante",
  domain_memory: "Hriatna",
  domain_language: "Ṭawng leh Hming",
  domain_perceptual_motor: "Chhinchhiahna leh Hmun",
  domain_social: "Mite leh Rilru",

  play: "Ṭante",
  stop: "Ṭang rawh",
  well_done_today: "Vawiin ṭha tak i ti",
  thats_it: "Chu chu a ni",
  lets_look_together: "Hetih hi en tur i",
  next: "A dawt",
  ready: "I inbuatsaih em?",
  start: "Ṭan",
  remember_these: "Hetih hi en teh",
  now_answer: "Tunah, zawhna pakhat",

  ask_which_did_you_see: "Eng nge i hmuh?",
  ask_what_is_this: "Hei hi eng an tih?",
  ask_how_feeling: (pronoun) => `${pronoun} rilru eng anga a awm?`,
  ask_put_in_order: "I tih dan angin dah rawh",
  ask_match_shape: "Chhinchhiah inzomkim chu khawih rawh",
  ask_tap_green: "Circle hring khawih rawh. Sen chu chhuang mai",
  ask_tap_all: "Circle nei zawng zawng khawih rawh",

  he: "Ama",
  she: "Ama",

  emotion_angry: "Thinur", emotion_calm: "Mual", emotion_happy: "Lawm",
  emotion_sad: "Lungngai", emotion_surprised: "Mak", emotion_worried: "Ngaihmawh",

  obj_banana: "Balhla", obj_basket: "Bawm", obj_bicycle: "Bicycle",
  obj_bucket: "Bucket", obj_clock: "Dâr", obj_coconut: " Artha",
  obj_comb: "Sam ṭaite", obj_cow: "Sial", obj_fish: "Sangha",
  obj_jackfruit: "Theipui", obj_kettle: "Kettle", obj_lamp: "Meivar",
  obj_plate: "Plate", obj_pot: "Bel", obj_rice: "Buh",
  obj_slippers: "Cherep", obj_soap: "Saphun", obj_spoon: "Spoon",
  obj_teacup: "Tea no", obj_umbrella: "Sepbur",

  shape_circle: "Vêlvang", shape_square: "Square", shape_triangle: "Triangle",
  shape_diamond: "Diamond", shape_hexagon: "Hexagon", shape_star: "Arsi",

  next_games_at: (time) => `Ṭante a dawt ${time}-ah`,
  come_back_later: "Vawiin i ṭan tawh. Nakinah kal leh rawh.",

  my_day: "Ka Ni",
  my_day_desc: "I damdawi, tui, chaw leh hmuh tur",
  nothing_today: "Tunah eng ti tur reng reng awm lo",
  mark_done: "Ṭan zo",
  all_done_today: "Vawiin thil zawng zawng ti zo",

  speak_greeting: (greeting) =>
    `${greeting}. Kal leh chuan lawm kan ti che. I inbuatsaih hunah thil ti tur thlang rawh.`,
  this_is: (name, relationship) =>
    `Hei hi ${name} a ni. ${relationship || ""}`.trim(),
  not_sure_who: "He mi hi tunge a nih hriat ka nei tawh lo.",
};

// ── Khasi, Konyak, Nyishi — STILL UNVERIFIED STUBS. ─────────────────────
//
// Deliberately left as English-fallback clones rather than machine-guessed
// translations. I do not have reliable enough training data on Khasi,
// Konyak, or Nyishi to produce dementia-care phrasing I'd trust for a real
// patient — a wrong word here (an emotion label, an instruction, "well
// done") isn't a cosmetic bug, it's a comprehension failure for someone who
// already has trouble parsing language. Get these translated by a native
// speaker (or a vetted professional translation service) rather than
// filling them in with a best guess.
strings.kha = { ...strings.en };
strings.nqo = { ...strings.en };
strings.njz = { ...strings.en };