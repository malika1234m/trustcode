"""Verification pipeline: runs every stage independently and aggregates evidence.

Stages run independently so that one failing tool never hides the results of another,
and every stage reports its own status. No overall verdict is computed.
"""
from __future__ import annotations

import tempfile
from pathlib import Path

from .analyzers.dependencies import check_dependencies
from .analyzers.lint import check_lint
from .analyzers.security import check_security
from .analyzers.syntax import check_syntax
from .analyzers.tests import check_tests
from .languages import detect_language
from .models import (Check, CheckKind, CheckStatus, Language, UnverifiedArea, VerificationRequest,
                     VerificationResult)

ENGINE_VERSION = "trustcode-worker 0.1.0"
_PREFIX = {CheckKind.SYNTAX: "SYN", CheckKind.LINT: "LINT", CheckKind.SECURITY: "SEC",
           CheckKind.TESTS: "TEST", CheckKind.DEPENDENCIES: "DEP", CheckKind.REQUIREMENTS: "REQ"}


def _safe(fn, kind: CheckKind, *args) -> Check:
    try:
        return fn(*args)
    except Exception as e:  # a crashing analyzer must surface as CHECK_FAILED, never as "passed"
        return Check(kind=kind, tool=fn.__name__, status=CheckStatus.CHECK_FAILED,
                     summary="Internal error while running this check.", scope="Not completed.", error=repr(e)[:500])


def verify(req: VerificationRequest, run_tests: bool = True) -> VerificationResult:
    lang, how = detect_language(req.code, req.language.value if req.language else None)
    with tempfile.TemporaryDirectory(prefix="trustcode-") as d:
        wd = Path(d)
        syntax = _safe(check_syntax, CheckKind.SYNTAX, req.code, lang, wd)
        parses = syntax.details.get("parses", False)
        lint = _safe(check_lint, CheckKind.LINT, req.code, lang, wd) if parses else Check(
            kind=CheckKind.LINT, tool="ruff", status=CheckStatus.NOT_RUN, summary="Skipped: code does not parse.",
            scope="Not run.")
        security = _safe(check_security, CheckKind.SECURITY, req.code, lang, wd) if parses else Check(
            kind=CheckKind.SECURITY, tool="semgrep", status=CheckStatus.NOT_RUN, summary="Skipped: code does not parse.",
            scope="Not run: security patterns were NOT checked.")
    deps = _safe(check_dependencies, CheckKind.DEPENDENCIES, req.code, lang)
    unverified: list[UnverifiedArea] = []
    if run_tests:
        try:
            tests, gaps = check_tests(req.code, req.tests, lang, parses)
        except Exception as e:
            tests, gaps = Check(kind=CheckKind.TESTS, tool="sandbox", status=CheckStatus.CHECK_FAILED,
                                summary="Internal error while running tests.", scope="Not completed.", error=repr(e)[:500]), []
        unverified += gaps
    else:
        tests = Check(kind=CheckKind.TESTS, tool="sandbox", status=CheckStatus.NOT_RUN,
                      summary="Test execution disabled by configuration.", scope="Not run: runtime behaviour NOT tested.")
        unverified.append(UnverifiedArea(id="", description="Runtime behaviour", reason="Test execution was disabled."))
    requirements = Check(
        kind=CheckKind.REQUIREMENTS, tool="none", status=CheckStatus.NEEDS_REVIEW if req.task else CheckStatus.NOT_RUN,
        summary=("Whether the code does what the task asks has not been verified automatically - compare it with the task."
                 if req.task else "No task description supplied."),
        scope="Automated tools cannot confirm that code matches the intended requirement.")
    if req.task:
        unverified.append(UnverifiedArea(id="", description="Match between the code and the stated task",
                                         reason="No automated check establishes requirement conformance."))
    checks = [syntax, lint, security, tests, deps, requirements]
    # assign stable IDs
    for c in checks:
        for i, f in enumerate(c.findings, 1):
            f.id = f"{_PREFIX[c.kind]}-{i}"
    for i, u in enumerate(unverified, 1):
        u.id = f"U-{i}"
    return VerificationResult(language=lang, language_detection=how, checks=checks, unverified=unverified,
                              engine_version=ENGINE_VERSION)
