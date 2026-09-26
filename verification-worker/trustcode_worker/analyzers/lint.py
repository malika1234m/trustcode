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
        return _pyflakes(code, t0) or Check(kind=CheckKind.LINT, tool="ruff", status=CheckStatus.CHECK_FAILED,
                                            summary="No Python linter available.", scope=scope, error="ruff/pyflakes not found")
    src = workdir / "solution.py"
    src.write_text(code)
    r = run(ruff + ["check", "--no-cache", "--isolated", "--select", RUFF_SELECT, "--output-format", "json", "--exit-zero", str(src)],
            timeout=60)
    if r.timed_out or r.returncode not in (0, 1):
        return Check(kind=CheckKind.LINT, tool="ruff", tool_version=tool_version("ruff"), status=CheckStatus.CHECK_FAILED,
                     summary="ruff did not complete.", scope=scope, error=(r.stderr or "timeout")[:500], duration_ms=_ms(t0))
    if not r.stdout.strip():  # ruff --output-format json always prints at least "[]"; empty means it did not run
        fallback = _pyflakes(code, t0)  # e.g. serverless bundles that ship the ruff package without its binary
        if fallback:
            return fallback
        return Check(kind=CheckKind.LINT, tool="ruff", status=CheckStatus.CHECK_FAILED, summary="ruff produced no output.",
                     scope=scope, error=(r.stderr or "no output")[-500:], duration_ms=_ms(t0))
    try:
        items = json.loads(r.stdout)
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


PYFLAKES_CODES = {"UnusedImport": "F401", "UndefinedName": "F821", "UnusedVariable": "F841",
                  "RedefinedWhileUnused": "F811", "ImportStarUsed": "F403", "UndefinedLocal": "F823"}


def _pyflakes(code: str, t0: float) -> Check | None:
    """Pure-Python fallback (parse-only, never executes code). Covers the pyflakes (F) subset of the ruff rules."""
    try:
        import ast

        import pyflakes
        from pyflakes import checker
    except ImportError:
        return None
    lines = code.splitlines()
    msgs = sorted(checker.Checker(ast.parse(code), filename="solution.py").messages, key=lambda m: m.lineno)
    findings = []
    for m in msgs:
        rule = PYFLAKES_CODES.get(type(m).__name__, "F")
        text = m.message % m.message_args
        findings.append(Finding(id="", check=CheckKind.LINT, tool="pyflakes", rule_id=rule, title=text[:100], message=text,
                                severity=_SEV.get(rule, Severity.LOW), location=Location(line=m.lineno, column=m.col),
                                code_excerpt=lines[m.lineno - 1].strip()[:200] if 0 < m.lineno <= len(lines) else None))
    return Check(kind=CheckKind.LINT, tool="pyflakes", tool_version=getattr(pyflakes, "__version__", None),
                 status=CheckStatus.ISSUES_FOUND if findings else CheckStatus.PASSED,
                 summary=f"{len(findings)} lint finding(s)" if findings else "No lint findings for the selected rules.",
                 scope="pyflakes (fallback for ruff): undefined names, unused imports/variables, redefinitions. "
                       "Bug-pattern (B) rules were NOT checked. Does not check logic or runtime behaviour.",
                 findings=findings, duration_ms=_ms(t0))


def _ms(t0):
    return int((time.monotonic() - t0) * 1000)
