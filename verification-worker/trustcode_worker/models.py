"""Normalised verification evidence model.

Design invariants (see docs/decisions/ADR-002):
* Every check reports its own status; there is NO aggregate correctness score.
* "passed" means only "this tool, within its stated scope, reported nothing".
* Anything not checked is reported explicitly as NOT_RUN / an unverified area.
* Evidence is produced only by deterministic tools; LLM output never enters this model
  except as REQUIREMENTS findings whose status is always NEEDS_REVIEW.
"""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class Language(str, Enum):
    PYTHON = "python"
    JAVASCRIPT = "javascript"
    TYPESCRIPT = "typescript"


class CheckKind(str, Enum):
    SYNTAX = "syntax"
    LINT = "lint"
    SECURITY = "security"
    TESTS = "tests"
    DEPENDENCIES = "dependencies"
    REQUIREMENTS = "requirements"
    SECRETS = "secrets"            # extended profile: credential-format scan
    TYPES = "types"                # extended profile: static type checking


class CheckStatus(str, Enum):
    PASSED = "passed"              # tool ran, reported nothing within its scope
    ISSUES_FOUND = "issues_found"  # tool ran and reported findings
    CHECK_FAILED = "check_failed"  # tool could not complete (error/timeout/unavailable)
    NOT_RUN = "not_run"            # check not applicable / no input (e.g. no tests supplied)
    NEEDS_REVIEW = "needs_review"  # result requires human judgement (e.g. LLM notes, unknown deps)


class Severity(str, Enum):
    INFO = "info"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


SEVERITY_ORDER = {s: i for i, s in enumerate([Severity.CRITICAL, Severity.HIGH, Severity.MEDIUM, Severity.LOW, Severity.INFO])}


class FindingStatus(str, Enum):
    ISSUE_DETECTED = "issue_detected"        # reported by a deterministic tool
    NEEDS_HUMAN_REVIEW = "needs_human_review"  # plausible but not verified (LLM, heuristic)


class Location(BaseModel):
    line: int
    end_line: Optional[int] = None
    column: Optional[int] = None


class Finding(BaseModel):
    id: str                                  # stable within a result, e.g. "SEC-1"
    check: CheckKind
    tool: str                                # which tool produced it (the verification method)
    rule_id: Optional[str] = None
    title: str
    message: str                             # raw tool message (the evidence)
    severity: Severity = Severity.MEDIUM
    status: FindingStatus = FindingStatus.ISSUE_DETECTED
    location: Optional[Location] = None
    code_excerpt: Optional[str] = None
    cwe: list[str] = Field(default_factory=list)
    owasp: list[str] = Field(default_factory=list)
    metadata: dict = Field(default_factory=dict)  # rule-provided explanation hints, test output, ...


class Check(BaseModel):
    kind: CheckKind
    tool: str
    tool_version: Optional[str] = None
    status: CheckStatus
    summary: str
    scope: str                               # what this check can and cannot establish
    findings: list[Finding] = Field(default_factory=list)
    details: dict = Field(default_factory=dict)
    duration_ms: Optional[int] = None
    error: Optional[str] = None


class UnverifiedArea(BaseModel):
    id: str                                  # e.g. "U-1"
    description: str
    reason: str
    location: Optional[Location] = None


class VerificationRequest(BaseModel):
    code: str = Field(max_length=200_000)
    language: Optional[Language] = None
    task: Optional[str] = Field(default=None, max_length=10_000)
    tests: Optional[str] = Field(default=None, max_length=200_000)


class VerificationResult(BaseModel):
    schema_version: str = "1.0"
    language: Language
    language_detection: str                  # "declared" or "detected: <reason>"
    checks: list[Check]
    unverified: list[UnverifiedArea] = Field(default_factory=list)
    engine_version: str
    profile: str = "extended"                # which check set ran: "extended" (product) or "study-v1" (frozen, ADR-005)
    disclaimer: str = ("These results describe what specific automated checks did and did not find. "
                       "Passing checks do not establish that the code is correct or secure.")

    def all_findings(self) -> list[Finding]:
        out = [f for c in self.checks for f in c.findings]
        return sorted(out, key=lambda f: SEVERITY_ORDER[f.severity])

    def check(self, kind: CheckKind) -> Optional[Check]:
        return next((c for c in self.checks if c.kind == kind), None)
