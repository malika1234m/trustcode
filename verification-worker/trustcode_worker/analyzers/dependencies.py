"""Stage: dependency existence check (package-hallucination guard, cf. Spracklen et al.).

Imports are extracted statically. Standard-library modules are recognised offline.
Third-party packages are looked up on PyPI / npm only when registry checks are enabled
(TRUSTCODE_REGISTRY_CHECK=1); otherwise they are reported as NEEDS_REVIEW, never as OK.
Note: Python import names do not always equal distribution names (e.g. `yaml` -> PyYAML);
a missing distribution is therefore reported as "not found under this name" and marked
for human review rather than as a definite hallucination.
"""
from __future__ import annotations

import ast
import os
import re
import sys
import time
import urllib.error
import urllib.request

from ..models import Check, CheckKind, CheckStatus, Finding, FindingStatus, Language, Location, Severity

NODE_BUILTINS = {
    "assert", "async_hooks", "buffer", "child_process", "cluster", "console", "constants", "crypto", "dgram",
    "diagnostics_channel", "dns", "domain", "events", "fs", "fs/promises", "http", "http2", "https", "inspector",
    "module", "net", "os", "path", "perf_hooks", "process", "punycode", "querystring", "readline", "repl", "stream",
    "string_decoder", "sys", "timers", "tls", "trace_events", "tty", "url", "util", "v8", "vm", "wasi",
    "worker_threads", "zlib", "test",
}
# Common import-name -> distribution-name aliases (documented, not exhaustive).
PY_ALIASES = {"yaml": "PyYAML", "cv2": "opencv-python", "PIL": "Pillow", "sklearn": "scikit-learn",
              "bs4": "beautifulsoup4", "dateutil": "python-dateutil", "jwt": "PyJWT", "dotenv": "python-dotenv"}
LOCAL_MODULES = {"solution"}


def _python_imports(code: str) -> list[tuple[str, int]]:
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return []
    out = []
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            out += [(a.name.split(".")[0], n.lineno) for a in n.names]
        elif isinstance(n, ast.ImportFrom) and n.module and n.level == 0:
            out.append((n.module.split(".")[0], n.lineno))
    return out


def _js_imports(code: str) -> list[tuple[str, int]]:
    out = []
    pat = re.compile(r"""require\(\s*['"]([^'"]+)['"]\s*\)|from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]""")
    for i, line in enumerate(code.splitlines(), 1):
        for m in pat.finditer(line):
            name = next(g for g in m.groups() if g)
            if name.startswith((".", "/")):
                continue
            name = name.removeprefix("node:")
            name = "/".join(name.split("/")[:2]) if name.startswith("@") else name.split("/")[0]
            out.append((name, i))
    return out


def _registry_exists(lang: Language, name: str) -> bool | None:
    url = (f"https://pypi.org/pypi/{PY_ALIASES.get(name, name)}/json" if lang == Language.PYTHON
           else f"https://registry.npmjs.org/{name.replace('/', '%2F')}")
    req = urllib.request.Request(url, method="GET", headers={"User-Agent": "trustcode-worker/0.1"})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            return r.status == 200
    except urllib.error.HTTPError as e:
        return False if e.code == 404 else None
    except Exception:
        return None


def check_dependencies(code: str, lang: Language, local: frozenset[str] = frozenset(), registry: bool | None = None) -> Check:
    """`local`: top-level module names known to be part of the project (multi-file verification), never third-party.
    `registry`: force the registry lookup on/off; None uses TRUSTCODE_REGISTRY_CHECK."""
    t0 = time.monotonic()
    imports = _python_imports(code) if lang == Language.PYTHON else _js_imports(code)
    stdlib = sys.stdlib_module_names if lang == Language.PYTHON else NODE_BUILTINS
    third = {}
    for name, line in imports:
        if name not in stdlib and name not in LOCAL_MODULES and name not in local:
            third.setdefault(name, line)
    if registry is None:
        registry = os.environ.get("TRUSTCODE_REGISTRY_CHECK", "0") == "1"
    scope = ("Checks that imported packages are standard-library modules or exist on the public registry "
             f"({'PyPI' if lang == Language.PYTHON else 'npm'}). Does not check versions, licences, vulnerabilities "
             "or whether the package is the intended one.")
    if not third:
        return Check(kind=CheckKind.DEPENDENCIES, tool="trustcode-deps", status=CheckStatus.PASSED,
                     summary=f"{len(imports)} import(s), all standard library." if imports else "No imports.",
                     scope=scope, details={"imports": [n for n, _ in imports], "third_party": [], "third_party_lines": {}},
                     duration_ms=_ms(t0))
    findings, unknown = [], []
    for name, line in third.items():
        exists = _registry_exists(lang, name) if registry else None
        if exists is False:
            findings.append(Finding(
                id="", check=CheckKind.DEPENDENCIES, tool="registry lookup", rule_id="package-not-found",
                title=f"Package '{name}' not found on registry",
                message=(f"No package named '{PY_ALIASES.get(name, name)}' exists on "
                         f"{'PyPI' if lang == Language.PYTHON else 'npm'}. It may be hallucinated, misspelled, or "
                         "published under a different distribution name."),
                severity=Severity.HIGH, status=FindingStatus.NEEDS_HUMAN_REVIEW, location=Location(line=line), cwe=["CWE-829"]))
        elif exists is None:
            unknown.append(name)
    status = CheckStatus.ISSUES_FOUND if findings else CheckStatus.NEEDS_REVIEW if unknown else CheckStatus.PASSED
    summary = (f"{len(findings)} package(s) not found" if findings else
               f"{len(unknown)} third-party package(s) not verified: {', '.join(unknown)}" if unknown else
               f"All {len(third)} third-party package(s) exist on the registry.")
    return Check(kind=CheckKind.DEPENDENCIES, tool="trustcode-deps", status=status, summary=summary, scope=scope,
                 findings=findings, duration_ms=_ms(t0),
                 details={"third_party": list(third), "third_party_lines": third, "unverified": unknown,
                          "registry_checked": registry})


def _ms(t0):
    return int((time.monotonic() - t0) * 1000)
