"""One-off: normalise the stock item images, then report present vs expected.

The images arrived from mixed sources with mixed conventions -- `Jackfruit.jpg`
next to `banana .jpg`, `WOMAN CALM.jpg` next to `worried man.jpg`, PNGs with a
.jpg extension, 7000px originals, EXIF still attached. Sprint 3's item bank
addresses assets by key, so the filenames have to be predictable before a
single item is written.

WHAT IT DOES
  * reads the REAL format with Pillow rather than trusting the extension
    (comb.jpg is a PNG)
  * flattens alpha onto white, converts everything to baseline .jpg
  * resizes the long edge down to 800px, never up
  * strips EXIF by re-encoding without it
  * objects  -> {key}.jpg          lowercase, single word
  * faces    -> {person}-{emotion}.jpg, in that order, whichever order the
    source used
  * prints anything it cannot confidently map and LEAVES IT ALONE

WHAT IT WILL NOT DO
  Guess. `human angry.png` has no person this script can resolve, and it will
  not infer "man" from the fact that man-angry happens to be the only empty
  slot. Corrections live in expected_items.json's alias table, where they are
  a declared decision rather than a silent one.

USAGE
  python tools/normalise_item_images.py                  # dry run, changes nothing
  python tools/normalise_item_images.py --apply          # writes
  python tools/normalise_item_images.py --manifest-only  # just the report

  --root PATH   items directory (default <repo>/frontend/public/items).
                The images may live in a different checkout than this script;
                point --root at it.

On --apply the originals are MOVED to <root>/../../items-originals/, outside
public/ so they are not bundled or served. Nothing is deleted.

Needs Pillow:  pip install Pillow
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("This script needs Pillow:  pip install Pillow")

ROOT = Path(__file__).resolve().parents[1]

MAX_EDGE = 800
JPEG_QUALITY = 82

# Separators the sources used between tokens: spaces, underscores, hyphens.
SPLIT = re.compile(r"[\s_\-]+")


# ── Loading the contract ─────────────────────────────────────────────────────

def load_expected(path: Path) -> dict:
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)

    aliases = data.get("aliases", {})
    return {
        "objects": [k for k in data["objects"]],
        "people": data["faces"]["people"],
        "emotions": data["faces"]["emotions"],
        "alias_objects": {k: v for k, v in aliases.get("objects", {}).items()
                          if not k.startswith("_")},
        "alias_emotions": {k: v for k, v in aliases.get("emotions", {}).items()
                           if not k.startswith("_")},
        "alias_people": {k: v for k, v in aliases.get("people", {}).items()
                         if not k.startswith("_")},
    }


def expected_face_keys(spec: dict) -> list[str]:
    return [f"{p}-{e}" for p in spec["people"] for e in spec["emotions"]]


# ── Mapping a filename to a key ──────────────────────────────────────────────

def tokens_of(path: Path) -> list[str]:
    """Lowercase word tokens from a filename, extension and padding removed."""
    return [t for t in SPLIT.split(path.stem.strip().lower()) if t]


def map_object(path: Path, spec: dict) -> tuple[str | None, str | None]:
    """Return (key, note). key is None when it cannot be mapped confidently."""
    toks = tokens_of(path)
    if not toks:
        return None, "no usable tokens in the filename"

    known = set(spec["objects"])
    aliases = spec["alias_objects"]

    # A single token is the normal case: `Jackfruit.jpg`, `banana .jpg`.
    direct = [t for t in toks if t in known]
    if len(direct) == 1:
        return direct[0], None

    aliased = [(t, aliases[t]) for t in toks if t in aliases]
    if len(aliased) == 1 and not direct:
        raw, key = aliased[0]
        return key, f"spelling corrected via alias table: {raw!r} -> {key!r}"

    if len(direct) > 1:
        return None, f"matches several expected keys {direct} -- ambiguous"
    return None, f"no expected object key in {toks}"


def map_face(path: Path, spec: dict) -> tuple[str | None, str | None]:
    """Return ({person}-{emotion}, note), or (None, why) if not confident.

    Order-agnostic: the source used both `woman angry` and `worried man`, so
    each token is classified rather than positioned.
    """
    toks = tokens_of(path)
    if not toks:
        return None, "no usable tokens in the filename"

    people = set(spec["people"])
    emotions = set(spec["emotions"])
    alias_people = spec["alias_people"]
    alias_emotions = spec["alias_emotions"]

    found_people: list[tuple[str, str]] = []
    found_emotions: list[tuple[str, str]] = []
    unknown: list[str] = []

    for tok in toks:
        if tok in people:
            found_people.append((tok, tok))
        elif tok in alias_people:
            found_people.append((tok, alias_people[tok]))
        elif tok in emotions:
            found_emotions.append((tok, tok))
        elif tok in alias_emotions:
            found_emotions.append((tok, alias_emotions[tok]))
        else:
            unknown.append(tok)

    if len(found_people) != 1 or len(found_emotions) != 1:
        parts = []
        if not found_people:
            parts.append("no person token")
        elif len(found_people) > 1:
            parts.append(f"several person tokens {[r for r, _ in found_people]}")
        if not found_emotions:
            parts.append("no emotion token")
        elif len(found_emotions) > 1:
            parts.append(f"several emotion tokens {[r for r, _ in found_emotions]}")
        if unknown:
            parts.append(f"unrecognised {unknown}")
        return None, "; ".join(parts)

    (person_raw, person), (emotion_raw, emotion) = found_people[0], found_emotions[0]

    notes = []
    if person_raw != person:
        notes.append(f"{person_raw!r} -> {person!r}")
    if emotion_raw != emotion:
        notes.append(f"spelling corrected via alias table: {emotion_raw!r} -> {emotion!r}")
    if toks.index(emotion_raw) < toks.index(person_raw):
        notes.append("source order was emotion-person")

    return f"{person}-{emotion}", "; ".join(notes) or None


# ── Image work ───────────────────────────────────────────────────────────────

def already_normalised(path: Path) -> bool:
    """True when re-encoding this file would only cost quality.

    Judged from the file itself rather than a marker or a timestamp, so it
    stays correct if someone drops a hand-edited image in.
    """
    if path.suffix != ".jpg":
        return False
    try:
        with Image.open(path) as im:
            return (
                im.format == "JPEG"
                and im.mode == "RGB"
                and max(im.size) <= MAX_EDGE
                and not im.getexif()
            )
    except Exception:
        return False


def normalise_image(src: Path, dest: Path) -> dict:
    """Convert, resize and re-encode. Returns what changed."""
    with Image.open(src) as im:
        real_format = im.format
        before_size = im.size
        had_exif = bool(im.getexif())
        had_alpha = im.mode in ("RGBA", "LA", "P")

        # Flatten transparency onto white rather than letting it go black.
        if im.mode in ("RGBA", "LA"):
            background = Image.new("RGB", im.size, (255, 255, 255))
            background.paste(im, mask=im.split()[-1])
            im = background
        elif im.mode != "RGB":
            im = im.convert("RGB")

        # Downscale only. Upscaling a small source invents detail.
        long_edge = max(im.size)
        if long_edge > MAX_EDGE:
            scale = MAX_EDGE / long_edge
            im = im.resize(
                (round(im.width * scale), round(im.height * scale)),
                Image.LANCZOS,
            )

        dest.parent.mkdir(parents=True, exist_ok=True)
        # No exif= argument, so EXIF is dropped on re-encode.
        im.save(dest, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)

        return {
            "real_format": real_format,
            "before": before_size,
            "after": im.size,
            "had_exif": had_exif,
            "had_alpha": had_alpha,
            "bytes_before": src.stat().st_size,
            "bytes_after": dest.stat().st_size,
        }


# ── The run ──────────────────────────────────────────────────────────────────

def process(kind: str, folder: Path, spec: dict, apply: bool, originals: Path) -> dict:
    mapper = map_object if kind == "objects" else map_face
    planned: dict[str, Path] = {}
    collisions: list[str] = []
    unmapped: list[tuple[Path, str]] = []
    notes: list[tuple[str, str]] = []

    if not folder.is_dir():
        return {"present": {}, "unmapped": [], "collisions": [f"{folder} does not exist"]}

    for src in sorted(folder.iterdir()):
        if not src.is_file():
            continue
        try:
            Image.open(src).close()
        except Exception as exc:
            unmapped.append((src, f"not a readable image: {exc}"))
            continue

        key, note = mapper(src, spec)
        if key is None:
            unmapped.append((src, note or "unmappable"))
            continue
        if key in planned:
            collisions.append(f"{src.name} and {planned[key].name} both map to {key!r}")
            continue
        planned[key] = src
        if note:
            notes.append((src.name, note))

    print(f"\n{'=' * 74}\n{kind.upper()}  ({len(planned)} mapped, {len(unmapped)} unmapped)\n{'=' * 74}")

    results: dict[str, dict] = {}
    skipped = 0
    for key, src in sorted(planned.items()):
        dest_name = f"{key}.jpg"

        # Already normalised: right name, real JPEG, RGB, inside the size cap,
        # no EXIF. Re-encoding costs quality and buys nothing, and a one-off
        # script that silently degrades its own output every time it is re-run
        # is a trap. This makes --apply idempotent.
        if src.name == dest_name and already_normalised(src):
            with Image.open(src) as im:
                results[key] = {
                    "file": dest_name,
                    "source": src.name,
                    "width": im.width,
                    "height": im.height,
                }
            skipped += 1
            continue

        if apply:
            tmp = folder / f".{dest_name}.tmp"
            info = normalise_image(src, tmp)
            originals.mkdir(parents=True, exist_ok=True)
            # Never clobber something already in originals. Names collide two
            # ways: a source already called {key}.jpg, and Windows being
            # case-insensitive (Jackfruit.jpg vs jackfruit.jpg). Either way a
            # true source would be replaced by a derived file and lost for good.
            keep = originals / src.name
            n = 1
            while keep.exists():
                keep = originals / f"{src.stem}.orig{n}{src.suffix}"
                n += 1
            shutil.move(str(src), str(keep))
            final = folder / dest_name
            if final.exists():
                final.unlink()
            tmp.rename(final)
        else:
            with Image.open(src) as im:
                long_edge = max(im.size)
                scale = min(1.0, MAX_EDGE / long_edge)
                info = {
                    "real_format": im.format,
                    "before": im.size,
                    "after": (round(im.width * scale), round(im.height * scale)),
                    "had_exif": bool(im.getexif()),
                    "had_alpha": im.mode in ("RGBA", "LA", "P"),
                    "bytes_before": src.stat().st_size,
                    "bytes_after": None,
                }

        flags = []
        if src.suffix.lower().lstrip(".") not in (info["real_format"].lower(), "jpg"
                                                  if info["real_format"] == "JPEG" else ""):
            flags.append(f"EXT LIES (really {info['real_format']})")
        if info["had_exif"]:
            flags.append("exif stripped")
        if info["had_alpha"]:
            flags.append("alpha flattened")
        if info["before"] != info["after"]:
            flags.append(f"{info['before'][0]}x{info['before'][1]} -> {info['after'][0]}x{info['after'][1]}")

        size_bit = ""
        if info["bytes_after"]:
            size_bit = f"  {info['bytes_before'] / 1024:.0f}KB -> {info['bytes_after'] / 1024:.0f}KB"

        print(f"  {src.name:<24} -> {dest_name:<22}{size_bit}")
        if flags:
            print(f"      {'; '.join(flags)}")

        results[key] = {
            "file": dest_name,
            "source": src.name,
            "width": info["after"][0],
            "height": info["after"][1],
        }

    if skipped:
        print(f"\n  ({skipped} already normalised -- left untouched)")

    if notes:
        print("\n  CORRECTIONS APPLIED (declared in expected_items.json):")
        for name, note in notes:
            print(f"    {name:<24} {note}")

    if unmapped:
        print("\n  !! NOT MAPPED -- left untouched, decide by hand:")
        for src, why in unmapped:
            print(f"    {src.name:<24} {why}")

    if collisions:
        print("\n  !! COLLISIONS:")
        for c in collisions:
            print(f"    {c}")

    return {
        "present": results,
        "unmapped": [{"file": s.name, "reason": w} for s, w in unmapped],
        "collisions": collisions,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", type=Path, default=ROOT / "frontend" / "public" / "items")
    ap.add_argument("--expected", type=Path, default=ROOT / "tools" / "expected_items.json")
    ap.add_argument("--manifest", type=Path, default=ROOT / "tools" / "item_manifest.json")
    ap.add_argument("--apply", action="store_true", help="actually write (default: dry run)")
    ap.add_argument("--manifest-only", action="store_true")
    args = ap.parse_args()

    spec = load_expected(args.expected)
    originals = args.root.parent.parent / "items-originals"

    mode = "APPLY" if args.apply else "DRY RUN -- nothing is written"
    print(f"\nitems root : {args.root}")
    print(f"expected   : {args.expected}")
    print(f"mode       : {mode}")
    if args.apply:
        print(f"originals  : {originals}")

    out = {}
    for kind in ("objects", "faces"):
        if args.manifest_only:
            folder = args.root / kind
            present = {}
            for f in sorted(folder.glob("*.jpg")) if folder.is_dir() else []:
                with Image.open(f) as im:
                    present[f.stem] = {"file": f.name, "source": f.name,
                                       "width": im.width, "height": im.height}
            out[kind] = {"present": present, "unmapped": [], "collisions": []}
        else:
            out[kind] = process(kind, args.root / kind, spec, args.apply, originals)

    # ── Manifest: present vs expected ────────────────────────────────────────
    exp = {"objects": spec["objects"], "faces": expected_face_keys(spec)}
    manifest = {"max_edge_px": MAX_EDGE, "jpeg_quality": JPEG_QUALITY, "sets": {}}
    clean = True

    print(f"\n{'=' * 74}\nMANIFEST -- present vs expected\n{'=' * 74}")
    for kind in ("objects", "faces"):
        present = out[kind]["present"]
        want = exp[kind]
        missing = [k for k in want if k not in present]
        extra = [k for k in present if k not in want]
        unmapped = out[kind]["unmapped"]

        print(f"\n  {kind}: {len(present)}/{len(want)} present")
        if missing:
            print(f"    MISSING  ({len(missing)}): {', '.join(missing)}")
        if extra:
            print(f"    EXTRA    ({len(extra)}): {', '.join(extra)}")
        if unmapped:
            print(f"    UNMAPPED ({len(unmapped)}): {', '.join(u['file'] for u in unmapped)}")
        if not missing and not extra and not unmapped and not out[kind]["collisions"]:
            print("    complete")
        else:
            clean = False

        manifest["sets"][kind] = {
            "expected": want,
            "present": present,
            "missing": missing,
            "extra": extra,
            "unmapped": unmapped,
            "collisions": out[kind]["collisions"],
            "complete": not (missing or extra or unmapped or out[kind]["collisions"]),
        }

    manifest["clean"] = clean
    args.manifest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"\n  manifest written to {args.manifest}")

    print()
    if clean:
        print("MANIFEST CLEAN -- the item bank may reference these keys.")
        return 0
    print("MANIFEST NOT CLEAN -- do not hardcode filenames in the item bank yet.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
