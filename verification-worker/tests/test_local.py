"""The local engine entry point: one JSON request in, one JSON answer out, same reports as the server."""
import io
import json
import subprocess
import sys

import pytest

from trustcode_worker import local

CODE = "import os\n\ndef run(cmd):\n    return eval(cmd)\n"


def ask(req):
    code, out = local.handle(req)
    return code, out


def test_verify_returns_result_and_view_for_the_same_findings():
    code, out = ask({"op": "verify", "code": CODE, "language": "python"})
    assert code == 0 and out["ok"] is True and out["protocol"] == local.PROTOCOL
    found = [f["id"] for c in out["result"]["checks"] for f in c["findings"]]
    assert found, "eval() and the unused import must be reported"
    assert sorted(found) == sorted(i["finding_id"] for i in out["view"]["findings"])
    assert out["view"]["level"] == "intermediate"
    assert out["view"]["llm"] == {"used": False}


def test_tests_are_not_run_unless_asked_and_never_reported_as_passed():
    _, out = ask({"op": "verify", "code": "def f():\n    return 1\n", "language": "python", "tests": "from solution import f\ndef test_f():\n    assert f() == 1\n"})
    tests = next(c for c in out["result"]["checks"] if c["kind"] == "tests")
    assert tests["status"] == "not_run"


def test_registry_lookup_is_off_by_default(monkeypatch):
    import trustcode_worker.analyzers.dependencies as deps
    monkeypatch.setenv("TRUSTCODE_REGISTRY_CHECK", "1")  # an operator variable must not switch lookups on for a local request
    monkeypatch.setattr(deps, "_registry_exists", lambda *a: pytest.fail("network lookup attempted"))
    _, out = ask({"op": "verify", "code": "import requests\nprint(requests)\n", "language": "python"})
    assert out["ok"]
    d = next(c for c in out["result"]["checks"] if c["kind"] == "dependencies")
    assert d["status"] != "passed"


def test_explain_applies_level_and_own_feedback_without_changing_evidence():
    _, first = ask({"op": "verify", "code": CODE, "language": "python"})
    rule = next(f"{f['tool']}:{f['rule_id']}" for c in first["result"]["checks"] for f in c["findings"])
    code, out = ask({"op": "explain", "result": first["result"], "level": "beginner", "rule_ratings": [[rule, "incorrect"], [rule, "incorrect"]]})
    assert code == 0 and out["view"]["level"] == "beginner"
    assert rule in out["view"]["learned_from_feedback"]
    assert len(out["view"]["findings"]) == len(first["view"]["findings"])  # still reported
    _, off = ask({"op": "explain", "result": first["result"], "suggestions": False, "rule_ratings": [[rule, "incorrect"], [rule, "incorrect"]]})
    assert off["view"]["learned_from_feedback"] == []


def test_session_reports_cross_file_problem_with_explanations():
    req = {"files": [{"path": "app/main.py", "change": "modified", "content": "from app.util import missing_name\nprint(missing_name)\n"},
                     {"path": "app/util.py", "change": "context", "content": "def present():\n    return 1\n"}],
           "workspace_paths": ["app/main.py", "app/util.py"], "depth": "standard"}
    code, out = ask({"op": "session", "request": req, "level": "advanced"})
    assert code == 0 and out["report"]["kind"] == "session" and out["report"]["level"] == "advanced"
    items = [x for f in out["report"]["files"] for x in f["findings"]]
    assert items and all("explained" in x for x in items)
    assert any(x.get("metadata", {}).get("cross_file") for x in items)


@pytest.mark.parametrize("req", [None, [], {}, {"op": "nope"}, {"op": "verify"}, {"op": "verify", "code": "   "}, {"op": "verify", "code": "x=1", "profile": "other"},
                                 {"op": "explain", "result": {}}, {"op": "session", "request": {"files": []}}, {"op": "session"}])
def test_bad_requests_fail_and_are_never_a_result(req):
    code, out = ask(req)
    assert code == 2 and out["ok"] is False and "result" not in out and "report" not in out and out["error"]


def test_crash_is_reported_as_failure(monkeypatch):
    monkeypatch.setitem(local.OPS, "verify", lambda r: 1 / 0)
    code, out = ask({"op": "verify", "code": "x = 1"})
    assert code == 2 and out["ok"] is False and "ZeroDivisionError" in out["error"]


def test_stdout_carries_exactly_one_json_line_even_if_a_tool_prints(monkeypatch, capsys):
    def noisy(_):
        print("tool chatter")
        return {"x": 1}
    monkeypatch.setitem(local.OPS, "doctor", noisy)
    monkeypatch.setattr(sys, "stdin", type("S", (), {"buffer": io.BytesIO(b'{"op":"doctor"}')})())
    assert local.main([]) == 0
    out = capsys.readouterr().out.strip().splitlines()
    assert len(out) == 1 and json.loads(out[0]) == {"ok": True, "protocol": 1, "x": 1}


def test_runs_isolated_from_a_neutral_directory(tmp_path):
    (tmp_path / "trustcode_worker.py").write_text("raise SystemExit('workspace module was imported')\n")
    (tmp_path / "json.py").write_text("raise SystemExit('workspace module was imported')\n")
    r = subprocess.run([sys.executable, "-I", "-m", "trustcode_worker.local"], input=json.dumps({"op": "doctor"}), capture_output=True, text=True,
                       cwd=tmp_path, timeout=120)
    out = json.loads(r.stdout.strip().splitlines()[-1])
    assert r.returncode == 0 and out["ok"] and "ruff" in out["tools"] and isinstance(out["missing"], list)
