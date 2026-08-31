# Sahaay — Patient Side Rewrite: Implementation Plan

**For an agent with no prior context. Read this whole file before writing any code.**

---

## Part 0 — What you are working on

Sahaay is a cognitive assistance app for elderly dementia patients in North East India. It has a patient side (games, reminders, family photos) and a caregiver/doctor side (dashboards, reports). Stack is React + Dexie (IndexedDB) on the client, FastAPI + SQLAlchemy on the server, with two LangChain agents.

**You are rewriting the patient side only.** The caregiver and doctor dashboards should keep working throughout — they iterate over whatever data arrives, so they mostly survive untouched.

### What is changing and why

| From | To | Reason |
|---|---|---|
| 4 invented domains | 6 DSM-5 domains | The four current domains aren't a recognised framework. Two of them collapse different tasks together, and one (attention) has no game at all — it's synthesised from completion rate. |
| Levels 1–5, disagreeing between client and server | Levels 0–15, defined once | Client allows routine 1–4 and name-recall 1–5, server clamps both to 1–3. Content is currently unreachable because of this. |
| Difficulty changes every round | Difficulty changes on a 7-day pattern | A single bad round is noise. Only a sustained pattern should move a clinical number. |
| Failure feedback everywhere | Errorless design | Failure creates anxiety in dementia patients, which makes them stop using the app. |
| LLM picks difficulty | LLM analyses weekly trends; difficulty is a formula | Difficulty must be deterministic and reproducible. Interpretation is the model's job, arithmetic isn't. |
| Unlimited play | 2 sessions/day, 10 min each, 4-hour gap | Matches clinical dosing, prevents fatigue contaminating the data. |

### The one-sentence product statement

> Six cognitive domains, measured twice daily at home in the patient's own language, tracked as trend lines over months, so a caregiver can see decline between clinic visits.

**We do not diagnose.** Nothing in the UI or the reports may state or imply a diagnosis, a dementia subtype, or anything about medication.

---

## Part 1 — Facts about the existing codebase

These come from a full read of the tree. Trust them, but verify line numbers before editing — they may have drifted.

### Files you will touch most

```
frontend/src/
  lib/difficulty.js          DELETE ENTIRELY
  lib/gameContent.js         rewrite — level banks are 1-based arrays
  lib/db.js                  v4 schema needed
  lib/api.js                 remove plan fetch/cache
  lib/i18n.js                needs many new keys
  lib/utils.js               keep speak(); delete level helpers
  components/games/*.jsx     4 games, all rewritten
  pages/PatientHome.jsx      session gating added
  pages/MemoryVault.jsx      becomes My People
backend/app/
  domains.py                 rewrite — 4 domains -> 6
  models.py                  add base level storage
  schemas.py                 drop coach schemas
  routers/sessions.py        domain frozen at write time here
  routers/ai.py              drop /adapt-difficulty
  services/agents.py         lines 16-289 repurposed, 292-470 untouched
  services/analytics.py      6 domain-aware functions
  services/prompts.py        coach prompt replaced, report prompt kept
  seed_demo.py               full reseed required
```

### Seven traps that will silently corrupt data

Every one of these is real and currently live.

**1. Legacy level migration**
`db.js:333` `migrateLegacyMemoryLevels()` remaps levels `{2:1, 3:2, 4:3}` on the first memory read, gated by a `settings` flag. On any device where that flag is unset it will rewrite a 0–15 value into garbage. **Delete this function before writing any new level anywhere.** Unrecoverable if it runs.

**2. Level 0 is falsy**
Three places coerce 0 to 1:
- `agents.py:135` — `new_level or level or 1`
- `agents.py:240` — same
- `analytics.py:164` — `row.new_level or row.level or 1`

On a 0–15 scale, every genuine level-0 patient reads as level 1. Replace with explicit `is None` checks. Do the same sweep on the client for `||` and truthiness checks on level.

**3. Domain is frozen at write time**
`sessions.py:85` resolves `domain_for_game()` and stores the label in the row. Every historical row carries a dead four-domain label and will not re-map. Either migrate the column or declare a hard cutover date and reseed. **Reseeding is the right call here** — the historical data is demo data anyway.

**4. Two independent ±1 clamps**
`difficulty.js:30` `bound()` and `agents.py:45` `clamp()` implement the same rule separately. If only one is removed, the client will silently undo the server.

**5. Score means two different things**
Memory writes move-efficiency (`pairCount / moves`) into `score/total`. Objects, routine and name-recall write correct-answers-over-questions. Both are averaged together by `analytics._accuracy()`, so the overall number is currently meaningless. **Pick accuracy. Move efficiency to its own field.**

**6. No game can log an abandoned round**
All four games pass `completed: true` literally. There is no unmount handler, no `beforeunload`, no partial write. Consequences: `outcomeOf`'s `if (!stats.completed)` branch is dead code, and 60% of `attention_score()` is a constant 1.0.

**7. Routine's punishment IS its measurement**
`RoutineGame.jsx:64–71` wipes the whole sequence on a wrong tap. That's also the only reason `errors` gets counted. Removing the punishment (which errorless design requires) removes the score. The scoring has to be redesigned at the same time, not after.

### One thing to preserve exactly

**Preview mode.** `db.js:104–117`, flag `sahaay-preview-mode` in sessionStorage. It's the only thing keeping caregiver testing out of clinical data. It currently blocks `logGameSession()` and `setDifficulty()`. Keep it verbatim and make sure every new write path respects the same guard.

---

## Part 2 — The target design

### The six domains

```python
DOMAINS = [
    "attention",         # complex attention
    "executive",         # executive function
    "memory",            # learning and memory
    "language",          # language
    "perceptual_motor",  # perceptual-motor
    "social",            # social cognition
]
```

These are the six DSM-5 neurocognitive domains. All dementia types affect these same six — they differ in which one goes first and how fast. That's why domain is the right axis and subtype is not.

### Levels

- Six independent base levels per patient, one per domain, range **0–15**
- 15 = performing well, 0 = severe
- Levels move independently. Memory dropping must not drag executive down. **That independence is the entire clinical signal** — a memory drop with flat executive looks different from a global drop, and that difference is what the caregiver needs to see.
- **Level 0 is valid, not missing.**
- Base levels are **stored on the patient record**, never inferred from the newest session (which is what the code does today).

### Daily score vs base level

Two different things:

- **Daily score** — 0–15, per domain, computed fresh from that day's play. Noisy.
- **Base level** — the clinical number. Moves at most ±1 per domain per week.

Rules:
1. A session starts at the patient's current base level
2. Play produces a daily score per domain
3. Daily scores flat across 7 days → base level +1
4. Daily scores declining across 7 days → base level −1
5. One bad day changes nothing

Flag threshold for the caregiver: **−2 sustained**, not −1. On a 0–15 scale one step is small.

### Difficulty formula

One formula, all domains, no hand-tuned tables:

```js
export function difficultyFor(level) {
  return {
    gridSize:  Math.min(2 + Math.floor(level / 2), 8),
    itemCount: 2 + level,
    timerSec:  null,                        // never
    cueLevel:  level < 5  ? 'full'
             : level < 10 ? 'partial'
             : 'none',
  };
}
```

Because it's a formula, the number of levels is free. **No sub-levels** — granularity comes from these parameters moving inside a level.

**The level controls difficulty and nothing else.** It does not change which games appear, swap in other content, or lock anything.

### Sessions

- 2 per day, ~10 minutes each, 20 min/day hard cap
- Session 2 unlocks **4 hours after session 1 ends** — a rolling gap, not a fixed clock time
- Each session contains **all six domains**, shuffled order, 2 items each
- **Session contents are fixed when the session starts.** Getting item 3 wrong must not change item 4. Wrong answers move the base level in 7 days; they change nothing inside the current session.
- No timers. Log `latencyMs` silently, never display it.
- Always-visible exit that is never treated as failure

### Errorless design — 12 sites to remove

Complete inventory from the audit:

| # | Location | What the patient currently sees |
|---|---|---|
| 1 | `MemoryGame.jsx:206` | Live "Moves: N" counter |
| 2 | `MemoryGame.jsx:152–162` | Mismatched pair flips back after 900ms |
| 3 | `MemoryGame.jsx:241` | "Completed in N moves" |
| 4 | `RoutineGame.jsx:64–71` | Wrong tap wipes the whole sequence |
| 5 | `RoutineGame.jsx:170` | Row dims to opacity-60 while wrong |
| 6 | `ObjectsGame.jsx:156–163` | Wrong pick greys out |
| 7 | `ObjectsGame.jsx:184` | "You got N out of M correct" |
| 8 | `ObjectsGame.jsx:141` | Progress counter "3 of 15" |
| 9 | `NameRecallGame.jsx:174–182` | Correct/wrong option styling |
| 10 | `NameRecallGame.jsx:203` | "You got N out of M correct" |
| 11 | `NameRecallGame.jsx:156` | Progress counter |
| 12 | `difficulty.js:107` | Spoken "Next round will be a little gentler" |

Replacement behaviour: wrong pick → the correct option gently appears, warm tone, move on. No red, no X, no score shown, no "wrong". Session ends with "Well done today" regardless of performance.

### The AI layer — two agents, neither touches difficulty

**Agent 1 — weekly trend analyst** (repurposed from the coach, ~60% of the code survives)
- Runs weekly, not per round
- Input: 7 days of daily scores across all six domains
- Output: which base levels move ±1, with a written reason each
- **The model proposes, the server bounds.** Max ±1 per domain per week, never without 7 days of data. Clamp anything outside that.
- Keep the existing rule-based fallback for when the model is unavailable

**Agent 2 — clinical report** (unchanged)
- Reads `analytics.domain_scores()`, writes prose
- Its prompt hardcodes no domain names, so it describes six domains the moment analytics does. **No prompt changes needed.**

### Item bank

Three tiers:

**Tier 1 — generated at runtime, no bank**
- attention (go/no-go), perceptual_motor (shape match, clock hands)
- Generated from the level. Rotation is automatic.

**Tier 2 — template × content, small asset pool multiplies out**
- memory, language — both draw from a ~20 image object pool
- 20 images choose 3 = 1,140 combinations. Need 20.

**Tier 3 — hand-authored, the only real work**
- executive (routine sequences need real-world logic — brushing before eating)
- social (faces need verified emotion labels — code can't check a face looks sad)

**Rule: the LLM may author content offline, but never generates a question at runtime.** Three reasons: offline is a requirement, a hallucinated question shown to a dementia patient is a real harm, and latency loses an elderly user. Author-time model, runtime static bank.

**Target: 20 items per domain.** Enough for six full sessions with no repeat.

### Item shape

```json
{
  "id": "mem-001",
  "domain": "memory",
  "template": "which-did-you-see",
  "minLevel": 4,
  "maxLevel": 11,
  "show": { "images": ["fish","gamosa","kettle"], "durationMs": 4000 },
  "gap":  { "type": "blank", "durationMs": 8000 },
  "ask": {
    "prompt": "Which one did you see?",
    "options": ["fish","umbrella","bicycle"],
    "correct": "fish"
  }
}
```

`minLevel`/`maxLevel` do the difficulty selection — no separate easy/hard versions of the same item. Distractors come from the same asset pool, so they cost nothing to author.

### Rotation

**Never repeat an item within 14 days.** Otherwise the patient memorises the specific pictures, scores climb, and the trend line reports improvement where nothing changed.

- Banked items: log `itemId`, check against the last 14 days
- Generated items: log `template + seed`

### The report — two layers

**Primary (the verdict):** six base levels and their 30-day trends. Only game data moves this.

**Secondary (context only, never changes the verdict):**

| Signal | Source | Meaning |
|---|---|---|
| Sessions completed | play history | is there enough data to trust the trend |
| Reminder completion | My Day | how daily routine is holding up |
| Photo activity | My People | engagement |

These are functional and engagement signals, not cognitive scores. Someone missing water reminders is worth knowing but must not lower their Memory level.

**Trust marker:** fewer than 5 sessions in 14 days → report says **"not enough data"** instead of drawing a trend. Never draw a line the data can't support.

### My People (was Memory Vault)

Card per person, like a simple ID card:

| Field | Example |
|---|---|
| Photo | clear face |
| Name | Rahul |
| Relationship | Your son |
| Age | 42 |
| What they do | Teacher |
| Where they live | Guwahati |
| Married to | Priya |
| Children | Two — Aarav and Ria |
| What they like | Fishing |
| Favourite food | Fish curry |

Fields are optional. The Test only asks about filled fields — the card **is** the question bank.

**Two sections:**
- **Revision** — browse cards, details read aloud, nothing scored, nothing recorded, always available
- **Test** — 3-option MCQ generated from filled fields. Scores into **memory** (who is this) and **social** (relationship and detail questions).

Distractors come from the other cards, so "Where does Rahul live?" offers real place names from the family. Plausible for free.

**Revision is not a punishment.** It is not where the patient goes after failing the Test.

**This data is now clinical** (it feeds the report), so it needs a server home. It is currently device-local Dexie only and is destroyed by clearing browser data.

### Interface rules

- Big buttons, big text, high contrast, no thin fonts
- **Tap only.** No drag, no swipe, no pinch — tremor is common
- Debounce accidental double-taps
- One thing on screen at a time
- No patient login. One device, one person, opens straight to PLAY
- Voice reads instructions aloud (existing `speak()` in `utils.js` is fine)

---

## Part 3 — Sprints

Each sprint has a goal, a task list, tests, and a definition of done. **Do not start a sprint until the previous one's DoD passes.**

---

### Sprint 0 — Landmines

**Goal:** make it impossible to corrupt data in later sprints. Nothing here is user-visible.

**Tasks**
1. Delete `migrateLegacyMemoryLevels()` (`db.js:333–347`) and its `settings` flag
2. Replace `new_level or level or 1` at `agents.py:135` and `agents.py:240` with explicit `is None` checks
3. Replace `row.new_level or row.level or 1` at `analytics.py:164` likewise
4. Grep the client for `level ||`, `if (level)`, `!level` and fix each one
5. Create `shared/levels.js` and `backend/app/levels.py` — `MIN_LEVEL = 0`, `MAX_LEVEL = 15`. Every other file imports from here.
6. Delete `bound()` (`difficulty.js:30`) and `clamp()` (`agents.py:45`) plus `LEVEL_BOUNDS`

**Tests**
- Unit: a patient with level 0 round-trips through save → load → analytics and comes back 0, not 1
- Unit: `MAX_LEVEL` is imported from one place; grep confirms no other hardcoded 15 or 5
- Manual: clear browser data, load the app, confirm no migration runs

**DoD:** level 0 survives a full round trip. No `or 1` chains remain anywhere.

---

### Sprint 1 — Six domains

**Goal:** the six-domain taxonomy exists end to end. This unlocks the report agent for free.

**Tasks**
1. Rewrite `backend/app/domains.py`:
   ```python
   DOMAINS = ["attention","executive","memory",
              "language","perceptual_motor","social"]
   DERIVED_DOMAINS = []          # attention is now genuinely measured
   ```
2. Rewrite `GAME_TO_DOMAIN` for the new game set
3. Update `analytics.domain_scores()` (`:121–149`) to loop six domains, remove the derived branch
4. Delete `analytics.attention_score()` (`:99–118`) — attention is measured now, not synthesised
5. Update `_latest_levels()` (`:152`) to read stored base levels instead of inferring from sessions
6. Add six base levels to the patient model (see Sprint 2)
7. Add i18n keys for the six domain display names in `en`, `hi`, `as`

**Tests**
- Unit: `domain_scores()` returns exactly six entries for a patient with data
- Unit: a patient with no data returns six entries with `None` scores, not an empty list
- Integration: hit the report endpoint and confirm the LLM output mentions six domains **with no prompt changes**
- Visual: caregiver dashboard grid wraps 4+2 without layout breakage

**DoD:** report agent describes six domains. Dashboards render without code changes.

---

### Sprint 2 — Storage

**Goal:** base levels have a real home on both sides.

**Tasks**
1. Server: add a `patient_domain_levels` table or six columns on `patients`. Default all to `null` (uncalibrated), not 0 and not 1.
2. Client: Dexie v4 schema
   - drop `aiPlans`
   - add `domainLevels` keyed by `patientId`
   - add `itemHistory` for 14-day rotation: `{patientId, domain, itemId, playedAt}`
   - keep `logGameSession`, the sync queue, preview helpers, and the vault tables
3. Extend the session row: `status` (`completed` | `abandoned`), `itemIds`, `sessionId`, `domain` sent from the client rather than resolved server-side
4. Stop `sessions.py:85` resolving domain at write time — accept it from the payload
5. Migration path: reseed rather than migrate. Historical rows are demo data.

**Tests**
- Unit: Dexie v3 → v4 upgrade on a populated database loses no sessions
- Unit: a session row with `status: 'abandoned'` and null scores saves and syncs
- Integration: sync a batch containing one abandoned row and confirm dedup still works
- Unit: `null` (unplayed) and `0` (genuinely scored zero) are distinguishable after a round trip

**DoD:** six base levels persist client and server. Abandoned rounds can be written.

---

### Sprint 3 — Item bank

**Goal:** content exists for all six domains.

**Tasks**
1. Gather assets: ~20 object images, ~12 faces (6 emotions × 2 people). Pexels or Unsplash — free for commercial use, no attribution required. Search "Indian man smiling" rather than generic emotion terms.
2. Write `itemBank.json` — 20 items each for memory, language, social, executive
3. Write generators for attention and perceptual_motor:
   ```js
   generateAttention(level) {
     return {
       domain: "attention",
       stimuli:    6 + level * 2,
       noGoRatio:  level < 3 ? 0 : Math.min(0.1 + level * 0.015, 0.3),
       windowMs:   2200 - level * 85,
       targetSize: level < 5 ? "xl" : "md",
     };
   }
   ```
   Attention is **go/no-go, visual only** — green tap, red don't. That measures sustained attention and response inhibition, not just reaction time. No voice.
4. Write the selector: given domain + level + 14-day history, return an eligible item
5. Write `difficultyFor(level)` in the shared module
6. **Delete `CONTENT_MAX_LEVEL` from `shared/levels.js` and `backend/app/levels.py`.** It is the interim ceiling that kept a proposed level inside the fixed banks. Once `difficultyFor` serves every level on demand it is wrong, not just redundant: left in place it caps the 0-15 scale at 5, and a patient pinned at a ceiling reads exactly like a patient who stopped improving. `stepBounded`/`step_bounded` must then clamp to `MAX_LEVEL` alone.

**Tests**
- Unit: selector never returns an item outside `[minLevel, maxLevel]`
- Unit: selector never returns an item played in the last 14 days
- Unit: with all 20 items exhausted, selector degrades gracefully (returns the oldest) rather than throwing
- Unit: `generateAttention(0)` has `noGoRatio === 0` — level 0 must be near-impossible to fail
- Unit: `generateAttention(15)` produces harder settings than `generateAttention(7)` on every axis
- Unit: `stepBounded(15, 14, gameType)` returns 15 for every domain — no content ceiling survives
- Gate: `tools/check_level_parity.py` fails while `difficultyFor` and `CONTENT_MAX_LEVEL` coexist, so the table cannot quietly survive this sprint
- Manual: every image loads offline after first cache

**DoD:** 20 items per banked domain. Generators produce valid configs at levels 0, 7 and 15. `CONTENT_MAX_LEVEL` is gone from both mirrors and the full 0-15 range is reachable.

---

### Sprint 4 — Games rewritten

**Goal:** six games, errorless, driven by the bank.

**Tasks**
1. Build a shared `<GameShell>` — loads the item, renders by template, collects the answer, logs, hands back to the session runner. Games become thin renderers.
2. Rewrite the four existing games onto it; add the two missing domains
3. Remove all 12 failure sites (table above)
4. **Rescore Routine.** Wrong tap now does nothing; the correct step highlights gently. Score becomes taps-to-complete rather than errors-before-reset. Same signal, no punishment.
5. Fix Memory's scoring — accuracy in `score/total`, move efficiency in its own field
6. Delete `lib/difficulty.js` entirely
7. Add the abandon path: unmount handler and explicit exit both write `status: 'abandoned'`, unplayed domains get `null` not `0`
8. Route every user-facing string through `t()` — the games are currently hardcoded English even when the voice speaks Assamese

**Tests**
- Unit: each game logs exactly one session row per round, including abandons
- Unit: a wrong answer produces no state change beyond recording it
- Unit: quitting mid-round writes `abandoned` with nulls, never zeros
- Manual: play a full round of each game and confirm zero failure signals — no red, no X, no counter, no score
- Manual: switch language to `as` and confirm no English leaks into game UI
- Regression: existing sync still works

**DoD:** six games playable, no failure feedback anywhere, abandons logged.

---

### Sprint 5 — Session runner

**Goal:** 2 sessions a day, locked contents, 4-hour gap.

**Tasks**
1. Build the session runner: on start, pick one item per domain, shuffle order, **freeze the list**
2. Enforce 2 items per domain per session
3. 4-hour rolling gap between sessions — from session 1's end time, not a wall clock
4. 20 min/day hard cap
5. Waiting screen: clock image plus "Next games at 3:40 PM". **Never a greyed-out button** — that reads as broken and the patient stops opening the app
6. Always-visible exit
7. "Well done today" on completion, unconditionally
8. Respect preview mode on every new write path

**Tests**
- Unit: session contents do not change when an answer is wrong
- Unit: session 2 is locked until 4 hours after session 1 ended
- Unit: a session started at 23:50 and finished at 00:05 counts correctly for the day
- Unit: the daily cap counts play time, not wall-clock time since first open
- Manual: preview mode writes nothing
- Manual: quit halfway, reopen — the same frozen session resumes, it does not reshuffle

**DoD:** two sessions per day with a working gap. Contents provably immutable mid-session.

---

### Sprint 6 — Level movement

**Goal:** daily score → 7-day pattern → base level ±1.

**Tasks**
1. Compute a daily score per domain from that day's items
2. Store daily scores — do not recompute from raw sessions each time
3. Weekly evaluation job:
   - fewer than 5 play days in the window → **no change**, mark `insufficient_data`
   - flat across 7 days → +1
   - declining across 7 days → −1
   - otherwise no change
4. Clamp to `[0, 15]`
5. Write to `difficulty_history` with the reason
6. Caregiver flag at −2 sustained

**Tests**
- Unit: one bad day in seven does not move the base level
- Unit: seven flat days moves +1 exactly once, not seven times
- Unit: a domain with 4 play days returns `insufficient_data`, not a change
- Unit: a level at 15 does not go to 16; a level at 0 does not go to −1
- Unit: level 0 is never coerced to 1 anywhere in this path
- Integration: 90 days of seeded declining data produces a visible downward trend and a flag

**DoD:** base levels move only on sustained patterns. Bad days provably absorbed.

---

### Sprint 7 — AI agents

**Goal:** two agents, neither in the difficulty loop.

**Tasks**
1. Repurpose the coach in `agents.py:75–289` into the weekly trend analyst
   - Keep: the chain, `ChatPromptTemplate | llm | PydanticOutputParser`, Groq/Gemini fallback, the rule-based fallback
   - Change: input becomes 7 days × 6 domains; output becomes six ±1 moves with reasons
   - Delete: `outcomeOf`, per-round plan cache, `SourceBadge` and its four call sites
2. Rewrite the coach prompt in `prompts.py:5–43`. **Leave the report prompt (`:48–103`) alone.**
3. Delete `/adapt-difficulty` (`ai.py:39–52`) and the coach schemas (`schemas.py:309–337`)
4. Remove the plan fetch and cache (`api.js:336–352, :404–407`)
5. Server-side clamp on whatever the model returns: ±1 max, and reject any move without 7 days of data
6. Leave Agent 2 completely untouched

**Tests**
- Unit: a model returning +5 is clamped to +1
- Unit: a model returning a move for a domain with 3 days of data is rejected entirely
- Unit: with the model unavailable, the rule fallback produces valid moves and nothing blocks
- Unit: malformed model output does not crash the weekly job
- Integration: the report agent still produces prose with no prompt change
- Manual: play a round with the network off — difficulty still resolves, because it is a formula

**DoD:** difficulty never calls a model. Both agents run. Offline play works.

---

### Sprint 8 — Report weighting

**Goal:** games drive the verdict; everything else is context.

**Tasks**
1. Six trend lines as the primary report surface
2. Engagement signals in their own section, visually secondary, explicitly unable to change the verdict
3. `insufficient_data` state — fewer than 5 sessions in 14 days shows "not enough data" instead of a trend line
4. Update `ClinicalAssistant`'s "difficulty changes today" — with weekly moves this panel is empty six days in seven. Reframe as "recent changes" over a wider window.
5. Update `CaregiverDashboard:713` — `{level} / {meta.max}` needs the new ceiling

**Tests**
- Unit: perfect reminder adherence with declining game scores still reports declining
- Unit: zero reminder adherence with flat game scores still reports stable
- Unit: 4 sessions in 14 days renders "not enough data", not a flat line
- Visual: six trend lines render; engagement is clearly subordinate

**DoD:** engagement provably cannot move the verdict. `insufficient_data` renders.

---

### Sprint 9 — My People

**Goal:** card system with Revision and Test, and a server home.

**Tasks**
1. Extend the card schema to the full ID-card field set
2. Revision view — big photo, details below, tap for next, nothing recorded
3. Test view — 3-option MCQ generated from filled fields only
4. Distractors pulled from other cards
5. Score into memory and social
6. Server table + sync for card data — it is clinical now
7. Rotation applies: don't ask the same question about the same person two days running

**Tests**
- Unit: a card with only name and photo generates only "who is this", no empty questions
- Unit: distractors never include the correct answer twice
- Unit: Revision writes nothing to sessions
- Unit: Test writes to both memory and social
- Integration: cards survive a browser data clear once synced
- Manual: getting a family member's name wrong shows no failure signal

**DoD:** both modes work. Cards survive a data clear. Test feeds two domains.

---

### Sprint 10 — Seed and demo

**Goal:** the app looks like it has been used for three months.

**Tasks**
1. Rewrite `seed_demo.py` — six domains, 0–15 levels, realistic daily scores
2. Three demo patients:
   - **Kamala, 72** — all six flat, all green, stable
   - **Bipul, 78** — memory declining, other five flat. **This is the money shot** — one domain moving alone is something a single-score dashboard cannot show.
   - **Rina, 69** — 6 sessions in 30 days, `insufficient_data`
3. 90 days of history each, with realistic day-to-day noise so the trend is visible but not a straight line
4. Dashboard opens on Bipul by default
5. Optional: a "simulate 90 days" button on the demo account. Label it clearly as demo mode — openly faked reads as confident, hidden reads as cheating.

**Tests**
- Unit: seeded data produces the intended verdict for each of the three patients
- Unit: no seeded row carries an old four-domain label
- Manual: dashboard loads with Bipul's amber memory flag visible
- Manual: full run with the network disconnected

**DoD:** three patients with 90 days of history. Bipul's single-domain decline visible on open.

---

## Part 4 — Testing strategy

### Per sprint

Every sprint's DoD is a gate. Do not proceed past a failing one.

### Regression suite — run after every sprint

1. Level 0 round-trips as 0 through every layer
2. Sync works offline → online
3. Preview mode writes nothing
4. No failure feedback in any game
5. Caregiver and doctor dashboards render without errors
6. The report agent produces prose

### The five tests that matter most

| Test | Why |
|---|---|
| Level 0 is not coerced to 1 | Three live `or` chains do this today |
| A wrong answer doesn't change the current session | The whole locked-session design |
| One bad day doesn't move a base level | The whole clinical model |
| Engagement can't change the verdict | The report weighting |
| Full offline play | A stated requirement, and a demo-killer if it fails |

### Manual checklist before any demo

- [ ] Airplane mode: play a full session start to finish
- [ ] Play a round badly on purpose — confirm zero failure signals
- [ ] Quit mid-round, reopen, confirm the same session resumes unshuffled
- [ ] Switch to Assamese, confirm no English in game UI
- [ ] Open the caregiver dashboard — Bipul's flag visible
- [ ] Clear browser data, log in, confirm My People cards return from the server

---

## Part 5 — Rules that must never be broken

1. **Never write `level or 1`, `if (level)`, or any falsy check on a level.** 0 is valid.
2. **Never change session contents mid-session.**
3. **Never show failure to the patient.** No red, no X, no score, no "wrong".
4. **Never generate a question at runtime with a model.** Author-time only.
5. **Never let a model move a base level more than ±1, or move one without 7 days of data.**
6. **Never let engagement signals change the clinical verdict.**
7. **Never write `0` for an unplayed item.** Use `null`.
8. **Never draw a trend line without enough data.** Say "not enough data" instead.
9. **Never claim a diagnosis, a subtype, or anything about medication.**
10. **Never break preview mode.** It is the only thing keeping test data out of clinical data.

---

## Part 6 — If you have to cut scope

Cut in this order:

1. Sprint 9 (My People Test mode) — Revision alone still demos well
2. Sprint 7 (Agent 1 repurpose) — leave the old coach in place, disconnected
3. Sprint 8 (engagement layer) — six trend lines alone are the point
4. Two of the six games — four domains with real data beats six with stubs

**Never cut:** Sprint 0, 1, 2, 5, 6, or 10. Those are the model and the demo.
