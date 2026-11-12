"""Project security scanner: accuracy regression, scan modes, Git gates, baseline, cache, failure handling."""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from trustcode_worker.scan import engine
from trustcode_worker.scan.cli import HOOK_MARK, hooks_status, main, to_sarif, to_text
from trustcode_worker.scan.engine import mark_reviewed, scan

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "security_eval"))
import dataset  # noqa: E402
from evaluate_scanner import build, evaluate  # noqa: E402

SQLI = 'from flask import request\ndef find(conn):\n    return conn.execute("SELECT * FROM t WHERE n = \'" + request.args["n"] + "\'")\n'
CLEAN = "def add(a, b):\n    return a + b\n"


def git(repo, *args):
    return subprocess.run(["git", "-c", "user.email=t@example.com", "-c", "user.name=t", *args], cwd=repo, check=True, capture_output=True, text=True).stdout


def project(tmp_path, files, init=True):
    for rel, text in files.items():
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
    if init:
        git(tmp_path, "init", "-q")
    return tmp_path


def rules(report, path=None):
    return sorted(f["rule_id"] for f in report["findings"] if path is None or f["path"] == path)


# ---------------------------------------------------------------- accuracy
@pytest.fixture(scope="module")
def evaluation(tmp_path_factory):
    dest = tmp_path_factory.mktemp("dataset")
    build(dest)
    return evaluate(dest), dest


def test_accuracy_matches_recorded_baseline(evaluation):
    res, _ = evaluation
    base = json.loads((ROOT / "datasets" / "security_eval" / "baseline.json").read_text())
    assert res["status"] == "complete" and not res["failed_checks"]
    now = {r["id"]: r for r in res["cases"]}
    assert set(now) == set(base["cases"]), "dataset changed: regenerate the baseline deliberately"
    lost = [i for i, b in base["cases"].items() if b.get("detected") and not now[i].get("detected")]
    new_fp = [i for i, b in base["cases"].items() if not b.get("flagged") and now[i].get("flagged")]
    assert not lost, f"vulnerabilities no longer detected at the exact line: {lost}"
    assert not new_fp, f"new false positives on safe code: {new_fp}"


def test_every_finding_has_an_exact_range_and_never_contains_a_secret(evaluation):
    _, dest = evaluation
    report = scan(dest, "full", use_cache=False)
    text = json.dumps(report)
    for secret in (dataset.GH, dataset.STRIPE, dataset.AWS, dataset.SENDGRID, dataset.JWTSECRET, "Tr0ub4dor-9x!", "Vq7#pL2x9Rt4mZ"):
        assert secret not in text, "a secret value appeared in the report"
    for f in report["findings"]:
        assert f["line"] >= 1 and f["end_line"] >= f["line"] and f["col"] >= 1
        assert f["severity"] in engine.SEVERITIES and f["confidence"] in engine.CONFIDENCES and f["fingerprint"]
        if not f["file_level"] and f["end_line"] == f["line"]:
            line = (dest / f["path"]).read_text().splitlines()[f["line"] - 1]
            assert f["end_col"] - f["col"] <= len(line) + 1, "range wider than its line"
    assert len({(f["path"], f["line"], f["category"]) for f in report["findings"]}) == len(report["findings"]), "duplicate findings"
    assert "confirmed" not in {f["confidence"] for f in report["findings"]}, "a pattern or data-flow match must never be 'confirmed'"
    sarif = to_sarif(report)
    assert sarif["version"] == "2.1.0" and len(sarif["runs"][0]["results"]) == len(report["findings"])
    assert all(r["locations"][0]["physicalLocation"]["region"]["startLine"] >= 1 for r in sarif["runs"][0]["results"])


# ---------------------------------------------------------------- coverage and exclusions
def test_full_scan_covers_untracked_files_and_explains_every_exclusion(tmp_path):
    p = project(tmp_path, {"app.py": SQLI, "new_untracked.py": SQLI, "node_modules/x/i.js": "eval(x)", "dist/b.js": "eval(x)", "ignored/s.py": SQLI,
                           ".gitignore": "ignored/\n.env\n", ".env": "DB_PASSWORD=Xk29!pqLm77zQ\n", "logo.png": "x", "big.py": "x = 1\n" * 200_000, "notes.rb": "puts 1\n"})
    os.symlink(tmp_path / "app.py", tmp_path / "link.py")
    git(p, "add", "app.py", ".gitignore")
    r = scan(p, "full", use_cache=False)
    assert rules(r, "app.py") and rules(r, "new_untracked.py"), "tracked and untracked source must both be scanned"
    assert not rules(r, ".env"), "a properly ignored .env is not a commit risk"
    ex = r["files"]["excluded"]
    assert set(ex) == {"dependency directory", "build output or cache", "ignored by Git", "generated or binary file type", "larger than 512 KB", "symbolic link (not followed)"}
    assert sum(ex.values()) == 6 and r["files"]["scanned"] == r["files"]["included"]
    cov = {c["language"]: c["analysis"] for c in r["coverage"]}
    assert cov["Python"] == "language-aware" and cov["Ruby"] == "generic patterns only"


def test_scanning_works_without_git(tmp_path):
    p = project(tmp_path, {"app.py": SQLI, ".env": "DB_PASSWORD=Xk29!pqLm77zQ\n"}, init=False)
    r = scan(p, "full", use_cache=False)
    assert r["status"] == "complete" and r["files"]["git"] is False
    assert "py-taint-sql" in rules(r) or "sql-string-formatting" in rules(r)
    env = next(f for f in r["findings"] if f["rule_id"] == "TC-ENV-001")
    assert env["confidence"] == "potential" and env["file_level"]
    assert scan(p, "staged")["status"] == "failed" and scan(p, "staged")["gate"]["decision"] == "block"


# ---------------------------------------------------------------- incremental cache
def test_cache_reuses_unchanged_files_follows_renames_and_is_invalidated_by_rule_changes(tmp_path, monkeypatch):
    p = project(tmp_path, {"a.py": SQLI, "b.py": CLEAN, "c.py": SQLI})
    first = scan(p, "full")
    assert first["files"]["from_cache"] == 0
    second = scan(p, "full")
    assert second["files"]["from_cache"] == 3 and rules(second) == rules(first)
    assert [(f["path"], f["line"], f["col"]) for f in second["findings"]] == [(f["path"], f["line"], f["col"]) for f in first["findings"]]
    (p / "b.py").write_text(SQLI.replace("find", "find2"))
    os.rename(p / "c.py", p / "moved.py")
    (p / "a.py").unlink()
    third = scan(p, "full")
    assert third["files"]["from_cache"] == 1, "the renamed file is recognised by content"
    assert sorted({f["path"] for f in third["findings"]}) == ["b.py", "moved.py"], "deleted file's findings must disappear, new file's must appear"
    assert scan(p, "full", use_cache=False)["files"]["from_cache"] == 0
    monkeypatch.setattr(engine, "rules_digest", lambda: "changed-rules")
    assert scan(p, "full")["files"]["from_cache"] == 0, "a rule change must invalidate the cache"


# ---------------------------------------------------------------- baseline and review
def test_baseline_states_new_existing_resolved_reintroduced_suppressed_not_revalidated(tmp_path):
    p = project(tmp_path, {"old.py": SQLI, "other.py": SQLI.replace("find", "other"), "ok.py": CLEAN})
    assert {f["state"] for f in scan(p, "full")["findings"]} == {"unclassified"}
    assert main(["baseline", "--root", str(p), "--format", "json", "--output", str(tmp_path / "b.json")]) == 0
    r = scan(p, "full")
    assert {f["state"] for f in r["findings"]} == {"existing"} and r["baseline"]["present"]
    (p / "new.py").write_text(SQLI.replace("find", "fresh"))
    r = scan(p, "full")
    assert {f["path"]: f["state"] for f in r["findings"]} == {"old.py": "existing", "other.py": "existing", "new.py": "new"}
    assert r["summary"]["by_severity"]["critical"] == 3, "existing critical findings must stay visible"
    # resolved, then recorded, then reintroduced
    original = (p / "old.py").read_text()
    (p / "old.py").write_text(CLEAN)
    r = scan(p, "full")
    assert [x["path"] for x in r["baseline"]["resolved"]] == ["old.py"]
    main(["baseline", "--root", str(p), "--format", "json", "--output", str(tmp_path / "b.json")])
    (p / "old.py").write_text(original)
    assert {f["path"]: f["state"] for f in scan(p, "full")["findings"]}["old.py"] == "reintroduced"
    # a partial scan cannot say anything about files it did not look at
    r = scan(p, "changed", paths=["ok.py"])
    assert sorted(x["path"] for x in r["baseline"]["not_revalidated"]) == ["new.py", "other.py"] and r["baseline"]["resolved"] == []
    # review: only the exact finding is suppressed, with an audit record
    full = scan(p, "full")
    target = next(f for f in full["findings"] if f["path"] == "other.py")
    with pytest.raises(ValueError):
        mark_reviewed(p, target["fingerprint"], "  ", "me")
    entry = mark_reviewed(p, target["fingerprint"], "internal admin tool, input is a constant", "reviewer")
    assert entry["reviewed_by"] == "reviewer" and entry["reviewed_at"]
    after = scan(p, "full")
    states = {f["path"]: f["state"] for f in after["findings"]}
    assert states["other.py"] == "suppressed" and states["new.py"] != "suppressed" and after["baseline"]["suppressed"] == 1
    assert after["summary"]["total"] == len(after["findings"]) - 1
    (p / "other.py").write_text((p / "other.py").read_text().replace('"SELECT *', '"SELECT id,'))
    assert {f["path"]: f["state"] for f in scan(p, "full")["findings"]}["other.py"] != "suppressed", "a changed line must be reported again"


# ---------------------------------------------------------------- git gates
def test_pre_commit_scans_the_staged_content_not_the_working_tree(tmp_path):
    p = project(tmp_path, {"ok.py": CLEAN})
    git(p, "add", "-A"); git(p, "commit", "-q", "-m", "init")
    (p / "api.py").write_text(SQLI)
    git(p, "add", "api.py")
    (p / "api.py").write_text(CLEAN)                      # fixed in the working tree, but the vulnerable version is staged
    (p / "unstaged.py").write_text(SQLI)                  # not staged: not part of this commit
    r = scan(p, "staged")
    assert sorted({f["path"] for f in r["findings"]}) == ["api.py"]
    assert r["gate"]["decision"] == "block" and r["gate"]["blocking"]
    assert main(["--root", str(p), "--mode", "staged", "--format", "json", "--output", str(tmp_path / "o.json")]) == 1
    git(p, "add", "api.py")                               # stage the fixed version
    assert scan(p, "staged")["gate"]["decision"] == "allow"
    assert "not a statement that the project is secure" in " ".join(scan(p, "staged")["gate"]["reasons"])


def test_hooks_install_preserve_existing_detect_and_actually_block_a_commit(tmp_path):
    p = project(tmp_path, {"ok.py": CLEAN})
    assert all(h["state"] == "not installed" for h in hooks_status(p)["hooks"].values())
    pre_push = p / ".git" / "hooks" / "pre-push"
    pre_push.write_text("#!/bin/sh\necho mine\n")
    assert main(["hooks", "install", "--root", str(p)]) == 3, "an existing hook must be reported, not replaced"
    assert pre_push.read_text() == "#!/bin/sh\necho mine\n"
    st = hooks_status(p)["hooks"]
    assert st["pre-commit"]["state"] == "installed" and st["pre-push"]["state"].startswith("another hook exists")
    assert HOOK_MARK in (p / ".git" / "hooks" / "pre-commit").read_text()
    env = {**os.environ, "PATH": f"{Path(sys.executable).parent}{os.pathsep}{os.environ['PATH']}", "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com",
           "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com"}
    (p / "api.py").write_text(SQLI)
    git(p, "add", "-A")
    blocked = subprocess.run(["git", "commit", "-q", "-m", "add api"], cwd=p, env=env, capture_output=True, text=True)
    assert blocked.returncode != 0 and "TrustCode BLOCKED this commit" in blocked.stderr, blocked.stderr
    assert subprocess.run(["git", "rev-parse", "--verify", "-q", "HEAD"], cwd=p, capture_output=True).returncode != 0, "the blocked commit must not exist"
    (p / "api.py").write_text(CLEAN)
    git(p, "add", "-A")
    ok = subprocess.run(["git", "commit", "-q", "-m", "add api"], cwd=p, env=env, capture_output=True, text=True)
    assert ok.returncode == 0, ok.stderr
    # the scanner missing from PATH is announced, never silent
    no_scanner = {**env, "PATH": "/usr/bin:/bin"}
    (p / "x.py").write_text(CLEAN); git(p, "add", "-A")
    skipped = subprocess.run(["git", "commit", "-q", "-m", "x"], cwd=p, env=no_scanner, capture_output=True, text=True)
    assert skipped.returncode == 0 and "security check was SKIPPED" in skipped.stderr
    (p / "y.py").write_text(CLEAN); git(p, "add", "-A")
    required = subprocess.run(["git", "commit", "-q", "-m", "y"], cwd=p, env={**no_scanner, "TRUSTCODE_REQUIRE_SCANNER": "1"}, capture_output=True, text=True)
    assert required.returncode != 0


def test_pre_push_checks_outgoing_commits_and_reports_commits_that_skipped_the_hook(tmp_path):
    remote = tmp_path / "remote.git"
    subprocess.run(["git", "init", "-q", "--bare", str(remote)], check=True)
    p = project(tmp_path / "work", {"ok.py": CLEAN})
    git(p, "add", "-A"); git(p, "commit", "-q", "-m", "init")
    git(p, "remote", "add", "origin", str(remote)); git(p, "push", "-q", "-u", "origin", "HEAD")
    (p / "api.py").write_text(SQLI)
    git(p, "add", "-A"); git(p, "commit", "-q", "--no-verify", "-m", "bypassed")       # the commit gate never saw this
    r = scan(p, "push")
    assert sorted({f["path"] for f in r["findings"]}) == ["api.py"] and r["gate"]["decision"] == "block"
    assert any("were not checked when they were made" in n for n in r["notes"])
    assert main(["--root", str(p), "--mode", "push", "--format", "json", "--output", str(tmp_path / "o.json")]) == 1


def test_policy_is_configurable_and_potential_findings_never_block(tmp_path):
    p = project(tmp_path, {"cfg.py": 'JWT_SECRET = "f3a9c1e7b5d2486a9c0e1f2a3b4c5d6e"\n', "h.py": "import random\n\ndef token():\n    return random.random()\n"})
    git(p, "add", "-A")
    r = scan(p, "staged")
    assert r["findings"] and all(f["confidence"] == "potential" for f in r["findings"]) and r["gate"]["decision"] == "allow"
    (p / "api.py").write_text('import requests\nfrom flask import request\ndef f():\n    return requests.get(request.args["u"]).text\n')   # high, strongly suspected
    git(p, "add", "-A")
    assert scan(p, "staged")["gate"]["decision"] == "allow", "default commit policy blocks critical only"
    (p / ".trustcode").mkdir(exist_ok=True)
    (p / ".trustcode" / "config.json").write_text(json.dumps({"block": {"commit": "high"}, "disabled_rules": ["TC-SEC-004"]}))
    r = scan(p, "staged")
    assert r["gate"]["decision"] == "allow", "SSRF is a CI-level rule: it warns at commit time and blocks in CI"
    assert scan(p, "ci")["gate"]["decision"] == "block"
    assert "TC-SEC-004" not in rules(scan(p, "full", use_cache=False))


# ---------------------------------------------------------------- failures are never clean results
def test_missing_scanner_is_an_incomplete_scan_and_blocks_production(tmp_path, monkeypatch):
    p = project(tmp_path, {"app.py": SQLI, "k.py": 'T = "gh' + 'p_' + 'Zx9Kq2LmN8vB4tR7yW1cE5uA3sD6fG0hJ2kLmN"\n'})
    monkeypatch.setattr(engine, "semgrep_cmd", lambda: None)
    r = scan(p, "production")
    assert r["status"] == "incomplete"
    sast = next(c for c in r["checks"] if c["id"] == "sast")
    assert sast["status"] == "failed" and "Semgrep is not installed" in sast["detail"]
    assert rules(r) == ["TC-SEC-001"], "built-in rules still run"
    assert r["gate"]["decision"] == "block" and any("incomplete" in x for x in r["gate"]["reasons"])
    assert "did NOT run" in next(c for c in r["coverage"] if c["language"] == "Python")["analysis"]
    text = to_text(r, markdown=True)
    for needle in ("NOT complete", "Findings by severity", "Checks", "[failed]", "Coverage", "Excluded files", "Gate decision", "BLOCK"):
        assert needle in text, needle
    assert "secure" not in text.lower().replace("not a statement that the project is secure", "")
    tool = next(t for t in r["tools"] if t["name"] == "semgrep")
    assert tool["installed"] is False and "pip install" in tool["detail"]
    assert (tmp_path / ".trustcode" / "cache.json").exists() is False or "app.py" not in json.loads((tmp_path / ".trustcode" / "cache.json").read_text())["files"]


def test_unreadable_scanner_output_is_a_failed_check(tmp_path, monkeypatch):
    p = project(tmp_path, {"app.py": SQLI})
    monkeypatch.setattr(engine, "semgrep_cmd", lambda: [sys.executable, "-c", "print('not json')", "--"])
    r = scan(p, "full", use_cache=False)
    assert r["status"] == "incomplete" and next(c for c in r["checks"] if c["id"] == "sast")["status"] == "failed"


def test_dependency_advisories_are_opt_in_and_confirmed_only_on_an_exact_version(tmp_path, monkeypatch):
    p = project(tmp_path, {"requirements.txt": "flask==0.12\nrequests>=2\n"})
    real_which = engine.shutil.which
    monkeypatch.setattr(engine.shutil, "which", lambda name, *a, **k: None if name == "osv-scanner" else real_which(name, *a, **k))   # this test covers the built-in lookup
    calls = []

    def fake(req, timeout=0):
        calls.append(json.loads(req.data))
        class R:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return json.dumps({"results": [{"vulns": [{"id": "GHSA-xxxx"}, {"id": "PYSEC-1"}]}]}).encode()
        return R()
    monkeypatch.setattr(engine.urllib.request, "urlopen", fake)
    off = scan(p, "full", use_cache=False)
    assert calls == [] and next(c for c in off["checks"] if c["id"] == "dependencies")["status"] == "skipped"
    on = scan(p, "full", use_cache=False, online=True)
    assert calls[0]["queries"] == [{"package": {"ecosystem": "PyPI", "name": "flask"}, "version": "0.12"}], "only pinned names and versions are sent"
    f = next(x for x in on["findings"] if x["rule_id"] == "TC-DEP-004")
    assert f["confidence"] == "confirmed" and f["line"] == 1 and "GHSA-xxxx" in f["reason"]
    monkeypatch.setattr(engine.urllib.request, "urlopen", lambda *a, **k: (_ for _ in ()).throw(OSError("offline")))
    down = scan(p, "full", use_cache=False, online=True)
    assert down["status"] == "incomplete" and next(c for c in down["checks"] if c["id"] == "dependencies")["status"] == "failed"


def test_large_project_scan_time_and_incremental_rescan(tmp_path):
    import time
    files = {f"pkg{i % 40}/mod_{i}.py": f"def f{i}(x):\n    return x + {i}\n" for i in range(2000)}
    files["pkg0/bad.py"] = SQLI
    p = project(tmp_path, files)
    t0 = time.monotonic(); first = scan(p, "full"); cold = time.monotonic() - t0
    (p / "pkg1" / "mod_1.py").write_text(SQLI.replace("find", "changed"))
    t0 = time.monotonic(); second = scan(p, "full"); warm = time.monotonic() - t0
    assert first["files"]["scanned"] == 2001 and second["files"]["from_cache"] == 2000
    assert sorted({f["path"] for f in second["findings"]}) == ["pkg0/bad.py", "pkg1/mod_1.py"]
    print(f"\n    2001 files: cold scan {cold:.1f} s, rescan after one change {warm:.1f} s")
    assert cold < 300 and warm < cold


def test_git_history_scan_is_opt_in_and_finds_a_removed_credential_without_printing_it(tmp_path):
    token = "gh" + "p_" + "Hh7Kq2LmN8vB4tR7yW1cE5uA3sD6fG0hJ2kLmQ"
    p = project(tmp_path, {"cfg.py": f'TOKEN = "{token}"\n'})
    git(p, "add", "-A"); git(p, "commit", "-q", "-m", "add config")
    (p / "cfg.py").write_text('import os\nTOKEN = os.environ["TOKEN"]\n')
    git(p, "add", "-A"); git(p, "commit", "-q", "-m", "use env")
    plain = scan(p, "full", use_cache=False)
    assert plain["findings"] == [] and next(c for c in plain["checks"] if c["id"] == "history")["status"] == "skipped"
    deep = scan(p, "full", use_cache=False, history=True)
    f = next(x for x in deep["findings"] if x["rule_id"] == "TC-SEC-006")
    assert f["path"] == "cfg.py" and f["file_level"] and f["evidence"].startswith("commit ") and token not in json.dumps(deep)
    assert next(c for c in deep["checks"] if c["id"] == "history")["status"] == "completed"


def test_new_files_mode_scans_only_untracked_files(tmp_path):
    p = project(tmp_path / "repo", {"old.py": SQLI})
    git(p, "add", "-A"); git(p, "commit", "-q", "-m", "init")
    (p / "fresh.py").write_text(SQLI.replace("find", "fresh"))
    r = scan(p, "new")
    assert sorted({f["path"] for f in r["findings"]}) == ["fresh.py"] and r["gate"]["decision"] == "not_applicable"
    assert scan(project(tmp_path / "plain", {"a.py": SQLI}, init=False), "new")["status"] == "failed"


def test_bandit_is_detected_merged_without_duplicates_and_its_failure_is_reported(tmp_path, monkeypatch):
    p = project(tmp_path, {"a.py": "import pickle\nimport subprocess\n\ndef f(b, cmd):\n    subprocess.call(cmd, shell=True)\n    return pickle.loads(b)\n"})
    r = scan(p, "full", use_cache=False)
    tool = next(t for t in r["tools"] if t["name"] == "bandit")
    assert tool["installed"] and tool["status"] == "ready" and next(c for c in r["checks"] if c["id"] == "bandit")["status"] == "completed"
    assert len({(f["line"], f["category"]) for f in r["findings"]}) == len(r["findings"]), "the same problem reported twice by two scanners"
    assert any(any(s.startswith("bandit:") for s in [f["source"], *f["also_reported_by"]]) for f in r["findings"]), "Bandit contributed nothing"
    monkeypatch.setattr(engine, "bandit_available", lambda: None)
    without = scan(p, "full", use_cache=False)
    assert without["status"] == "complete" and not any(c["id"] == "bandit" for c in without["checks"])
    assert next(t for t in without["tools"] if t["name"] == "bandit")["status"].startswith("not installed")


def test_kubernetes_iam_and_config_command(tmp_path, capsys):
    p = project(tmp_path, {"k.yaml": "apiVersion: v1\nkind: Pod\nspec:\n  hostNetwork: true\n", "notk8s.yaml": "settings:\n  privileged: true\n",
                           "policy.json": '{"Statement": [{"Action": "*",\n "Resource": "*"}]}\n'})
    r = scan(p, "full", use_cache=False)
    assert rules(r) == ["TC-IAM-001", "TC-K8S-001"] and rules(r, "notk8s.yaml") == []
    assert main(["config", "--root", str(p)]) == 0
    assert json.loads(capsys.readouterr().out)["block"]["production"] == "high"


def test_file_names_that_look_like_options_are_scanned_as_files(tmp_path):
    evil = tmp_path / "evil.yml"
    evil.write_text("rules: []\n")
    p = project(tmp_path / "repo", {"--config=../evil.yml.py": SQLI, "-rf.py": SQLI.replace("find", "other"), "ok.py": CLEAN})
    r = scan(p, "full", use_cache=False)
    assert r["status"] == "complete", [c for c in r["checks"] if c["status"] == "failed"]
    assert sorted({f["path"] for f in r["findings"]}) == ["--config=../evil.yml.py", "-rf.py"], "a dash-prefixed file was skipped or treated as an option"
    assert next(c for c in r["checks"] if c["id"] == "bandit")["status"] == "completed"


def test_weakened_controls_are_detected_from_the_change_itself(tmp_path):
    p = project(tmp_path / "repo", {
        "app/views.py": "@app.route('/reports')\n@login_required\ndef reports():\n    return data()\n",
        "app/api.py": "@app.route('/items')\n@login_required\ndef items():\n    return data()\n",
        "tests/test_views.py": "def test_reports():\n    assert reports()\n",
        "tests/test_old.py": "def test_old():\n    assert True\n",
        ".gitignore": ".env\n*.pem\nnode_modules/\n",
        ".github/workflows/ci.yml": "on: push\njobs:\n  scan:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: github/codeql-action/analyze@v3\n      - run: npm test\n"})
    git(p, "add", "-A"); git(p, "commit", "-q", "-m", "init")
    assert not [f for f in scan(p, "full", use_cache=False)["findings"] if f["category"] == "regression"], "nothing changed yet"
    (p / "app/views.py").write_text("@app.route('/reports')\ndef reports():\n    return data()\n")                               # guard removed
    (p / "app/api.py").write_text("@app.route('/items')\n@jwt_required\ndef items():\n    return data()\n")                   # guard replaced: fine
    (p / "tests/test_views.py").write_text("import pytest\n@pytest.mark.skip\ndef test_reports():\n    assert reports()\n")   # test disabled
    (p / "tests/test_old.py").unlink()                                                                                      # test deleted
    (p / ".gitignore").write_text("*.pem\nnode_modules/\n")                                                                 # .env no longer ignored
    (p / ".github/workflows/ci.yml").write_text("on: push\njobs:\n  scan:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n")
    r = scan(p, "full", use_cache=False)
    got = sorted((f["rule_id"], f["path"]) for f in r["findings"] if f["category"] == "regression")
    assert got == [("TC-REG-001", "app/views.py"), ("TC-REG-003", "tests/test_old.py"), ("TC-REG-003", "tests/test_views.py"),
                   ("TC-REG-005", ".gitignore"), ("TC-REG-008", ".github/workflows/ci.yml")], got
    guard = next(f for f in r["findings"] if f["rule_id"] == "TC-REG-001")
    assert "login_required" in guard["evidence"] and guard["line"] >= 1
    assert next(c for c in r["checks"] if c["id"] == "regressions")["status"] == "completed"
    git(p, "add", "app/views.py")
    staged = scan(p, "staged")
    assert [f["rule_id"] for f in staged["findings"] if f["category"] == "regression"] == ["TC-REG-001"]
    assert staged["gate"]["decision"] == "allow", "the default commit policy blocks critical findings only"
    (p / ".trustcode").mkdir(exist_ok=True)
    (p / ".trustcode" / "config.json").write_text(json.dumps({"block": {"commit": "high"}}))
    assert scan(p, "staged")["gate"]["decision"] == "block"
    assert next(c for c in scan(project(tmp_path / "plain", {"a.py": CLEAN}, init=False), "full")["checks"] if c["id"] == "regressions")["status"] == "skipped"


def test_disabled_rules_are_listed_in_the_report_and_progress_goes_to_stderr_only(tmp_path, monkeypatch, capsys):
    p = project(tmp_path / "repo", {"a.py": SQLI, "c.py": 'API = "http://api.partner-site.com/v1"\n'})
    (p / ".trustcode").mkdir()
    (p / ".trustcode" / "config.json").write_text(json.dumps({"disabled_rules": ["TC-NET-001"]}))
    monkeypatch.setenv("TRUSTCODE_PROGRESS", "1")
    r = scan(p, "full", use_cache=False)
    assert r["disabled_rules"] == ["TC-NET-001"] and "TC-NET-001" not in rules(r) and rules(r, "a.py")
    err = capsys.readouterr().err
    assert "TRUSTCODE_PROGRESS " in err and json.loads(err.strip().splitlines()[0].split(" ", 1)[1])["message"]
    json.dumps(r)   # the report itself stays valid JSON, with no progress text in it


def test_scanned_project_cannot_hijack_the_scanners_or_leak_secrets_through_evidence(tmp_path):
    marker = tmp_path / "hijacked"
    p = project(tmp_path / "repo", {"bandit.py": f"open({str(marker)!r}, 'w').write('x')\n", "semgrep.py": f"open({str(marker)!r}, 'w').write('x')\n",
                                    "a.py": "import pickle\ndef f(b):\n    return pickle.loads(b)\n",
                                    "s.py": 'password = "Zq8Lm2Xv9Rt4KpW7"\n'})
    r = scan(p, "full", use_cache=False)
    assert not marker.exists(), "a file in the scanned project was executed by a scanner"
    assert next(c for c in r["checks"] if c["id"] == "bandit")["status"] == "completed"
    assert any(f["path"] == "a.py" for f in r["findings"])
    assert "Zq8Lm2Xv9Rt4KpW7" not in json.dumps(r), "a secret reached the report through copied evidence"


def test_policy_file_changes_are_reported_and_cannot_be_disabled_or_reviewed_away(tmp_path):
    p = project(tmp_path / "repo", {"a.py": SQLI})
    git(p, "add", "-A"); git(p, "commit", "-q", "-m", "init")
    git(p, "checkout", "-q", "-b", "feature")
    (p / ".trustcode").mkdir()
    (p / ".trustcode" / "config.json").write_text(json.dumps({"disabled_rules": ["py-taint-sql", "sql-string-formatting", "TC-REG-009"], "block": {"ci": "critical"}}))
    git(p, "add", "-f", ".trustcode/config.json"); git(p, "commit", "-q", "-m", "quietly switch the gate off")
    r = scan(p, "ci", base="master" if "master" in git(p, "branch") else "main")
    f = next(x for x in r["findings"] if x["rule_id"] == "TC-REG-009")
    assert f["path"] == ".trustcode/config.json" and f["state"] != "suppressed"
    (p / ".trustcode" / "config.json").write_text(json.dumps({"block": {"ci": "high"}}))
    git(p, "add", "-f", ".trustcode/config.json"); git(p, "commit", "-q", "-m", "policy")
    base = "master" if "master" in git(p, "branch") else "main"
    assert scan(p, "ci", base=base)["gate"]["decision"] == "block"
    ok = scan(p, "ci", base=base, allow_policy_change=True)
    assert not any(x["rule_id"] == "TC-REG-009" for x in ok["findings"]) and any("--allow-policy-change" in n for n in ok["notes"])


def test_gitleaks_and_osv_scanner_are_optional_isolated_and_reported(tmp_path, monkeypatch):
    import shutil as sh
    token = "gh" + "p_" + "Ww3Kq2LmN8vB4tR7yW1cE5uA3sD6fG0hJ2kLmZ"
    p = project(tmp_path / "repo", {"k.py": f'TOKEN = "{token}"\n', "ok.py": 'API_KEY = "your_api_key_here"\n',
                                    ".gitleaks.toml": "[allowlist]\npaths = ['.*']\n", ".gitleaksignore": "k.py:github-pat:1\n"})
    r = scan(p, "full", use_cache=False)
    assert {"gitleaks", "osv-scanner", "bandit", "semgrep"} <= {t["name"] for t in r["tools"]}
    if sh.which("gitleaks"):
        f = next(x for x in r["findings"] if x["path"] == "k.py")
        assert any(s.startswith("gitleaks:") for s in [f["source"], *f["also_reported_by"]]), "a project-supplied allowlist silenced Gitleaks"
        assert next(c for c in r["checks"] if c["id"] == "gitleaks")["status"] == "completed" and token not in json.dumps(r)
    assert not [x for x in r["findings"] if x["path"] == "ok.py"], "a placeholder was reported"
    assert len([x for x in r["findings"] if x["path"] == "k.py" and x["category"] == "secrets"]) == 1, "the same secret listed twice by two scanners"
    real_which = sh.which
    monkeypatch.setattr(engine.shutil, "which", lambda name, *a, **k: None if name in ("gitleaks", "osv-scanner") else real_which(name, *a, **k))
    without = scan(p, "full", use_cache=False)
    assert without["status"] == "complete" and [x["rule_id"] for x in without["findings"] if x["path"] == "k.py"] == ["TC-SEC-001"]
    assert next(t for t in without["tools"] if t["name"] == "gitleaks")["status"].startswith("not installed")


def test_build_output_is_checked_in_production_scans_and_monorepo_packages_are_summarised(tmp_path):
    key = "sk" + "_live_" + "7aB8cD7eF6gH5iJ4kL3mN2oQ"
    p = project(tmp_path / "repo", {"apps/web/package.json": '{"name": "web"}', "apps/web/src/a.js": "export const a = 1;\n",
                                    "apps/api/pyproject.toml": "[project]\nname = 'api'\n", "apps/api/app.py": SQLI,
                                    "apps/web/dist/bundle.js": f'var k="{key}";\n'})
    full = scan(p, "full", use_cache=False)
    assert not [f for f in full["findings"] if f["rule_id"] == "TC-SEC-007"] and next(c for c in full["checks"] if c["id"] == "artifacts")["status"] == "skipped"
    prod = scan(p, "production")
    f = next(x for x in prod["findings"] if x["rule_id"] == "TC-SEC-007")
    assert f["path"] == "apps/web/dist/bundle.js" and key not in json.dumps(prod)
    pk = {x["root"]: x for x in prod["packages"]}
    assert set(pk) == {".", "apps/api", "apps/web"} and pk["apps/api"]["critical"] == 1 and pk["apps/web"]["findings"] >= 1
    assert "Packages" in to_text(prod)
    assert scan(project(tmp_path / "single", {"package.json": "{}", "a.js": "export const a = 1;\n"}), "full", use_cache=False)["packages"] == []


def test_evidence_from_external_scanners_never_contains_the_secret(tmp_path):
    secret = "f3a9c1e7b5d2486a9c0e1f2a3b4c5d6e7f8091a2"
    p = project(tmp_path / "repo", {".env.production": f"JWT_SECRET={secret}\nexport API_TOKEN={secret}\n", "Dockerfile": f"FROM alpine\nENV APP_SECRET={secret}\nUSER app\n"})
    r = scan(p, "full", use_cache=False)
    assert r["findings"], "nothing was reported"
    assert secret not in json.dumps(r) and secret[:12] not in json.dumps(r)
    assert engine.patterns.redact(f"JWT_SECRET={secret}") == "JWT_SECRET=f3a9…[masked]"
    assert engine.patterns.redact("PORT=3000") == "PORT=3000"
