"""Stage 4: execute supplied unit tests in the sandbox.

Distinguishes: no tests supplied (NOT_RUN) vs tests passed vs tests failed vs
execution impossible (CHECK_FAILED). Coverage gaps become unverified areas.
"""
from __future__ import annotations

import ast
import time

from ..models import Check, CheckKind, CheckStatus, Finding, Language, Location, Severity, UnverifiedArea
from ..sandbox.docker_runner import IMAGE, run_in_sandbox

SCOPE = ("Runs the supplied tests in an isolated sandbox. Passing tests show the code behaves as expected "
         "ONLY for the inputs those tests use; untested inputs and paths remain unverified.")


def check_tests(code: str, tests: str | None, lang: Language, parses: bool) -> tuple[Check, list[UnverifiedArea]]:
    t0 = time.monotonic()
    tool = "pytest (sandbox)" if lang == Language.PYTHON else "node --test (sandbox)"
    if not tests or not tests.strip():
        return (Check(kind=CheckKind.TESTS, tool=tool, status=CheckStatus.NOT_RUN, summary="No tests supplied.",
                      scope="Not run: runtime behaviour was NOT tested."),
                [UnverifiedArea(id="", description="Runtime behaviour of the whole snippet",
                                reason="No tests were supplied, so no input was ever executed.")])
    if lang == Language.TYPESCRIPT:
        return (Check(kind=CheckKind.TESTS, tool="sandbox", status=CheckStatus.NOT_RUN,
                      summary="Test execution for TypeScript is not supported in this version.",
                      scope="Not run: runtime behaviour was NOT tested."),
                [UnverifiedArea(id="", description="Runtime behaviour of the whole snippet",
                                reason="TypeScript tests cannot be executed in this version.")])
    if not parses:
        return (Check(kind=CheckKind.TESTS, tool=tool, status=CheckStatus.NOT_RUN,
                      summary="Skipped because the code does not parse.", scope=SCOPE),
                [UnverifiedArea(id="", description="Runtime behaviour", reason="Code has syntax errors; tests not run.")])
    out = run_in_sandbox(lang.value, code, tests)
    if not out.ok:
        return (Check(kind=CheckKind.TESTS, tool=tool, tool_version=IMAGE, status=CheckStatus.CHECK_FAILED,
                      summary="Tests could not be executed.", scope=SCOPE, error=out.error, duration_ms=_ms(t0)),
                [UnverifiedArea(id="", description="Runtime behaviour", reason=f"Test execution failed: {out.error}")])
    d = out.data
    if d["status"] == "timeout":
        f = Finding(id="", check=CheckKind.TESTS, tool=tool, rule_id="timeout", title="Tests timed out",
                    message="Execution exceeded the time limit (possible infinite loop or very slow code).",
                    severity=Severity.HIGH)
        return (Check(kind=CheckKind.TESTS, tool=tool, tool_version=IMAGE, status=CheckStatus.ISSUES_FOUND,
                      summary="Test run timed out.", scope=SCOPE, findings=[f], duration_ms=_ms(t0)), [])
    if d["status"] == "error" or not d.get("tests"):
        return (Check(kind=CheckKind.TESTS, tool=tool, tool_version=IMAGE, status=CheckStatus.CHECK_FAILED,
                      summary="Test runner reported an error before any test result (e.g. import error in tests).",
                      scope=SCOPE, error=d.get("output", "")[-800:], duration_ms=_ms(t0)),
                [UnverifiedArea(id="", description="Runtime behaviour", reason="No test produced a result.")])
    results = [t for t in d["tests"] if t.get("depth", 0) == min(x.get("depth", 0) for x in d["tests"])] \
        if lang == Language.JAVASCRIPT and any("depth" in t for t in d["tests"]) else d["tests"]
    findings = [Finding(id="", check=CheckKind.TESTS, tool=tool, rule_id="test-" + t["outcome"],
                        title=f"Test {t['outcome']}: {t['name']}", message=(t.get("message") or "").strip()[:1500],
                        severity=Severity.HIGH, metadata={"test": t["name"]})
                for t in results if t["outcome"] in ("failed", "error")]
    passed = sum(t["outcome"] == "passed" for t in results)
    skipped = sum(t["outcome"] == "skipped" for t in results)
    unverified = _coverage_gaps(code, d.get("coverage"), lang)
    details = {"passed": passed, "failed": len(findings), "skipped": skipped, "total": len(results),
               "tests": [{"name": t["name"], "outcome": t["outcome"]} for t in results],
               "coverage_measured": d.get("coverage") is not None}
    if d.get("coverage"):
        ex, miss = len(d["coverage"]["executed"]), len(d["coverage"]["missing"])
        details["line_coverage"] = round(100 * ex / max(ex + miss, 1), 1)
    else:
        unverified.append(UnverifiedArea(id="", description="Which lines the tests executed",
                                         reason="Coverage is not measured for this language in this version."))
    summary = f"{passed} passed, {len(findings)} failed" + (f", {skipped} skipped" if skipped else "")
    return (Check(kind=CheckKind.TESTS, tool=tool, tool_version=IMAGE,
                  status=CheckStatus.ISSUES_FOUND if findings else CheckStatus.PASSED,
                  summary=summary, scope=SCOPE, findings=findings, details=details, duration_ms=_ms(t0)), unverified)


def _coverage_gaps(code: str, cov: dict | None, lang: Language) -> list[UnverifiedArea]:
    if lang != Language.PYTHON or not cov:
        return []
    executed = set(cov["executed"])
    missing = sorted(cov["missing"])
    gaps = []
    try:
        tree = ast.parse(code)
        for n in ast.walk(tree):
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                body_lines = set(range(n.body[0].lineno, (n.end_lineno or n.lineno) + 1))
                if not body_lines & executed:
                    gaps.append(UnverifiedArea(id="", description=f"Function '{n.name}' was never executed by the tests",
                                               reason="0 of its lines ran during testing.",
                                               location=Location(line=n.lineno, end_line=n.end_lineno)))
    except SyntaxError:
        pass
    # group remaining missing lines into ranges
    covered_fn_lines = {g.location.line for g in gaps if g.location}
    ranges, start, prev = [], None, None
    for ln in missing:
        if start is None:
            start = prev = ln
        elif ln == prev + 1:
            prev = ln
        else:
            ranges.append((start, prev))
            start = prev = ln
    if start is not None:
        ranges.append((start, prev))
    for a, b in ranges:
        if any(g.location and g.location.line <= a <= (g.location.end_line or a) for g in gaps) or a in covered_fn_lines:
            continue
        gaps.append(UnverifiedArea(id="", description=f"Lines {a}-{b} never executed by tests" if a != b else f"Line {a} never executed by tests",
                                   reason="This code path (e.g. a branch or error case) was not exercised.",
                                   location=Location(line=a, end_line=b)))
    return gaps


def _ms(t0):
    return int((time.monotonic() - t0) * 1000)
