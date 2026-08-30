# Item assets — review before Sprint 3

Written by hand after looking at the images, not produced by
`normalise_item_images.py`. The script checks names and encodings; it cannot
see what is in a picture. Re-running the script will not overwrite this file.

## Status

| Set | Files | Manifest |
|---|---|---|
| objects | 20 / 20 | complete |
| faces | 11 / 12 | `man-angry` missing, `human angry .png` unmapped |

`tools/item_manifest.json` is the machine-readable version.

---

## 1. `human angry .png` — a naming problem with an easy fix

The filename has no person token, so the script left it alone rather than
inferring "man" from the fact that `man-angry` is the only empty slot.

Looking at it: it is a man, dark hair and beard, mid-thirties, with a
displeased expression.

**To resolve**, do one of these and re-run — do not rename by hand and skip the
script, or the file keeps its PNG encoding and 595px width:

- rename the source to `man angry.png` (the script handles either token order), or
- add `"human": "man"` to `aliases.people` in `expected_items.json`

The second is worse: "human" is not a person label, and the alias would apply
to any future file using it.

---

## 2. The faces are not one man and one woman — this is the real problem

The plan assumes **6 emotions × 2 people = 12**: one man photographed six
times, one woman photographed six times. That is not what these are.

Confirmed by inspection:

| File | Who |
|---|---|
| `man-happy.jpg` | grey-haired man, ~50s, grey background |
| `man-surprised.jpg` | bespectacled man, ~35, grey background, **hand raised to face** |
| `human angry .png` | bearded man, ~35, **bright yellow background** |
| `woman-happy.jpg` | woman in green kurta, light grey background |
| `woman-surprised.jpg` | different woman, blue top, **both arms raised** |

At least three different men and two different women.

### Why this matters more than it looks

Social Cognition is measured by asking *"which face is happy?"*. If the options
in one question show different people, the patient is doing person
discrimination as well as emotion reading, and a wrong answer no longer tells
us which of those they struggled with. The number still moves; it just stops
meaning what the report says it means.

Three specific confounds:

1. **Background is a learnable cue.** One image on bright yellow among greys
   can be picked without looking at the face at all. Section 9 of the spec
   exists for this exact failure — a score that climbs because the patient
   learned the pictures rather than the skill.
2. **Gestures carry the emotion.** Two of the "surprised" images have raised
   hands. A patient could answer from posture with the face cropped out.
3. **Different ages and framing** across one emotion set mean distractors are
   not comparable.

### What to do

Best: source one man and one woman, six expressions each, same session, same
background, head-and-shoulders, no hands in frame. Search terms like
"Indian man portrait emotions set" find these as bundles.

Acceptable for a demo: keep the current set but only ever offer options drawn
from **the same person**, and note in the report that Social Cognition is
provisional.

Not acceptable: writing bank items against these as if they were a matched
set. That bakes the confound into the measurement.

**This is a content decision, not a code one.** Sprint 3 can proceed on the
objects (which are clean) while the faces are re-sourced — social is one of
the two hand-authored domains and was always going to be the slow one.

---

## 3. Objects — clean, worth a glance

All 20 normalise cleanly and the keys match. They are stock product shots on
white, which is consistent and fine. Two things to confirm by eye before the
bank hardcodes them:

- `cocnut.jpg` was renamed to `coconut.jpg` via the declared alias. Confirm
  the picture is a coconut.
- The spec asks for locally familiar objects (rice, jackfruit, gamosa, drums,
  temple bells). `gamosa` is not in this set and is the most distinctively
  Assamese item on that list — worth adding.
