# Item assets — review before Sprint 3

Written by hand after looking at the images, not produced by
`normalise_item_images.py`. The script checks names and encodings; it cannot
see what is in a picture. Re-running the script will not overwrite this file.

## Status

| Set | Files | Manifest |
|---|---|---|
| objects | 20 / 20 | complete |
| faces | 12 / 12 | complete |

The manifest is **clean**. The item bank may reference these keys.

`tools/item_manifest.json` is the machine-readable version.

---

## 1. `human angry .png` — RESOLVED

Renamed to `man angry.png` and re-run. It normalised to `man-angry.jpg`, and
the faces set is now 12/12. The manifest is clean.

---

## 2. Multiple actors — NOT a problem. My earlier analysis here was wrong.

An earlier version of this file argued that the faces had to be one man and one
woman, and that the mixed actors and backgrounds were a confound serious enough
to block Sprint 3. That was wrong, and it was wrong because I had picked the
wrong task format, not because the assets were bad.

**Social uses the single-face format:** one image, the prompt *"How is she
feeling?"*, and three EMOTION WORDS as the options. The patient never sees two
faces at once, so identity never enters the comparison. Different actors across
items cannot be used to answer anything.

Clinical emotion-recognition tests use multiple actors on purpose — it stops
the patient learning one specific face's idiosyncrasies and keeps the measure
about expression rather than about a person they have met twenty times.

The confound I described is real ONLY for a multi-face format ("which of these
four faces is happy?"), which is what the preview originally rendered. That
format is not what Social should be, so the objection disappears with it.

**Rule for the bank: an item's three options are always emotion words, never
faces.** That is what keeps identity out of the comparison, and it is the one
thing to check when reviewing Social items.

### What still holds

Mixed backgrounds no longer let a patient shortcut an answer — with one image
on screen there is nothing to contrast it against. Worth knowing, not worth
blocking on:

- 12 faces means Social has a rotation depth of 12, below the 20-per-domain
  target. The selector degrades to the least-recently-seen item rather than
  throwing, so this is a data-density issue, not a correctness one.
- Two images (`man-surprised`, `woman-surprised`) have hands raised near the
  face. In a single-face format a gesture is a legitimate additional emotion
  cue, the way it is in life, so this is fine — just be aware those two items
  are slightly easier than the rest.

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
