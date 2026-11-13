"""Project-wide security scanner: discovery, analysis, caching, baseline, policy.

Everything runs on the local machine. Project files are read and parsed, never executed; the only programs
started are `git` (read-only queries) and Semgrep with TrustCode's own rule files. Nothing leaves the machine
unless dependency advisory lookups are switched on, and then only package names and versions are sent.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import tempfile
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from ..tools import run, semgrep_cmd, tool_version
from . import patterns
from .catalogue import (CONFIDENCES, LEGACY_SEMGREP, REMEDIATION, RULES, SEMGREP_BLOCK, SEMGREP_CONFIDENCE, SEVERITIES)

ENGINE = "trustcode-scan 1.1"
RULES_DIR = Path(__file__).resolve().parent.parent / "rules"
STATE_DIR = ".trustcode"
SEMGREP_LANGS = {".py": "Python", ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
                 ".ts": "TypeScript", ".tsx": "TypeScript", ".php": "PHP", ".java": "Java"}
GENERIC_TYPES = {".json": "JSON", ".yml": "YAML", ".yaml": "YAML", ".sh": "Shell", ".bash": "Shell", ".sql": "SQL", ".toml": "TOML", ".xml": "XML",
                 ".ini": "INI", ".cfg": "INI", ".properties": "Properties", ".tf": "Terraform", ".md": "Markdown", ".html": "HTML", ".env": "Env",
                 ".go": "Go", ".rb": "Ruby", ".cs": "C#", ".rs": "Rust", ".kt": "Kotlin", ".swift": "Swift", ".c": "C", ".cpp": "C++", ".vue": "Vue", ".svelte": "Svelte"}
DEPENDENCY_DIRS = {"node_modules", "bower_components", "vendor", ".venv", "venv", "site-packages", "__pypackages__", ".tox"}
BUILD_DIRS = {"dist", "build", "out", ".next", ".nuxt", "target", "coverage", "__pycache__", ".pytest_cache", ".ruff_cache", ".mypy_cache", ".gradle", ".vscode-test"}
ALWAYS_SCAN = re.compile(r"(?i)(^|/)(\.env(\.[\w.-]+)?|\.mcp\.json|\.cursorrules|\.windsurfrules|claude\.md|agents\.md|gemini\.md)$|"
                         r"(^|/)\.(cursor|claude|codex|gemini|windsurf|roo|vscode)/")
DEFAULT_CONFIG = {
    "exclude": [], "disabled_rules": [], "max_file_kb": 512,
    "block": {"commit": "critical", "push": "critical", "ci": "high", "production": "high"},
    "block_confidence": "strongly_suspected",
    "block_existing": {"commit": False, "push": False, "ci": False, "production": True},
    "on_incomplete": {"commit": "warn", "push": "warn", "ci": "block", "production": "block"},
    "network": False,
}
SEV_RANK = {s: i for i, s in enumerate(SEVERITIES)}
CONF_RANK = {c: i for i, c in enumerate(CONFIDENCES)}


def _progress(message: str, done: int = 0, total: int = 0) -> None:
    """Progress for a front end (the VS Code extension sets TRUSTCODE_PROGRESS=1); never mixed into the report."""
    if os.environ.get("TRUSTCODE_PROGRESS") == "1":
        import sys
        print("TRUSTCODE_PROGRESS " + json.dumps({"message": message, "done": done, "total": total}), file=sys.stderr, flush=True)


def _harden_search_path(root: Path | None = None) -> None:
    """Programs are looked up only in absolute PATH directories outside the project being scanned - never in the
    current directory or in a directory of the (untrusted) project. This also covers programs that the scanners
    start themselves."""
    base = os.path.realpath(root) if root is not None else None
    def outside(p: str) -> bool:
        real = os.path.realpath(p)
        return base is None or not (real == base or real.startswith(base + os.sep))
    parts = [p for p in os.environ.get("PATH", "").split(os.pathsep) if p and p != "." and os.path.isabs(p) and outside(p)]
    os.environ["PATH"] = os.pathsep.join(parts)
    os.environ["NoDefaultCurrentDirectoryInExePath"] = "1"   # Windows: do not search the working directory


def _which(name: str, root: Path | None = None) -> str | None:
    """Absolute path of a tool, refusing anything that lives inside the project being scanned."""
    _harden_search_path()
    exe = shutil.which(name)
    if not exe or not os.path.isabs(exe):
        return None
    if root is not None:
        real, base = os.path.realpath(exe), os.path.realpath(root)
        if real == base or real.startswith(base + os.sep):
            return None
    return exe


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _git(root: Path, *args: str) -> str | None:
    if not _which("git", root):
        return None
    r = run(["git", "-c", "core.fsmonitor=false", *args], cwd=str(root), timeout=60, env={"GIT_OPTIONAL_LOCKS": "0", "GIT_TERMINAL_PROMPT": "0"})
    return r.stdout if r.returncode == 0 else None


def load_config(root: Path) -> dict:
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    p = root / STATE_DIR / "config.json"
    if p.is_file():
        try:
            user = json.loads(p.read_text())
            for k, v in user.items():
                if k in cfg and isinstance(cfg[k], dict) and isinstance(v, dict):
                    cfg[k].update({a: b for a, b in v.items() if a in cfg[k]})
                elif k in cfg and isinstance(v, type(cfg[k])):
                    cfg[k] = v
        except Exception:
            cfg["_error"] = f"{STATE_DIR}/config.json could not be read; defaults are used."
    return cfg


def rules_digest() -> str:
    h = hashlib.sha256(ENGINE.encode())
    for p in sorted(RULES_DIR.rglob("*.yml")) + sorted(Path(__file__).parent.glob("*.py")):
        h.update(p.read_bytes())
    return h.hexdigest()[:16]


def _glob_match(path: str, globs: list[str]) -> bool:
    import fnmatch
    return any(fnmatch.fnmatch(path, g) or fnmatch.fnmatch(path, g.rstrip("/") + "/*") or fnmatch.fnmatch("/" + path, "*/" + g.strip("/") + "/*") for g in globs)


# --------------------------------------------------------------------------------------- discovery
def discover(root: Path, cfg: dict) -> dict:
    """Every file of the project, each either included or excluded with a reason."""
    included: list[str] = []
    excluded: dict[str, list[str]] = {}
    nested: list[str] = []

    def skip(path: str, reason: str):
        excluded.setdefault(reason, []).append(path)

    listed = _git(root, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
    tracked = set((_git(root, "ls-files", "-z") or "").split("\0")) - {""} if listed is not None else set()
    visible = set(listed.split("\0")) - {""} if listed is not None else None
    max_bytes = int(cfg["max_file_kb"]) * 1024
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        rel_dir = os.path.relpath(dirpath, root).replace(os.sep, "/")
        rel_dir = "" if rel_dir == "." else rel_dir
        keep = []
        for d in dirnames:
            rel = f"{rel_dir}/{d}" if rel_dir else d
            full = os.path.join(dirpath, d)
            if d == ".git" or (d == STATE_DIR and not rel_dir):
                continue
            if os.path.islink(full):
                skip(rel + "/", "symbolic link (not followed)")
            elif d in DEPENDENCY_DIRS:
                skip(rel + "/", "dependency directory")
            elif d in BUILD_DIRS:
                skip(rel + "/", "build output or cache")
            elif _glob_match(rel + "/x", cfg["exclude"]):
                skip(rel + "/", "excluded by configuration")
            else:
                if rel_dir != "" or True:
                    if os.path.exists(os.path.join(full, ".git")):
                        nested.append(rel)
                keep.append(d)
        dirnames[:] = keep
        for f in filenames:
            rel = f"{rel_dir}/{f}" if rel_dir else f
            full = os.path.join(dirpath, f)
            always = bool(ALWAYS_SCAN.search(rel))
            try:
                st = os.lstat(full)
            except OSError:
                continue
            if stat.S_ISLNK(st.st_mode):
                skip(rel, "symbolic link (not followed)")
            elif not stat.S_ISREG(st.st_mode):
                continue
            elif _glob_match(rel, cfg["exclude"]):
                skip(rel, "excluded by configuration")
            elif visible is not None and rel not in visible and not always:
                skip(rel, "ignored by Git")
            elif re.search(r"(?i)\.(min\.js|map|lock|png|jpe?g|gif|ico|svg|pdf|zip|gz|tgz|woff2?|ttf|eot|mp[34]|mov|exe|dll|so|dylib|class|jar|pyc|db|sqlite3?|vsix|bin)$", f) \
                    and f not in ("poetry.lock", "uv.lock"):
                skip(rel, "generated or binary file type")
            elif st.st_size > max_bytes and f != "package-lock.json":
                skip(rel, f"larger than {cfg['max_file_kb']} KB")
            else:
                included.append(rel)
    return {"included": sorted(included), "excluded": excluded, "nested_repositories": sorted(nested), "git": listed is not None,
            "tracked": tracked, "visible": visible}


def _kind(path: str) -> tuple[str, str]:
    """(language or file type, analysis depth)."""
    base = os.path.basename(path).lower()
    ext = os.path.splitext(base)[1]
    if ext in SEMGREP_LANGS:
        return SEMGREP_LANGS[ext], "language-aware"
    if patterns.ENV_FILE.search(path):
        return "Env", "structured"
    if base.startswith("dockerfile") or re.match(r"(docker-)?compose", base):
        return "Docker", "structured"
    if re.search(r"(^|/)\.github/workflows/", path.lower()):
        return "GitHub Actions", "structured"
    if ext == ".json":
        return "JSON", "structured"
    if ext in GENERIC_TYPES:
        return GENERIC_TYPES[ext], "generic patterns only"
    return (ext.lstrip(".").upper() or "no extension"), "generic patterns only"


# --------------------------------------------------------------------------------------- analysis
def _finding(rule_id: str, path: str, raw: tuple, source: str) -> dict:
    _, line, col, end_line, end_col, evidence, reason, extra = raw
    meta = RULES[rule_id]
    return {"rule_id": rule_id, "category": meta["category"], "title": meta["title"], "severity": extra.get("severity", meta["severity"]),
            "confidence": extra.get("confidence", meta["confidence"]), "path": path, "line": line, "col": col, "end_line": end_line, "end_col": end_col,
            "file_level": bool(extra.get("file_level")), "evidence": evidence, "reason": reason, "remediation": meta["remediation"],
            "source": f"{source}:{extra.get('detector', rule_id)}", "cwe": meta["cwe"], "owasp": [], "block": meta["block"], "priority": meta["priority"]}


def analyse_text(path: str, text: str, git_state: str) -> list[dict]:
    out = [_finding(r[0], path, r, "trustcode-patterns") for r in patterns.secrets(path, text)]
    out += [_finding(r[0], path, r, "trustcode-patterns") for r in patterns.text_rules(path, text)]
    for fn in (patterns.json_config, patterns.workflow, patterns.container, patterns.infrastructure, patterns.network):
        out += [_finding(r[0], path, r, "trustcode-config") for r in fn(path, text)]
    if patterns.ENV_FILE.search(path):
        out += [_finding(r[0], path, r, "trustcode-config") for r in patterns.env_file(path, text, git_state)]
    return out


# Rules of the shared rule files that are not meaningful for a project scan. They exist for snippet verification, where
# the code under test runs in the same process as its tests: there, importing the test framework or exiting the process
# can falsify a test result. In a project, `import pytest` and `process.exit()` are ordinary code.
NOT_FOR_PROJECTS = {"runtime-or-test-tampering", "js-runtime-or-test-tampering"}
CONSTANT_HTML = re.compile(r"""\.(?:inner|outer)HTML\s*=\s*(?:'[^'\\]*'|"[^"\\]*"|`[^`$\\]*`)\s*;?\s*(?://.*)?$""")
TEST_CONTEXT_RULES = {"TC-SEC-004", "TC-SEC-005", "TC-ENV-006", "hardcoded-secret", "js-hardcoded-secret"}


def keep_match(sid: str, path: str, src: list[str], line: int) -> bool:
    """Second look at a Semgrep match with what the rule itself cannot see: the kind of file and the text around the
    match. Returns False when the match is not what the rule is meant to find (precision, not suppression)."""
    text_line = src[line - 1] if 0 < line <= len(src) else ""
    if sid in NOT_FOR_PROJECTS:
        return False
    if sid == "assert-for-validation":
        return not patterns.is_test_file(path)          # assert is how tests state what they expect
    if sid in ("hardcoded-secret", "js-hardcoded-secret"):
        # the rule matches on the variable name alone: keep it only when the value could be a secret
        pairs = [(m.group(1), m.group(3)) for m in patterns.LOOSE_ASSIGN.finditer(text_line)]
        return any(patterns.secret_like(n, v) for n, v in pairs) if pairs else not patterns.is_test_file(path)
    if sid in ("insecure-random", "js-insecure-random"):
        # weak randomness matters where the value protects something; jitter, shuffling and animation do not
        around = " ".join(src[max(0, line - 3):line + 1])
        return bool(patterns.SECURITY_USE.search(around))
    if sid == "js-innerhtml":
        return not CONSTANT_HTML.search(text_line)       # a fixed string is not dynamic content
    return True


def in_context(f: dict) -> dict:
    """A hard-coded value in a test file is usually a fixture. It is still shown, but as low severity and never as
    a reason to block; provider-format credentials and private keys keep their severity everywhere."""
    if f["rule_id"] in TEST_CONTEXT_RULES and patterns.is_test_file(f["path"]) and f["severity"] != "low":
        return {**f, "severity": "low", "confidence": "potential", "block": "INFO",
                "reason": (f["reason"].rstrip(".") + ". This is a test file, where such values are usually fixtures.")[:300]}
    return f


def run_semgrep(root: Path, files: list[str]) -> tuple[dict[str, list[dict]], dict]:
    """Returns ({path: findings}, check record). Project-supplied Semgrep configuration and inline
    `nosemgrep` markers are ignored: only TrustCode's rule files decide what is reported."""
    check = {"id": "sast", "name": "Static analysis (Semgrep: patterns and intra-file data flow)", "status": "completed", "detail": ""}
    by_path: dict[str, list[dict]] = {f: [] for f in files}
    if not files:
        check.update(status="skipped", detail="No Python, JavaScript, TypeScript, PHP or Java files to analyse.")
        return by_path, check
    sg = semgrep_cmd()
    if not sg:
        check.update(status="failed", detail="Semgrep is not installed, so injection, authentication and other code-level rules did not run.")
        return {}, check
    if "-c" in sg[1:3]:
        sg = [sg[0], "-I", *sg[1:]]   # `python -c` would put the scanned directory on the import path
    configs = [a for p in sorted(RULES_DIR.glob("*.yml")) + sorted((RULES_DIR / "extended").glob("*.yml")) + sorted((RULES_DIR / "scan").glob("*.yml"))
               for a in ("--config", str(p))]
    failed = 0
    # File names come from the project being scanned, so they are untrusted: every path is passed with a "./"
    # prefix, which keeps a name such as "--config=x.yml" from being interpreted as a scanner option.
    line_cache: dict[str, list[str]] = {}
    for i in range(0, len(files), 300):
        chunk = files[i:i + 300]
        _progress("Analysing code (data flow and patterns)", i, len(files))
        r = run(sg + ["scan", "--metrics=off", "--disable-version-check", "--quiet", "--json", "--disable-nosem", "--no-git-ignore",
                      "--timeout", "20", *configs, *["./" + c for c in chunk]], cwd=str(root), timeout=600)
        try:
            data = json.loads(r.stdout[r.stdout.index("{"):]) if "{" in r.stdout else None
        except (json.JSONDecodeError, ValueError):
            data = None
        if r.timed_out or not isinstance(data, dict) or not isinstance(data.get("results"), list):
            failed += len(chunk)
            for f in chunk:
                by_path.pop(f, None)
            continue
        for res in data["results"]:
            try:
                path = os.path.normpath(str(res["path"])).replace(os.sep, "/")
                sid = str(res["check_id"]).split(".")[-1]
                md = res["extra"].get("metadata") or {}
                legacy = LEGACY_SEMGREP.get(sid)
                category = str(md.get("category") or (legacy[0] if legacy else "security"))
                confidence = SEMGREP_CONFIDENCE.get(str(md.get("confidence")), legacy[1] if legacy else "potential")
                severity = str(md.get("trustcode_severity") or {"ERROR": "high", "WARNING": "medium", "INFO": "low"}.get(res["extra"].get("severity"), "medium"))
                rule_id = str(md.get("tc_id") or sid)
                item = {"rule_id": rule_id, "category": category, "title": str(md.get("title") or sid)[:120],
                        "severity": severity if severity in SEV_RANK else "medium", "confidence": confidence, "path": path,
                        "line": int(res["start"]["line"]), "col": int(res["start"]["col"]), "end_line": int(res["end"]["line"]), "end_col": int(res["end"]["col"]),
                        "file_level": False, "evidence": "", "reason": str(res["extra"].get("message", "")).strip()[:300],
                        "remediation": str(md.get("fix") or REMEDIATION.get(category, "Review this code.")),
                        "source": f"semgrep:{sid}", "cwe": [str(x) for x in (md.get("cwe") or [])] if isinstance(md.get("cwe"), list) else [str(md.get("cwe"))] if md.get("cwe") else [],
                        "owasp": [str(x) for x in (md.get("owasp") or [])] if isinstance(md.get("owasp"), list) else [],
                        "block": RULES.get(rule_id, {}).get("block") or SEMGREP_BLOCK.get(category, "WARN"), "priority": RULES.get(rule_id, {}).get("priority", "P1")}
            except (KeyError, TypeError, ValueError):
                continue  # malformed scanner output is dropped, never trusted
            if not keep_match(sid, path, line_cache.setdefault(path, _lines(root / path)), item["line"]):
                continue
            if path in by_path:
                by_path[path].append(item)
    if failed:
        check.update(status="failed", detail=f"Semgrep did not produce a readable result for {failed} of {len(files)} file(s).")
    else:
        check["detail"] = f"{len(files)} file(s) analysed."
    return by_path, check


BANDIT = {"B608": "sql-injection", "B602": "command-injection", "B605": "command-injection", "B604": "command-injection", "B102": "command-injection",
          "B307": "command-injection", "B301": "unsafe-deserialization", "B506": "unsafe-deserialization", "B324": "cryptography", "B303": "cryptography",
          "B501": "cryptography", "B201": "configuration", "B701": "xss", "B314": "xxe", "B320": "xxe"}


BANDIT_TITLES = {"B314": "XML parsed without a hardened parser", "B320": "XML parsed without a hardened parser", "B608": "SQL built from strings",
                 "B602": "Shell command with shell=True", "B605": "Shell command started with a shell", "B307": "Use of eval"}


def bandit_available() -> str | None:
    import importlib.util
    if importlib.util.find_spec("bandit") is None:
        return None
    try:
        from importlib.metadata import version
        return version("bandit")
    except Exception:
        return "unknown"


def run_bandit(root: Path, files: list[str]) -> tuple[dict[str, list[dict]], dict | None]:
    """Second opinion for Python from Bandit (optional). Only test ids with a clear category are used; its findings
    are merged with Semgrep's by file, line and category, so the same problem is never listed twice."""
    import sys
    py = [f for f in files if f.endswith(".py")]
    if not py or bandit_available() is None:
        return {}, None
    # Isolated interpreter (-I), neutral working directory and absolute paths: a `bandit.py`, `.bandit` or
    # other file inside the project being scanned must never be imported or read as configuration.
    neutral = tempfile.mkdtemp(prefix="trustcode-bandit-")
    check = {"id": "bandit", "name": "Python security rules (Bandit)", "status": "completed", "detail": f"{len(py)} file(s) analysed."}
    out: dict[str, list[dict]] = {}
    for i in range(0, len(py), 300):
        r = run([sys.executable, "-I", "-m", "bandit", "-q", "-f", "json", "--exit-zero", *[str(root / f) for f in py[i:i + 300]]], cwd=neutral, timeout=300)
        try:
            data = json.loads(r.stdout[r.stdout.index("{"):])
            results = data["results"]
        except (ValueError, KeyError, TypeError):
            check.update(status="failed", detail="Bandit did not return a readable result.")
            shutil.rmtree(neutral, ignore_errors=True)
            return {}, check
        for res in results:
            try:
                tid, category = str(res["test_id"]), BANDIT.get(str(res["test_id"]))
                if category is None or (tid == "B608" and res.get("issue_confidence") == "LOW"):
                    continue   # B608 at low confidence: a string with SQL words that is not passed to a query call
                path = os.path.relpath(os.path.realpath(str(res["filename"])), os.path.realpath(root)).replace(os.sep, "/")
                if path.startswith(".."):
                    continue
                sev = {"HIGH": "high", "MEDIUM": "medium", "LOW": "low"}.get(str(res["issue_severity"]), "medium")
                line = int(res["line_number"])
                out.setdefault(path, []).append({
                    "rule_id": f"bandit-{tid}", "category": category, "title": BANDIT_TITLES.get(tid, str(res.get("test_name", tid)).replace("_", " "))[:120],
                    "severity": "low" if tid in ("B314", "B320") else sev,
                    "confidence": "strongly_suspected" if res.get("issue_confidence") == "HIGH" and tid not in ("B314", "B320") else "potential", "path": path, "line": line,
                    "col": int(res.get("col_offset", 0)) + 1, "end_line": max(line, int((res.get("line_range") or [line])[-1])), "end_col": int(res.get("end_col_offset", 0)) + 1,
                    "file_level": False, "evidence": "", "reason": str(res.get("issue_text", ""))[:300], "remediation": REMEDIATION.get(category, "Review this code."),
                    "source": f"bandit:{tid}", "cwe": [f"CWE-{res['issue_cwe']['id']}"] if isinstance(res.get("issue_cwe"), dict) and res["issue_cwe"].get("id") else [],
                    "owasp": [], "block": SEMGREP_BLOCK.get(category, "WARN"), "priority": "P1"})
            except (KeyError, TypeError, ValueError):
                continue
    shutil.rmtree(neutral, ignore_errors=True)
    return out, check


def run_gitleaks(root: Path, scanned: set[str], texts: dict[str, str], private_env: set[str] = frozenset()) -> tuple[list[dict], dict | None]:
    """Credential detection by Gitleaks (optional). Project-supplied Gitleaks configuration, ignore files and
    inline allow markers are not honoured, and values are redacted by the tool before they reach this process."""
    exe = _which("gitleaks", root)
    if not exe:
        return [], None
    check = {"id": "gitleaks", "name": "Credential detection (Gitleaks)", "status": "completed", "detail": ""}
    neutral = Path(tempfile.mkdtemp(prefix="trustcode-gitleaks-"))
    try:
        (neutral / "config.toml").write_text("[extend]\nuseDefault = true\n")
        r = run([exe, "dir", "--no-banner", "--redact", "--exit-code", "0", "--ignore-gitleaks-allow", "--config", str(neutral / "config.toml"),
                 "--gitleaks-ignore-path", str(neutral), "--report-format", "json", "--report-path", str(neutral / "out.json"), str(root)], cwd=str(neutral), timeout=600)
        try:
            data = json.loads((neutral / "out.json").read_text())
            if not isinstance(data, list):
                raise ValueError("not a list")
        except Exception:
            check.update(status="failed", detail=f"Gitleaks did not return a readable result ({(r.stderr or '').strip()[-120:]}).")
            return [], check
    finally:
        shutil.rmtree(neutral, ignore_errors=True)
    out = []
    for res in data:
        try:
            path = os.path.relpath(os.path.realpath(str(res["File"])), os.path.realpath(root)).replace(os.sep, "/")
            if path not in scanned:
                continue   # the project's own exclusions apply to every scanner
            line, rid = int(res["StartLine"]), str(res["RuleID"])
            src = texts.get(path, "").splitlines()
            text_line = src[line - 1] if 0 < line <= len(src) else ""
            generic = rid.startswith("generic")
            m = patterns.GENERIC_ASSIGN.search(text_line)
            if (m and patterns._is_placeholder(m.group(3))) or patterns.ENV_TEMPLATE.search(path) or patterns.PLACEHOLDER.search(text_line) and generic:
                continue
            if path in private_env:
                continue   # an environment file that Git ignores is where secrets belong; env_file() judges these files
            if generic and not patterns.ENV_FILE.search(path) and not any(patterns.secret_like(a.group(1), a.group(3)) for a in patterns.GENERIC_ASSIGN.finditer(text_line)):
                continue   # the generic detector fires on any `key = "..."`: keep it only for a secret-like name and value
            meta = RULES["TC-SEC-004" if generic else "TC-SEC-001"]
            out.append({"rule_id": "TC-SEC-004" if generic else "TC-SEC-001", "category": "secrets", "title": meta["title"], "severity": meta["severity"],
                        "confidence": "potential" if generic else "strongly_suspected", "path": path, "line": line, "col": max(1, int(res.get("StartColumn", 1))),
                        "end_line": max(line, int(res.get("EndLine", line))), "end_col": max(1, int(res.get("EndColumn", 1))) + 1, "file_level": False,
                        "evidence": f"{rid}: …[masked]", "reason": str(res.get("Description", "Credential detected."))[:200],
                        "remediation": meta["remediation"], "source": f"gitleaks:{rid}", "cwe": meta["cwe"], "owasp": [], "block": meta["block"], "priority": meta["priority"]})
        except (KeyError, TypeError, ValueError):
            continue
    check["detail"] = f"{len(scanned)} file(s) in scope."
    return out, check


def run_osv_scanner(root: Path, texts: dict[str, str]) -> tuple[list[dict], str | None, bool]:
    """Dependency advisories through the OSV-Scanner CLI (more lockfile formats than the built-in lookup).
    Returns (findings, error, ran). It contacts osv.dev, so it only runs when network lookups are enabled."""
    exe = _which("osv-scanner", root)
    if not exe:
        return [], None, False
    neutral = Path(tempfile.mkdtemp(prefix="trustcode-osv-"))
    try:
        (neutral / "empty.toml").write_text("")   # a project-supplied osv-scanner.toml could hide advisories
        r = run([exe, "scan", "source", "--format", "json", "--config", str(neutral / "empty.toml"), "-r", str(root)], cwd=str(neutral), timeout=600)
    finally:
        shutil.rmtree(neutral, ignore_errors=True)
    try:
        data = json.loads(r.stdout[r.stdout.index("{"):])
        results = data["results"]
    except (ValueError, KeyError, TypeError):
        if r.returncode == 128 or "No package sources found" in (r.stderr or ""):
            return [], None, True
        return [], f"OSV-Scanner did not return a readable result ({(r.stderr or '').strip()[-120:]}).", True
    meta, out = RULES["TC-DEP-004"], []
    for res in results:
        try:
            path = os.path.relpath(os.path.realpath(str(res["source"]["path"])), os.path.realpath(root)).replace(os.sep, "/")
            if path.startswith(".."):
                continue
            for pkg in res.get("packages", []):
                name, version = str(pkg["package"]["name"]), str(pkg["package"]["version"])
                ids = sorted({str(i) for g in pkg.get("groups", []) for i in g.get("ids", [])})
                if not ids:
                    continue
                line = next((i for i, ln in enumerate(texts.get(path, "").splitlines(), 1) if name.lower() in ln.lower()), 1)
                malicious = any(i.startswith("MAL-") for i in ids)
                out.append({"rule_id": "TC-DEP-004", "category": "dependencies", "title": "Malicious package version" if malicious else meta["title"],
                            "severity": "critical" if malicious else "high", "confidence": "confirmed", "path": path, "line": line, "col": 1, "end_line": line, "end_col": 1,
                            "file_level": line <= 1, "evidence": f"{name} {version} ({pkg['package'].get('ecosystem', '')})",
                            "reason": f"{len(ids)} advisory record(s) match this exact version: {', '.join(ids[:4])}{'…' if len(ids) > 4 else ''}.",
                            "remediation": meta["remediation"], "source": "osv-scanner:" + ids[0], "cwe": meta["cwe"], "owasp": ["A06:2021 Vulnerable Components"],
                            "block": "BLOCK" if malicious else meta["block"], "priority": meta["priority"]})
        except (KeyError, TypeError, ValueError):
            continue
    return out, None, True


def scan_artifacts(root: Path, dirs: list[str], limit: int = 3000) -> list[dict]:
    """Provider-format credentials inside build output (bundles shipped to users). Only credential formats are
    checked there: build output is generated code, so no other rule is meaningful for it."""
    meta, out, seen = RULES["TC-SEC-007"], [], 0
    for d in dirs:
        for dirpath, dirnames, filenames in os.walk(root / d.rstrip("/"), followlinks=False):
            dirnames[:] = [x for x in dirnames if x not in DEPENDENCY_DIRS and x != ".git"]
            for f in filenames:
                full = Path(dirpath) / f
                seen += 1
                if seen > limit or full.is_symlink() or not re.search(r"(?i)\.(js|mjs|cjs|css|html?|json|map|txt|xml|ya?ml|env|py|php)$", f):
                    continue
                try:
                    if full.stat().st_size > 5 * 1024 * 1024:
                        continue
                    text = full.read_text(errors="replace")
                except OSError:
                    continue
                rel = str(full.relative_to(root)).replace(os.sep, "/")
                for i, line in enumerate(text.splitlines(), 1):
                    for rule, title, pat in patterns.PROVIDER_TOKENS:
                        for m in pat.finditer(line[:200000]):
                            if patterns._is_placeholder(m.group(0)):
                                continue
                            out.append({"rule_id": "TC-SEC-007", "category": meta["category"], "title": meta["title"], "severity": meta["severity"],
                                        "confidence": meta["confidence"], "path": rel, "line": i, "col": m.start() + 1, "end_line": i, "end_col": m.end() + 1,
                                        "file_level": False, "evidence": m.group(0)[:4] + "…[masked]", "reason": f"Text in the format of a {title} is present in build output.",
                                        "remediation": meta["remediation"], "source": f"trustcode-artifacts:{rule}", "cwe": meta["cwe"], "owasp": [],
                                        "block": meta["block"], "priority": meta["priority"]})
                            break
    return out


PACKAGE_MANIFESTS = {"package.json", "pyproject.toml", "requirements.txt", "pom.xml", "build.gradle", "go.mod", "Cargo.toml", "composer.json"}


def package_summary(included: list[str], findings: list[dict]) -> list[dict]:
    """Per-package totals for repositories that contain several projects (monorepos)."""
    roots = sorted({os.path.dirname(p) for p in included if os.path.basename(p) in PACKAGE_MANIFESTS}, key=len, reverse=True)
    if len(roots) < 2:
        return []
    def owner(path: str) -> str:
        return next((r for r in roots if r == "" or path == r or path.startswith(r + "/")), "")
    out: dict[str, dict] = {r: {"root": r or ".", "files": 0, "findings": 0, "critical": 0, "high": 0} for r in roots}
    out.setdefault("", {"root": ".", "files": 0, "findings": 0, "critical": 0, "high": 0})
    for p in included:
        out[owner(p)]["files"] += 1
    for f in findings:
        if f.get("state") == "suppressed":
            continue
        o = out[owner(f["path"])]
        o["findings"] += 1
        if f["severity"] in ("critical", "high"):
            o[f["severity"]] += 1
    return sorted(out.values(), key=lambda x: x["root"])


def _lines(path: Path) -> list[str]:
    try:
        return path.read_text(errors="replace").splitlines()
    except OSError:
        return []


def osv_lookup(packages: dict[tuple[str, str, str], tuple[str, int]], timeout: float = 20) -> tuple[list[dict], str | None]:
    """Looks package versions up in the OSV database. Only ecosystem, name and version are sent."""
    keys = list(packages)
    findings: list[dict] = []
    for i in range(0, len(keys), 500):
        body = json.dumps({"queries": [{"package": {"ecosystem": e, "name": n}, "version": v} for e, n, v in keys[i:i + 500]]}).encode()
        req = urllib.request.Request("https://api.osv.dev/v1/querybatch", data=body, headers={"Content-Type": "application/json", "User-Agent": "trustcode-scan"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                results = json.loads(resp.read()).get("results", [])
        except Exception as e:
            return [], f"The advisory database could not be reached ({type(e).__name__})."
        for key, res in zip(keys[i:i + 500], results):
            vulns = [str(v.get("id")) for v in (res or {}).get("vulns", []) if v.get("id")]
            if not vulns:
                continue
            eco, name, version = key
            path, line = packages[key]
            malicious = any(v.startswith("MAL-") for v in vulns)
            meta = RULES["TC-DEP-004"]
            findings.append({"rule_id": "TC-DEP-004", "category": "dependencies",
                             "title": "Malicious package version" if malicious else meta["title"],
                             "severity": "critical" if malicious else "high", "confidence": "confirmed", "path": path, "line": line, "col": 1, "end_line": line,
                             "end_col": 1, "file_level": line <= 1, "evidence": f"{name} {version} ({eco})",
                             "reason": f"{len(vulns)} advisory record(s) match this exact version: {', '.join(vulns[:4])}{'…' if len(vulns) > 4 else ''}.",
                             "remediation": meta["remediation"], "source": "osv:" + vulns[0], "cwe": meta["cwe"], "owasp": ["A06:2021 Vulnerable Components"],
                             "block": "BLOCK" if malicious else meta["block"], "priority": meta["priority"]})
    return findings, None


def fingerprint(f: dict, line_text: str) -> str:
    return _sha(f"{f['rule_id']}|{f['path']}|{re.sub(r'\\s+', ' ', line_text).strip()}".encode())[:24]


def dedupe(findings: list[dict]) -> list[dict]:
    """One finding per (file, line, category): the most severe / most certain report wins, the others are recorded on it."""
    best: dict[tuple, dict] = {}
    for f in findings:
        key = (f["path"], f["line"], f["category"])
        cur = best.get(key)
        if cur is None:
            best[key] = {**f, "also_reported_by": []}
            continue
        rank = lambda x: (SEV_RANK[x["severity"]], CONF_RANK[x["confidence"]], x["end_col"] - x["col"] if x["end_line"] == x["line"] else 0)  # noqa: E731
        if rank(f) > rank(cur):
            best[key] = {**f, "also_reported_by": cur["also_reported_by"] + [cur["source"]]}
        elif f["source"] != cur["source"]:
            cur["also_reported_by"].append(f["source"])
    return list(best.values())


# --------------------------------------------------------------------------------------- state files
def _read_json(path: Path, default):
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def _write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=1, sort_keys=True) + "\n")
    os.replace(tmp, path)


def _tool_ver(name: str, flag: str) -> str | None:
    exe = _which(name)
    if not exe:
        return None
    r = run([exe, flag], cwd=tempfile.gettempdir(), timeout=20)
    m = re.search(r"\d+\.\d+(\.\d+)?", (r.stdout or "") + (r.stderr or ""))
    return m.group(0) if m else None


def tools_status() -> list[dict]:
    sg = semgrep_cmd()
    version = tool_version("semgrep") if sg else None
    nums = [int(x) for x in re.findall(r"\d+", version or "")[:2]]
    compatible = bool(nums) and (nums[0], nums[1] if len(nums) > 1 else 0) >= (1, 50)
    git_v = (_git(Path("."), "--version") or "").strip() or None
    return [
        {"name": "semgrep", "role": "code-level rules (patterns and data flow)", "installed": bool(sg), "version": version, "compatible": compatible if sg else None,
         "status": "ready" if sg and compatible else "incompatible version (1.50 or newer expected)" if sg else "not installed",
         "detail": "" if sg else "Install with: pip install 'trustcode-worker[tools]' (or pip install semgrep). Without it only credential, environment and configuration rules run."},
        {"name": "bandit", "role": "second set of Python security rules (optional)", "installed": bandit_available() is not None, "version": bandit_available(),
         "compatible": True if bandit_available() else None, "status": "ready" if bandit_available() else "not installed (optional)",
         "detail": "" if bandit_available() else "Optional: pip install bandit. Python files are still covered by the Semgrep rules."},
        {"name": "gitleaks", "role": "second credential detector (optional)", "installed": bool(_which("gitleaks")), "version": _tool_ver("gitleaks", "version"),
         "compatible": True if _which("gitleaks") else None, "status": "ready" if _which("gitleaks") else "not installed (optional)",
         "detail": "" if _which("gitleaks") else "Optional. Credentials are still covered by the built-in rules."},
        {"name": "osv-scanner", "role": "dependency advisories for more lockfile formats (optional, network)", "installed": bool(_which("osv-scanner")),
         "version": _tool_ver("osv-scanner", "--version"), "compatible": True if _which("osv-scanner") else None,
         "status": "ready (used when advisory lookups are on)" if _which("osv-scanner") else "not installed (optional)",
         "detail": "" if _which("osv-scanner") else "Optional. The built-in OSV lookup covers npm and Python lockfiles."},
        {"name": "trustcode-patterns", "role": "credentials, environment files, agent and CI configuration", "installed": True, "version": ENGINE, "compatible": True, "status": "ready", "detail": "Built in."},
        {"name": "git", "role": "ignore rules, staged and outgoing changes", "installed": bool(git_v), "version": git_v, "compatible": True if git_v else None,
         "status": "ready" if git_v else "not installed", "detail": "" if git_v else "Full-project scans still work; staged and outgoing-change scans need Git."},
        {"name": "osv", "role": "known-vulnerable dependency versions", "installed": True, "version": "api.osv.dev", "compatible": True, "status": "opt-in (network)",
         "detail": "Runs only with --online or \"network\": true; sends package names and versions, never source code."},
    ]


# --------------------------------------------------------------------------------------- modes
def _materialise(root: Path, spec: str, paths: list[str]) -> Path:
    """Writes the given revisions of files (`:path` = index, `REV:path`) into a private temporary directory."""
    tmp = Path(tempfile.mkdtemp(prefix="trustcode-scan-"))
    os.chmod(tmp, 0o700)
    for p in paths:
        if ".." in p.split("/") or p.startswith("/"):
            continue
        r = subprocess.run(["git", "show", f"{spec}{p}"], cwd=root, capture_output=True, timeout=30)
        if r.returncode == 0:
            dest = tmp / p
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(r.stdout)
    return tmp


def scan(root: str | Path, mode: str = "full", *, paths: list[str] | None = None, use_cache: bool = True, online: bool | None = None,
         update_baseline: bool = False, history: bool = False, base: str | None = None, allow_policy_change: bool = False,
         artifacts: bool | None = None) -> dict:
    """Runs a scan. `mode`: full | changed | new | staged | push | production | ci. Returns the report (see docs/security_scanner.md).
    `history`: also look for provider-format credentials on lines added in the last 500 commits (opt-in)."""
    t0 = time.monotonic()
    root = Path(root).resolve()
    _harden_search_path(root)
    cfg = load_config(root)
    online = cfg["network"] if online is None else online
    notes: list[str] = [cfg["_error"]] if cfg.get("_error") else []
    checks: list[dict] = []
    scan_root, cleanup, scope = root, None, None  # scope: files examined in this run (None = everything)
    diff_args: list[str] | None = ["HEAD"]       # what "this change" is compared with, for weakened-control detection
    _progress("Finding files")
    try:
        if mode == "staged":
            out = _git(root, "diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR")
            if out is None:
                return _failed(mode, root, "Staged-file scanning needs a Git repository.", t0)
            scope = [p for p in out.split("\0") if p]
            scan_root = cleanup = _materialise(root, ":", scope)
            diff_args = ["--cached"]
        elif mode == "push":
            base = None
            for ref in ("@{upstream}", "origin/HEAD", "origin/main", "origin/master"):
                if _git(root, "rev-parse", "--verify", "--quiet", ref) is not None:
                    base = ref
                    break
            if _git(root, "rev-parse", "HEAD") is None:
                return _failed(mode, root, "Outgoing-change scanning needs a Git repository with at least one commit.", t0)
            if base:
                scope = [p for p in (_git(root, "diff", "--name-only", "-z", "--diff-filter=ACMR", f"{base}..HEAD") or "").split("\0") if p]
                diff_args = [f"{base}..HEAD"]
                skipped = _unchecked_commits(root, base)
                if skipped:
                    notes.append(f"{len(skipped)} outgoing commit(s) were not checked when they were made (hook not installed, skipped with --no-verify, or made elsewhere): {', '.join(skipped[:5])}. They are checked now.")
            else:
                scope = [p for p in (_git(root, "ls-tree", "-r", "--name-only", "-z", "HEAD") or "").split("\0") if p]
                notes.append("No upstream branch was found, so every file in HEAD is treated as outgoing.")
            scan_root = cleanup = _materialise(root, "HEAD:", scope)
        elif mode == "new":
            out = _git(root, "ls-files", "-z", "--others", "--exclude-standard")
            if out is None:
                return _failed(mode, root, "Finding new files needs a Git repository (new = not yet tracked). Use a full scan instead.", t0)
            scope = [p for p in out.split("\0") if p]
        elif mode == "changed":
            if paths is not None:
                scope = [p.replace(os.sep, "/") for p in paths]
            else:
                out = _git(root, "status", "--porcelain=v1", "-z", "--untracked-files=all")
                if out is None:
                    notes.append("Git is not available, so changed files cannot be determined: the whole project was scanned.")
                else:
                    scope, parts = [], out.split("\0")
                    i = 0
                    while i < len(parts):
                        e = parts[i]
                        if len(e) > 3:
                            if "D" not in e[:2]:
                                scope.append(e[3:])
                            if e[0] in "RC":
                                i += 1
                        i += 1
        if mode in ("production", "ci"):
            use_cache = False
            if base:   # compare the change with the branch it will be merged into
                diff_args = [f"{base}...HEAD"] if _git(root, "rev-parse", "--verify", "-q", base) is not None else ["HEAD"]
                if diff_args == ["HEAD"]:
                    notes.append(f"The base '{base}' was not found, so policy and control changes were compared with the last commit only.")

        disc = discover(scan_root, cfg)
        wanted = set(scope) if scope is not None else None
        targets = [p for p in disc["included"] if wanted is None or p in wanted]
        git_view = discover(root, cfg) if scan_root != root else disc   # ignore/tracked state always comes from the real repository
        cache_path = root / STATE_DIR / "cache.json"
        digest = rules_digest() + _sha(json.dumps({k: cfg[k] for k in ("disabled_rules", "max_file_kb")}, sort_keys=True).encode())[:8]
        cache = _read_json(cache_path, {}) if use_cache else {}
        cached = cache.get("files", {}) if cache.get("digest") == digest else {}
        by_sha = {v["sha"]: v for v in cached.values()}

        def git_state(p: str) -> str:
            return "no-git" if not git_view["git"] else "tracked" if p in git_view["tracked"] else "untracked" if p in (git_view["visible"] or ()) else "ignored"

        file_findings: dict[str, list[dict]] = {}
        shas: dict[str, str] = {}
        texts: dict[str, str] = {}
        from_cache = unreadable = 0
        need_semgrep: list[str] = []
        for p in targets:
            try:
                data = (scan_root / p).read_bytes()
            except OSError:
                unreadable += 1
                continue
            if b"\x00" in data[:8000]:
                disc["excluded"].setdefault("binary content", []).append(p)
                continue
            shas[p] = _sha(data)
            texts[p] = data.decode("utf-8", "replace")
            hit = cached.get(p) if cached.get(p, {}).get("sha") == shas[p] else by_sha.get(shas[p])   # by content: survives renames
            if hit is not None and not patterns.ENV_FILE.search(p):
                file_findings[p] = [{**f, "path": p} for f in hit["findings"]]
                from_cache += 1
                continue
            file_findings[p] = analyse_text(p, texts[p], git_state(p))
            if os.path.splitext(p)[1].lower() in SEMGREP_LANGS:
                need_semgrep.append(p)
        scanned = [p for p in targets if p in shas]
        _progress("Checking credentials and configuration", len(scanned), len(targets))
        checks.append({"id": "patterns", "name": "Credentials, environment files, agent and CI/container configuration", "status": "completed",
                       "detail": f"{len(scanned)} file(s) examined" + (f", {unreadable} unreadable" if unreadable else "") + "."})
        sast, sast_check = run_semgrep(scan_root, need_semgrep)
        if need_semgrep or not any(os.path.splitext(p)[1].lower() in SEMGREP_LANGS for p in scanned):
            checks.append(sast_check)
        else:
            checks.append({**sast_check, "status": "completed", "detail": "All code files were unchanged since the last scan (results reused)."})
        sast_failed = {p for p in need_semgrep if p not in sast}
        for p, items in sast.items():
            file_findings[p] = file_findings.get(p, []) + items
        extra, bandit_check = run_bandit(scan_root, [p for p in need_semgrep if p not in sast_failed])
        if bandit_check:
            checks.append(bandit_check)
        for p, items in extra.items():
            if p in file_findings:
                file_findings[p] += items
        leaks, leak_check = run_gitleaks(scan_root, set(scanned), texts, {p for p in scanned if patterns.ENV_FILE.search(p) and git_state(p) == "ignored"})
        if leak_check:
            checks.append(leak_check)
        for f in leaks:
            file_findings.setdefault(f["path"], []).append(f)
        artifact_findings: list[dict] = []
        build_dirs = [d for d in disc["excluded"].get("build output or cache", []) if d.endswith("/")]
        if (artifacts if artifacts is not None else mode in ("production", "ci")) and scan_root == root:
            artifact_findings = scan_artifacts(root, build_dirs)
            checks.append({"id": "artifacts", "name": "Credentials in build output", "status": "completed" if build_dirs else "skipped",
                           "detail": f"{len(build_dirs)} build director(ies) examined for credential formats." if build_dirs else "No build output directory was found."})
        else:
            checks.append({"id": "artifacts", "name": "Credentials in build output", "status": "skipped", "detail": "Runs in production and CI scans, or with --artifacts."})
        if disc["nested_repositories"]:
            notes.append(f"{len(disc['nested_repositories'])} nested repository(ies) are scanned as part of this project: {', '.join(disc['nested_repositories'][:5])}.")

        # ---- dependency advisories (opt-in network)
        packages: dict[tuple[str, str, str], tuple[str, int]] = {}
        for p in scanned:
            for eco, name, version in patterns.lockfile_packages(p, texts[p]):
                line = next((i for i, ln in enumerate(texts[p].splitlines(), 1) if name in ln and version in ln), 1)
                packages.setdefault((eco, name, version), (p, line))
        dep_findings: list[dict] = []
        if not packages:
            checks.append({"id": "dependencies", "name": "Known-vulnerable dependency versions", "status": "skipped",
                           "detail": "No lockfile or pinned requirements file with exact versions was found in scope."})
        elif not online:
            checks.append({"id": "dependencies", "name": "Known-vulnerable dependency versions", "status": "skipped",
                           "detail": f"{len(packages)} pinned package version(s) found but advisory lookups are off (use --online or set \"network\": true)."})
        else:
            dep_findings, err, ran = run_osv_scanner(scan_root, texts)
            how = "OSV-Scanner"
            if not ran:
                dep_findings, err = osv_lookup(packages)
                how = "the OSV advisory database"
            checks.append({"id": "dependencies", "name": "Known-vulnerable dependency versions", "status": "failed" if err else "completed",
                           "detail": err or f"{len(packages)} pinned package version(s) checked with {how}."})
        for f in dep_findings:
            file_findings.setdefault(f["path"], []).append(f)
        # ---- weakened security controls: what this change removed or switched off, compared with the last commit
        regression_findings: list[dict] = []
        diff = _git(root, "diff", "-U0", "--no-color", "--no-ext-diff", *diff_args) if diff_args and _git(root, "rev-parse", "--verify", "-q", "HEAD") else None
        if diff is None:
            checks.append({"id": "regressions", "name": "Weakened security controls (compared with the last commit)", "status": "skipped",
                           "detail": "Needs a Git repository with at least one commit."})
        else:
            for rule, rpath, rline, evidence, reason, extra in patterns.regressions(diff):
                if wanted is not None and rpath not in wanted and not extra.get("file_level"):
                    continue
                meta = RULES[rule]
                if extra.get("policy") and allow_policy_change:
                    notes.append(f"{rpath} changed; accepted for this run with --allow-policy-change.")
                    continue
                regression_findings.append({"rule_id": rule, "category": meta["category"], "title": meta["title"], "severity": extra.get("severity", meta["severity"]),
                                            "confidence": extra.get("confidence", meta["confidence"]), "path": rpath, "line": rline, "col": 1, "end_line": rline, "end_col": 1,
                                            "file_level": bool(extra.get("file_level")), "evidence": evidence, "reason": reason, "remediation": meta["remediation"],
                                            "source": f"trustcode-diff:{rule}", "cwe": meta["cwe"], "owasp": [], "block": meta["block"], "priority": meta["priority"]})
            checks.append({"id": "regressions", "name": "Weakened security controls (compared with the last commit)", "status": "completed",
                           "detail": "Removed guards, disabled tests, ignore rules and CI security steps were compared."})
        history_findings: list[dict] = []
        if history:
            log = _git(root, "log", "-p", "--all", "-n", "500", "--no-color", "--unified=0", "--no-ext-diff")
            if log is None:
                checks.append({"id": "history", "name": "Credentials in Git history", "status": "failed", "detail": "Git history could not be read."})
            else:
                meta = RULES["TC-SEC-006"]
                for commit, hpath, detector, masked in patterns.history_secrets(log):
                    history_findings.append({"rule_id": "TC-SEC-006", "category": meta["category"], "title": meta["title"], "severity": meta["severity"],
                                             "confidence": meta["confidence"], "path": hpath or "(unknown path)", "line": 1, "col": 1, "end_line": 1, "end_col": 1,
                                             "file_level": True, "evidence": f"commit {commit}: {masked}", "reason": "A credential-format value was added in this commit; it stays in the history even if the file is clean now.",
                                             "remediation": meta["remediation"], "source": f"trustcode-history:{detector}", "cwe": meta["cwe"], "owasp": [],
                                             "block": meta["block"], "priority": meta["priority"]})
                checks.append({"id": "history", "name": "Credentials in Git history", "status": "completed", "detail": "Lines added in the last 500 commits were examined."})
        else:
            checks.append({"id": "history", "name": "Credentials in Git history", "status": "skipped", "detail": "Off by default (use --history)."})
        for name in ("Authorization of each route (object-level access)", "Rate limiting and input validation", "Runtime behaviour"):
            checks.append({"id": "not-implemented", "name": name, "status": "skipped", "detail": "Not checked by this scanner."})

        if use_cache and scan_root == root:
            keep = {p: v for p, v in cached.items() if p not in shas and (root / p).is_file()} if wanted is not None else {}
            keep.update({p: {"sha": shas[p], "findings": [f for f in file_findings.get(p, []) if f["rule_id"] != "TC-DEP-004"]}
                         for p in scanned if p not in sast_failed})
            _write_json(cache_path, {"digest": digest, "files": keep})

        findings = dedupe([in_context(f) for p in scanned for f in file_findings.get(p, []) if f["rule_id"] not in cfg["disabled_rules"]])
        findings += [f for f in history_findings + regression_findings + artifact_findings if f["rule_id"] not in cfg["disabled_rules"] or f["rule_id"] == "TC-REG-009"]
        for f in findings:
            lines = texts.get(f["path"], "").splitlines()
            line_text = lines[f["line"] - 1] if 0 < f["line"] <= len(lines) else ""
            f["fingerprint"] = fingerprint(f, line_text if not f["file_level"] else f["evidence"])
            if not f["evidence"]:
                f["evidence"] = patterns.redact(line_text.strip())[:200]
        findings.sort(key=lambda f: (-SEV_RANK[f["severity"]], -CONF_RANK[f["confidence"]], f["path"], f["line"]))

        # ---- baseline: new / existing / reintroduced / suppressed; resolved / not revalidated
        baseline_path, reviewed_path = root / STATE_DIR / "baseline.json", root / STATE_DIR / "reviewed.json"
        baseline = _read_json(baseline_path, None)
        reviewed = {r["fingerprint"]: r for r in _read_json(reviewed_path, []) if isinstance(r, dict) and "fingerprint" in r}
        active = (baseline or {}).get("findings", {})
        gone = (baseline or {}).get("resolved", {})
        current = set()
        for f in findings:
            current.add(f["fingerprint"])
            f["state"] = ("suppressed" if f["fingerprint"] in reviewed and f["rule_id"] != "TC-REG-009" else "existing" if f["fingerprint"] in active
                          else "reintroduced" if f["fingerprint"] in gone else "new" if baseline is not None else "unclassified")
            if f["state"] == "suppressed":
                f["review"] = {k: reviewed[f["fingerprint"]].get(k) for k in ("reason", "reviewed_by", "reviewed_at")}
        resolved, not_revalidated = [], []
        examined = set(scanned) - sast_failed
        for fp, b in active.items():
            if fp in current:
                continue
            (resolved if b.get("path") in examined or (wanted is None and b.get("path") not in set(disc["included"])) else not_revalidated).append({"fingerprint": fp, **b})
        if (update_baseline or baseline is None and False) and wanted is None:
            now = datetime.now(timezone.utc).isoformat(timespec="seconds")
            new_active = {f["fingerprint"]: {"rule_id": f["rule_id"], "path": f["path"], "line": f["line"], "severity": f["severity"], "title": f["title"],
                                             "first_seen": active.get(f["fingerprint"], {}).get("first_seen", now)} for f in findings if f["state"] != "suppressed"}
            new_gone = {**gone, **{r["fingerprint"]: {"rule_id": r.get("rule_id"), "path": r.get("path"), "resolved_at": now} for r in resolved}}
            for fp in new_active:
                new_gone.pop(fp, None)
            _write_json(baseline_path, {"engine": ENGINE, "updated_at": now, "findings": new_active, "resolved": new_gone})

        # ---- status and gate
        failed_checks = [c for c in checks if c["status"] == "failed"]
        status = "incomplete" if failed_checks or unreadable else "complete"
        gate = _gate(mode, cfg, findings, status, failed_checks)
        if mode in ("staged", "push") and gate["decision"] != "not_applicable":
            _log_gate(root, mode, gate["decision"], status)
        coverage: dict[str, dict] = {}
        for p in scanned:
            lang, depth = _kind(p)
            c = coverage.setdefault(lang, {"language": lang, "files": 0, "analysis": depth})
            c["files"] += 1
        if sast_failed:
            for c in coverage.values():
                if c["analysis"] == "language-aware":
                    c["analysis"] = "language-aware rules did NOT run for some files (scanner failure)"
        visible_findings = [f for f in findings if f["state"] != "suppressed"]
        count = lambda key, items: {k: sum(1 for f in items if f[key] == k) for k in sorted({f[key] for f in items})}  # noqa: E731
        return {
            "schema": 1, "engine": ENGINE, "mode": mode, "status": status, "root": str(root), "duration_ms": int((time.monotonic() - t0) * 1000),
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "files": {"included": len(disc["included"]), "in_scope": len(targets), "scanned": len(scanned), "from_cache": from_cache, "unreadable": unreadable,
                      "excluded": {k: len(v) for k, v in sorted(disc["excluded"].items())},
                      "excluded_samples": {k: sorted(v)[:8] for k, v in sorted(disc["excluded"].items())},
                      "nested_repositories": disc["nested_repositories"], "git": git_view["git"]},
            "coverage": sorted(coverage.values(), key=lambda c: -c["files"]), "tools": tools_status(), "checks": checks, "notes": notes,
            "findings": findings,
            "summary": {"total": len(visible_findings), "by_severity": {s: sum(1 for f in visible_findings if f["severity"] == s) for s in reversed(SEVERITIES)},
                        "by_confidence": count("confidence", visible_findings), "by_category": count("category", visible_findings),
                        "by_state": count("state", findings), "files_with_findings": len({f["path"] for f in visible_findings})},
            "baseline": {"present": baseline is not None, "resolved": resolved, "not_revalidated": not_revalidated,
                         "suppressed": sum(1 for f in findings if f["state"] == "suppressed")},
            "gate": gate, "policy": {k: cfg[k] for k in ("block", "block_confidence", "block_existing", "on_incomplete")},
            "disabled_rules": sorted(str(x) for x in cfg["disabled_rules"]),
            "packages": package_summary(disc["included"], findings),
        }
    finally:
        if cleanup is not None:
            shutil.rmtree(cleanup, ignore_errors=True)


def _failed(mode: str, root: Path, why: str, t0: float) -> dict:
    return {"schema": 1, "engine": ENGINE, "mode": mode, "status": "failed", "root": str(root), "duration_ms": int((time.monotonic() - t0) * 1000),
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "files": {"included": 0, "in_scope": 0, "scanned": 0, "from_cache": 0, "unreadable": 0, "excluded": {}, "excluded_samples": {}, "nested_repositories": [], "git": False},
            "coverage": [], "tools": tools_status(), "checks": [], "notes": [why], "findings": [],
            "summary": {"total": 0, "by_severity": {s: 0 for s in reversed(SEVERITIES)}, "by_confidence": {}, "by_category": {}, "by_state": {}, "files_with_findings": 0},
            "baseline": {"present": False, "resolved": [], "not_revalidated": [], "suppressed": 0},
            "gate": {"mode": mode, "decision": "block", "reasons": [why], "blocking": []}, "policy": {}}


def _gate(mode: str, cfg: dict, findings: list[dict], status: str, failed_checks: list[dict]) -> dict:
    key = {"staged": "commit", "push": "push", "production": "production", "ci": "ci"}.get(mode)
    if key is None:
        return {"mode": mode, "decision": "not_applicable", "reasons": ["This scan mode reports findings and does not gate anything."], "blocking": []}
    threshold = cfg["block"].get(key, "critical")
    states = {"new", "reintroduced", "unclassified"} | ({"existing"} if cfg["block_existing"].get(key) else set())
    blocking = []
    for f in findings:
        if f["state"] not in states or CONF_RANK[f["confidence"]] < CONF_RANK.get(cfg["block_confidence"], 1):
            continue
        # Rule-level policy: INFO never blocks. At commit and push time only rules marked BLOCK stop the operation,
        # except critical findings, which always count. In CI and for production the severity threshold alone decides.
        if f["block"] == "INFO":
            continue
        if key in ("commit", "push") and f["block"] != "BLOCK" and f["severity"] != "critical":
            continue
        if threshold in SEV_RANK and SEV_RANK[f["severity"]] >= SEV_RANK[threshold]:
            blocking.append(f["fingerprint"])
    reasons = []
    decision = "allow"
    if blocking:
        decision = "block"
        reasons.append(f"{len(blocking)} finding(s) at or above '{threshold}' severity with at least '{cfg['block_confidence']}' confidence.")
    if status != "complete":
        what = "; ".join(c["detail"] for c in failed_checks) or "some files could not be read"
        if cfg["on_incomplete"].get(key) == "block":
            decision = "block"
            reasons.append(f"The scan is incomplete and the policy does not allow an incomplete scan here: {what}")
        else:
            decision = "block" if decision == "block" else "warn"
            reasons.append(f"The scan is incomplete - this is NOT a clean result: {what}")
    if decision == "allow":
        reasons.append("No finding meets the blocking policy. This is not a statement that the project is secure.")
    return {"mode": mode, "decision": decision, "reasons": reasons, "blocking": blocking}


def _log_gate(root: Path, mode: str, decision: str, status: str) -> None:
    tree = (_git(root, "write-tree") or "").strip() if mode == "staged" else (_git(root, "rev-parse", "HEAD^{tree}") or "").strip()
    if not tree:
        return
    path = root / STATE_DIR / "gate-log.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as fh:
        fh.write(json.dumps({"tree": tree, "mode": mode, "decision": decision, "status": status, "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}) + "\n")


def _unchecked_commits(root: Path, base: str) -> list[str]:
    """Outgoing commits whose tree was never seen by the pre-commit gate on this machine."""
    seen = set()
    try:
        for ln in (root / STATE_DIR / "gate-log.jsonl").read_text().splitlines():
            seen.add(json.loads(ln).get("tree"))
    except Exception:
        pass
    out = _git(root, "log", "--format=%h %T", f"{base}..HEAD") or ""
    return [ln.split()[0] for ln in out.splitlines() if len(ln.split()) == 2 and ln.split()[1] not in seen]


def mark_reviewed(root: str | Path, fingerprint_: str, reason: str, reviewer: str, report: dict | None = None) -> dict:
    """Records a reviewed false positive. Only the exact finding (rule + file + line text) is suppressed."""
    root = Path(root).resolve()
    if not reason.strip():
        raise ValueError("a reason is required")
    report = report or scan(root, "full")
    f = next((x for x in report["findings"] if x["fingerprint"] == fingerprint_), None)
    if f is None:
        raise ValueError("no current finding has this fingerprint")
    path = root / STATE_DIR / "reviewed.json"
    items = [r for r in _read_json(path, []) if isinstance(r, dict) and r.get("fingerprint") != fingerprint_]
    entry = {"fingerprint": fingerprint_, "rule_id": f["rule_id"], "path": f["path"], "line": f["line"], "severity": f["severity"], "title": f["title"],
             "reason": reason.strip()[:500], "reviewed_by": reviewer[:100], "reviewed_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    _write_json(path, items + [entry])
    return entry
