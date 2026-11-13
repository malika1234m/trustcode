"""Multi-file (session) verification: per-file checks, cross-file checks, attribution and honest gaps."""
import pytest

from trustcode_worker.project import SessionFile, SessionRequest, verify_session


def F(path, content=None, change="modified", **kw):
    return SessionFile(path=path, content=content, change=change, **kw)


def run(files, paths=None, depth="standard"):
    return verify_session(SessionRequest(files=files, workspace_paths=paths if paths is not None else
                                         [f.path for f in files if f.change != "deleted"], depth=depth))


def findings(report, rule=None):
    out = [f for file in report["files"] for f in file["findings"]]
    return [f for f in out if f["rule_id"] == rule] if rule else out


MODELS = "class User:\n    def __init__(self, name):\n        self.name = name\n"
AUTH = ("from .models import User, Session\nfrom .tokens import make_token\nimport hashlib\n\n"
        "def login(conn, name, password):\n"
        "    row = conn.execute(f\"SELECT * FROM users WHERE name = '{name}'\").fetchone()\n"
        "    return User(name) if row else None\n")


def test_backend_change_set_reports_per_file_and_cross_file_problems():
    r = run([F("app/models.py", MODELS, "created"), F("app/auth.py", AUTH, "created"), F("app/legacy_tokens.py", None, "deleted")],
            paths=["app/models.py", "app/auth.py", "app/__init__.py"])
    assert r["kind"] == "session" and r["summary"]["files_changed"] == 3
    assert [f["rule_id"] for f in findings(r, "sql-string-formatting")] == ["sql-string-formatting"]
    missing_name = findings(r, "imported-name-not-defined")
    assert len(missing_name) == 1 and "Session" in missing_name[0]["title"] and missing_name[0]["path"] == "app/auth.py"
    assert missing_name[0]["location"]["line"] == 1
    assert [f["message"] for f in findings(r, "import-not-found")] and "tokens" in findings(r, "import-not-found")[0]["message"]
    ids = [f["id"] for f in findings(r)]
    assert len(ids) == len(set(ids)), "finding ids must be unique across files"
    assert all(f["introduced"] == "new" for f in findings(r) if f["path"] == "app/auth.py" and not f["metadata"].get("cross_file"))
    deleted = next(f for f in r["files"] if f["path"] == "app/legacy_tokens.py")
    assert deleted["analysed"] is False and "deleted" in deleted["reason"]


def test_import_of_a_file_deleted_or_renamed_in_the_same_change():
    r = run([F("src/api.ts", "import { helper } from './util';\nexport const x = helper();\n"), F("src/util.ts", None, "deleted")],
            paths=["src/api.ts"])
    assert [f["rule_id"] for f in findings(r)] == ["import-of-deleted-file"]
    r = run([F("src/api.ts", "import { helper } from './util';\nexport const x = helper();\n"),
             F("src/helpers.ts", "export function helper() { return 1; }\n", "renamed", renamed_from="src/util.ts")],
            paths=["src/api.ts", "src/helpers.ts"])
    assert [f["rule_id"] for f in findings(r)] == ["import-of-deleted-file"]


def test_frontend_and_backend_together_named_and_default_exports():
    service = "export async function fetchUser(id) { return fetch('/api/users/' + id); }\nexport const API = '/api';\n"
    comp = ("import api, { fetchUser, deleteUser } from './service';\nimport { API as Base } from './service.js';\n"
            "import React from 'react';\nexport const Profile = () => fetchUser(1) && api && Base && deleteUser && React;\n")
    r = run([F("web/service.js", service, "created"), F("web/Profile.jsx", comp, "created"),
             F("web/package.json", '{"dependencies": {"left-pad": "1.0.0"}}', "context")])
    rules = sorted(f["rule_id"] for f in findings(r))
    assert rules == ["default-import-without-default-export", "imported-name-not-exported", "undeclared-dependency"]
    assert "deleteUser" in findings(r, "imported-name-not-exported")[0]["title"]
    assert "react" in findings(r, "undeclared-dependency")[0]["title"]


@pytest.mark.parametrize("target", [
    "module.exports = { a: 1 };\n",                     # CommonJS: dynamic
    "export * from './other';\nexport const b = 1;\n",   # re-export everything
])
def test_names_are_not_guessed_when_exports_are_not_statically_knowable(target):
    r = run([F("a.js", "import { a } from './b';\nexport const z = a;\n"), F("b.js", target), F("other.js", "export const a = 1;\n", "context")])
    assert findings(r) == []
    imports = next(c for c in r["project_checks"] if c["kind"] == "imports")
    assert imports["details"]["names_not_checkable"] >= 1 and "export dynamically" in imports["scope"]


def test_python_valid_patterns_are_not_reported():
    pkg_init = "from .models import User\n__all__ = ['User']\n"
    use = ("from app import User\nfrom app.models import User as U\nfrom . import models\nimport app.models\nimport os\n"
           "def f():\n    return User('a'), U('b'), models, app.models, os\n")
    r = run([F("app/__init__.py", pkg_init), F("app/models.py", MODELS), F("app/use.py", use)])
    assert [f for f in findings(r) if f["tool"] == "trustcode-imports"] == []
    deps = next(c for f in r["files"] if f["path"] == "app/use.py" for c in f["checks"] if c["kind"] == "dependencies")
    assert deps["status"] == "passed", "local packages must not be reported as third-party"


def test_attribution_separates_new_from_preexisting_findings():
    before = "import os\ndef run(cmd):\n    return os.system('ls ' + cmd)\n"
    after = before + "def calc(expr):\n    return eval(expr)\n"
    r = run([F("tools.py", after, baseline=before)])
    by_rule = {f["rule_id"]: f["introduced"] for f in findings(r)}
    assert by_rule == {"shell-command-injection": "preexisting", "eval-exec-use": "new"}
    assert r["summary"]["new"] == 1 and r["summary"]["preexisting"] == 1
    unknown = run([F("tools.py", after)])
    assert {f["introduced"] for f in findings(unknown)} == {"unknown"}, "without a baseline the origin must not be guessed"


def test_config_dependency_and_migration_files():
    r = run([F("package.json", '{"dependencies": {"express": "4.0.0",}}'),
             F("config/settings.toml", 'name = "x"\n[db]\nurl = "postgres://admin:Sup3rS3cretPw@db.internal/prod"\n'),
             F("migrations/0002_add_users.sql", "CREATE TABLE users (id INT);\n", "created"),
             F("docs/README.md", "# Title\n", "created")])
    pkg = next(f for f in r["files"] if f["path"] == "package.json")
    assert pkg["findings"][0]["rule_id"] == "syntax-error" and pkg["findings"][0]["severity"] == "critical"
    assert [f["rule_id"] for f in next(f for f in r["files"] if f["path"].endswith(".toml"))["findings"]] == ["credentials-in-url"]
    sql = next(f for f in r["files"] if f["path"].endswith(".sql"))
    assert "No code analyzer" in sql["reason"] and "credential formats" in sql["reason"]
    assert any(n["check"] == "Database schema consistency" for n in r["not_executed"])
    assert any(n["check"] == "Project tests" for n in r["not_executed"])


def test_depth_levels_never_report_skipped_checks_as_passed():
    files = [F("a.py", "import requests\ndef f(x):\n    return eval(x)\n", "created")]
    quick = run(files, depth="quick")
    kinds = {c["kind"]: c["status"] for c in quick["files"][0]["checks"]}
    assert kinds["security"] == "not_run" and kinds["secrets"] == "not_run" and kinds["dependencies"] == "not_run"
    assert kinds["lint"] in ("passed", "issues_found") and findings(quick, "eval-exec-use") == []
    assert all(c["status"] == "not_run" for c in quick["project_checks"])
    standard = run(files, depth="standard")
    assert findings(standard, "eval-exec-use") and any(n["check"] == "Package registry lookup" for n in standard["not_executed"])
    assert next(c for c in standard["project_checks"] if c["kind"] == "declared_dependencies")["status"] == "not_run"


def test_context_files_inform_checks_but_their_findings_are_not_reported():
    r = run([F("a.py", "from b import helper\nprint(helper())\n", "created"), F("b.py", "def helper():\n    return eval('1')\n", "context")])
    assert findings(r) == [] and r["summary"]["files_changed"] == 1 and r["summary"]["context_files"] == 1


def test_unparsable_and_binary_files_are_reported_not_dropped():
    r = run([F("bad.py", "def x(:\n", "created"), F("logo.bin", "ab\x00cd", "created")])
    assert findings(r, "syntax-error") and r["summary"]["files_not_analysed"] == [{"path": "logo.bin", "reason": "Binary content: not analysed."}]


def test_payload_limit_is_an_error_not_a_silent_truncation():
    big = "x = 1\n" * 30_000
    with pytest.raises(ValueError):
        run([F(f"f{i}.py", big) for i in range(4)])


def test_unchanged_importers_of_a_changed_module_are_checked_and_attributed():
    before = "def make_token(u):\n    return 't'\ndef check_token(t):\n    return True\n"
    after = "def create_token(u):\n    return 't'\ndef check_token(t):\n    return True\n"   # the agent renamed make_token
    routes = "from .tokens import make_token, check_token, never_existed\n\ndef login(u):\n    x = eval(u)\n    return make_token(u), check_token, never_existed\n"
    r = run([F("app/tokens.py", after, baseline=before), F("app/routes.py", routes, "related")],
            paths=["app/tokens.py", "app/routes.py", "app/__init__.py"])
    got = {f["title"]: f for f in findings(r)}
    assert set(got) == {"`make_token` is not defined in app/tokens.py", "`never_existed` is not defined in app/tokens.py"}
    renamed = got["`make_token` is not defined in app/tokens.py"]
    assert renamed["introduced"] == "new" and renamed["path"] == "app/routes.py" and "removed or renamed in this change" in renamed["message"]
    assert got["`never_existed` is not defined in app/tokens.py"]["introduced"] == "preexisting"
    assert r["summary"]["files_changed"] == 1 and r["summary"]["related_files"] == 1   # eval() in the unchanged file is not this change's finding


def test_related_typescript_importer_of_a_removed_export():
    r = run([F("src/api.ts", "export function getUser() { return 1; }\n", baseline="export function getUser() { return 1; }\nexport function listUsers() { return []; }\n"),
             F("src/page.tsx", "import { listUsers } from './api';\nexport const P = () => listUsers();\n", "related")])
    f = findings(r)
    assert [x["rule_id"] for x in f] == ["imported-name-not-exported"] and f[0]["introduced"] == "new"


def test_deep_check_cannot_switch_on_registry_lookups_the_operator_disabled(monkeypatch):
    from trustcode_worker.analyzers import dependencies
    calls = []
    monkeypatch.setattr(dependencies, "_registry_exists", lambda lang, name: calls.append(name) or True)
    monkeypatch.delenv("TRUSTCODE_REGISTRY_CHECK", raising=False)
    files = [F("a.py", "import requests\nimport totally_made_up_pkg\n", "created")]
    r = run(files, depth="deep")
    assert calls == [], "a client-chosen depth made the server contact a registry"
    assert any(n["check"] == "Package registry lookup" and "switched off" in n["reason"] for n in r["not_executed"])
    monkeypatch.setenv("TRUSTCODE_REGISTRY_CHECK", "1")
    run(files, depth="deep")
    assert sorted(calls) == ["requests", "totally_made_up_pkg"]
    calls.clear()
    run(files, depth="standard")
    assert calls == [], "registry lookups belong to the deep check only"


def test_registry_lookups_are_capped_per_file(monkeypatch):
    from trustcode_worker.analyzers import dependencies
    from trustcode_worker.models import Language
    calls = []
    monkeypatch.setattr(dependencies, "_registry_exists", lambda lang, name: calls.append(name) or True)
    code = "".join(f"import pkg_{i}\n" for i in range(60))
    c = dependencies.check_dependencies(code, Language.PYTHON, registry=True)
    assert len(calls) == dependencies.MAX_REGISTRY_LOOKUPS and len(c.details["unverified"]) == 60 - dependencies.MAX_REGISTRY_LOOKUPS


def test_import_resolution_cost_does_not_grow_with_listing_times_imports():
    import time
    paths = [f"pkg{i % 50}/sub{i % 7}/module_{i}.py" for i in range(20_000)] + ["app/__init__.py", "app/a.py"]
    code = "".join(f"import module_{i}\nfrom pkg{i % 50}.sub{i % 7} import module_{i} as m{i}\n" for i in range(0, 20_000, 50))   # 800 import statements
    t0 = time.monotonic()
    r = run([F("app/a.py", code, "created")], paths=paths, depth="standard")
    took = time.monotonic() - t0
    assert took < 20, f"cross-file checks took {took:.1f}s for a large listing"
    assert not findings(r, "import-not-found"), "existing modules reported as missing"
    imports = next(c for c in r["project_checks"] if c["kind"] == "imports")
    assert imports["details"]["resolved"] <= 400, "imports examined per file must be capped"


def test_listing_cannot_inflate_the_import_index_or_exceed_its_budget():
    from trustcode_worker.project import MAX_SUFFIX_PARTS, SessionRequest, _Project
    deep = "/".join(f"d{i}" for i in range(200)) + "/mod.py"          # 201 components
    proj = _Project(SessionRequest(files=[F("a.py", "x = 1\n")], workspace_paths=[deep]))
    assert sum(1 for k in proj.by_suffix if k.endswith("mod.py")) == MAX_SUFFIX_PARTS
    # a deeply nested module is still found by its tail and by its full dotted path
    r = run([F("a.py", "import mod\nimport d198.d199.mod\nimport " + ".".join(f"d{i}" for i in range(200)) + ".mod\n", "created")], paths=[deep, "a.py"])
    assert not findings(r, "import-not-found")
    with pytest.raises(ValueError, match="listing too large"):
        run([F("a.py", "x = 1\n")], paths=["p" * 450 + f"/{i}.py" for i in range(5000)])
