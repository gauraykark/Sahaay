# Sahaay — Patient Side Map

**Read-only audit · 30 Aug 2026 · no source files modified**

Every mechanism on the patient half of Sahaay, traced end to end against the code as it stands after the Phase 2 fixes. Written to be worked from during the rewrite to six DSM-5 domains, 0–15 base levels, and errorless design.

Line numbers reflect the tree as of this audit.

---

## Three structural facts to carry into the rewrite

1. **`domain` is resolved and frozen at write time** (`backend/app/routers/sessions.py:85`), so every existing session row carries an old four-domain label and will not re-map itself.
2. **No game can log an abandoned round** — `completed` is hardcoded `true` in all four, so every "incomplete" branch downstream is dead code on real data.
3. **Level bounds disagree between client and server** — the frontend allows routine 1–4 and name-recall 1–5, the backend clamps both to 1–3.

---

## Contents

1. [The four games](#1-the-four-games)
2. [Level and difficulty](#2-level-and-difficulty)
3. [Domain mapping](#3-domain-mapping)
4. [Session logging and sync](#4-session-logging-and-sync)
5. [The AI layer](#5-the-ai-layer)
6. [Analytics and reports](#6-analytics-and-reports)
7. [Patient routing and shell](#7-patient-routing-and-shell)
8. [My People / Memory Vault](#8-my-people--memory-vault)
9. [What breaks](#9-what-breaks)

---

## 1. The four games

All four share one skeleton: read level from Dexie on mount → deal content → collect answers → call `resolveNextLevel()` → call `logGameSession()` → speak the reason → show a result screen with a `SourceBadge`. None of them talks to the network directly.

| Game | Setup | Content source | Correct answer | Stats on completion |
|---|---|---|---|---|
| **Memory**<br>`MemoryGame.jsx` | `:46–62` loads level, deals cards, sets `isReady` | `dealMemoryCards(level)` — `gameContent.js:46`, 17 emoji in `MEMORY_PATTERNS` sliced to pair count | Two flipped cards share `value` — `:138` | `moves`, `errors` (mismatched pairs), `idealMoves` = pairCount, `durationMs` |
| **Routine**<br>`RoutineGame.jsx` | `:38–51` loads level, deals shuffled steps | `getRoutineForLevel(level)` — `gameContent.js:186`, 4 fixed scenarios of 4/8/12/16 steps | Every tap so far matches `order === index + 1` — `:60–62` | `errors` (wrong taps), `score` = stepCount − errors, `total` = stepCount |
| **Objects**<br>`ObjectsGame.jsx` | `:37–49` loads level, deals questions | `dealObjectQuestions(level)` — `gameContent.js:108`, 38-item `OBJECT_BANK`, level×5 drawn | `option === current.correct` — `:88` | `score`, `total` = question count, `errors` = total − score |
| **Name Recall**<br>`NameRecallGame.jsx` | `:39–58` loads level **and** vault people together | `dealNameRecallQuestions(level, vaultPeople)` — `gameContent.js:273`, 5 circles + caregiver-added people | `option === current.correct` — `:97` | Identical to Objects; always 5 questions regardless of level |

### Exact payload handed to the session logger

```js
// Memory — MemoryGame.jsx:96-107
{ gameType:"memory", completed:true, moves, errors, level, newLevel,
  durationMs, reason, score: pairCount, total: moves || pairCount }
//   ^ score/total is MOVE EFFICIENCY (pairCount/moves), not accuracy

// Routine — RoutineGame.jsx:96-106
{ gameType:"routine", completed:true, score: stepCount - errors,
  total: stepCount, errors, level, newLevel, durationMs, reason }

// Objects — ObjectsGame.jsx:65-75   Name Recall — NameRecallGame.jsx:74-84
{ gameType, completed:true, score: finalScore, total: questions.length,
  errors: total - score, level, newLevel, durationMs, reason }
```

> **Semantic divergence.** Memory's `score/total` means something different from the other three. Objects and Name Recall store correct-answers-over-questions; Memory stores minimum-moves-over-actual-moves. Both land in the same `game_sessions.score/total` columns and are averaged together by `analytics._accuracy()`. If the new model keeps a single accuracy column, pick one meaning and make all six domains honour it.

### Every place the patient is shown failure

Complete inventory for the errorless-design pass.

| # | Location | What the patient sees |
|---|---|---|
| 1 | `MemoryGame.jsx:206` | Live **"Moves: N"** counter — running efficiency tally during play |
| 2 | `MemoryGame.jsx:152–162` | Mismatched pair **flips back** after 900 ms — the failure signal itself |
| 3 | `MemoryGame.jsx:241` | **"Completed in N moves"** on the result screen |
| 4 | `RoutineGame.jsx:64–71` | Wrong tap sets `isWrong` and **wipes the whole sequence** after 800 ms — harshest moment in the app |
| 5 | `RoutineGame.jsx:170` | Entire to-do row dims to `opacity-60` while `isWrong` |
| 6 | `ObjectsGame.jsx:156–163` | After answering, correct option highlights and **the patient's wrong pick greys out** |
| 7 | `ObjectsGame.jsx:184` | **"You got N out of M correct"** |
| 8 | `ObjectsGame.jsx:141` | Progress counter **"3 of 15"** — pressure rather than failure, same family |
| 9 | `NameRecallGame.jsx:174–182` | Same correct/wrong option styling as Objects |
| 10 | `NameRecallGame.jsx:203` | **"You got N out of M correct"** |
| 11 | `NameRecallGame.jsx:156` | Progress counter "N of M" |
| 12 | `difficulty.js:107` | Spoken and printed **"Next round will be a little gentler"** — a demotion the patient hears aloud |

No timers exist anywhere. `durationMs` is measured via a `startedAt` ref in each game but never shown to the patient.

---

## 2. Level and difficulty

### The level model today

| Game | Client range | Server range | What the level changes |
|---|---|---|---|
| memory | 1–4 | 1–4 | Grid: 2×2 → 2×4 → 3×4 → 4×4 (`MEMORY_GRIDS`, `gameContent.js:22`) |
| routine | 1–4 | **1–3** ⚠ | Which of 4 scenarios; 4 → 16 steps |
| objects | 1–5 | 1–5 | Question count only: level × 5. Item difficulty never changes |
| name-recall | 1–5 | **1–3** ⚠ | Which social circle. Always 5 questions |

> **Live bug worth knowing before you delete this code.** `GAME_LEVEL_META` (`gameContent.js:318`) and `LEVEL_BOUNDS` (`agents.py:16`) disagree. The AI coach can never propose routine level 4 or name-recall levels 4–5, so `ROUTINE_LEVELS[3]` ("A full day at home") and two entire name circles are unreachable through the AI path — only the client-side rule engine can take a patient there.

### Where level state lives — two sources of truth

- **Client, authoritative for play.** Dexie `difficultyState`, primary key `[patientId+gameType]` (`db.js:73`). Written only by `setDifficulty()` (`db.js:366`), read only by `getDifficulty()` (`db.js:350`). Row shape: `{patientId, gameType, level, reason, source, updatedAt}`.
- **Server, inferred not stored.** There is no level column on `patients`. The server reconstructs the current level from the newest session: `current = sessions[0].new_level or sessions[0].level or 1` (`agents.py:135`, again at `:240`). `analytics._latest_levels()` (`:152`) does the same for the dashboard, scanning the last 80 sessions.
- **Audit trail.** `difficulty_history` rows, written only by `sessions.py:112` during sync and only when `new_level != level`.
- **A legacy migration still runs.** `migrateLegacyMemoryLevels()` (`db.js:333`) remaps old memory levels `{2:1, 3:2, 4:3}` on the first memory read, gated by a `settings` flag. It will silently rewrite any 0–15 value on a device whose flag is unset.

### The complete path from "round ends" to "next level decided"

```
round completes in a game component
  |
  |--> resolveNextLevel({gameType, currentLevel, stats})     difficulty.js:126
  |      |
  |      |- preview = isPreviewMode()                        db.js:106
  |      |- plan = await getAIPlan(gameType)                 db.js:581
  |      |     `- returns null if: no row
  |      |                       - age > 7 days     (PLAN_MAX_AGE_DAYS, db.js:549)
  |      |                       - roundsSince >= 10 (PLAN_MAX_ROUNDS, db.js:550)
  |      |
  |      |- planFitsLevel = plan.currentLevel === currentLevel   difficulty.js:143
  |      |     `- PHASE 2 ADDITION. Mismatch => treat as stale.
  |      |
  |      |- IF plan AND planFitsLevel:
  |      |     branch = {good:ifGood, ok:ifOk, poor:ifPoor}[outcomeOf(stats)]
  |      |     newLevel = bound(branch.level, currentLevel, meta)
  |      |     source   = plan.source === "ai" ? "ai" : "rule"
  |      |     markPlanUsed(gameType)          (skipped in preview)
  |      |
  |      `- ELSE:
  |            newLevel = bound(ruleBasedNext({...}), currentLevel, meta)
  |            reason   = ruleReason(newLevel, currentLevel)
  |            source   = "rule"
  |
  |--> setDifficulty(gameType, newLevel, reason, source)     (skipped in preview)
  `--> logGameSession({... level, newLevel, reason})          db.js:227
         |- returns null immediately if preview               db.js:241
         `- else writes Dexie row, then fires runSyncOnReconnect()  db.js:264
```

### `outcomeOf(stats)` — `difficulty.js:53`

```js
if (!stats.completed)              return "poor";   // DEAD: never false
if (moves && idealMoves) {                           // memory only
  ratio = moves / idealMoves;
  ratio <= 1.6 -> "good"   ratio >= 2.8 -> "poor"   else "ok"
}
if (total > 0) {                                     // routine/objects/name-recall
  acc = score / total;
  acc >= 0.8 -> "good"     acc < 0.5 -> "poor"      else "ok"
}
return "ok";
```

Move-ratio is tested first — a Phase 2 reordering. Before it, memory and routine could only ever produce `"good"`.

### Rule engine — `difficulty.js:75`

- **memory** → `nextDifficultyLevel()` (`utils.js:72`), thresholds raise ≤ 1.6 / lower ≥ 2.8 (`utils.js:78–79`)
- **routine** → inline `:88–93`. Promotes only on `errorRate === 0` exactly; demotes at ≥ 0.5. One error in eight steps holds the level forever.
- **objects, name-recall** → `nextLevelByAccuracy()` (`utils.js:96`), raise ≥ 0.8 / lower < 0.5

### The ±1 clamp exists twice

Client `bound()` (`difficulty.js:30–35`) and server `clamp()` (`agents.py:45–58`) implement the same rule independently. Both must go, or both must move to the new scale.

---

## 3. Domain mapping

Defined once in `backend/app/domains.py`: four displayed domains, four game types, and a many-to-one mapping.

```python
DOMAINS = [memory, attention, routine, recognition]        # domains.py:9
GAME_TO_DOMAIN = { memory:memory, name-recall:memory,
                   objects:recognition, routine:routine }   # domains.py:48
DERIVED_DOMAINS = [attention]                               # domains.py:75
```

> **Two collapses you are undoing.** `memory` and `name-recall` both write into the `memory` domain, so the Memory score silently blends two different tasks. And `attention` has no game at all — it is synthesised from completion rate and pace variance by `analytics.attention_score()` (`:99`).

### Every consumer

| File | Line | Use | Breaks on 6 domains? |
|---|---|---|---|
| `sessions.py` | 85, 116 | `domain_for_game()` at write time — freezes the label into the row | **YES — needs migration** |
| `analytics.py` | 128–147 | `domain_scores()` loops `DOMAINS`, branches on `DERIVED_DOMAINS` | **YES** |
| `analytics.py` | 152–166 | `_latest_levels()` keys levels by domain, defaults attention to 1 | **YES** |
| `analytics.py` | 279 | `recommended_actions()` excludes derived domains | logic only |
| `agents.py` | 126, 204, 231, 284 | Coach iterates `GAME_TYPES`; `_suggest_next_game()` maps weakest domain back to a game | **YES** |
| `seed_demo.py` | 197, 215, 392, 410 | Writes `domain` into every seeded row | **YES — reseed** |
| `models.py` | 142, 184 | `domain` column on `game_sessions` and `difficulty_history`, both indexed `String(30)` | migrate data |
| `schemas.py` | 224–231 | `DomainScore` — `domain` and `label` are free strings, only `trend` is a `Literal` | tolerant |
| `PatientCard.jsx` | 87 | `grid-cols-2 sm:grid-cols-4` over `domains.map()` | layout only |
| `PatientClinicalView.jsx` | 264 | `sm:grid-cols-2 lg:grid-cols-4` over `domains.map()` | layout only |

The React side is the easy half: both grids iterate whatever array arrives, so six domains render with no code change — they simply wrap 4 + 2. `DomainScore.jsx` already handles a null score (`:20`, `:42`).

---

## 4. Session logging and sync

### Row shape, both sides

| Dexie `gameSessions` (`db.js:245`) | Server `game_sessions` (`models.py:124`) | Note |
|---|---|---|
| `id` autoincrement | `dexie_id` nullable, indexed | Device id travels up for dedup |
| `patientId` (local) | `patient_id` FK | Mapped via `patients.serverId` at sync |
| `gameType` | `game_type` + `domain` | Domain added server-side, never sent |
| `score, total, moves, errors` | same, all nullable | Floats server-side for score/total |
| `level, newLevel` | `level, new_level` | Drives `difficulty_history` |
| `durationMs` | `duration_ms` | Measured, never shown to patient |
| `reason` | — *not stored on the session* | Only reaches `difficulty_history.reason` |
| `completed` 0/1 | `completed` bool | Always 1 from a device |
| `createdAt` ISO | `created_at`, indexed | Client clock wins if sent |
| `synced` 0/1 | — | Client-only queue flag |
| — | `started_at, ended_at` | **Never populated** — no client sends them |

Unique constraint `uq_session_patient_dexie` on `(patient_id, dexie_id)` — `models.py:163`.

### When sync fires

1. Immediately after every logged round — `db.js:264` dynamic-imports `api.js` and calls `runSyncOnReconnect()`.
2. On app boot — `main.jsx:19`.
3. On the browser `online` event — `main.jsx:9`.

`runSyncOnReconnect()` filters the queue to the *active* patient only, maps rows through `toSyncPayload()`, POSTs `/sessions/sync`, marks them synced on any 200, then fetches a fresh plan and caches it.

### Dedup, three layers

- In-batch `seen` set on `(patient_id, dexie_id)` — `sessions.py:53, 62–78`
- Existing-row query before insert — `:67–77`
- `begin_nested()` savepoint per row so an `IntegrityError` drops that row not the batch — `:101–127`; a final guarded commit returns 409 — `:138`

### Abandoned rounds — there is no path

> **Nothing is written when a patient quits mid-round.** All four games pass `completed: true` literally; there is no `beforeunload`, no unmount handler, no partial write.
>
> Two consequences: `outcomeOf`'s `if (!stats.completed) return "poor"` (`difficulty.js:54`) is unreachable on real data, and `attention_score()`'s completion term (`analytics.py:109`) is a constant 1.0 for every real patient — only seeded rows (`seed_demo.py:203`, ~9 % incomplete) ever vary it. **Sixty per cent of the Attention score is currently measuring nothing.**

### Null versus zero

The client is consistently **null for unplayed**: `logGameSession()` defaults every optional field to `null` (`db.js:230–237`), and Memory sends `score`/`total` only because Phase 2 gave them an efficiency meaning. Zero appears only where it is a real measurement, such as `errors: 0` on a clean round. Server columns are all nullable and store what arrives.

`analytics._accuracy()` (`:38`) returns `None` when `score is None or not total`, so a null total and a zero total behave identically — a genuine zero-total round would be silently dropped rather than counted as 0 %.

---

## 5. The AI layer

Two LangChain chains, both `ChatPromptTemplate | llm | PydanticOutputParser`. Provider: Groq `openai/gpt-oss-120b`, Gemini `gemini-2.5-flash` fallback, `max_tokens` 4096 (`agents.py:472–500`).

| | Cognitive Coach | Report Generator |
|---|---|---|
| **Trigger** | `POST /ai/adapt-difficulty` — called only by `runSyncOnReconnect()` after each sync | `POST /ai/generate-report` — explicit button on doctor dashboard (`DoctorDashboard:115`) and clinical view (`PatientClinicalView:106`) |
| **Input** | Last 8 sessions per game: current level, completion rate, avg duration, avg errors, score trend — `agents.py:126–164` | Session count, adherence %, per-domain scores and trends, last 20 difficulty changes, target language — `agents.py:343–389` |
| **Output** | `CoachOutput`: per game `level_if_good/ok/poor` plus a reason each, and `next_game` — `:94` | `ReportOutput`: `summary`, `trends[]`, `observations[]`, `suggestions[]` — `:327` |
| **Stored** | **Nowhere server-side.** Returned to the device and cached in Dexie `aiPlans` — `db.js:553` | `ai_reports` row written by the router — `ai.py:77–94` (Phase 2 removed the duplicate write) |
| **UI surface** | `SourceBadge` on all four result screens; caregiver "Adaptive levels" card — `CaregiverDashboard:716` | `latest_report` on the clinical view — `PatientClinicalView:164` |
| **Fallback** | `_rule_difficulty_plan()` — `:227` | `_rule_report()` — `:405` |

### What exists only to serve per-round difficulty

All of this is deletable once a deterministic formula replaces the coach.

| Artefact | Location |
|---|---|
| Coach chain, Pydantic models, prompt assembly | `agents.py:75–225` |
| Rule plan builder | `agents.py:227–269` |
| Next-game suggester | `agents.py:271–289` |
| `clamp()` and `LEVEL_BOUNDS` | `agents.py:16–21, 45–58` |
| Coach prompts | `prompts.py:5–43` |
| Endpoint and request/response schemas | `ai.py:39–52`; `schemas.py:309–337` |
| Dexie `aiPlans` table, save/get/markUsed, staleness constants | `db.js:80, 545–599` |
| Plan fetch and cache in the sync orchestrator | `api.js:336–352, 404–407` |
| Whole plan branch of `resolveNextLevel`, plus `outcomeOf`, `bound`, rule engine | `difficulty.js` — entire file |
| `SourceBadge` and its four call sites | `Badge.jsx:66` plus four games |

> The Report Generator has no dependency on the coach and should survive the rewrite intact — it reads `analytics.domain_scores()`, so it will describe six domains the moment analytics does. Its prompt (`prompts.py:48–103`) hardcodes no domain names.

---

## 6. Analytics and reports

Every number on both dashboards is pure Python. The LLM writes prose only, and never on page load.

| Number | Computed in | Method | Assumes |
|---|---|---|---|
| Overall score | `analytics.py:291` | Mean of `_accuracy()` over 30 days | score/total comparable across games — **memory differs** |
| Domain score ×4 | `:121–149` | Mean accuracy per domain; attention derived | **4 domains** |
| Attention | `:99–118` | `0.6×completion + 0.4×(1−CoV of duration)` | Completion varies — **it does not** |
| Trend | `:59–77` | Split window, compare halves, ±0.06 band | ≥ 4 scored sessions or returns `unknown` |
| Sudden drop *z* | `:80–94` | Latest vs own baseline, threshold −1.5 | ≥ 6 rates, σ ≥ 0.01 |
| Risk band | `:189–214` | Additive points: high ≥ 3, medium ≥ 1 | Trend + drop + score + adherence |
| Adherence % | `:171–184` | done ÷ non-pending logs, 7 days | Independent of games — safe |
| Reason line | `:219–252` | Deterministic string from weakest domain | Domain labels |
| Recommended actions | `:255–282` | Rules on trend / weakest / adherence | Excludes derived domains |
| Priority strip | `:331–360` | Sort by risk, declining, score; drop low + non-declining | safe |
| Assistant panels | `:380–421` | Filter cards; last 24 h of `difficulty_history` | **per-round level changes** |
| 30-day trend series | `:426–452` | Daily mean accuracy, nulls preserved | safe |
| Percentile | `:455–478` | vs doctor's non-demo caseload, needs ≥ 2 peers | safe |
| Report prose | `agents.py:307 / :405` | **LLM**, or the deterministic fallback | Reads `domain_scores` |

### What breaks on a 0–15, seven-day-pattern model

- **"Difficulty changes today"** (`ClinicalAssistant.jsx:100`, fed by `analytics.py:406–415`) assumes a level change is a frequent per-round event. With weekly moves this panel is empty six days in seven.
- **Adaptive history timeline** (`PatientClinicalView.jsx:285`) renders `from_level → to_level`. Numerically fine, but the 20-row limit was sized for per-round churn.
- **`_latest_levels()`** (`:152`) reads levels off sessions and defaults attention to 1. With six independently moving base levels this must read a real store rather than infer.
- **Level display** — `DomainScore.jsx` prints `level` raw, so 0–15 renders unchanged. The caregiver card prints `{level} / {meta.max}` (`CaregiverDashboard.jsx:713`) and needs the new ceiling.
- **Level 0 is a new state.** Nothing today treats 0 as valid.

> **The `or` / `||` fallbacks are a real trap.** `new_level or level or 1` (`agents.py:135, :240`) and `row.new_level or row.level or 1` (`analytics.py:164`) treat 0 as absent. On a 0–15 scale every genuine level-0 patient silently reads as level 1.

---

## 7. Patient routing and shell

### Routes — `App.jsx:32–37`

All six patient routes are **deliberately unguarded** (comment at `:26–31`):

```
/patient
/patient/vault
/patient/game/memory
/patient/game/routine
/patient/game/objects
/patient/game/name-recall
```

Entry is by tapping a name on `Login.jsx`, which calls `setActivePatientId()` — identity is device state, not a session.

### Preview mode — Phase 2

- Flag `sahaay-preview-mode` in `sessionStorage`; helpers `isPreviewMode()` / `setPreviewMode()` — `db.js:104–117`.
- Set on the caregiver dashboard's "Patient home" link (`CaregiverDashboard:353`); cleared on both patient entry paths (`Login.jsx:52, :58`) and by the banner button (`PatientHome:100`).
- Effects: `logGameSession()` returns `null` before writing (`db.js:241`); `setDifficulty()` and `markPlanUsed()` are both skipped (`difficulty.js:154, :169`).
- Amber banner on Patient Home — `:94–112`.

> Preview is the one piece of Phase 2 that should survive verbatim — it is the only thing keeping caregiver testing out of clinical data, and locked sessions will need exactly the same guard.

### Voice and TTS

Four primitives in `lib/utils.js`: `speak()` (`:132`, rate 0.9, pitch 1, volume 0.85), `supportsVoiceInput()` (`:149`), `listenOnce()` (`:164`, one-shot, 6 s timeout), `extractNameFromQuestion()` (`:211`).

| Call site | What is spoken |
|---|---|
| `PatientHome.jsx:44` | Greeting, 600 ms after mount, **once per session** via `sahaay-greeted` (`:38`) |
| `MemoryGame:111` · `Routine:109` · `Objects:78` · `NameRecall:87` | The difficulty `reason` after each round |
| `MemoryVault.jsx:41, :59` | "This is {name}. {relationship}" or the not-found line |
| `MemoryVault.jsx:51` | **Listens** — the only speech input anywhere in the app |

### i18n — `lib/i18n.js`

Three dictionaries (`en`, `hi`, `as`) of roughly fifteen keys, patient-facing only. `useT()` (`:125`) reads `user.preferred_language` from auth context and falls back key-by-key to English. `langToLocale()` (`:107`) maps to `en-IN` / `hi-IN` / `as-IN` for the speech APIs.

> **Assamese barely reaches the games.** Only Patient Home and the Vault call `t()`. Every string inside the four games — titles, "Moves", "You got N out of M correct", "Play again", "Round complete" — is hardcoded English (see `ObjectsGame:129, :138, :141, :180–198`). Worse, the spoken reason is generated in English by the coach or rule engine and then spoken with an `as-IN` voice. Translation coverage is a rewrite task, not a port.

---

## 8. My People / Memory Vault

Two Dexie tables, introduced in schema v2 (`db.js:41–56`), both keyed by local `patientId`.

```
vaultPeople        "++id, patientId, name, relationship, createdAt"
  fields: { patientId, name, relationship, photo (base64|null),
            circle (1-5, default 1), createdAt }          db.js:431-446

vaultRoutineSteps  "++id, patientId, order, time, activity, createdAt"
  fields: { patientId, time, activity, order, createdAt }  db.js:489-498
```

### How Name Recall consumes it

`NameRecallGame.jsx:42–52` loads `listVaultPeople()` alongside the level and passes both to `dealNameRecallQuestions(level, people)`. Inside (`gameContent.js:273–307`) people are filtered to `circle === level`, converted to questions with the relationship as the prompt (`"Someone you know named X"` when no relationship is set), prepended to the built-in circle, shuffled, and **sliced to 5**. Custom people carry no distractors, so wrong options are drawn from a shared name pool. A caregiver who adds six people to circle 1 will find some of them never appear.

### Does any of it reach the server?

**No.** There is no vault table in `models.py`, no endpoint in any router, and no client call that sends it. `doctors.py:124–128` returns `people_count: None` with a comment saying exactly this; `schemas.py:303` types it `int | None`. The clinical view never renders the field.

**The vault is device-local and unbacked — clearing browser data destroys it with no recovery.**

The other vault table is more visible: `vaultRoutineSteps` drives the "Your day" list on Patient Home (`:80–96`). Note that the doctor's "Daily guidance" panel (`PatientClinicalView.jsx:337`) shows `routine_steps` built from server-side **Reminders** (`doctors.py:123`) — a different, unrelated store that happens to render under a similar name.

---

## 9. What breaks

Ranked by how deeply each file is welded to the model being removed.

### Rewrite from scratch — the current design *is* the thing being replaced

| File | Why |
|---|---|
| **`lib/difficulty.js`** — *delete* | Every line encodes per-round adaptation: `outcomeOf`, plan branches, staleness, the ±1 `bound()`, the rule engine. A deterministic seven-day formula shares nothing with it. |
| **`components/games/` ×4** — *rewrite* | Each game hardcodes its level semantics, its scoring, its failure feedback (12 sites), and calls `resolveNextLevel` inline. Errorless design changes the interaction model, not just styling. |
| **`app/domains.py`** — *rewrite* | Four domains, the two-into-one collapse, and `DERIVED_DOMAINS` are all wrong under DSM-5. Small file, total rewrite, widest blast radius. |
| **`services/agents.py`** — *halve* | Lines 16–289 are the coach and exist only for difficulty. Lines 292–470 (reports) survive untouched. Split the file. |

### Heavy change — structure survives, assumptions do not

| File | Why |
|---|---|
| `services/analytics.py` | Six domain-aware functions; `attention_score()` becomes obsolete once attention is genuinely measured; the `or 1` fallback at `:164` breaks level 0. |
| `lib/gameContent.js` | Level banks are 1-based arrays indexed by level (`MEMORY_GRIDS`, `ROUTINE_LEVELS[level-1]`, `NAME_RECALL_CIRCLES`). A 0–15 scale needs a parameterised generator, plus 14-day item-rotation state that does not exist anywhere today. |
| `lib/db.js` | Needs a v4 schema: drop `aiPlans`, add per-domain base levels and rotation bookkeeping. **Delete `migrateLegacyMemoryLevels()` (`:333`) before it corrupts a 0–15 value.** Keep `logGameSession`, preview, vault and the sync queue. |
| `seed_demo.py` | Both generators write four-domain rows and levels 1–4 (`:168, :361`). Full reseed required; historical rows cannot be reinterpreted. |

### Moderate — contracts widen, logic mostly holds

| File | Why |
|---|---|
| `app/schemas.py` | Drop `AdaptDifficultyRequest/Response`, `PlanBranch`, `GamePlan` (`:309–337`). `DomainScore` already accepts free-string domains. |
| `app/models.py` | `domain String(30)` holds any label, but a level column is needed if base levels stop being inferred from sessions. `difficulty_history` semantics shift from per-round to weekly. |
| `routers/ai.py`, `routers/sessions.py` | `ai.py` loses `/adapt-difficulty` (`:39–52`). `sessions.py` keeps its dedup, but the `new_level != level` trigger (`:107`) fires far less often. |
| `lib/api.js`, `main.jsx` | Remove the plan fetch and cache (`api.js:336–352, :404–407`). Sync orchestration, patient hydration and the boot call all stay. |

### Light — display only

| File | Why |
|---|---|
| `PatientCard` · `PatientClinicalView` · `DomainScore` · `CaregiverDashboard` | Grids iterate whatever arrives and wrap at six. Only `{level} / {meta.max}` (`CaregiverDashboard:713`) and the `levelDetail()` helper (`:452`) hardcode the old scale. |
| `ClinicalAssistant.jsx` | Renders whatever `difficulty_changes_today` contains; it will simply be empty most days. |
| `PatientHome` · `Login` · `MemoryVault` · `i18n` · `utils` · `auth` | Shell, voice and identity are model-agnostic. i18n needs many new keys, not new machinery. |

### Where the existing design actively fights the new one

1. **Frozen domain labels.** `sessions.py:85` writes `domain` at insert time, so every historical row is stamped with a four-domain label. A six-domain analytics layer reading old data sees categories that no longer exist. Either migrate the column or accept a hard cutover date.
2. **Routine's reset-on-error is structurally anti-errorless.** `RoutineGame.jsx:64–71` wipes the sequence on a wrong tap — which is *also* the only reason the round always finishes perfect and the only way `errors` gets counted at all. Removing the punishment removes the measurement, so the scoring model has to be redesigned alongside the interaction.
3. **Two independent ±1 clamps.** `difficulty.js:30` and `agents.py:45`. A formula that can move a level more than one step must have both removed, or the client will silently undo the server.
4. **Level 0 is falsy.** Three `or` / `||` chains (`agents.py:135, :240`, `analytics.py:164`) coerce 0 to 1.
5. **The legacy memory migration is a live landmine.** `db.js:333–347` remaps levels `{2:1, 3:2, 4:3}` on first read for any device whose flag is unset.
6. **Client and server already disagree on level ranges** (routine 4 vs 3, name-recall 5 vs 3). Whatever the new bounds are, define them in one place and have the other side import it — this drift has already made content unreachable.
7. **Attention has no measurement to inherit.** Sixty per cent of `attention_score()` is completion rate, which is constant because no round can be abandoned. A real attention domain needs locked sessions *and* an abandon path, or the new domain is as hollow as the old one.
8. **The vault has no server home.** If item rotation or personalisation depends on My People, it inherits a store that is device-local, unsynced, and destroyed by clearing browser data.

---

## Method

Full read of all four game components, `difficulty.js`, `gameContent.js`, `db.js`, `api.js`, `i18n.js`, `utils.js`, `App.jsx`, the patient and caregiver pages, and the backend routers, services, models and schemas. Consumer lists were produced by grep across `backend/` and `frontend/src`, excluding `venv/` and `node_modules/`. Line numbers reflect the tree as of this audit, after the Phase 2 fixes. No source files were modified.
