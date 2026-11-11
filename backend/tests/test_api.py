import pytest

from app.adaptation.engine import decide
from app.explanations.engine import build_explanation
from app.explanations.llm import LlmExplanation, LlmFindingText, validate
from app.explanations.templates import LEVELS, explain_finding
from conftest import wait_done
from trustcode_worker.sandbox.docker_runner import docker_available

needs_docker = pytest.mark.skipif(not docker_available()[0], reason="docker sandbox unavailable")
V = "/api/v1"
VULN = "import sqlite3\ndef find(conn, name):\n    return conn.execute(f\"SELECT * FROM u WHERE n = '{name}'\").fetchall()\n"


# ---------------- auth ----------------
def test_register_login_refresh_rotation(client):
    r = client.post(f"{V}/auth/register", json={"email": "A@Uni.example", "password": "correct-horse-1"})
    assert r.status_code == 201
    r = client.post(f"{V}/auth/login", json={"email": "a@uni.example", "password": "correct-horse-1"})
    assert r.status_code == 200
    rt = r.json()["refresh_token"]
    r2 = client.post(f"{V}/auth/refresh", json={"refresh_token": rt})
    assert r2.status_code == 200
    assert client.post(f"{V}/auth/refresh", json={"refresh_token": rt}).status_code == 401  # single use


def test_wrong_password_and_invalid_token(client):
    client.post(f"{V}/auth/register", json={"email": "b@uni.example", "password": "correct-horse-1"})
    r = client.post(f"{V}/auth/login", json={"email": "b@uni.example", "password": "wrong-password"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "unauthorized"
    assert client.get(f"{V}/profile", headers={"Authorization": "Bearer garbage"}).status_code == 401
    assert client.get(f"{V}/profile").status_code == 401


def test_weak_password_rejected(client):
    assert client.post(f"{V}/auth/register", json={"email": "c@uni.example", "password": "short"}).status_code == 422


def test_local_mode_disabled_by_default(client):
    assert client.post(f"{V}/auth/local").status_code == 404


# ---------------- validation / privacy ----------------
def test_consent_required(client, auth):
    r = client.post(f"{V}/verifications", headers=auth, json={"code": "x = 1", "client_consent": False})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"


def test_validation_error_does_not_echo_code(client, auth):
    secret = "SUPER_SECRET_SOURCE_" * 4000
    r = client.post(f"{V}/verifications", headers=auth, json={"code": secret, "client_consent": True})
    assert r.status_code == 422 and "SUPER_SECRET_SOURCE_" not in r.text


def test_other_users_cannot_see_job(client, auth):
    j = client.post(f"{V}/verifications", headers=auth, json={"code": "x = 1\n", "language": "python", "client_consent": True}).json()
    r = client.post(f"{V}/auth/register", json={"email": "intruder@uni.example", "password": "correct-horse-1"})
    other = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get(f"{V}/verifications/{j['id']}", headers=other).status_code == 404


def test_code_purged_after_analysis(client, auth):
    from app.db import SessionLocal
    from app.models import VerificationJob
    j = client.post(f"{V}/verifications", headers=auth, json={"code": VULN, "language": "python", "client_consent": True}).json()
    wait_done(client, auth, j["id"])
    db = SessionLocal()
    row = db.get(VerificationJob, j["id"])
    assert row.code is None and row.tests is None and len(row.code_sha256) == 64
    db.close()


# ---------------- workflows ----------------
def test_workflow_b_vulnerable_code(client, auth):
    j = client.post(f"{V}/verifications", headers=auth, json={"code": VULN, "language": "python", "client_consent": True}).json()
    done = wait_done(client, auth, j["id"])
    assert done["status"] == "done"
    sec = next(c for c in done["result"]["checks"] if c["kind"] == "security")
    assert sec["status"] == "issues_found" and sec["findings"][0]["cwe"] == ["CWE-89"]
    ex = client.get(f"{V}/verifications/{j['id']}/explanation", headers=auth).json()
    assert ex["level"] == "intermediate" and ex["findings"][0]["finding_id"] == "SEC-1"


def test_workflow_d_invalid_code(client, auth):
    j = client.post(f"{V}/verifications", headers=auth, json={"code": "def f(:\n", "language": "python", "client_consent": True}).json()
    done = wait_done(client, auth, j["id"])
    statuses = {c["kind"]: c["status"] for c in done["result"]["checks"]}
    assert statuses["syntax"] == "issues_found" and statuses["security"] == "not_run" and "passed" not in (statuses["lint"], statuses["security"])


@needs_docker
def test_workflow_c_logical_defect(client, auth):
    code = "def is_even(n):\n    return n % 2 == 1\n"
    tests = "from solution import is_even\ndef test_two():\n    assert is_even(2)\n"
    j = client.post(f"{V}/verifications", headers=auth, json={"code": code, "tests": tests, "client_consent": True}).json()
    done = wait_done(client, auth, j["id"])
    t = next(c for c in done["result"]["checks"] if c["kind"] == "tests")
    assert t["status"] == "issues_found" and t["details"]["failed"] == 1


def test_workflow_f_decision_and_feedback(client, auth):
    j = client.post(f"{V}/verifications", headers=auth, json={"code": "x = 1\n", "client_consent": True}).json()
    wait_done(client, auth, j["id"])
    r = client.post(f"{V}/verifications/{j['id']}/decision", headers=auth, json={"decision": "reject", "confidence": 80})
    assert r.status_code == 201 and "never modifies" in r.json()["note"]
    assert client.post(f"{V}/verifications/{j['id']}/decision", headers=auth, json={"decision": "maybe"}).status_code == 422
    assert client.post(f"{V}/feedback", headers=auth, json={"job_id": j["id"], "rating": "too_technical"}).status_code == 201


def test_cancel_and_history_pagination(client, auth):
    ids = [client.post(f"{V}/verifications", headers=auth, json={"code": f"x = {i}\n", "client_consent": True}).json()["id"] for i in range(3)]
    for i in ids:
        wait_done(client, auth, i)
    page = client.get(f"{V}/verifications?limit=2", headers=auth).json()
    assert len(page["items"]) == 2 and page["next_cursor"]
    page2 = client.get(f"{V}/verifications?limit=2&cursor={page['next_cursor']}", headers=auth).json()
    assert {x["id"] for x in page2["items"]}.isdisjoint({x["id"] for x in page["items"]})
    assert client.post(f"{V}/verifications/{ids[0]}/cancel", headers=auth).status_code == 200


def test_explanation_before_done_is_conflict(client, auth):
    from app.db import SessionLocal
    from app.models import VerificationJob
    db = SessionLocal()
    me = client.get(f"{V}/verifications?limit=1", headers=auth)
    j = VerificationJob(user_id=_uid(client, auth), code="x", code_sha256="0" * 64, status="queued")
    db.add(j)
    db.commit()
    assert client.get(f"{V}/verifications/{j.id}/explanation", headers=auth).status_code == 409
    db.close()
    assert me.status_code == 200


def _uid(client, auth):
    from app.security import decode_token
    return decode_token(auth["Authorization"].split()[1])["sub"]


# ---------------- workflow E: adaptive explanations keep evidence invariant ----------------
def _sample_result():
    return {"checks": [
        {"kind": "security", "status": "issues_found", "summary": "1", "scope": "Semgrep. Limited.", "tool": "semgrep",
         "findings": [{"id": "SEC-1", "check": "security", "tool": "semgrep", "rule_id": "sql-string-formatting",
                       "title": "SQL injection risk", "message": "SQL query built with string formatting.", "severity": "high",
                       "status": "issue_detected", "location": {"line": 3}, "code_excerpt": "conn.execute(f'...')",
                       "cwe": ["CWE-89"], "owasp": [], "metadata": {"why_beginner": "b", "why": "t", "fix": "use params"}}]},
        {"kind": "tests", "status": "issues_found", "summary": "1 failed", "scope": "Tests. Limited.", "tool": "pytest",
         "findings": [{"id": "TEST-1", "check": "tests", "tool": "pytest", "rule_id": "test-failed", "title": "Test failed: t",
                       "message": "assert 1 == 2", "severity": "high", "status": "issue_detected", "location": None,
                       "cwe": [], "owasp": [], "metadata": {}}]}],
        "unverified": [{"id": "U-1", "description": "Function g never executed", "reason": "0 lines ran", "location": None}],
        "disclaimer": "d"}


def test_levels_change_wording_not_evidence():
    res = _sample_result()
    views = {lvl: build_explanation(res, decide(lvl, 2, [], False)) for lvl in LEVELS}
    ids = {lvl: [f["finding_id"] for f in v["findings"]] for lvl, v in views.items()}
    ev = {lvl: [f["evidence"] for f in v["findings"]] for lvl, v in views.items()}
    st = {lvl: [c["status"] for c in v["checks"]] for lvl, v in views.items()}
    assert ids["beginner"] == ids["intermediate"] == ids["advanced"]
    assert ev["beginner"] == ev["intermediate"] == ev["advanced"]
    assert st["beginner"] == st["intermediate"] == st["advanced"]
    assert views["beginner"]["findings"][0]["why"] != views["advanced"]["findings"][0]["why"]
    assert len(views["beginner"]["unverified"]) == len(views["advanced"]["unverified"]) == 1


def test_explanations_never_claim_safety():
    import re
    res = _sample_result()
    for lvl in LEVELS:
        txt = str(build_explanation(res, decide(lvl, 2, [], False))).lower()
        assert not re.search(r"\b(is|are) (safe|secure|correct)\b", txt)


def test_explain_finding_has_seven_fields():
    item = explain_finding(_sample_result()["checks"][0]["findings"][0], "beginner")
    for k in ("what", "where", "method", "why", "evidence", "could_not_verify", "next_step"):
        assert item[k]


# ---------------- LLM grounding validator (no network) ----------------
def test_llm_validator_drops_unknown_ids_and_absolute_claims():
    res = _sample_result()
    templates = build_explanation(res, decide("intermediate", 2, [], False))["findings"]
    llm = LlmExplanation(findings=[
        LlmFindingText(finding_id="SEC-1", what="SQL injection", why="This code is safe after all", next_step="none"),
        LlmFindingText(finding_id="SEC-99", what="invented", why="invented", next_step="x"),
        LlmFindingText(finding_id="TEST-1", what="Test fails", why="Output differs from expectation", next_step="Fix logic"),
    ])
    items, notes = validate(llm, templates)
    assert [i["finding_id"] for i in items] == ["SEC-1", "TEST-1"]
    assert items[0]["source"] == "template" and items[1]["source"] == "llm"
    assert items[1]["evidence"] == "assert 1 == 2"  # evidence untouched
    assert any("SEC-99" in n for n in notes) and any("absolute" in n for n in notes)


# ---------------- adaptation ----------------
def test_adaptation_suggests_but_never_switches():
    d = decide("intermediate", 3, ["too_technical"] * 4, True)
    assert d.level == "intermediate" and d.suggestion["to"] == "beginner"
    assert decide("intermediate", 3, ["too_technical"] * 4, False).suggestion is None
    assert decide("beginner", 12, [], False).collapse_low_severity


# ---------------- rate limiting ----------------
def test_rate_limit(client):
    from app.deps import limiter
    limiter.reset()
    codes = [limiter_check(i) for i in range(4)]
    assert codes[-1] == 429


def limiter_check(i):
    from fastapi import HTTPException

    from app.deps import limiter
    try:
        limiter.check("unit", 3)
        return 200
    except HTTPException as e:
        return e.status_code


def test_health(client):
    r = client.get(f"{V}/health")
    assert r.status_code == 200 and r.json()["database"] is True and "X-Request-ID" in r.headers


def test_researcher_only_endpoints(client, auth):
    assert client.post(f"{V}/experiments/sessions", headers=auth, json={}).status_code == 403
    assert client.get(f"{V}/experiments/export.csv", headers=auth).status_code == 403


def test_delete_my_data(client):
    r = client.post(f"{V}/auth/register", json={"email": "erase@uni.example", "password": "correct-horse-1"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.delete(f"{V}/me/data", headers=h).status_code == 204
    assert client.get(f"{V}/profile", headers=h).status_code == 401


def test_unknown_routes_and_methods_use_standard_error_format(client):
    r = client.get("/api/v1/nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found" and r.json()["error"]["request_id"]
    r = client.delete("/api/v1/health")
    assert r.status_code == 405 and r.json()["error"]["code"] == "method_not_allowed"


def test_feedback_teaches_the_system_about_false_alarms_without_hiding_evidence(client, auth):
    """Marking a rule wrong twice: later findings from that rule carry a note and are collapsed only below high severity."""
    code = "import random\n\ndef pick(xs):\n    return random.choice(xs)\n"   # non-security use: the insecure-random rule is a false alarm here
    client.patch(f"{V}/profile", headers=auth, json={"adaptive_suggestions": True})

    def verify_once():
        j = client.post(f"{V}/verifications", headers=auth, json={"code": code, "language": "python", "client_consent": True}).json()
        wait_done(client, auth, j["id"])
        view = client.get(f"{V}/verifications/{j['id']}/explanation", headers=auth).json()
        return j["id"], next(f for f in view["findings"] if "random" in f["what"].lower() or "random" in f["evidence"].lower()), view

    job1, f1, v1 = verify_once()
    assert "your_feedback" not in f1 and v1["learned_from_feedback"] == []
    for job in (job1, verify_once()[0]):
        assert client.post(f"{V}/feedback", headers=auth, json={"job_id": job, "finding_id": f1["finding_id"], "rating": "incorrect"}).status_code == 201
    _, f3, v3 = verify_once()
    assert f3["your_feedback"]["marked_wrong"] == 2 and f3["collapsed"] is True
    assert f3["evidence"] == f1["evidence"] and f3["severity"] == f1["severity"]      # evidence and severity untouched
    assert len(v3["findings"]) == len(v1["findings"])                                   # nothing is hidden
    assert v3["learned_from_feedback"] == [f3["your_feedback"]["rule"]]
    # opting out switches the behaviour off again
    client.patch(f"{V}/profile", headers=auth, json={"adaptive_suggestions": False})
    assert "your_feedback" not in verify_once()[1]


def test_learning_never_collapses_high_severity_findings():
    from app.adaptation.engine import AdaptationDecision, rule_history
    from app.explanations.engine import build_explanation
    finding = {"id": "SEC-1", "check": "security", "tool": "semgrep", "rule_id": "sql-string-formatting", "title": "SQL injection risk",
               "message": "m", "severity": "high", "status": "issue_detected", "location": {"line": 1}, "cwe": [], "metadata": {}}
    result = {"checks": [{"kind": "security", "status": "issues_found", "summary": "s", "scope": "sc", "tool": "semgrep", "findings": [finding]}]}
    hist = rule_history([("semgrep:sql-string-formatting", "incorrect")] * 3 + [("ruff:F401", "incorrect"), ("x:y", "helpful")])
    assert list(hist) == ["semgrep:sql-string-formatting"]          # one "wrong" is not a pattern
    item = build_explanation(result, AdaptationDecision(level="intermediate"), rule_feedback=hist)["findings"][0]
    assert item["your_feedback"]["marked_wrong"] == 3 and not item.get("collapsed")
    assert rule_history([("r", "incorrect"), ("r", "incorrect"), ("r", "helpful"), ("r", "helpful")]) == {}


def test_explanations_cover_the_extended_checks():
    from app.explanations.templates import explain_finding
    base = {"status": "issue_detected", "location": {"line": 2}, "cwe": [], "severity": "medium", "code_excerpt": "x"}
    cases = [{"id": "TYPE-1", "check": "types", "tool": "mypy", "rule_id": "return-value", "title": "Incompatible return value type", "message": "m", "metadata": {}},
             {"id": "SCRT-1", "check": "secrets", "tool": "trustcode-secrets", "rule_id": "github-token", "title": "GitHub token", "message": "m",
              "metadata": {"why": "W", "why_beginner": "WB", "fix": "FIX", "also_reported_by": ["semgrep:hardcoded-secret"]}},
             {"id": "LINT-1", "check": "lint", "tool": "trustcode-jslint", "rule_id": "nan-comparison", "title": "Comparison with NaN is always false", "message": "m", "metadata": {}}]
    for f in cases:
        for level in ("beginner", "intermediate", "advanced"):
            item = explain_finding({**base, **f}, level)
            assert item["why"] and item["next_step"] and item["could_not_verify"] and item["evidence"] == "m"
            assert "ruff" not in item["method"] or f["tool"] == "ruff"
    assert explain_finding({**base, **cases[1]}, "beginner")["also_reported_by"] == ["semgrep:hardcoded-secret"]
    assert "NaN never equals" in explain_finding({**base, **cases[2]}, "beginner")["why"]


# ---------------------------------------------------------------- multi-file (session) verification
SESSION_FILES = [
    {"path": "app/models.py", "change": "created", "content": "class User:\n    pass\n"},
    {"path": "app/auth.py", "change": "modified", "baseline": "import os\ndef run(c):\n    return os.system('ls ' + c)\n",
     "content": "from .models import User, Token\nimport os\ndef run(c):\n    return os.system('ls ' + c)\ndef calc(e):\n    return eval(e)\n"},
    {"path": "app/old.py", "change": "deleted"},
]


def test_session_verification_end_to_end(client, auth):
    body = {"files": SESSION_FILES, "workspace_paths": ["app/models.py", "app/auth.py"], "depth": "standard",
            "label": "auth feature", "client_consent": True}
    j = client.post(f"{V}/session-verifications", headers=auth, json=body)
    assert j.status_code == 202, j.text
    done = wait_done(client, auth, j.json()["id"])
    assert done["language"] == "session" and done["result"]["kind"] == "session"
    report = client.get(f"{V}/verifications/{done['id']}/session-report?level=beginner", headers=auth).json()
    found = {x["rule_id"]: x for f in report["files"] for x in f["findings"]}
    assert found["eval-exec-use"]["introduced"] == "new" and found["shell-command-injection"]["introduced"] == "preexisting"
    missing = found["imported-name-not-defined"]
    assert missing["path"] == "app/auth.py" and "does not contain" in missing["explained"]["why"]
    assert missing["explained"]["evidence"] == missing["message"] and "cross-file" in missing["explained"]["method"]
    assert any(n["check"] == "Project tests" for n in report["not_executed"])
    # the single-snippet explanation endpoint refuses multi-file jobs instead of mis-rendering them, and vice versa
    assert client.get(f"{V}/verifications/{done['id']}/explanation", headers=auth).status_code == 409
    # source is purged after analysis; feedback can still name the rule
    assert client.post(f"{V}/feedback", headers=auth, json={"job_id": done["id"], "finding_id": missing["id"], "rating": "incorrect"}).status_code == 201
    listed = client.get(f"{V}/verifications?limit=5", headers=auth).json()["items"][0]
    assert listed["language"] == "session" and listed["code_lines"] == 8


def test_session_verification_validation(client, auth):
    ok = {"files": [{"path": "a.py", "content": "x = 1\n"}], "client_consent": True}
    assert client.post(f"{V}/session-verifications", json=ok).status_code == 401
    assert client.post(f"{V}/session-verifications", headers=auth, json={**ok, "client_consent": False}).status_code == 422
    for bad in ("/etc/passwd", "../secret.py", "C:\\x.py", "a/../../b.py"):
        r = client.post(f"{V}/session-verifications", headers=auth, json={**ok, "files": [{"path": bad, "content": "x=1"}]})
        assert r.status_code == 422, bad
    dup = {**ok, "files": [{"path": "a.py", "content": "x=1"}, {"path": "a.py", "content": "y=2"}]}
    assert client.post(f"{V}/session-verifications", headers=auth, json=dup).status_code == 422
    big = {**ok, "files": [{"path": f"f{i}.py", "content": "x = 1\n" * 8000} for i in range(10)]}
    r = client.post(f"{V}/session-verifications", headers=auth, json=big)
    assert r.status_code == 413 and "fewer files" in r.text
    assert client.post(f"{V}/session-verifications", headers=auth, json={**ok, "files": []}).status_code == 422
    j = client.post(f"{V}/session-verifications", headers=auth, json=ok).json()
    wait_done(client, auth, j["id"])
    assert client.get(f"{V}/verifications/{j['id']}/session-report?level=expert", headers=auth).status_code == 422
