"""Extended-profile engine: new analyzers, de-duplication, frozen study profile and accuracy regression."""
import json
import sys
from pathlib import Path

import pytest

from trustcode_worker.analyzers import types as types_mod
from trustcode_worker.analyzers.secrets import check_secrets
from trustcode_worker.models import CheckKind, CheckStatus, VerificationRequest
from trustcode_worker.pipeline import verify

ROOT = Path(__file__).resolve().parents[2]


def run(code, lang, **kw):
    return verify(VerificationRequest(code=code, language=lang), run_tests=False, **kw)


def rules(result, kind):
    return [f.rule_id for f in result.check(kind).findings]


# ---------- JavaScript / TypeScript static analysis ----------
@pytest.mark.parametrize("code,rule", [
    ("function f(x) { return x === NaN; }", "nan-comparison"),
    ("const n = 1;\nfunction f() { n = 2; }", "const-reassignment"),
    ("const o = { a: 1, b: 2, a: 3 };", "duplicate-object-key"),
    ("function f(x) { switch (x) { case 'a': return 1; case 'a': return 2; } }", "duplicate-case"),
    ("function f(u) { if (u.role = 'admin') { return 1; } return 0; }", "assignment-in-condition"),
    ("function f(x) { x = x; return x; }", "self-assignment"),
    ("function f() { return 1; console.log('x'); }", "unreachable-code"),
    ("function f(g) { try { g(); } catch (e) {} }", "empty-catch"),
    ("import fs from 'fs';\nexport const x = 1;", "unused-import"),
])
def test_js_rules_fire(code, rule):
    for lang in ("javascript", "typescript"):
        assert rule in rules(run(code, lang), CheckKind.LINT), (lang, rule)


@pytest.mark.parametrize("code", [
    "let m; while ((m = re.exec(s)) !== null) { out.push(m); }",                     # idiomatic loop assignment
    "function f(t) { let v; if ((v = Number(t)) || v === 0) { return v; } return null; }",  # intentional, double parentheses
    "const o = { get a() { return 1; }, set a(v) {} };",                             # getter + setter pair
    "function f() { return g(); function g() { return 1; } }",                        # hoisted declaration after return
    "function f(g) { try { g(); } catch (e) { /* ignored on purpose */ } }",          # documented empty catch
    "import React from 'react';\nexport const A = () => <div/>;",                     # classic JSX runtime
    "import type { T } from './t';\nexport function f(x: T): T { return x; }",        # type-only use (TypeScript)
    "function f() { const n = 1; return n; }\nfunction g() { let n = 2; n = 3; return n; }",  # same name, other scope
    "function f(x) { return Number.isNaN(x) || x !== x; }",
])
def test_js_rules_stay_quiet_on_valid_code(code):
    lang = "typescript" if ": T" in code else "javascript"
    r = run(code, lang)
    assert r.check(CheckKind.SYNTAX).details.get("parses"), code
    assert rules(r, CheckKind.LINT) == [], code


def test_js_lint_scope_discloses_what_is_not_checked():
    c = run("export const x = 1;", "javascript").check(CheckKind.LINT)
    assert c.status == CheckStatus.PASSED and "NOT check undefined names" in c.scope


# ---------- credential formats ----------
def test_secret_formats_detected_and_value_masked():
    token = "ghp_" + "a1B2" * 10
    c = check_secrets(f'TOKEN = "{token}"\nurl = "postgres://app:Sup3rS3cret@db:5432/x"\n')
    assert [f.rule_id for f in c.findings] == ["github-token", "credentials-in-url"]
    for f in c.findings:
        assert token not in f.code_excerpt and "Sup3rS3cret" not in f.code_excerpt and "masked" in f.code_excerpt
        assert token not in f.message


@pytest.mark.parametrize("line", [
    'KEY = "' + "AK" + "IA" + 'IOSFODNN7EXAMPLE"', "# postgres://user:password@localhost/db", 'x = "sk' + "_live_" + "x" * 24 + '"',
    'url = f"https://{user}:{password}@host/"', 'key = os.environ["STRIPE_KEY"]',
])
def test_placeholders_and_templates_are_not_reported(line):
    assert check_secrets(line + "\n").findings == []


def test_secret_scan_runs_even_when_code_does_not_parse():
    r = run('def broken(:\n  k = "ghp_' + "Zz9" * 14 + '"', "python")
    assert r.check(CheckKind.SYNTAX).status == CheckStatus.ISSUES_FOUND
    assert rules(r, CheckKind.SECRETS) == ["github-token"]


# ---------- de-duplication across analyzers ----------
def test_same_weakness_on_one_line_is_reported_once_with_both_sources():
    r = run('GITHUB_TOKEN = "ghp_' + "Qw3" * 14 + '"\n', "python")
    sec, scrt = r.check(CheckKind.SECURITY), r.check(CheckKind.SECRETS)
    assert rules(r, CheckKind.SECURITY) == ["hardcoded-secret"] and scrt.findings == []
    assert sec.findings[0].metadata["also_reported_by"] == ["trustcode-secrets:github-token"]
    # the scanner that matched is never shown as "passed", and says where its match went
    assert scrt.status == CheckStatus.ISSUES_FOUND and scrt.details["merged"][0]["into"] == "semgrep:hardcoded-secret"
    assert len({f.id for c in r.checks for f in c.findings}) == sum(len(c.findings) for c in r.checks)


# ---------- type checking ----------
def test_python_type_errors_reported_with_line():
    r = run("def f(n: int) -> str:\n    return n + 1\n", "python")
    c = r.check(CheckKind.TYPES)
    assert c.status == CheckStatus.ISSUES_FOUND and c.findings[0].rule_id == "return-value" and c.findings[0].location.line == 2


def test_missing_type_checker_is_not_run_and_listed_as_unverified(monkeypatch):
    monkeypatch.setattr(types_mod, "mypy_available", lambda: False)
    r = run("def f(n: int) -> str:\n    return n + 1\n", "python")
    assert r.check(CheckKind.TYPES).status == CheckStatus.NOT_RUN
    assert any("Type checking" in u.description for u in r.unverified)


def test_js_type_checking_is_honestly_not_run():
    r = run("export const x: number = 'a';", "typescript")
    assert r.check(CheckKind.TYPES).status == CheckStatus.NOT_RUN
    assert any("Type checking" in u.description for u in r.unverified)


def test_failed_tool_is_listed_as_unverified(monkeypatch):
    from trustcode_worker.analyzers import security
    monkeypatch.setattr(security, "semgrep_cmd", lambda: None)
    r = run("x = 1\n", "python")
    assert r.check(CheckKind.SECURITY).status == CheckStatus.CHECK_FAILED
    assert any(u.description.startswith("Security patterns") for u in r.unverified)


# ---------- execution model ----------
def test_parallel_and_sequential_stages_give_identical_evidence():
    code = "import os\ndef f(n: int) -> str:\n    try:\n        return eval(n)\n    except:\n        pass\n"
    def strip(r):
        d = r.model_dump(mode="json")
        for c in d["checks"]:
            c["duration_ms"] = None
        return d
    assert strip(run(code, "python", parallel=True)) == strip(run(code, "python", parallel=False))


def test_unknown_profile_is_rejected():
    with pytest.raises(ValueError):
        run("x = 1", "python", profile="fast")


# ---------- the study profile stays frozen (ADR-005 / ADR-008) ----------
def test_study_profile_reproduces_benchmark_snapshots():
    items = sorted((ROOT / "datasets" / "benchmark" / "items").glob("*.json"))
    assert len(items) == 20
    for path in items:
        item = json.loads(path.read_text())
        r = verify(VerificationRequest(code=item["code"], language=item["language"], task=item["task"]),
                   run_tests=False, profile="study-v1")
        snap = {c["kind"]: c for c in item["evidence_snapshot"]["checks"]}
        assert [c.kind.value for c in r.checks] == list(snap), path.name
        for kind in ("syntax", "lint", "security", "dependencies"):
            got = r.check(CheckKind(kind))
            want = snap[kind]
            assert got.status.value == want["status"], (path.name, kind)
            assert [(f.id, f.rule_id, f.severity.value, f.location.line if f.location else None) for f in got.findings] == \
                   [(f["id"], f["rule_id"], f["severity"], (f.get("location") or {}).get("line")) for f in want["findings"]], (path.name, kind)
            # The digest inside the scope text is compared separately: the committed snapshots were built
            # before the TypeScript rule update, so they carry an older digest (docs/project/known_issues.md KI-016).
            assert _no_digest(got.scope) == _no_digest(want["scope"]), (path.name, kind)


def _no_digest(text: str) -> str:
    import re
    return re.sub(r"ruleset [0-9a-f]{12}", "ruleset <digest>", text)


# ---------- accuracy regression ----------
def test_accuracy_does_not_regress_against_recorded_baseline():
    sys.path.insert(0, str(ROOT / "scripts" / "engine_eval"))
    from run_eval import evaluate
    base = json.loads((ROOT / "datasets" / "engine_eval" / "baseline.json").read_text())
    res = evaluate("extended", parallel=True, jobs=4)
    now = {c["id"]: c for c in res["cases"]}
    assert set(now) == set(base["cases"]), "case set changed: regenerate the baseline deliberately (see datasets/engine_eval/README.md)"
    assert res["overall"]["tool_failure_rate"] == 0, [(c["id"], c["failed_checks"]) for c in res["cases"] if c["failed_checks"]]
    new_fp = [c["id"] for c in res["cases"] if c["flagged"] and not c["defective"] and not base["cases"][c["id"]]["flagged"]]
    lost = [cid for cid, b in base["cases"].items() if b["detected"] and not now[cid]["detected"]]
    unflagged = [cid for cid, b in base["cases"].items() if b["flagged"] and now[cid]["defective"] and not now[cid]["flagged"]]
    assert not new_fp, f"new false positives: {new_fp}"
    assert not lost and not unflagged, f"defects no longer detected: {lost + unflagged}"
