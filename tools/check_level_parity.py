"""Sprint 0 gate: the level scale is defined in exactly one place, twice.

`shared/levels.js` and `backend/app/levels.py` are the same contract in two
runtimes. Nothing enforces that at import time, so this checks it directly, and
then sweeps the tree for the two patterns that broke the old model:

  * a hardcoded level bound anywhere other than the two scale modules
  * a falsy check on a level (`level or 1`, `level || 1`, `if (level)`)

Run:  python tools/check_level_parity.py
Exit: 0 clean, 1 on any violation.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS_SCALE = ROOT / "shared" / "levels.js"
PY_SCALE = ROOT / "backend" / "app" / "levels.py"
JS_DOMAINS = ROOT / "shared" / "domains.js"
PY_DOMAINS = ROOT / "backend" / "app" / "domains.py"

SKIP_DIRS = {"node_modules", "venv", ".git", "dist", "__pycache__", ".claude"}
SOURCE_SUFFIXES = {".js", ".jsx", ".py"}

failures: list[str] = []


def source_files() -> list[Path]:
    out = []
    for path in ROOT.rglob("*"):
        if path.suffix not in SOURCE_SUFFIXES or not path.is_file():
            continue
        if SKIP_DIRS & set(path.relative_to(ROOT).parts):
            continue
        out.append(path)
    return out


def read_constant(path: Path, name: str) -> int:
    text = path.read_text(encoding="utf-8")
    match = re.search(rf"^(?:export const |){name}\s*=\s*(-?\d+)", text, re.M)
    if not match:
        raise SystemExit(f"{path.name}: could not find {name}")
    return int(match.group(1))


# ── 1. The two scale modules agree ───────────────────────────────────────────

for name in ("MIN_LEVEL", "MAX_LEVEL", "STARTING_LEVEL"):
    js = read_constant(JS_SCALE, name)
    py = read_constant(PY_SCALE, name)
    if js != py:
        failures.append(f"{name} disagrees: shared/levels.js={js}, levels.py={py}")

MIN_LEVEL = read_constant(PY_SCALE, "MIN_LEVEL")
MAX_LEVEL = read_constant(PY_SCALE, "MAX_LEVEL")
STARTING_LEVEL = read_constant(PY_SCALE, "STARTING_LEVEL")

if (MIN_LEVEL, MAX_LEVEL) != (0, 15):
    failures.append(f"scale is {MIN_LEVEL}-{MAX_LEVEL}, spec says 0-15")

# The starting level is what an uncalibrated patient plays at. Pinned off both
# ends on purpose: MIN_LEVEL is the bug this constant exists to fix (level 0
# emits no no-go stimulus and highlights the executive answer, so every domain
# scores a constant 1.0), and MAX_LEVEL is the "never start everyone at 15" the
# spec rules out. Anywhere strictly between is a judgement call; either end is
# a regression.
if not MIN_LEVEL < STARTING_LEVEL < MAX_LEVEL:
    failures.append(
        f"STARTING_LEVEL={STARTING_LEVEL} must sit strictly inside "
        f"{MIN_LEVEL}-{MAX_LEVEL}: the floor measures nothing, the ceiling is "
        f"the 'never start everyone at 15' the spec forbids"
    )


def read_content_ceilings(path: Path) -> dict[str, int]:
    """Parse the CONTENT_MAX_LEVEL table out of either mirror.

    The table is a temporary guard keeping a proposed level inside what the
    old fixed banks can serve. It exists twice, so it can drift twice.
    """
    text = path.read_text(encoding="utf-8")
    block = re.search(r"CONTENT_MAX_LEVEL\s*[:=]\s*\{(.*?)\}", text, re.S)
    if not block:
        # Absent is the CORRECT end state. Sprint 3 deletes this table; a
        # missing table is the goal, not a broken check.
        return {}

    ceilings: dict[str, int] = {}
    for line in block.group(1).splitlines():
        match = re.match(r"""\s*["']?([\w-]+)["']?\s*:\s*(\d+)""", line)
        if match:
            ceilings[match.group(1)] = int(match.group(2))
    return ceilings


js_ceilings = read_content_ceilings(JS_SCALE)
py_ceilings = read_content_ceilings(PY_SCALE)

if js_ceilings != py_ceilings:
    failures.append(
        f"CONTENT_MAX_LEVEL disagrees: shared/levels.js={js_ceilings}, "
        f"levels.py={py_ceilings}"
    )

for game, ceiling in sorted(py_ceilings.items()):
    if not MIN_LEVEL <= ceiling <= MAX_LEVEL:
        failures.append(f"CONTENT_MAX_LEVEL[{game}]={ceiling} is outside the scale")

def strip_comments(text: str, suffix: str) -> list[str]:
    """Blank out comments and docstrings, keeping line numbers intact.

    A comment explaining why `level or 1` was removed must not read as a
    reintroduction of it.
    """
    lines = text.splitlines()
    out = list(lines)

    if suffix == ".py":
        in_doc = None
        for i, line in enumerate(lines):
            rest = line
            if in_doc is None:
                stripped = rest.lstrip()
                if stripped.startswith("#"):
                    out[i] = ""
                    continue
                for quote in ('"""', "'''"):
                    idx = rest.find(quote)
                    if idx != -1:
                        closing = rest.find(quote, idx + 3)
                        if closing == -1:
                            in_doc = quote
                            out[i] = rest[:idx]
                        else:
                            out[i] = rest[:idx] + rest[closing + 3 :]
                        break
                else:
                    out[i] = rest.split("#", 1)[0]
            else:
                closing = rest.find(in_doc)
                if closing == -1:
                    out[i] = ""
                else:
                    out[i] = rest[closing + 3 :]
                    in_doc = None
        return out

    in_block = False
    for i, line in enumerate(lines):
        if in_block:
            end = line.find("*/")
            if end == -1:
                out[i] = ""
                continue
            line = line[end + 2 :]
            in_block = False
        start = line.find("/*")
        if start != -1:
            end = line.find("*/", start + 2)
            if end == -1:
                in_block = True
                line = line[:start]
            else:
                line = line[:start] + line[end + 2 :]
        out[i] = line.split("//", 1)[0]
    return out


# ── 2. Nobody else declares a level bound ────────────────────────────────────

BOUND_DECL = re.compile(
    r"\b(?:MIN_LEVEL|MAX_LEVEL|minLevel|maxLevel|LEVEL_BOUNDS)\b\s*[:=]\s*-?\d+"
)

for path in source_files():
    if path in (JS_SCALE, PY_SCALE) or path.name == "check_level_parity.py":
        continue
    for lineno, line in enumerate(
        strip_comments(path.read_text(encoding="utf-8"), path.suffix), 1
    ):
        if BOUND_DECL.search(line):
            rel = path.relative_to(ROOT).as_posix()
            failures.append(f"{rel}:{lineno} declares its own level bound: {line.strip()}")


# ── 3. No falsy-zero handling of a level ─────────────────────────────────────

FALSY_LEVEL = [
    re.compile(r"\b(?:new_)?level\s+or\s+"),           # python:  level or 1
    re.compile(r"\.level\s+or\s+"),                     # python:  row.level or 1
    re.compile(r"\b\w*[Ll]evel\s*\|\|"),                # js:      level || 1
    re.compile(r"if\s*\(\s*!\s*\w*[Ll]evel\s*\)"),      # js:      if (!level)
    re.compile(r"if\s*\(\s*\w*[Ll]evel\s*\)"),          # js:      if (level)
]

for path in source_files():
    if path in (JS_SCALE, PY_SCALE) or path.name == "check_level_parity.py":
        continue
    code = strip_comments(path.read_text(encoding="utf-8"), path.suffix)
    for lineno, line in enumerate(code, 1):
        for pattern in FALSY_LEVEL:
            if pattern.search(line):
                rel = path.relative_to(ROOT).as_posix()
                failures.append(
                    f"{rel}:{lineno} falsy check on a level: {line.strip()}"
                )
                break


# ── 3b. The six domains agree across runtimes ────────────────────────────────
#
# The client stores six base levels locally and sends `domain` with every
# session row, so both sides carry the list. Two copies can drift, and a drift
# here means a session row lands in a domain the dashboard never renders.

def _resolve_ref(text: str, ref: str) -> str | None:
    match = re.search(ref + r"""\s*=\s*["']([a-z_]+)["']""", text)
    return match.group(1) if match else None


def read_domain_list(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    block = re.search(r"DOMAINS\s*[:=]\s*\[(.*?)\]", text, re.S)
    if not block:
        raise SystemExit(f"{path.name}: could not find DOMAINS")
    body = block.group(1)

    names = re.findall(r"""["']([a-z_]+)["']""", body)
    if names:
        return names

    # Written as constant references (DOMAIN_MEMORY, ...) -- resolve each.
    out = []
    for ref in re.findall(r"\b(DOMAIN_[A-Z_]+)\b", body):
        value = _resolve_ref(text, ref)
        if value:
            out.append(value)
    return out


def read_game_map(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    block = re.search(r"GAME_TO_DOMAIN\s*[:=]\s*\{(.*?)^\}", text, re.S | re.M)
    if not block:
        raise SystemExit(f"{path.name}: could not find GAME_TO_DOMAIN")

    out = {}
    for line in block.group(1).splitlines():
        match = re.match(
            r"""\s*["']?([\w-]+)["']?\s*:\s*(?:["']([a-z_]+)["']|(DOMAIN_[A-Z_]+))""",
            line,
        )
        if not match:
            continue
        game, literal, ref = match.groups()
        value = literal or _resolve_ref(text, ref)
        if value:
            out[game] = value
    return out


js_domains = read_domain_list(JS_DOMAINS)
py_domains = read_domain_list(PY_DOMAINS)

if js_domains != py_domains:
    failures.append(
        f"DOMAINS disagree: shared/domains.js={js_domains}, domains.py={py_domains}"
    )

DSM5 = ["attention", "executive", "memory", "language", "perceptual_motor", "social"]
if py_domains != DSM5:
    failures.append(f"DOMAINS is {py_domains}, spec says the six DSM-5 domains {DSM5}")

def read_name_list(path: Path, name: str) -> list[str]:
    """A flat list of string literals assigned to `name`.

    The lookbehind matters: a plain search for GAME_TYPES also matches inside
    TARGET_GAME_TYPES, which is declared first, so the legacy list would come
    back as the target list and every legacy ceiling would look orphaned.
    """
    text = path.read_text(encoding="utf-8")
    block = re.search(r"(?<![A-Z_])" + name + r"\s*[:=]\s*\[(.*?)\]", text, re.S)
    if not block:
        return []
    return re.findall(r"""["']([\w-]+)["']""", block.group(1))


def read_target_games(path: Path) -> list[str]:
    return read_name_list(path, "TARGET_GAME_TYPES")


def read_legacy_games(path: Path) -> list[str]:
    return read_name_list(path, "GAME_TYPES")


js_games = read_game_map(JS_DOMAINS)
py_games = read_game_map(PY_DOMAINS)

if js_games != py_games:
    only_js = {k: v for k, v in js_games.items() if py_games.get(k) != v}
    only_py = {k: v for k, v in py_games.items() if js_games.get(k) != v}
    failures.append(f"GAME_TO_DOMAIN disagrees -- js has {only_js}, py has {only_py}")

# The collapse this rewrite exists to undo.
if py_games.get("memory") and py_games.get("memory") == py_games.get("name-recall"):
    failures.append(
        "memory and name-recall map to the same domain again -- that collapse "
        "is what made the Memory score blend two unrelated tasks"
    )


# ── 4. The Sprint 3 tripwire ────────────────────────────────────────────────
#
# CONTENT_MAX_LEVEL exists only because the LEGACY level banks are fixed arrays
# that cannot serve a level they have no entry for. It is keyed by game type.
#
# This check originally fired the moment difficultyFor() appeared anywhere,
# on the assumption that the generator and the ceiling could not coexist. That
# was too blunt, and it fired for the wrong reason: the generator arrived while
# the legacy games were still playable, and the six NEW game types are absent
# from the table, so contentMaxLevel() already returns MAX_LEVEL for every one
# of them. Nothing new was being capped.
#
# So it now guards the hazard itself rather than a proxy for it:
#
#   a) a NEW game type appearing in the table -- generated content serves every
#      level on demand, so a ceiling on one can only ever silently cap the
#      0-15 scale, and a patient pinned at a ceiling reads exactly like a
#      patient who stopped improving;
#   b) the table outliving the legacy games it describes -- once those are
#      gone in Sprint 4 it is dead weight that will cap something by accident.

target_games = read_target_games(PY_DOMAINS)
legacy_games = read_legacy_games(PY_DOMAINS)

capped_new = sorted(set(py_ceilings) & set(target_games))
if capped_new:
    failures.append(
        f"CONTENT_MAX_LEVEL caps new game types {capped_new}. Generated content "
        "serves every level, so a ceiling here can only silently cap the 0-15 "
        "scale. Remove those keys."
    )

orphaned = sorted(set(py_ceilings) - set(legacy_games))
if orphaned:
    failures.append(
        f"CONTENT_MAX_LEVEL has keys for games that are not in GAME_TYPES "
        f"{orphaned} -- a ceiling nothing plays against."
    )

if py_ceilings and not set(py_ceilings) & set(legacy_games):
    failures.append(
        "CONTENT_MAX_LEVEL has outlived the legacy games. Delete the table from "
        "shared/levels.js and backend/app/levels.py and let stepBounded clamp "
        "to MAX_LEVEL alone."
    )


if failures:
    print("PARITY: FAIL")
    for line in failures:
        print(f"  - {line}")
    sys.exit(1)

ceiling_note = (
    f", content ceiling active (remove in Sprint 3): {py_ceilings}"
    if py_ceilings
    else ", no content ceiling"
)
print(
    f"PARITY: OK  (scale {MIN_LEVEL}-{MAX_LEVEL}, {len(py_domains)} domains, "
    f"one definition per runtime{ceiling_note})"
)
