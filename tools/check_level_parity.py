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

for name in ("MIN_LEVEL", "MAX_LEVEL"):
    js = read_constant(JS_SCALE, name)
    py = read_constant(PY_SCALE, name)
    if js != py:
        failures.append(f"{name} disagrees: shared/levels.js={js}, levels.py={py}")

MIN_LEVEL = read_constant(PY_SCALE, "MIN_LEVEL")
MAX_LEVEL = read_constant(PY_SCALE, "MAX_LEVEL")

if (MIN_LEVEL, MAX_LEVEL) != (0, 15):
    failures.append(f"scale is {MIN_LEVEL}-{MAX_LEVEL}, spec says 0-15")


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


# ── 4. The Sprint 3 tripwire ────────────────────────────────────────────────
#
# CONTENT_MAX_LEVEL only exists because the level banks are still fixed arrays.
# difficultyFor(level) is the Sprint 3 deliverable that replaces them; once it
# exists every level 0-15 is servable and the ceiling is wrong, not just
# redundant. Left in place it caps the new scale at 5, and a patient pinned at
# a ceiling reads exactly like a patient who stopped improving -- a silent
# failure in the one number this whole app produces.
#
# So: the two may not coexist. Deleting the table is what turns this check off.

GENERATOR = re.compile(r"\b(?:difficultyFor|difficulty_for)\s*\(")
generator_sites = []

for path in source_files():
    if path.name == "check_level_parity.py":
        continue
    code = strip_comments(path.read_text(encoding="utf-8"), path.suffix)
    for lineno, line in enumerate(code, 1):
        if GENERATOR.search(line):
            generator_sites.append(f"{path.relative_to(ROOT).as_posix()}:{lineno}")

if generator_sites and py_ceilings:
    failures.append(
        "Sprint 3 has landed (difficultyFor exists at "
        + ", ".join(generator_sites[:3])
        + ") but CONTENT_MAX_LEVEL is still defined. Delete the table from "
        "shared/levels.js and backend/app/levels.py, and let stepBounded clamp "
        "to MAX_LEVEL alone -- otherwise the 0-15 scale is silently capped at "
        f"{max(py_ceilings.values())}."
    )


if failures:
    print("LEVEL PARITY: FAIL")
    for line in failures:
        print(f"  - {line}")
    sys.exit(1)

ceiling_note = (
    f", content ceiling active (remove in Sprint 3): {py_ceilings}"
    if py_ceilings
    else ", no content ceiling"
)
print(
    f"LEVEL PARITY: OK  (scale {MIN_LEVEL}-{MAX_LEVEL}, one definition per "
    f"runtime{ceiling_note})"
)
