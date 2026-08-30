// Level banks for the four cognitive games.
// Level numbers are 1-based and match the adaptive difficulty stored in Dexie.

export const MEMORY_MIN_LEVEL = 1;
export const MEMORY_MAX_LEVEL = 4; // 2×2 … 4×4 (always an even card count)
export const OBJECTS_MIN_LEVEL = 1;
export const OBJECTS_MAX_LEVEL = 5; // 5 … 25 questions
export const ROUTINE_MIN_LEVEL = 1;
export const ROUTINE_MAX_LEVEL = 4; // 4 … 16 steps
export const NAME_RECALL_MIN_LEVEL = 1;
export const NAME_RECALL_MAX_LEVEL = 5;

// NER-culturally relevant symbols added alongside generic patterns so the
// memory board feels familiar to elderly patients in Assam and the region.
const MEMORY_PATTERNS = [
  "🌸", "🍃", "🌼", "🌿", "🌺", "🍀", "☀️", "🌙", "⭐", "🌊", "🔥", "❄️",
  "🎋", "🦜", "🌾", "🐘", "🍵",
];

// Every level has an even number of cells, so every card has a partner:
// 2 pairs → 4 → 6 → 8 as the level rises.
const MEMORY_GRIDS = {
  1: { cols: 2, rows: 2 }, // 4 cards
  2: { cols: 4, rows: 2 }, // 8 cards
  3: { cols: 4, rows: 3 }, // 12 cards
  4: { cols: 4, rows: 4 }, // 16 cards
};

/** Column/row counts for a memory level. */
export function memoryGridDims(level) {
  const clamped = Math.max(MEMORY_MIN_LEVEL, Math.min(MEMORY_MAX_LEVEL, level));
  return MEMORY_GRIDS[clamped];
}

/** Human-readable board size for a level, e.g. "2×4". */
export function memoryGridLabel(level) {
  const { cols, rows } = memoryGridDims(level);
  return `${rows}×${cols}`;
}

/**
 * Deal a fresh board. Card counts are always even, so every card has a
 * matching partner — no orphan cell.
 * Positions are always shuffled — including when the player falls back.
 */
export function dealMemoryCards(level) {
  const { cols, rows } = memoryGridDims(level);
  const pairCount = (cols * rows) / 2;
  const selected = MEMORY_PATTERNS.slice(0, pairCount);
  const values = [...selected, ...selected];

  return shuffle(values).map((value, index) => ({
    id: index + 1,
    value,
    flipped: false,
    matched: false,
  }));
}

export const OBJECT_BANK = [
  { emoji: "🍎", correct: "Apple", options: ["Apple", "Banana", "Orange", "Mango"] },
  { emoji: "🕰️", correct: "Clock", options: ["Clock", "Watch", "Fan", "Lamp"] },
  { emoji: "🪑", correct: "Chair", options: ["Table", "Chair", "Bed", "Sofa"] },
  { emoji: "📚", correct: "Book", options: ["Book", "Notebook", "Pen", "Bag"] },
  { emoji: "🧴", correct: "Bottle", options: ["Cup", "Bottle", "Glass", "Jug"] },
  { emoji: "🍌", correct: "Banana", options: ["Banana", "Apple", "Papaya", "Guava"] },
  { emoji: "☕", correct: "Cup", options: ["Cup", "Plate", "Bowl", "Spoon"] },
  { emoji: "☂️", correct: "Umbrella", options: ["Umbrella", "Hat", "Coat", "Bag"] },
  { emoji: "🔑", correct: "Key", options: ["Key", "Lock", "Coin", "Ring"] },
  { emoji: "👓", correct: "Glasses", options: ["Glasses", "Watch", "Comb", "Mirror"] },
  { emoji: "🪥", correct: "Toothbrush", options: ["Toothbrush", "Comb", "Spoon", "Pen"] },
  { emoji: "🧼", correct: "Soap", options: ["Soap", "Towel", "Oil", "Cream"] },
  { emoji: "📱", correct: "Phone", options: ["Phone", "Radio", "Clock", "Remote"] },
  { emoji: "📺", correct: "Television", options: ["Television", "Fridge", "Fan", "Radio"] },
  { emoji: "🌀", correct: "Fan", options: ["Fan", "Light", "AC", "Heater"] },
  { emoji: "👞", correct: "Shoes", options: ["Shoes", "Socks", "Sandals", "Cap"] },
  { emoji: "🥄", correct: "Spoon", options: ["Spoon", "Fork", "Knife", "Plate"] },
  { emoji: "🍽️", correct: "Plate", options: ["Plate", "Bowl", "Cup", "Pan"] },
  { emoji: "🌸", correct: "Flower", options: ["Flower", "Leaf", "Tree", "Grass"] },
  { emoji: "🌳", correct: "Tree", options: ["Tree", "Flower", "Bush", "Grass"] },
  { emoji: "🐕", correct: "Dog", options: ["Dog", "Cat", "Cow", "Goat"] },
  { emoji: "🐱", correct: "Cat", options: ["Cat", "Dog", "Bird", "Rabbit"] },
  { emoji: "🍚", correct: "Rice", options: ["Rice", "Bread", "Dal", "Roti"] },
  { emoji: "💡", correct: "Lamp", options: ["Lamp", "Fan", "Clock", "Mirror"] },
  { emoji: "🪣", correct: "Bucket", options: ["Bucket", "Mug", "Pot", "Bowl"] },
  { emoji: "📰", correct: "Newspaper", options: ["Newspaper", "Book", "Letter", "Notebook"] },
  { emoji: "💊", correct: "Medicine", options: ["Medicine", "Sweet", "Soap", "Coin"] },
  { emoji: "🪮", correct: "Comb", options: ["Comb", "Brush", "Mirror", "Clip"] },
  { emoji: "🚲", correct: "Bicycle", options: ["Bicycle", "Car", "Bus", "Scooter"] },
  { emoji: "🧢", correct: "Cap", options: ["Cap", "Shoes", "Shirt", "Bag"] },
  // NER-culturally familiar objects
  { emoji: "🎋", correct: "Bamboo", options: ["Bamboo", "Sugarcane", "Reed", "Grass"] },
  { emoji: "🍵", correct: "Tea", options: ["Tea", "Coffee", "Milk", "Water"] },
  { emoji: "🐘", correct: "Elephant", options: ["Elephant", "Buffalo", "Cow", "Horse"] },
  { emoji: "🦜", correct: "Parrot", options: ["Parrot", "Crow", "Sparrow", "Pigeon"] },
  { emoji: "🌾", correct: "Paddy", options: ["Paddy", "Wheat", "Maize", "Barley"] },
  { emoji: "🪔", correct: "Diya", options: ["Diya", "Candle", "Torch", "Lamp"] },
  { emoji: "🧺", correct: "Basket", options: ["Basket", "Bag", "Box", "Pot"] },
  { emoji: "🫙", correct: "Mustard Oil", options: ["Mustard Oil", "Coconut Oil", "Ghee", "Water"] },
];

export function objectsQuestionCount(level) {
  const clamped = Math.max(OBJECTS_MIN_LEVEL, Math.min(OBJECTS_MAX_LEVEL, level));
  return clamped * 5;
}

/** Pick a unique set of objects for this round; options are shuffled too. */
export function dealObjectQuestions(level) {
  const count = objectsQuestionCount(level);
  return shuffle(OBJECT_BANK)
    .slice(0, count)
    .map((q, index) => ({
      id: index + 1,
      emoji: q.emoji,
      correct: q.correct,
      options: shuffle(q.options),
    }));
}

export const ROUTINE_LEVELS = [
  {
    id: "morning",
    title: "Morning routine",
    hint: "Start the day in order",
    steps: ["Wake up", "Brush teeth", "Have breakfast", "Take medicine"],
  },
  {
    id: "getting-ready",
    title: "Getting ready to go out",
    hint: "Get ready, then leave the house",
    steps: [
      "Wake up",
      "Wash face",
      "Brush teeth",
      "Get dressed",
      "Have breakfast",
      "Take medicine",
      "Pick up the bag",
      "Leave home",
    ],
  },
  {
    id: "midday-meal",
    title: "Preparing a meal",
    hint: "Cook, eat, then tidy up",
    steps: [
      "Wash hands",
      "Chop vegetables",
      "Boil water",
      "Cook rice",
      "Make dal",
      "Set the table",
      "Serve food",
      "Eat lunch",
      "Drink water",
      "Wash the plates",
      "Wipe the table",
      "Rest for a while",
    ],
  },
  {
    id: "full-day",
    title: "A full day at home",
    hint: "From morning through bedtime",
    steps: [
      "Wake up",
      "Brush teeth",
      "Take a bath",
      "Get dressed",
      "Have breakfast",
      "Take morning medicine",
      "Talk to family",
      "Go for a short walk",
      "Eat lunch",
      "Rest in the afternoon",
      "Have tea",
      "Watch television",
      "Eat dinner",
      "Take night medicine",
      "Change into night clothes",
      "Go to sleep",
    ],
  },
];

export function getRoutineForLevel(level) {
  const index = Math.max(0, Math.min(ROUTINE_LEVELS.length - 1, level - 1));
  const routine = ROUTINE_LEVELS[index];
  const ordered = routine.steps.map((label, i) => ({
    id: `${routine.id}-${i + 1}`,
    label,
    order: i + 1,
  }));
  return {
    ...routine,
    items: shuffle(ordered),
    stepCount: ordered.length,
  };
}

export const NAME_RECALL_CIRCLES = [
  {
    level: 1,
    title: "Close people",
    people: [
      { label: "Your mother", correct: "Maa", distractors: ["Aunty", "Didi", "Nurse"] },
      { label: "Your father", correct: "Papa", distractors: ["Uncle", "Doctor", "Neighbour"] },
      { label: "Your brother or sister", correct: "Ravi", distractors: ["Amit", "Suresh", "Karan"] },
      { label: "The nurse who visits you", correct: "Sister Meena", distractors: ["Sister Kavita", "Dr. Sharma", "Asha"] },
      { label: "Your caregiver at home", correct: "Asha", distractors: ["Meena", "Sunita", "Rekha"] },
    ],
  },
  {
    level: 2,
    title: "People at home",
    people: [
      { label: "The milkman who comes in the morning", correct: "Hari", distractors: ["Raju", "Mohan", "Sohan"] },
      { label: "The maid who helps at home", correct: "Kamala", distractors: ["Geeta", "Lata", "Sita"] },
      { label: "The cook in your kitchen", correct: "Rani", distractors: ["Asha", "Pooja", "Nisha"] },
      { label: "The driver who takes you to the clinic", correct: "Iqbal", distractors: ["Imran", "Farhan", "Salim"] },
      { label: "The watchman at the gate", correct: "Bahadur", distractors: ["Ram", "Singh", "Kumar"] },
    ],
  },
  {
    level: 3,
    title: "Neighbourhood",
    people: [
      { label: "Your neighbour who brings vegetables", correct: "Ramesh", distractors: ["Suresh", "Mahesh", "Dinesh"] },
      { label: "The shopkeeper at the corner store", correct: "Bora deka", distractors: ["Hazarika", "Kalita", "Nath"] },
      { label: "The postman", correct: "Prakash", distractors: ["Naresh", "Dinesh", "Mukesh"] },
      { label: "The pharmacist at the medical store", correct: "Chemist Babu", distractors: ["Dr. Khan", "Grocer Ram", "Watchman"] },
      { label: "The person who delivers the newspaper", correct: "Sohan", distractors: ["Mohan", "Rohan", "Kishan"] },
    ],
  },
  {
    level: 4,
    title: "Care and community",
    people: [
      { label: "The doctor you visit every month", correct: "Dr. Sharma", distractors: ["Dr. Verma", "Dr. Gupta", "Dr. Khan"] },
      { label: "Your granddaughter who studies in college", correct: "Ananya", distractors: ["Anjali", "Aisha", "Amrita"] },
      { label: "Your son who lives in another city", correct: "Arjun", distractors: ["Rohan", "Vikram", "Karan"] },
      { label: "The physiotherapist", correct: "Dr. Neha", distractors: ["Dr. Anil", "Sister Meena", "Coach Raj"] },
      { label: "The priest at the local temple", correct: "Pandit ji", distractors: ["Imam ji", "Father Thomas", "Guru ji"] },
    ],
  },
  {
    level: 5,
    title: "People you see less often",
    people: [
      { label: "Your old colleague from work", correct: "Mr. Hazarika", distractors: ["Mr. Bora", "Mr. Kalita", "Mr. Das"] },
      { label: "A distant cousin who visits on festivals", correct: "Manish", distractors: ["Ashish", "Rajesh", "Nitesh"] },
      { label: "The bus conductor on your usual route", correct: "Shankar", distractors: ["Gopal", "Lal", "Dev"] },
      { label: "The landlord of the house", correct: "Seth ji", distractors: ["Malik ji", "Sahib", "Babu ji"] },
      { label: "The tailor who stitches your clothes", correct: "Master ji", distractors: ["Darzi Ram", "Gupta ji", "Kaka"] },
    ],
  },
];

export const NAME_CIRCLE_OPTIONS = NAME_RECALL_CIRCLES.map((c) => ({
  level: c.level,
  title: c.title,
}));

function distractorsFromPool(correct, pool, n = 3) {
  const others = shuffle(pool.filter((name) => name !== correct));
  return others.slice(0, n);
}

/**
 * Build a round of name-recall questions for a level.
 * Caregiver-added vault people for that circle are included first.
 */
export function dealNameRecallQuestions(level, vaultPeople = []) {
  // An exact `find` on level fell back to the FIRST circle for anything it did
  // not recognise, so on the 0-15 scale a patient at level 9 would be handed
  // the easiest circle. Levels are one scale now (shared/levels.js) and these
  // banks are still 1-based, so clamp into the content that exists. The banks
  // themselves are replaced by the item bank in Sprint 3.
  const index = Math.max(
    0,
    Math.min(NAME_RECALL_CIRCLES.length - 1, Math.round(level) - 1)
  );
  const circle = NAME_RECALL_CIRCLES[index];
  const custom = vaultPeople
    .filter((p) => Number(p.circle || 1) === circle.level && p.name?.trim())
    .map((p) => ({
      label: p.relationship?.trim() || `Someone you know named ${p.name}`,
      correct: p.name.trim(),
      distractors: [],
    }));

  const combined = [...custom, ...circle.people];
  const namePool = [
    ...combined.map((p) => p.correct),
    "Ramesh",
    "Suresh",
    "Meena",
    "Asha",
    "Arjun",
    "Kavita",
  ];

  const picked = shuffle(combined).slice(0, 5);
  return picked.map((person, index) => {
    const extra = person.distractors?.length
      ? person.distractors
      : distractorsFromPool(person.correct, namePool);
    const options = shuffle([person.correct, ...extra.slice(0, 3)]);
    return {
      id: index + 1,
      label: person.label,
      correct: person.correct,
      options,
    };
  });
}

export function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export const GAME_LEVEL_META = {
  memory: { min: MEMORY_MIN_LEVEL, max: MEMORY_MAX_LEVEL, label: "Memory Matching" },
  objects: { min: OBJECTS_MIN_LEVEL, max: OBJECTS_MAX_LEVEL, label: "Object Recognition" },
  routine: { min: ROUTINE_MIN_LEVEL, max: ROUTINE_MAX_LEVEL, label: "Daily Routine" },
  "name-recall": { min: NAME_RECALL_MIN_LEVEL, max: NAME_RECALL_MAX_LEVEL, label: "Name Recall" },
};