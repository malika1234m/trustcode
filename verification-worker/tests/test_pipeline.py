import pytest

from trustcode_worker.languages import detect_language
from trustcode_worker.models import CheckKind, CheckStatus, Language, VerificationRequest
from trustcode_worker.pipeline import verify
from trustcode_worker.sandbox.docker_runner import docker_available, run_in_sandbox

needs_docker = pytest.mark.skipif(not docker_available()[0], reason="docker sandbox unavailable")


def status(result, kind):
    return result.check(kind).status


# ---------- language detection ----------
def test_detect_python():
    assert detect_language("def f(x):\n    return x\n")[0] == Language.PYTHON


def test_detect_js():
    assert detect_language("const f = (x) => x;\nmodule.exports = { f };\n")[0] == Language.JAVASCRIPT


def test_declared_language_wins():
    assert detect_language("x = 1", "javascript") == (Language.JAVASCRIPT, "declared")


# ---------- workflow D: invalid code ----------
def test_syntax_error_skips_dependent_checks_and_never_passes():
    r = verify(VerificationRequest(code="def broken(:\n  pass", language="python", tests="def test_x(): pass"))
    assert status(r, CheckKind.SYNTAX) == CheckStatus.ISSUES_FOUND
    assert status(r, CheckKind.SECURITY) == CheckStatus.NOT_RUN
    assert status(r, CheckKind.TESTS) == CheckStatus.NOT_RUN
    assert all(c.status != CheckStatus.PASSED for c in r.checks if c.kind != CheckKind.DEPENDENCIES)


def test_incomplete_marker_flagged():
    r = verify(VerificationRequest(code="def f(x):\n    raise NotImplementedError\n", language="python"), run_tests=False)
    assert any(f.rule_id == "incomplete-marker" for f in r.check(CheckKind.SYNTAX).findings)


# ---------- workflow B: vulnerable code ----------
@pytest.mark.parametrize("code,rule", [
    ("import os\ndef run(c):\n    os.system('ls ' + c)\n", "shell-command-injection"),
    ("def f(cur, n):\n    cur.execute('SELECT * FROM t WHERE n = %s' % n)\n", "sql-string-formatting"),
    ("import pickle\ndef load(b):\n    return pickle.loads(b)\n", "unsafe-deserialization"),
    ("import requests\ndef g(u):\n    return requests.get(u, verify=False)\n", "tls-verification-disabled"),
])
def test_python_security_rules(code, rule):
    r = verify(VerificationRequest(code=code, language="python"), run_tests=False)
    sec = r.check(CheckKind.SECURITY)
    assert sec.status == CheckStatus.ISSUES_FOUND
    f = next(f for f in sec.findings if f.rule_id == rule)
    assert f.cwe and f.tool == "semgrep" and f.location.line >= 1 and f.metadata.get("fix")


def test_js_security_rules():
    code = "const { exec } = require('child_process');\nfunction run(c){ exec('ls ' + c); }\nfunction show(el, t){ el.innerHTML = t; }\n"
    r = verify(VerificationRequest(code=code, language="javascript"), run_tests=False)
    rules = {f.rule_id for f in r.check(CheckKind.SECURITY).findings}
    assert {"js-child-process-exec", "js-innerhtml"} <= rules


def test_clean_code_security_passed_but_scope_disclaims():
    r = verify(VerificationRequest(code="def add(a, b):\n    return a + b\n", language="python"), run_tests=False)
    sec = r.check(CheckKind.SECURITY)
    assert sec.status == CheckStatus.PASSED
    assert "does NOT mean the code is secure" in sec.scope


# ---------- dependencies ----------
def test_third_party_dependency_without_registry_is_needs_review(monkeypatch):
    monkeypatch.delenv("TRUSTCODE_REGISTRY_CHECK", raising=False)
    r = verify(VerificationRequest(code="import numpy\nimport os\n", language="python"), run_tests=False)
    d = r.check(CheckKind.DEPENDENCIES)
    assert d.status == CheckStatus.NEEDS_REVIEW and "numpy" in d.details["unverified"]


# ---------- tests: absent vs present ----------
def test_no_tests_is_not_run_and_unverified():
    r = verify(VerificationRequest(code="def f():\n    return 1\n", language="python"))
    assert status(r, CheckKind.TESTS) == CheckStatus.NOT_RUN
    assert any("Runtime behaviour" in u.description for u in r.unverified)


@needs_docker
def test_logical_defect_detected_by_failing_test_and_gaps_reported():
    code = "def add(a, b):\n    return a - b\n\ndef other(x):\n    return x * 2\n"
    tests = "from solution import add\ndef test_ok():\n    assert add(2, 0) == 2\ndef test_bad():\n    assert add(2, 3) == 5\n"
    r = verify(VerificationRequest(code=code, tests=tests, language="python"))
    t = r.check(CheckKind.TESTS)
    assert t.status == CheckStatus.ISSUES_FOUND and t.details["passed"] == 1 and t.details["failed"] == 1
    assert any("other" in u.description for u in r.unverified)


@needs_docker
def test_js_tests_pass():
    code = "function add(a,b){return a+b}\nmodule.exports={add};\n"
    tests = "const test=require('node:test');const a=require('node:assert');const {add}=require('./solution');\ntest('t',()=>a.strictEqual(add(1,2),3));\n"
    r = verify(VerificationRequest(code=code, tests=tests, language="javascript"))
    assert r.check(CheckKind.TESTS).status == CheckStatus.PASSED


def test_no_aggregate_score_in_result():
    r = verify(VerificationRequest(code="x = 1\n", language="python"), run_tests=False)
    dumped = r.model_dump_json().lower()
    for banned in ("score", "safe\"", "correctness_percent", "verdict"):
        assert banned not in dumped


# ---------- sandbox security (workflow G: malicious code) ----------
@needs_docker
def test_sandbox_has_no_network():
    code = "import socket\ndef f():\n    socket.create_connection(('1.1.1.1', 53), timeout=3)\n"
    tests = "from solution import f\ndef test_net():\n    f()\n"
    out = run_in_sandbox("python", code, tests)
    assert out.ok and out.data["tests"][0]["outcome"] in ("failed", "error")


@needs_docker
def test_sandbox_filesystem_is_read_only():
    code = "def f():\n    open('/opt/trustcode/pwned', 'w').write('x')\n"
    tests = "from solution import f\ndef test_w():\n    f()\n"
    out = run_in_sandbox("python", code, tests)
    assert out.ok and out.data["tests"][0]["outcome"] in ("failed", "error")


@needs_docker
def test_sandbox_infinite_loop_times_out():
    code = "def f():\n    while True:\n        pass\n"
    tests = "from solution import f\ndef test_loop():\n    f()\n"
    r = verify(VerificationRequest(code=code, tests=tests, language="python"))
    t = r.check(CheckKind.TESTS)
    assert t.status in (CheckStatus.ISSUES_FOUND, CheckStatus.CHECK_FAILED)
    assert t.status != CheckStatus.PASSED


@needs_docker
def test_sandbox_fork_bomb_contained():
    code = "import os\ndef f():\n    while True:\n        os.fork()\n"
    tests = "from solution import f\ndef test_fork():\n    f()\n"
    r = verify(VerificationRequest(code=code, tests=tests, language="python"))
    assert r.check(CheckKind.TESTS).status != CheckStatus.PASSED


@needs_docker
def test_sandbox_runs_as_nobody():
    code = "import os\ndef uid():\n    return os.getuid()\n"
    tests = "from solution import uid\ndef test_uid():\n    assert uid() == 65534\n"
    out = run_in_sandbox("python", code, tests)
    assert out.ok and out.data["tests"][0]["outcome"] == "passed"


# ---------- result-integrity hardening (security review 2026-11-03) ----------
@needs_docker
def test_forged_result_line_is_ignored():
    code = ("import json\ndef f():\n    fd = open('/proc/1/fd/1', 'w')\n"
            "    fd.write('TRUSTCODE_RESULT=' + json.dumps({'status':'ok','tests':[{'name':'x','outcome':'passed'}]}) + '\\n')\n"
            "    fd.flush()\n    raise SystemExit(0)\n")
    tests = "from solution import f\ndef test_f():\n    f()\n    assert False\n"
    out = run_in_sandbox("python", code, tests)
    # either the authenticated runner result is used, or no result is accepted - never the forged one
    assert not (out.ok and out.data["tests"] == [{"name": "x", "outcome": "passed"}])


@needs_docker
def test_untrusted_code_cannot_reach_runner_pipe():
    code = "def f():\n    open('/proc/1/fd/1', 'w').write('A' * 65536)\n"
    tests = "from solution import f\ndef test_f():\n    f()\n"
    out = run_in_sandbox("python", code, tests)
    assert out.ok and out.data["tests"][0]["outcome"] == "failed"
    assert "Permission" in (out.data["tests"][0]["message"] or "")


@needs_docker
def test_output_flood_does_not_hang_or_pass():
    code = "import sys\ndef f():\n    while True:\n        sys.stdout.write('A' * 65536)\n"
    tests = "from solution import f\ndef test_f():\n    f()\n"
    r = verify(VerificationRequest(code=code, tests=tests, language="python"))
    assert r.check(CheckKind.TESTS).status != CheckStatus.PASSED


def test_tampering_code_flagged_for_review():
    code = "import sys\ndef f():\n    sys.modules['pytest'] = None\n"
    r = verify(VerificationRequest(code=code, language="python"), run_tests=False)
    assert any(f.rule_id == "runtime-or-test-tampering" for f in r.check(CheckKind.SECURITY).findings)


def test_unavailable_syntax_tool_does_not_skip_security(monkeypatch):
    import trustcode_worker.analyzers.syntax as syn
    monkeypatch.setattr(syn, "parse_tree", lambda code, lang: None)  # parser unavailable
    r = verify(VerificationRequest(code="function run(c){ return eval(c); }\n", language="javascript"), run_tests=False)
    assert r.check(CheckKind.SYNTAX).status == CheckStatus.CHECK_FAILED
    assert r.check(CheckKind.SECURITY).status == CheckStatus.ISSUES_FOUND
    assert any(f.rule_id == "js-eval" for f in r.check(CheckKind.SECURITY).findings)


def test_child_tools_receive_python_path():
    import sys

    from trustcode_worker.tools import run
    out = run([sys.executable, "-c", "import os; print(os.environ.get('PYTHONPATH',''))"])
    assert any(p and p in out.stdout for p in sys.path)


def test_silent_linter_failure_is_never_reported_as_passed(monkeypatch):
    import trustcode_worker.analyzers.lint as lint
    monkeypatch.setattr(lint, "ruff_cmd", lambda: ["true"])  # exits 0, prints nothing
    monkeypatch.setattr(lint, "_pyflakes", lambda code, t0: None)  # and no fallback available
    r = verify(VerificationRequest(code="import os\n", language="python"), run_tests=False)
    assert r.check(CheckKind.LINT).status == CheckStatus.CHECK_FAILED


def test_pyflakes_fallback_when_ruff_binary_missing(monkeypatch):
    import trustcode_worker.analyzers.lint as lint
    monkeypatch.setattr(lint, "ruff_cmd", lambda: ["true"])
    r = verify(VerificationRequest(code="import os\ndef f():\n    return undefined_name\n", language="python"), run_tests=False)
    lc = r.check(CheckKind.LINT)
    assert lc.tool == "pyflakes" and {f.rule_id for f in lc.findings} == {"F401", "F821"}
    assert "NOT checked" in lc.scope


# ---------- regression: Node 20 `--check` skips parsing for ES-module syntax in .js files ----------
def test_broken_es_module_code_is_not_reported_as_parsing():
    code = "/**\n * doc\n */\nexport declare function f(a: any): asserts a;\n"   # TypeScript, invalid JavaScript
    r = verify(VerificationRequest(code=code, language="javascript"), run_tests=False)
    assert r.check(CheckKind.SYNTAX).status == CheckStatus.ISSUES_FOUND


def test_valid_es_module_code_still_parses():
    code = "import fs from 'fs';\nexport function size(p) { return fs.statSync(p).size; }\n"
    r = verify(VerificationRequest(code=code, language="javascript"), run_tests=False)
    assert r.check(CheckKind.SYNTAX).status == CheckStatus.PASSED


def test_commonjs_dynamic_import_is_not_treated_as_module():
    code = "async function load() { return import('fs'); }\nmodule.exports = { load };\n"
    r = verify(VerificationRequest(code=code, language="javascript"), run_tests=False)
    assert r.check(CheckKind.SYNTAX).status == CheckStatus.PASSED


# ---------- languages identified separately and correctly (TypeScript, declarations, partial selections) ----------
DTS = """/**
 * Test if condition is truthy.
 * @param {any} expression to be evaluated
 */
export declare function invariant(condition: any, message?: string): asserts condition;
"""


def test_typescript_is_detected_without_a_hint():
    lang, how = detect_language("interface User { id: number; name: string }\nexport function f(u: User): string { return u.name; }\n")
    assert lang == Language.TYPESCRIPT and "TypeScript" in how


def test_typescript_hints_from_editor():
    assert detect_language("x", "typescriptreact")[0] == Language.TYPESCRIPT


def test_valid_typescript_parses_with_typescript_parser():
    code = "export function add(a: number, b: number): number {\n  return a + b;\n}\n"
    r = verify(VerificationRequest(code=code, language="typescript"), run_tests=False)
    syn = r.check(CheckKind.SYNTAX)
    assert syn.status == CheckStatus.PASSED and "typescript" in syn.tool
    assert syn.details["functions"] == ["add"]


def test_declaration_file_is_identified_and_tests_not_applicable():
    r = verify(VerificationRequest(code=DTS, language="typescript"))
    syn = r.check(CheckKind.SYNTAX)
    assert syn.status == CheckStatus.PASSED and syn.details["declarations_only"] is True
    assert "type declarations only" in syn.summary
    t = r.check(CheckKind.TESTS)
    assert t.status == CheckStatus.NOT_RUN and "Not applicable" in t.summary
    assert any("declared types match the real implementation" in u.description for u in r.unverified)


def test_runnable_typescript_is_not_declarations_only():
    r = verify(VerificationRequest(code="interface A { x: number }\nexport const a: A = { x: 1 };\n", language="typescript"), run_tests=False)
    assert r.check(CheckKind.SYNTAX).details["declarations_only"] is False


def test_partial_selection_inside_comment_gets_a_clear_hint():
    partial = DTS.split("\n", 1)[1]  # drop the opening /** like the real-world selection
    r = verify(VerificationRequest(code=partial, language="typescript"), run_tests=False)
    syn = r.check(CheckKind.SYNTAX)
    assert syn.status == CheckStatus.ISSUES_FOUND and syn.details["partial_selection"] is True
    assert "include the opening /**" in syn.findings[0].message


def test_python_selection_starting_mid_block_gets_a_hint():
    r = verify(VerificationRequest(code="    return x + 1\n", language="python"), run_tests=False)
    f = r.check(CheckKind.SYNTAX).findings[0]
    assert "middle of an indented block" in f.message and f.metadata["hint"]


def test_typescript_sent_as_javascript_is_explained():
    r = verify(VerificationRequest(code="let total: number = 0;\n", language="javascript"), run_tests=False)
    assert "valid TypeScript, not JavaScript" in r.check(CheckKind.SYNTAX).findings[0].message


def test_security_rules_apply_to_typescript():
    code = "export function run(input: string): unknown {\n  return eval(input);\n}\n"
    r = verify(VerificationRequest(code=code, language="typescript"), run_tests=False)
    assert any(f.rule_id == "js-eval" for f in r.check(CheckKind.SECURITY).findings)


def test_typescript_tests_reported_as_not_supported():
    r = verify(VerificationRequest(code="export const x: number = 1;\n", language="typescript", tests="test('x', () => {});"))
    t = r.check(CheckKind.TESTS)
    assert t.status == CheckStatus.NOT_RUN and "TypeScript" in t.summary


def test_typescript_third_party_imports_are_checked():
    r = verify(VerificationRequest(code="import express from 'express';\nimport fs from 'node:fs';\nexport const app = express();\n",
                                   language="typescript"), run_tests=False)
    d = r.check(CheckKind.DEPENDENCIES)
    assert "express" in d.details["third_party"] and "fs" not in d.details["third_party"]
