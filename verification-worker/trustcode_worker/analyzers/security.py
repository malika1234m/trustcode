"""Stage 3: security analysis with Semgrep using the frozen TrustCode ruleset.

The ruleset (trustcode_worker/rules/*.yml) is versioned in the repository so that the
experiment uses identical rules for every participant (ADR-005). Each rule carries
CWE/OWASP metadata and explanation hints used by the deterministic explanation engine.
"""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

from ..models import Check, CheckKind, CheckStatus, Finding, Language, Location, Severity
from ..tools import run, semgrep_cmd, tool_version

RULES_DIR = Path(__file__).resolve().parent.parent / "rules"
_SEV = {"ERROR": Severity.HIGH, "WARNING": Severity.MEDIUM, "INFO": Severity.LOW}


def ruleset_digest() -> str:
    h = hashlib.sha256()
    for p in sorted(RULES_DIR.glob("*.yml")):
        h.update(p.read_bytes())
    return h.hexdigest()[:12]


def check_security(code: str, lang: Language, workdir: Path) -> Check:
    t0 = time.monotonic()
    rules = RULES_DIR / f"{lang.value}.yml"
    n_rules = sum(1 for ln in rules.read_text().splitlines() if ln.startswith("  - id:"))
    scope = (f"Semgrep pattern matching with {n_rules} TrustCode {lang.value} rules (ruleset {ruleset_digest()}). "
             "Detects only the listed insecure patterns; absence of findings does NOT mean the code is secure.")
    sg = semgrep_cmd()
    if not sg:
        return Check(kind=CheckKind.SECURITY, tool="semgrep", status=CheckStatus.CHECK_FAILED,
                     summary="Semgrep not available; security patterns not checked.", scope=scope, error="semgrep not found")
    ext = "py" if lang == Language.PYTHON else "js"
    src = workdir / f"solution.{ext}"
    src.write_text(code)
    r = run(sg + ["scan", "--metrics=off", "--disable-version-check", "--quiet", "--json", "--config", str(rules), str(src)],
            timeout=120)
    if r.timed_out:
        return Check(kind=CheckKind.SECURITY, tool="semgrep", status=CheckStatus.CHECK_FAILED, summary="Semgrep timed out.",
                     scope=scope, error="timeout", duration_ms=_ms(t0))
    try:
        data = json.loads(r.stdout[r.stdout.index("{"):]) if "{" in r.stdout else None
    except (json.JSONDecodeError, ValueError):
        data = None
    if data is None:
        return Check(kind=CheckKind.SECURITY, tool="semgrep", status=CheckStatus.CHECK_FAILED, summary="Unreadable Semgrep output.",
                     scope=scope, error=(r.stderr or r.stdout)[-500:], duration_ms=_ms(t0))
    errors = [e.get("message", "")[:200] for e in data.get("errors", []) if e.get("level") == "error"]
    findings = []
    for res in data.get("results", []):
        ex, md = res["extra"], res["extra"].get("metadata", {})
        findings.append(Finding(
            id="", check=CheckKind.SECURITY, tool="semgrep", rule_id=res["check_id"].split(".")[-1],
            title=md.get("title", res["check_id"].split(".")[-1]), message=ex.get("message", "").strip(),
            severity=Severity(md["trustcode_severity"]) if md.get("trustcode_severity") else _SEV.get(ex.get("severity"), Severity.MEDIUM),
            location=Location(line=res["start"]["line"], end_line=res["end"]["line"], column=res["start"]["col"]),
            code_excerpt=(ex.get("lines") or "").strip()[:300],
            cwe=_as_list(md.get("cwe")), owasp=_as_list(md.get("owasp")),
            metadata={k: md[k] for k in ("why_beginner", "why", "fix", "example", "confidence") if k in md}))
    status = CheckStatus.ISSUES_FOUND if findings else (CheckStatus.CHECK_FAILED if errors else CheckStatus.PASSED)
    return Check(kind=CheckKind.SECURITY, tool="semgrep", tool_version=tool_version("semgrep"), status=status,
                 summary=(f"{len(findings)} security pattern(s) matched" if findings else
                          "Semgrep reported errors" if errors else "No listed insecure patterns matched."),
                 scope=scope, findings=findings, duration_ms=_ms(t0), error="; ".join(errors) or None,
                 details={"ruleset": ruleset_digest(), "rules": n_rules})


def _as_list(v):
    if v is None:
        return []
    return [str(x) for x in v] if isinstance(v, list) else [str(v)]


def _ms(t0):
    return int((time.monotonic() - t0) * 1000)
