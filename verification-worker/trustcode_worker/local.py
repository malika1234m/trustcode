"""TrustCode local engine: runs verification on this machine for the editor extension.

One JSON request on standard input, one JSON answer on standard output. The request carries the text to
analyse; the engine never reads project files by itself, never executes the submitted code outside the
Docker sandbox, and makes no network request unless the request sets "registry": true (package-name lookups
on PyPI / npm). It produces exactly the reports the TrustCode server produces, from the same code.

    {"op": "doctor"}
    {"op": "verify",  "code": "...", "language": "python", "task": null, "tests": null, "run_tests": false, ...view options}
    {"op": "explain", "result": {...}, ...view options}
    {"op": "session", "request": {"files": [...], "workspace_paths": [...], "depth": "standard"}, ...view options}

View options (all optional): "level", "selected_level", "ratings" (list of rating strings, oldest first),
"rule_ratings" (list of [rule, rating]), "suggestions" (bool).

Exit status: 0 = answered (the answer says whether checks passed), 2 = the request could not be served.
A failure is never reported as a completed analysis.
"""
from __future__ import annotations

import json
import platform
import sys
from importlib import metadata

PROTOCOL = 1
MAX_REQUEST_BYTES = 64 * 1024 * 1024
PROFILES = ("extended", "study-v1")


class BadRequest(ValueError):
    pass


def _view_options(req: dict) -> tuple[str, str | None, list[str], dict, bool]:
    from .present.adaptation import LEVELS, rule_history
    selected = req.get("selected_level") if req.get("selected_level") in LEVELS else "intermediate"
    override = req.get("level") if req.get("level") in LEVELS else None
    suggestions = bool(req.get("suggestions", True))
    ratings = [r for r in (req.get("ratings") or []) if isinstance(r, str)][-200:]
    rows = [(r[0], r[1]) for r in (req.get("rule_ratings") or [])
            if isinstance(r, (list, tuple)) and len(r) == 2 and all(isinstance(x, str) for x in r)][-2000:]
    return selected, override, ratings, (rule_history(rows) if suggestions else {}), suggestions


def _explain(result: dict, req: dict) -> dict:
    from .present.adaptation import decide
    from .present.explain import build_explanation
    selected, override, ratings, learned, suggestions = _view_options(req)
    n = sum(len(c["findings"]) for c in result["checks"])
    return build_explanation(result, decide(selected, n, ratings, suggestions, override=override), rule_feedback=learned)


def _profile(req: dict) -> str:
    profile = req.get("profile", "extended")
    if profile not in PROFILES:
        raise BadRequest(f"unknown profile {profile!r}")
    return profile


def op_verify(req: dict) -> dict:
    from .models import VerificationRequest
    from .pipeline import verify
    if not isinstance(req.get("code"), str) or not req["code"].strip():
        raise BadRequest("'code' must be non-empty text")
    vr = VerificationRequest(code=req["code"], language=req.get("language") or None, task=req.get("task") or None,
                             tests=req.get("tests") or None)
    result = verify(vr, run_tests=bool(req.get("run_tests", False)), profile=_profile(req),
                    registry=bool(req.get("registry", False))).model_dump(mode="json")
    return {"result": result, "view": _explain(result, req)}


def op_explain(req: dict) -> dict:
    result = req.get("result")
    if not isinstance(result, dict) or not isinstance(result.get("checks"), list):
        raise BadRequest("'result' must be a verification result")
    return {"view": _explain(result, req)}


def op_session(req: dict) -> dict:
    from .present.explain import explain_session
    from .project import SessionRequest, verify_session
    if not isinstance(req.get("request"), dict):
        raise BadRequest("'request' must be an object")
    sr = SessionRequest(**req["request"])
    report = verify_session(sr, profile=_profile(req), allow_registry=bool(req.get("registry", False)))
    selected, override, _, learned, _ = _view_options(req)
    return {"report": explain_session(report, override or selected, learned)}


def op_doctor(_: dict) -> dict:
    from .pipeline import ENGINE_VERSION
    from .sandbox.docker_runner import docker_available
    from .tools import node_cmd, ruff_cmd, semgrep_cmd, tool_version
    try:
        package = metadata.version("trustcode-worker")
    except metadata.PackageNotFoundError:
        package = None
    def have(mod: str) -> bool:
        try:
            __import__(mod)
            return True
        except Exception:
            return False
    sandbox_ok, sandbox_note = docker_available()
    tools = {
        "ruff": {"available": ruff_cmd() is not None, "version": tool_version("ruff"), "used_for": "Python lint"},
        "semgrep": {"available": semgrep_cmd() is not None, "version": tool_version("semgrep"), "used_for": "security rules"},
        "pyflakes": {"available": have("pyflakes"), "version": None, "used_for": "Python lint"},
        "mypy": {"available": have("mypy"), "version": None, "used_for": "Python type check"},
        "tree-sitter": {"available": have("tree_sitter"), "version": None, "used_for": "JavaScript / TypeScript syntax and lint"},
        "node": {"available": node_cmd() is not None, "version": tool_version("node"), "used_for": "JavaScript syntax check"},
        "docker-sandbox": {"available": sandbox_ok, "version": None, "used_for": "running your tests in isolation", "note": sandbox_note},
    }
    return {"engine": ENGINE_VERSION, "package": package, "python": platform.python_version(), "executable": sys.executable,
            "tools": tools, "missing": sorted(k for k, v in tools.items() if not v["available"])}


OPS = {"verify": op_verify, "explain": op_explain, "session": op_session, "doctor": op_doctor}


def handle(req: object) -> tuple[int, dict]:
    if not isinstance(req, dict) or req.get("op") not in OPS:
        return 2, {"ok": False, "protocol": PROTOCOL, "error": f"unknown operation; expected one of {sorted(OPS)}"}
    try:
        return 0, {"ok": True, "protocol": PROTOCOL, **OPS[req["op"]](req)}
    except (BadRequest, ValueError) as e:  # includes pydantic validation errors
        return 2, {"ok": False, "protocol": PROTOCOL, "error": f"invalid request: {str(e)[:500]}"}
    except Exception as e:  # never report a crash as a completed analysis
        return 2, {"ok": False, "protocol": PROTOCOL, "error": f"analysis failed: {type(e).__name__}: {str(e)[:300]}"}


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv and argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    raw = json.dumps({"op": "doctor"}) if argv[:1] == ["doctor"] else sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    if len(raw) > MAX_REQUEST_BYTES:
        code, out = 2, {"ok": False, "protocol": PROTOCOL, "error": "request too large"}
    else:
        try:
            req = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            req = None
        real, sys.stdout = sys.stdout, sys.stderr  # anything a tool prints must not corrupt the single JSON answer
        try:
            code, out = handle(req)
        finally:
            sys.stdout = real
    sys.stdout.write(json.dumps(out, separators=(",", ":")) + "\n")
    return code


if __name__ == "__main__":
    sys.exit(main())
