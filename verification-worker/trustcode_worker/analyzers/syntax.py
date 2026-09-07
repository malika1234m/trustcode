"""Stage 1: syntax and structure (parse only, never execute)."""
from __future__ import annotations

import ast
import re
import time
from pathlib import Path

from ..models import Check, CheckKind, CheckStatus, Finding, Language, Location, Severity
from ..tools import node_cmd, run, tool_version

_INCOMPLETE = re.compile(r"(TODO|FIXME|NotImplementedError|\.\.\.\s*$|pass\s*#\s*implement|throw new Error\(['\"]not implemented)", re.I | re.M)


def _incomplete_markers(code: str, lang: Language) -> list[Finding]:
    out = []
    for i, line in enumerate(code.splitlines(), 1):
        if _INCOMPLETE.search(line):
            out.append(Finding(
                id="", check=CheckKind.SYNTAX, tool="trustcode-structure", rule_id="incomplete-marker",
                title="Possible incomplete implementation",
                message=f"Line contains a marker that often indicates unfinished code: {line.strip()[:120]}",
                severity=Severity.LOW, location=Location(line=i), code_excerpt=line.strip()[:200]))
    return out


def check_syntax(code: str, lang: Language, workdir: Path) -> Check:
    t0 = time.monotonic()
    scope = ("Confirms the code can be parsed. Says nothing about behaviour, logic or security.")
    if lang == Language.PYTHON:
        try:
            tree = ast.parse(code)
        except SyntaxError as e:
            f = Finding(id="", check=CheckKind.SYNTAX, tool="python-ast", rule_id="syntax-error",
                        title="Syntax error", message=f"{e.msg}", severity=Severity.CRITICAL,
                        location=Location(line=e.lineno or 1, column=e.offset))
            return Check(kind=CheckKind.SYNTAX, tool="python-ast", tool_version=_py_version(), status=CheckStatus.ISSUES_FOUND,
                         summary="The code does not parse; later checks are unreliable or skipped.", scope=scope,
                         findings=[f], duration_ms=_ms(t0), details={"parses": False})
        funcs = [n.name for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
        markers = _incomplete_markers(code, lang)
        return Check(kind=CheckKind.SYNTAX, tool="python-ast", tool_version=_py_version(),
                     status=CheckStatus.ISSUES_FOUND if markers else CheckStatus.PASSED,
                     summary=("Parses successfully" + (f"; {len(markers)} incomplete-code marker(s)" if markers else "")),
                     scope=scope, findings=markers, duration_ms=_ms(t0),
                     details={"parses": True, "functions": funcs, "lines": len(code.splitlines())})
    # JavaScript: node --check parses without executing.
    node = node_cmd()
    if not node:
        return Check(kind=CheckKind.SYNTAX, tool="node --check", status=CheckStatus.CHECK_FAILED,
                     summary="Node.js not available; JavaScript syntax not checked.", scope=scope,
                     error="node not found", duration_ms=_ms(t0))
    src = workdir / "solution.js"
    src.write_text(code)
    r = run(node + ["--check", str(src)], timeout=20)
    if r.timed_out:
        return Check(kind=CheckKind.SYNTAX, tool="node --check", status=CheckStatus.CHECK_FAILED,
                     summary="Syntax check timed out.", scope=scope, error="timeout", duration_ms=_ms(t0))
    if r.returncode != 0:
        m = re.search(r"solution\.js:(\d+)", r.stderr)
        msg = next((ln for ln in r.stderr.splitlines() if "Error" in ln), r.stderr.strip()[:300])
        f = Finding(id="", check=CheckKind.SYNTAX, tool="node --check", rule_id="syntax-error", title="Syntax error",
                    message=msg, severity=Severity.CRITICAL, location=Location(line=int(m.group(1)) if m else 1))
        return Check(kind=CheckKind.SYNTAX, tool="node --check", tool_version=tool_version("node"), status=CheckStatus.ISSUES_FOUND,
                     summary="The code does not parse; later checks are unreliable or skipped.", scope=scope,
                     findings=[f], duration_ms=_ms(t0), details={"parses": False})
    funcs = re.findall(r"function\s+(\w+)\s*\(|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>", code)
    markers = _incomplete_markers(code, lang)
    return Check(kind=CheckKind.SYNTAX, tool="node --check", tool_version=tool_version("node"),
                 status=CheckStatus.ISSUES_FOUND if markers else CheckStatus.PASSED,
                 summary="Parses successfully" + (f"; {len(markers)} incomplete-code marker(s)" if markers else ""),
                 scope=scope, findings=markers, duration_ms=_ms(t0),
                 details={"parses": True, "functions": [a or b for a, b in funcs], "lines": len(code.splitlines())})


def _py_version() -> str:
    import sys
    return f"Python {sys.version.split()[0]}"


def _ms(t0: float) -> int:
    return int((time.monotonic() - t0) * 1000)
