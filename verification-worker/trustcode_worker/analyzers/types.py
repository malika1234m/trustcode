"""Static type checking (extended profile).

Python: mypy, when it is installed in the worker environment (optional dependency). mypy only analyses the
file; it never executes it. Imports are not followed, so the check covers type consistency *inside* the
submitted code only.
JavaScript / TypeScript: no type checker is bundled; reported honestly as NOT_RUN.
A missing tool is always NOT_RUN / CHECK_FAILED, never "passed".
"""
from __future__ import annotations

import functools
import importlib.util
import re
import sys
import time
from pathlib import Path

from ..models import Check, CheckKind, CheckStatus, Finding, Language, Location, Severity
from ..tools import run

_LINE = re.compile(r"^[^:]+:(\d+):(?:(\d+):)? error: (.*?)(?:\s+\[([a-z0-9-]+)\])?$")
# Codes that depend on code outside the snippet; reporting them for a selection would be noise.
_IGNORED = {"import", "import-untyped", "import-not-found", "name-defined", "no-redef", "syntax"}
SCOPE = ("mypy type consistency inside the submitted code (imports are not followed; unannotated code is checked "
         "only loosely). Does not check logic, runtime values or code outside the selection.")


@functools.lru_cache
def mypy_available() -> bool:
    return importlib.util.find_spec("mypy") is not None


@functools.lru_cache
def _mypy_version() -> str | None:
    try:
        from importlib.metadata import version
        return f"mypy {version('mypy')}"
    except Exception:
        return None


def check_types(code: str, lang: Language, workdir: Path) -> Check:
    t0 = time.monotonic()
    if lang != Language.PYTHON:
        name = "TypeScript" if lang == Language.TYPESCRIPT else "JavaScript"
        return Check(kind=CheckKind.TYPES, tool="none", status=CheckStatus.NOT_RUN,
                     summary=f"No type checker for {name} in this version.",
                     scope="Not run: type errors were NOT checked.")
    if not mypy_available():
        return Check(kind=CheckKind.TYPES, tool="mypy", status=CheckStatus.NOT_RUN,
                     summary="mypy is not installed on the verification server.",
                     scope="Not run: type errors were NOT checked.")
    workdir.mkdir(parents=True, exist_ok=True)
    src = workdir / "solution.py"
    src.write_text(code)
    r = run([sys.executable, "-m", "mypy", "--ignore-missing-imports", "--follow-imports=skip", "--no-incremental",
             "--no-error-summary", "--show-column-numbers", "--hide-error-context", "--no-color-output",
             "--no-site-packages", "--config-file", "", str(src)], cwd=str(workdir), timeout=60)
    if r.timed_out or r.returncode not in (0, 1):
        return Check(kind=CheckKind.TYPES, tool="mypy", tool_version=_mypy_version(), status=CheckStatus.CHECK_FAILED,
                     summary="mypy did not complete.", scope=SCOPE, error=(r.stderr or r.stdout or "timeout")[-500:],
                     duration_ms=_ms(t0))
    lines = code.splitlines()
    findings = []
    for out_line in r.stdout.splitlines():
        m = _LINE.match(out_line.strip())
        if not m:
            continue
        ln, col, msg, code_id = int(m.group(1)), m.group(2), m.group(3), m.group(4) or "misc"
        if code_id in _IGNORED:
            continue
        findings.append(Finding(
            id="", check=CheckKind.TYPES, tool="mypy", rule_id=code_id, title=msg.split("  ")[0][:100], message=msg,
            severity=Severity.MEDIUM, location=Location(line=ln, column=int(col) if col else None),
            code_excerpt=lines[ln - 1].strip()[:200] if 0 < ln <= len(lines) else None))
    return Check(kind=CheckKind.TYPES, tool="mypy", tool_version=_mypy_version(),
                 status=CheckStatus.ISSUES_FOUND if findings else CheckStatus.PASSED,
                 summary=f"{len(findings)} type error(s)" if findings else "No type errors reported inside the submitted code.",
                 scope=SCOPE, findings=findings, duration_ms=_ms(t0))


def _ms(t0: float) -> int:
    return int((time.monotonic() - t0) * 1000)
