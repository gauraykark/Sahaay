# Patient Side — Build Spec

Everything below is decided. Nothing here needs more discussion.

---

## 1. What the patient sees

Three things only:

1. **PLAY** — one big button. This is the main thing.
2. **My Day** — reminders (medicine, water, food, appointments)
3. **My People** — family photos with names

No menus. No categories. No settings on this side.

PLAY is the priority. The other two are real features people need, but they are not the point of the app.

---

## 2. The six areas we measure

Every game belongs to one of these six. The patient never sees these names.

| Area | What it means | Example game |
|---|---|---|
| Attention | noticing and staying focused | tap when you hear the drum |
| Executive | planning and ordering | put daily routine in order |
| Memory | remembering | 3 pictures, recall after a gap |
| Language | naming things | "what is this called?" |
| Perceptual-Motor | seeing shapes and space | match shape / set clock hands |
| Social | reading faces and feelings | which face is happy? |

These six come from DSM-5, the standard doctors use. All types of dementia hit these same six areas — they just hit them in a different order and at different speeds.

---

## 3. Levels

- Every patient has **6 base levels**, one per area
- Range: **0 to 15**
  - 15 = doing fine
  - 0 = very severe
- The six levels move **independently**. Memory dropping does NOT drag the others down. That independence is the whole signal.

**First launch:** short calibration, about 90 seconds per area. Start high, drop fast on failure until it settles. This sets the first base level. Never start everyone at 15.

**Level 0 is a real level, not "missing".** Never write `level or 1` or `if (level)` anywhere — 0 is falsy in both Python and JS, and every level-0 patient would silently read as level 1. Use `if level is None` instead. The current code has three of these chains and they must all go.

**Base levels are stored, not inferred.** Today the server works out the level by reading the newest session. That cannot work with six independent levels. Add a real store: six numbers on the patient record, one place, client and server reading the same source.

---

## 4. How the level moves

Two different things, don't mix them up:

- **Daily score** — 0 to 15, measured fresh every day. Moves a lot. Noisy.
- **Base level** — the real number. Moves slowly. This is what we track.

Rules:

1. Each day starts at the patient's **base level**
2. Patient plays, produces a **daily score** for each area
3. If daily scores stay **constant for 7 days** → base level **+1**
4. If daily scores keep **dropping over 7 days** → base level **−1**
5. One bad day changes nothing. Only a pattern moves the base level.

**Long-term view:** 30 days of base levels is the trend. Flat for months = good, that means we're doing our job. Falling = flag it.

Use **−2 sustained** as the flag threshold, not −1 (because the scale is 0–15, one step is small).

---

## 5. What the level actually controls

**The base level changes difficulty. Nothing else.**

It does not change which games appear. It does not swap games for other content. It does not unlock or lock anything. Difficulty only.

One formula, works for every game, every level. No hand-made tables.

```js
gridSize  = Math.min(2 + Math.floor(level / 2), 8);
itemCount = 2 + level;
timerSec  = null;                     // no timers, see section 8
cueLevel  = level < 5  ? 'full'
          : level < 10 ? 'partial'
          : 'none';
```

Because it's a formula, adding more levels costs nothing.

**No sub-levels.** Granularity comes from these knobs moving inside a level, not from nesting levels.

**Games always run, at every level.** A patient at level 1 still plays, still gets scored, still appears on the trend line — their items are just 2 at a time and fully cued. We never stop measuring someone. The moment scoring stops, their line goes flat, and nobody can tell "steady" from "we gave up."

---

## 6. Sessions are locked at the start

**When a session begins, its contents are fixed. Nothing changes until it ends.**

Getting item 3 wrong does not change item 4. It does not make the rest easier, harder, or different. It does not swap in photos or reminders. The patient plays the set they were given, start to finish.

Wrong answers affect the **base level in 7 days**. They affect nothing inside the current session.

Reason: if struggling changes what happens next, the patient is being punished for struggling. That's the exact thing section 8 forbids.

---

## 7. Session structure

- **2 sessions per day**
- Each session ≈ **10 minutes**
- Hard cap: **20 minutes a day**
- Session 2 unlocks **4 hours after session 1 ends** (not at a fixed clock time)

Why the gap: it stops the patient rushing both in one sitting, prevents fatigue, and spacing practice apart is better for memory than doing it all at once.

Why the cap: past ~15 minutes people get tired, tired scores look exactly like declining scores, and that ruins our data.

**Each session contains all six areas**, in shuffled order. 1–3 items per area. Not "today is memory day" — everything, every session.

**No timers.** Fixed number of items, patient takes as long as they want. Timers create anxiety. Log response time silently in the background, never show it.

**Waiting screen:** show a clock picture and "Next games at 3:40 PM". Never a greyed-out dead button — that looks broken and they stop opening the app.

**Way out:** one obvious, always-visible way to stop. Leaving is never treated as failure. Log it as `abandoned`.

---

## 8. Never let them fail

This is the most important design rule.

- No red X
- No "wrong"
- No score shown to the patient
- No losing screen
- No timer pressure

Wrong answer → card flips back gently, soft sound, encouragement, try again. The patient should not be able to tell they got it wrong.

Reason: failure creates anxiety in dementia patients, anxiety makes them stop using the app, and an app they won't open helps nobody.

End of session → "Well done today." Always. Regardless of performance.

---

## 9. Item rotation

**Never repeat the same item within 14 days.**

If the same 20 pictures come round every day, the patient memorises those specific pictures. Scores go up. The trend line says they're improving when nothing has changed.

Keep a pool at least 3× larger than one session needs, per area. Track when each item was last shown. Pull only from items not used in the last 14 days.

This is the difference between a real measurement and a number that drifts upward on its own.

---

## 10. Recording results

Write a row **every time a game ends**. Win, lose, quit — every time. If we only log some of them, the whole tracking system goes blind.

```js
session: {
  patientId,
  gameId,
  domain,        // one of the six
  levelPlayed,
  score,
  accuracy,
  latencyMs,     // hidden from patient
  itemIds,       // for the 14-day rotation check
  playedAt,
  status         // 'completed' | 'abandoned'
}
```

**If a patient quits halfway, unplayed areas get `null`, never `0`.**
A zero from quitting looks identical to a zero from decline. That would poison everything.

---

## 11. How the report is weighted

The report has two layers, and they are not equal.

### Primary — the games (this is the verdict)

The six base levels and their 30-day trend are the report. Everything a caregiver or doctor reads as a conclusion comes from here.

- Six trend lines, one per area
- Steady / slipping, per area
- Only game data can move this

### Secondary — everything else (context only)

These appear in the report, but they **never change the verdict**. They explain and support it.

| Signal | Where from | What it tells us |
|---|---|---|
| Sessions completed | play history | are we getting enough data to trust the trend |
| Reminder completion | My Day | how daily routine is holding up |
| Photo activity | My People | engagement, emotional side |

These are **functional and engagement signals, not cognitive scores.** Someone missing their water reminders is useful to know, but it does not lower their Memory level. Only memory games do that.

**Why keep them at all:** the problem statement asks for reminders and emotional wellbeing, not just training. And low engagement is genuinely worth flagging — if someone stops taking their medicine, the caregiver should know, even though it isn't a test result.

### Trust marker

If there aren't enough sessions in the last 14 days, the report says **"not enough data"** instead of showing a trend. Never draw a line we can't support. Saying "we don't know yet" is better than guessing.

---

## 12. My Day and My People

These are their own features. They live on the home screen, available any time.

**They are never inserted into a game session.** They are not a substitute for games, not a fallback for low levels, and not something the app switches to when someone is struggling.

**My Day** — medicine, water, food, appointments. Big buttons, one tap to mark done, voice reminder read aloud.

**My People** — family cards. See section 12b.

---

## 12b. My People — the card system

Name stays **My People**. Each person gets one card, like a simple ID card.

### What a card holds

Caregiver fills this in once, per person. Short answers only — one line each.

| Field | Example |
|---|---|
| Photo | clear face, one person, good light |
| Name | Rahul |
| Relationship | Your son |
| Age | 42 |
| What they do | Teacher |
| Where they live | Guwahati |
| Married to | Priya |
| Children | Two — Aarav and Ria |
| What they like | Fishing |
| Favourite food | Your fish curry |

Not every field is required. Fill what you know, skip the rest. The Test only asks about fields that are filled in.

5–7 cards total. More than that and it stops being family and becomes a list.

### Two sections

**1. Revision** — the card, one at a time

Big photo on top, details listed below in large text. Tap for the next person. Nothing is asked, nothing is scored, nothing is recorded. It should feel like flipping through an album.

Always available. Never locked.

**2. Test** — MCQ, 3 options

One question at a time, generated from whatever fields are filled:

| Field | Question it makes |
|---|---|
| Photo + Name | *"Who is this?"* |
| Relationship | *"Rahul is your ___?"* |
| What they do | *"What does your son do?"* |
| Where they live | *"Where does Rahul live?"* |
| Married to | *"Who is Rahul married to?"* |
| Children | *"How many children does Rahul have?"* |
| What they like | *"What does Rahul like doing?"* |
| Favourite food | *"What does Rahul like to eat?"* |

Wrong options come from the other cards — so "Where does Rahul live?" offers Guwahati / Jorhat / Shillong pulled from real family cards, not made up. Keeps it plausible and costs nothing.

Test scores into **Memory** (who is this) and **Social** (the relationship and detail questions). Revision scores nothing.

### Two rules

**Errorless applies here more than anywhere.** Getting your own son's name wrong is not like missing a shape match. No red X, no "wrong". Wrong pick → the right card appears gently with the answer shown. Move on.

**Revision is not a punishment.** It's not where you go after failing the Test. It's its own thing, chosen freely, always there.

---

## 13. Content — where the questions come from

In order of how cheap they are:

1. **Generated by code** — digit span, sequencing, matching, n-back. Infinite questions, zero assets, and rotation is free. Covers attention, executive, memory.
2. **Family uploads** — the caregiver adds real family photos and names. Costs nothing, and it's the most powerful thing in the app.
3. **Free image libraries** — Wikimedia Commons for local scenes, food, festivals, animals.
4. **Own phone camera** — 30 photos of local objects takes 20 minutes and looks more real than stock photos.
5. **Hand-written questions** — last resort, only where nothing else works.

Use local things: rice, jackfruit, gamosa, drums, temple bells, rain, birds, market scenes, festival images.

Generated content is preferred wherever it works, because section 9 needs a deep pool and code gives you an infinite one.

---

## 14. Time targets

| | Amount |
|---|---|
| Per session | 10 min |
| Per day | 14 min typical, 20 min cap |
| Per week | ~90 min |
| Program | 7 weeks intensive, then lighter maintenance |

90 minutes a week is deliberate — it matches the standard clinical programme (45 minutes, twice a week). We split it into smaller daily pieces because we need daily data and because short sessions suit short attention spans.

---

## 15. Interface rules

- Big buttons, big text
- **Tap only. No dragging, no swiping, no pinching.** Shaky hands are common.
- Ignore accidental double-taps
- High contrast, no thin fonts
- Voice reads every instruction aloud
- One thing on screen at a time
- No back button confusion — one path forward
- **No login for the patient.** One device, one person, opens straight to PLAY. The caregiver does setup once, from their own phone.

---

## 16. If the person has no diagnosis

Some users will be people who are simply worried about their own forgetting. They use the same app, the same way. Nothing gets harder or harsher for them.

If steady decline shows up across several weeks, the app suggests a check-up in ordinary language — *"It may be worth talking to a doctor about this."* Nothing more. It does not name a condition and it does not say what the result means.

---

## 17. What we do NOT claim

We do not diagnose. We do not identify which type of dementia someone has. We do not touch medication.

Real diagnosis uses brain scans and blood tests. We can't do that from a phone game, and claiming otherwise is both wrong and legally risky.

**What we actually do:** track six areas every day, at home, in the patient's own language, and show whether things are steady or slipping over months. Clinic visits happen twice a year at best. We fill the gap between them.

Put on screen: *"Not a diagnostic tool. Supports, does not replace, medical care."*

---

## 18. Rules that come from the existing code

These are not design choices. They are things the current codebase will do wrong unless we stop it.

### Kill the legacy migration first

`migrateLegacyMemoryLevels()` remaps old levels `{2:1, 3:2, 4:3}` on first read, on any device whose flag is unset. On a 0–15 scale it will silently corrupt real values. **Delete it before writing a single new level.** Unrecoverable if missed.

### One meaning for "score"

Right now Memory stores move-efficiency in `score/total` while the other games store correct-answers. Both get averaged together, so the overall number is meaningless.

**Pick accuracy — correct over attempted — and make all six areas use it.** Memory's efficiency can still be logged, just in its own field, not in `score`.

### Level bounds live in one place

Client and server currently disagree (routine 4 vs 3, name-recall 5 vs 3), which has already made content unreachable. Define `0–15` once, have the other side import it. Also: remove both of the existing `±1` clamps, or the client will silently undo the server.

### Abandon has to actually exist

Every game hardcodes `completed: true`, so nothing is ever logged as abandoned. That means the Attention measurement is 60% based on a number that never changes.

Section 7 needs a real quit path: unmount handler or explicit exit, writes a row with `status: 'abandoned'` and `null` for unplayed areas.

### Routine scoring has to be redesigned, not just softened

Routine currently wipes the whole sequence on a wrong tap. That punishment **is** the measurement — it's the only reason errors get counted at all.

So removing it (section 8) removes the score. Replacement: let the wrong tap do nothing at all, gently highlight the right one, and count how many taps it took to complete the sequence. Same signal, no punishment.

### Keep preview mode exactly as it is

Preview mode is the only thing stopping caregiver testing from polluting real clinical data. It already blocks session logging and level writes. Keep it verbatim, and make sure the new locked-session logic respects the same guard.

### My People needs a server home

The card data is device-local only. Clearing browser data destroys it with no recovery. Since Test mode now feeds Memory and Social in the report, this data is clinical — it needs to sync like everything else.

---

## 19. The AI layer

**Two agents. Neither one touches difficulty during play.**

### Difficulty is deterministic

The formula in section 5 decides difficulty. No model in that loop. Clinical adaptation has to be reproducible — the same inputs must always give the same level.

### Agent 1 — weekly trend analyst

Runs once a week, not once a round.

- **Reads:** 7 days of daily scores across all six areas
- **Does:** looks at the six areas *together* and decides which base levels move ±1, with a written reason
- **Why a model:** a formula can only see one area at a time. Noticing that Executive is slipping while Memory holds steady is a judgement about the whole picture.

**The model proposes, the server bounds.** Maximum ±1 per area per week, and never without 7 days of data. If the model returns something outside that, clamp it.

**Offline fallback stays.** If the model is unavailable, the existing rule-based path runs instead. Nothing blocks on the network.

### Agent 2 — clinical report

Unchanged from today. Reads the six domain scores and writes the prose summary. Its prompt hardcodes no domain names, so it starts describing six areas the moment analytics does — no prompt work needed.

### What to say about it

*"Difficulty is deterministic and auditable. The first agent analyses weekly patterns across six areas. The second writes the clinical summary. No model decides anything mid-game."*

That's a better answer than the old one, because "why does picking a difficulty level need an LLM?" has no good reply. Interpretation and language are real model jobs. Arithmetic isn't.

---

## Build order

**Blockers — do these before anything else**

1. Delete the legacy level migration *(corrupts data if it runs)*
2. Remove every `or 1` / falsy-zero chain *(level 0 breaks otherwise)*
3. Six domains defined in one place

**Core**

4. Six base levels stored on the patient record
5. One meaning for score across all six areas
6. Difficulty formula wired into the games, single source for bounds
7. Session logging — every game end writes a row, including abandons
8. Daily score → 7-day pattern → base level ±1
9. Two sessions a day with the 4-hour lock

**Then**

10. Errorless mode — 12 failure sites removed, Routine rescored
11. Agent 1 repointed to weekly trends; Agent 2 left alone
12. Report: six trend lines primary, engagement secondary
13. 14-day item rotation
14. My People — cards, Revision, Test, and a server home
15. My Day polish

Steps 1–3 are unrecoverable if skipped. Step 11 is mostly editing an existing file — roughly 60% of the current agent code survives.
