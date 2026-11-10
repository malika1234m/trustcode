"""Verification pipeline: runs every stage independently and aggregates evidence.

Stages run independently so that one failing tool never hides the results of another,
and every stage reports its own status. No overall verdict is computed.
"""
from __future__ import annotations

import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .analyzers.dependencies import check_dependencies
from .analyzers.lint import check_lint
from .analyzers.secrets import check_secrets
from .analyzers.security import check_security
from .analyzers.syntax import check_syntax
from .analyzers.tests import check_tests
from .analyzers.types import check_types
from .languages import detect_language
from .models import (SEVERITY_ORDER, Check, CheckKind, CheckStatus, UnverifiedArea, VerificationRequest,
                     VerificationResult)

ENGINE_VERSION = "trustcode-worker 0.2.0"
# "study-v1" reproduces the engine used to build the research benchmark (frozen rules, ADR-005/ADR-008).
# "extended" is the product default: adds JS/TS static analysis, wider Python lint rules, a credential-format
# scan, type checking and cross-analyzer de-duplication.
PROFILES = ("extended", "study-v1")
_PREFIX = {CheckKind.SYNTAX: "SYN", CheckKind.LINT: "LINT", CheckKind.SECURITY: "SEC", CheckKind.SECRETS: "SCRT",
           CheckKind.TYPES: "TYPE", CheckKind.TESTS: "TEST", CheckKind.DEPENDENCIES: "DEP", CheckKind.REQUIREMENTS: "REQ"}
_TOOL = {CheckKind.LINT: "linter", CheckKind.SECURITY: "semgrep", CheckKind.SECRETS: "trustcode-secrets",
         CheckKind.TYPES: "type checker", CheckKind.DEPENDENCIES: "trustcode-deps"}


def _safe(fn, kind: CheckKind, *args) -> Check:
    try:
        return fn(*args)
    except Exception as e:  # a crashing analyzer must surface as CHECK_FAILED, never as "passed"
        return Check(kind=kind, tool=fn.__name__, status=CheckStatus.CHECK_FAILED,
                     summary="Internal error while running this check.", scope="Not completed.", error=repr(e)[:500])


def _skipped(kind: CheckKind, what: str) -> Check:
    return Check(kind=kind, tool=_TOOL[kind], status=CheckStatus.NOT_RUN, summary="Skipped: code does not parse.",
                 scope=f"Not run: {what} NOT checked.")


def _tests_stage(req: VerificationRequest, lang, parses: bool):
    try:
        return check_tests(req.code, req.tests, lang, parses)
    except Exception as e:
        return Check(kind=CheckKind.TESTS, tool="sandbox", status=CheckStatus.CHECK_FAILED,
                     summary="Internal error while running tests.", scope="Not completed.", error=repr(e)[:500]), []


def deduplicate(checks: list[Check]) -> int:
    """Merge findings that two analyzers report for the same line and the same weakness (shared CWE) or rule.

    The most severe report is kept; the others are removed from their check and recorded on the kept finding
    (`metadata.also_reported_by`) and on the check they came from (`details.merged`), so no evidence is lost
    and a check that matched something is never shown as "passed".
    """
    kept: dict[tuple, tuple[Check, object]] = {}
    merged = 0
    for c in checks:
        for f in list(c.findings):
            if not f.location:
                continue
            keys = [(f.location.line, cwe) for cwe in f.cwe] or [(f.location.line, f"{f.tool}:{f.rule_id}")]
            hit = next((kept[k] for k in keys if k in kept), None)
            if hit is None:
                for k in keys:
                    kept[k] = (c, f)
                continue
            owner_check, owner = hit
            if owner is f:
                continue
            if SEVERITY_ORDER[f.severity] < SEVERITY_ORDER[owner.severity]:
                owner.severity = f.severity
            owner.metadata.setdefault("also_reported_by", []).append(f"{f.tool}:{f.rule_id}")
            c.findings.remove(f)
            c.details.setdefault("merged", []).append({"rule": f.rule_id, "line": f.location.line,
                                                       "into": f"{owner.tool}:{owner.rule_id}"})
            merged += 1
            if not c.findings:
                c.summary = f"{len(c.details['merged'])} match(es), reported under {_names(owner_check.kind)} (same line and weakness)."
    return merged


def _names(kind: CheckKind) -> str:
    return {"security": "Security patterns", "secrets": "Hardcoded secrets", "lint": "Static analysis",
            "types": "Type checking"}.get(kind.value, kind.value)


def verify(req: VerificationRequest, run_tests: bool = True, profile: str = "extended", parallel: bool = True) -> VerificationResult:
    if profile not in PROFILES:
        raise ValueError(f"unknown profile {profile!r}")
    extended = profile == "extended"
    lang, how = detect_language(req.code, req.language.value if req.language else None)
    with tempfile.TemporaryDirectory(prefix="trustcode-") as d:
        wd = Path(d)
        syntax = _safe(check_syntax, CheckKind.SYNTAX, req.code, lang, wd)
        parses = syntax.details.get("parses", False)
        decl_only = bool(syntax.details.get("declarations_only"))
        # A syntax check that could not run (tool unavailable) is "unknown", not a parse error:
        # still run the static analyzers, which have their own parsers and report their own failures.
        analysable = parses or syntax.status == CheckStatus.CHECK_FAILED
        # Every stage is independent and mostly waits on a subprocess, so they run concurrently; each gets a
        # private directory. Results are collected in a fixed order, so output never depends on timing.
        stages: dict[str, tuple] = {}
        for name in ("lint", "security", "types"):
            (wd / name).mkdir()
        if analysable:
            stages["lint"] = (_safe, check_lint, CheckKind.LINT, req.code, lang, wd / "lint", extended)
            stages["security"] = (_safe, check_security, CheckKind.SECURITY, req.code, lang, wd / "security", extended)
            if extended:
                stages["types"] = (_safe, check_types, CheckKind.TYPES, req.code, lang, wd / "types")
        if extended:
            stages["secrets"] = (_safe, check_secrets, CheckKind.SECRETS, req.code)  # text scan: works on unparsable code too
        stages["deps"] = (_safe, check_dependencies, CheckKind.DEPENDENCIES, req.code, lang)
        if run_tests and not decl_only:
            stages["tests"] = (_tests_stage, req, lang, parses)
        if parallel:
            with ThreadPoolExecutor(max_workers=len(stages), thread_name_prefix="trustcode-stage") as pool:
                futures = {name: pool.submit(*call) for name, call in stages.items()}
                done = {name: fut.result() for name, fut in futures.items()}
        else:
            done = {name: call[0](*call[1:]) for name, call in stages.items()}

    lint = done.get("lint") or _skipped(CheckKind.LINT, "undefined variables, unused code and common bug patterns were")
    security = done.get("security") or Check(
        kind=CheckKind.SECURITY, tool="semgrep", status=CheckStatus.NOT_RUN, summary="Skipped: code does not parse.",
        scope="Not run: security patterns were NOT checked.")
    if not analysable and not extended:  # byte-identical to the frozen engine
        lint = Check(kind=CheckKind.LINT, tool="ruff", status=CheckStatus.NOT_RUN, summary="Skipped: code does not parse.",
                     scope="Not run.")
    deps = done["deps"]
    unverified: list[UnverifiedArea] = []
    if decl_only:
        # Type declarations (e.g. .d.ts) have no behaviour: testing is not applicable, not "missing".
        tests = Check(kind=CheckKind.TESTS, tool="sandbox", status=CheckStatus.NOT_RUN,
                      summary="Not applicable: type declarations contain no runnable code.",
                      scope="Declarations describe types only; there is no behaviour to test.")
        unverified.append(UnverifiedArea(id="", description="Whether the declared types match the real implementation",
                                         reason="Type declarations only (e.g. a .d.ts file): the implementation is elsewhere and was not checked."))
    elif run_tests:
        tests, gaps = done["tests"]
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
    if extended:
        types = done.get("types") or _skipped(CheckKind.TYPES, "type errors were")
        checks = [syntax, lint, types, security, done["secrets"], tests, deps, requirements]
        deduplicate(checks)
        # Every check that did not produce a result is also listed where users look for gaps.
        for c in (lint, types, security):
            if c.status in (CheckStatus.CHECK_FAILED, CheckStatus.NOT_RUN):
                unverified.append(UnverifiedArea(
                    id="", description=f"{_names(c.kind)}: not checked",
                    reason=c.summary + (" The tool failed, so its result is unknown." if c.status == CheckStatus.CHECK_FAILED else "")))
    else:
        checks = [syntax, lint, security, tests, deps, requirements]
    # assign stable IDs
    for c in checks:
        for i, f in enumerate(c.findings, 1):
            f.id = f"{_PREFIX[c.kind]}-{i}"
    for i, u in enumerate(unverified, 1):
        u.id = f"U-{i}"
    return VerificationResult(language=lang, language_detection=how, checks=checks, unverified=unverified,
                              engine_version=ENGINE_VERSION, profile=profile)
