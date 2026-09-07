"""Stage 2: static analysis / linting.

Python: ruff with pyflakes (F), syntax (E9) and bugbear (B) rule families.
JavaScript: no linter is bundled in the MVP -> reported honestly as NOT_RUN.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

from ..models import Check, CheckKind, CheckStatus, Finding, Language, Location, Severity
from ..tools import ruff_cmd, run, tool_version

RUFF_SELECT = "E9,F,B"
_SEV = {"F821": Severity.HIGH, "F811": Severity.MEDIUM, "F841": Severity.LOW, "F401": Severity.LOW}


def check_lint(code: str, lang: Language, workdir: Path) -> Check:
    t0 = time.monotonic()
    if lang != Language.PYTHON:
        return Check(kind=CheckKind.LINT, tool="none", status=CheckStatus.NOT_RUN,
                     summary="No linter configured for JavaScript in this version.",
                     scope="Not run: undefined variables, unused code and common bug patterns were NOT checked.")
    scope = (f"ruff rules {RUFF_SELECT}: undefined names, unused imports/variables and common bug patterns. "
             "Does not check logic, requirements or runtime behaviour.")
    ruff = ruff_cmd()
    if not ruff:
        return Check(kind=CheckKind.LINT, tool="ruff", status=CheckStatus.CHECK_FAILED, summary="ruff not available.",
                     scope=scope, error="ruff not found")
    src = workdir / "solution.py"
    src.write_text(code)
    r = run(ruff + ["check", "--no-cache", "--isolated", "--select", RUFF_SELECT, "--output-format", "json", "--exit-zero", str(src)],
            timeout=60)
    if r.timed_out or r.returncode not in (0, 1):
        return Check(kind=CheckKind.LINT, tool="ruff", tool_version=tool_version("ruff"), status=CheckStatus.CHECK_FAILED,
                     summary="ruff did not complete.", scope=scope, error=(r.stderr or "timeout")[:500], duration_ms=_ms(t0))
    try:
        items = json.loads(r.stdout or "[]")
    except json.JSONDecodeError as e:
        return Check(kind=CheckKind.LINT, tool="ruff", status=CheckStatus.CHECK_FAILED, summary="Unreadable ruff output.",
                     scope=scope, error=str(e), duration_ms=_ms(t0))
    lines = code.splitlines()
    findings = []
    for it in items:
        ln = it["location"]["row"]
        findings.append(Finding(
            id="", check=CheckKind.LINT, tool="ruff", rule_id=it["code"], title=it["message"].split(".")[0][:100],
            message=it["message"], severity=_SEV.get(it["code"], Severity.MEDIUM if it["code"].startswith("B") else Severity.LOW),
            location=Location(line=ln, end_line=it.get("end_location", {}).get("row"), column=it["location"]["column"]),
            code_excerpt=lines[ln - 1].strip()[:200] if 0 < ln <= len(lines) else None,
            metadata={"url": it.get("url")}))
    return Check(kind=CheckKind.LINT, tool="ruff", tool_version=tool_version("ruff"),
                 status=CheckStatus.ISSUES_FOUND if findings else CheckStatus.PASSED,
                 summary=f"{len(findings)} lint finding(s)" if findings else "No lint findings for the selected rules.",
                 scope=scope, findings=findings, duration_ms=_ms(t0))


def _ms(t0):
    return int((time.monotonic() - t0) * 1000)
