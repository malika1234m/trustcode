"""Credential-format scan (extended profile). Language independent, regex only, never executes code.

Matches well-known credential *formats* (provider key prefixes, PEM private-key blocks). It complements the
Semgrep `hardcoded-secret` rules, which match on variable names. The matched value is never copied into the
evidence: excerpts are masked, so a real key is not stored or displayed a second time.
"""
from __future__ import annotations

import re
import time

from ..models import Check, CheckKind, CheckStatus, Finding, Location, Severity

TOOL = "trustcode-secrets"
PATTERNS: list[tuple[str, str, re.Pattern]] = [
    ("private-key-block", "Private key embedded in code", re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----")),
    ("aws-access-key-id", "AWS access key ID", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("github-token", "GitHub token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b")),
    ("slack-token", "Slack token", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b")),
    ("stripe-live-key", "Stripe live secret key", re.compile(r"\b[sr]k_live_[0-9A-Za-z]{20,}\b")),
    ("google-api-key", "Google API key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("anthropic-api-key", "Anthropic API key", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}\b")),
    ("openai-api-key", "OpenAI API key", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b")),
    ("credentials-in-url", "Credentials embedded in a URL", re.compile(r"\b[a-z][a-z0-9+.-]*://[^\s/:@'\"]+:[^\s/@'\"{}$<>%]{3,}@[^\s'\"]+")),
]
# Obvious documentation placeholders are not credentials.
_PLACEHOLDER = re.compile(r"(example|placeholder|changeme|your[_-]?(key|token|password)|x{6,}|\*{4,}|<[^>]+>|user:pass(word)?@)", re.I)
SCOPE = (f"Looks for {len(PATTERNS)} known credential formats (cloud/API key prefixes, private-key blocks, passwords in URLs). "
         "Does NOT detect secrets without a recognisable format (e.g. a plain password string) and cannot tell "
         "whether a matched key is live.")


def mask(line: str, start: int, end: int) -> str:
    value = line[start:end]
    keep = min(8, max(4, len(value) // 4))
    return (line[:start] + value[:keep] + "…[masked]" + line[end:]).strip()[:200]


def check_secrets(code: str) -> Check:
    t0 = time.monotonic()
    findings = []
    for i, line in enumerate(code.splitlines(), 1):
        if len(line) > 5000:
            continue  # minified/data lines: skipped, disclosed below
        for rule, title, pat in PATTERNS:
            m = pat.search(line)
            if not m or _PLACEHOLDER.search(m.group(0)):
                continue
            findings.append(Finding(
                id="", check=CheckKind.SECRETS, tool=TOOL, rule_id=rule, title=title,
                message=f"Line {i} contains text in the format of a {title[0].lower() + title[1:]}. "
                        "Anyone who can read this code can use the credential.",
                severity=Severity.HIGH, location=Location(line=i, column=m.start() + 1),
                code_excerpt=mask(line, m.start(), m.end()), cwe=["CWE-798"],
                metadata={"why_beginner": "A password or key written directly in code can be read by anyone who sees the code "
                                          "(teammates, a public repository, an AI assistant) and used as if they were you.",
                          "why": "Hardcoded credential (CWE-798): exposed to everyone with read access to the source or its history.",
                          "fix": "Remove it from the code, load it from an environment variable or secret manager, and revoke/rotate "
                                 "the exposed credential."}))
            break  # one finding per line is enough
    skipped = sum(len(ln) > 5000 for ln in code.splitlines())
    return Check(kind=CheckKind.SECRETS, tool=TOOL, status=CheckStatus.ISSUES_FOUND if findings else CheckStatus.PASSED,
                 summary=(f"{len(findings)} credential-format match(es)" if findings else "No known credential formats found.")
                 + (f" {skipped} very long line(s) were not scanned." if skipped else ""),
                 scope=SCOPE, findings=findings, duration_ms=int((time.monotonic() - t0) * 1000),
                 details={"patterns": [p[0] for p in PATTERNS], "lines_skipped": skipped})
