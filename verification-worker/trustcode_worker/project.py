"""Multi-file ("session") verification: verify a set of changed files together.

Every changed file goes through the normal single-file pipeline; on top of that, checks that only make sense
across files run once for the whole set:

  * imports     - a relative/local import must resolve to a file that exists in the workspace, must not point
                  at a file deleted in the same change, and an imported name must be defined/exported there;
  * declared_dependencies - a third-party package that is imported must be declared in the nearest manifest
                  (package.json / requirements*.txt / pyproject.toml) when one was supplied.

Findings are attributed: when the pre-change ("baseline") text of a modified file is supplied, the same checks
run on it and a finding that was already reported there is marked `preexisting`; otherwise `new` (created
files) or `unknown`.

Nothing is executed. Checks this engine cannot perform for a multi-file change (project tests, API-contract and
database-schema consistency, integration behaviour) are listed under `not_executed` with the reason - they are
never reported as passed.
"""
from __future__ import annotations

import ast
import json
import posixpath
import re
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Literal, Optional

from pydantic import BaseModel, Field

from .analyzers.dependencies import PY_ALIASES
from .analyzers.secrets import check_secrets
from .analyzers.syntax import parse_tree
from .models import (SEVERITY_ORDER, Check, CheckKind, CheckStatus, Finding, FindingStatus, Language, Location,
                     Severity, VerificationRequest)
from .pipeline import ENGINE_VERSION, verify

LANG_BY_EXT = {".py": Language.PYTHON, ".js": Language.JAVASCRIPT, ".jsx": Language.JAVASCRIPT, ".mjs": Language.JAVASCRIPT,
               ".cjs": Language.JAVASCRIPT, ".ts": Language.TYPESCRIPT, ".tsx": Language.TYPESCRIPT}
JS_EXTS = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".d.ts")
# Optional pipeline stages per depth ("deps" = package analysis, registry lookup only at deep).
DEPTHS: dict[str, frozenset[str]] = {
    "quick": frozenset({"lint", "types"}),
    "standard": frozenset({"lint", "types", "security", "secrets", "deps"}),
    "deep": frozenset({"lint", "types", "security", "secrets", "deps"}),
}
MAX_FILES = 60
MAX_IMPORTS_PER_FILE = 400      # imports examined per file by the cross-file checks
MAX_TOTAL_CHARS = 600_000


class SessionFile(BaseModel):
    path: str = Field(min_length=1, max_length=500)          # workspace-relative, forward slashes
    # context = read for structure only; related = unchanged file that imports a changed/deleted file (cross-file checks only)
    change: Literal["created", "modified", "deleted", "renamed", "context", "related"] = "modified"
    content: Optional[str] = Field(default=None, max_length=200_000)   # None for deleted files
    baseline: Optional[str] = Field(default=None, max_length=200_000)  # text before the change, when known
    renamed_from: Optional[str] = Field(default=None, max_length=500)


class SessionRequest(BaseModel):
    files: list[SessionFile] = Field(min_length=1, max_length=MAX_FILES)
    workspace_paths: list[str] = Field(default_factory=list, max_length=50_000)  # every path that exists now (names only)
    depth: Literal["quick", "standard", "deep"] = "standard"


def _norm(path: str) -> str:
    return posixpath.normpath(path.replace("\\", "/")).lstrip("/")


def language_of(path: str) -> Language | None:
    low = path.lower()
    return next((lang for ext, lang in LANG_BY_EXT.items() if low.endswith(ext)), None)


def _fingerprint(f: Finding) -> tuple:
    text = re.sub(r"\s+", " ", (f.code_excerpt or f.title)).strip()
    return (f.check.value, f.tool, f.rule_id, text)


# --------------------------------------------------------------------------- python structure
def _py_defined_names(code: str) -> tuple[set[str], bool] | None:
    """Top-level names a module defines, and whether its namespace is dynamic (star import / __getattr__)."""
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return None
    names: set[str] = set()
    dynamic = False

    def visit(body):
        nonlocal dynamic
        for n in body:
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                names.add(n.name)
                dynamic = dynamic or n.name == "__getattr__"
            elif isinstance(n, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
                for t in (n.targets if isinstance(n, ast.Assign) else [n.target]):
                    for x in ast.walk(t):
                        if isinstance(x, ast.Name):
                            names.add(x.id)
            elif isinstance(n, ast.Import):
                names.update((a.asname or a.name.split(".")[0]) for a in n.names)
            elif isinstance(n, ast.ImportFrom):
                if any(a.name == "*" for a in n.names):
                    dynamic = True
                names.update((a.asname or a.name) for a in n.names)
            elif isinstance(n, (ast.If, ast.Try, ast.With, ast.For, ast.While)):
                for part in ("body", "orelse", "finalbody"):
                    visit(getattr(n, part, []) or [])
                for h in getattr(n, "handlers", []) or []:
                    visit(h.body)
    visit(tree.body)
    return names, dynamic


def _py_imports(code: str) -> list[tuple[int, str, list[str], int]]:
    """(level, module, imported names, line) for every import statement."""
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return []
    out = []
    for n in ast.walk(tree):
        if isinstance(n, ast.ImportFrom):
            out.append((n.level, n.module or "", [a.name for a in n.names], n.lineno))
        elif isinstance(n, ast.Import):
            out += [(0, a.name, [], n.lineno) for a in n.names]
    return out


# --------------------------------------------------------------------------- javascript / typescript structure
def _text(n) -> str:
    return n.text.decode("utf-8", "replace")


def _walk(root):
    stack = [root]
    while stack:
        n = stack.pop()
        yield n
        stack.extend(reversed(n.children))


def _js_imports(code: str, lang: Language) -> list[tuple[str, list[str], bool, int]]:
    """(specifier, named imports, wants default, line) for static imports, re-exports and require()."""
    tree = parse_tree(code, lang)
    if tree is None:
        return []
    out = []
    for n in _walk(tree.root_node):
        if n.type in ("import_statement", "export_statement"):
            src = n.child_by_field_name("source")
            if src is None:
                continue
            names, default = [], False
            for m in _walk(n):
                if m.type == "import_specifier":
                    nm = m.child_by_field_name("name")
                    if nm is not None:
                        names.append(_text(nm))
                elif m.type == "identifier" and m.parent is not None and m.parent.type == "import_clause":
                    default = True
            type_only = any(c.type == "type" for c in n.children)
            out.append((_text(src)[1:-1], [] if type_only else names, default and not type_only, n.start_point[0] + 1))
        elif n.type == "call_expression":
            fn, args = n.child_by_field_name("function"), n.child_by_field_name("arguments")
            if fn is not None and fn.type in ("identifier", "import") and _text(fn) in ("require", "import") and args is not None:
                lits = [a for a in args.named_children if a.type == "string"]
                if len(lits) == 1 and len(args.named_children) == 1:
                    out.append((_text(lits[0])[1:-1], [], False, n.start_point[0] + 1))
    return out


def _js_exports(code: str, lang: Language) -> tuple[set[str], bool, bool] | None:
    """(named exports, has default export, statically unknowable) or None when the file does not parse."""
    tree = parse_tree(code, lang)
    if tree is None or tree.root_node.has_error:
        return None
    names: set[str] = set()
    default = unknowable = esm = False
    for n in _walk(tree.root_node):
        if n.type == "export_statement":
            esm = True
            kids = [c.type for c in n.children]
            if "default" in kids:
                default = True
            if "*" in kids or any(c.type == "namespace_export" for c in n.children):
                unknowable = unknowable or n.child_by_field_name("source") is not None and "*" in kids and "as" not in kids
            decl = n.child_by_field_name("declaration")
            if decl is not None:
                nm = decl.child_by_field_name("name")
                if nm is not None:
                    names.add(_text(nm))
                for m in _walk(decl):
                    if m.type == "variable_declarator":
                        target = m.child_by_field_name("name")
                        if target is not None:
                            names.update(_text(x) for x in _walk(target)
                                         if x.type in ("identifier", "shorthand_property_identifier_pattern"))
            for m in n.children:
                if m.type == "export_clause":
                    for spec in m.named_children:
                        if spec.type == "export_specifier":
                            alias = spec.child_by_field_name("alias") or spec.child_by_field_name("name")
                            if alias is not None:
                                if _text(alias) == "default":
                                    default = True
                                names.add(_text(alias))
                elif m.type == "namespace_export":
                    names.update(_text(x) for x in m.named_children if x.type == "identifier")
        elif n.type == "member_expression" and _text(n) in ("module.exports", "exports"):
            unknowable = True  # CommonJS: exports are assigned dynamically
    if not esm:
        unknowable = True
    return names, default, unknowable


# --------------------------------------------------------------------------- cross-file checks
class _Project:
    def __init__(self, req: SessionRequest):
        self.files = {_norm(f.path): f for f in req.files}
        self.deleted = {p for p, f in self.files.items() if f.change == "deleted"}
        self.deleted |= {_norm(f.renamed_from) for f in req.files if f.renamed_from}
        present = {p for p, f in self.files.items() if f.content is not None and f.change != "deleted"}
        self.paths = ({_norm(p) for p in req.workspace_paths} | present) - (self.deleted - present)
        self.dirs = {posixpath.dirname(p) for p in self.paths}
        self.have_listing = bool(req.workspace_paths)
        # top-level python module/package names that live in this workspace
        self.py_local = frozenset(
            {posixpath.basename(p)[:-3] for p in self.paths | self.deleted if p.endswith(".py") and not p.endswith("__init__.py")}
            | {posixpath.basename(posixpath.dirname(p)) for p in self.paths | self.deleted if p.endswith(".py") and posixpath.dirname(p)})
        # Suffix indexes, built once: every "a/b/c.py" is reachable by "c.py", "b/c.py" and "a/b/c.py" in O(1).
        # (Resolving an import must not scan the whole listing: the listing and the imports are client-supplied.)
        self.by_suffix = self._index(sorted(self.paths, key=len))
        self.deleted_suffixes = set(self._index(self.deleted))
        self.dir_suffixes = set(self._index(self.dirs))

    @staticmethod
    def _index(paths) -> dict[str, str]:
        out: dict[str, str] = {}
        for p in paths:
            parts = p.split("/")
            for i in range(len(parts)):
                out.setdefault("/".join(parts[i:]), p)   # shortest path wins (paths arrive sorted by length)
        return out

    def content(self, path: str) -> str | None:
        f = self.files.get(path)
        return f.content if f and f.change != "deleted" else None

    def baseline(self, path: str) -> str | None:
        f = self.files.get(path)
        return f.baseline if f else None

    # ---- python
    def resolve_py(self, importer: str, level: int, module: str) -> tuple[str | None, bool]:
        """Returns (resolved path or None, was a deleted file). Absolute imports are matched by path suffix."""
        parts = [p for p in module.split(".") if p]
        if level:
            base = posixpath.dirname(importer)
            for _ in range(level - 1):
                base = posixpath.dirname(base)
            stem = posixpath.join(base, *parts) if parts else base
            cands = [stem + ".py", posixpath.join(stem, "__init__.py")]
            hit = next((c for c in cands if _norm(c) in self.paths), None)
            if hit:
                return _norm(hit), False
            if _norm(stem) in self.dirs:
                return _norm(stem), False  # namespace package directory
            return None, any(_norm(c) in self.deleted for c in cands)
        tail = "/".join(parts)
        for suffix in (tail + ".py", tail + "/__init__.py"):
            hit = self.by_suffix.get(suffix)
            if hit:
                return hit, False
        if tail in self.dir_suffixes:
            return tail, False
        return None, (tail + ".py") in self.deleted_suffixes or (tail + "/__init__.py") in self.deleted_suffixes

    # ---- javascript / typescript
    def resolve_js(self, importer: str, spec: str) -> tuple[str | None, bool]:
        stem = _norm(posixpath.join(posixpath.dirname(importer), spec))
        cands = [stem] + [stem + e for e in JS_EXTS] + [posixpath.join(stem, "index" + e) for e in JS_EXTS[:6]]
        m = re.search(r"\.(m|c)?js$", stem)
        if m:  # TypeScript ESM style: import './x.js' refers to x.ts
            root = stem[:m.start()]
            cands += [root + e for e in (".ts", ".tsx", ".mts", ".cts")]
        hit = next((c for c in cands if c in self.paths), None)
        if hit:
            return hit, False
        return None, any(c in self.deleted for c in cands)


def _import_findings(proj: _Project, analysed: list[tuple[str, Language, str]]) -> tuple[list[tuple[str, Finding]], dict]:
    out: list[tuple[str, Finding]] = []
    stats = {"resolved": 0, "external": 0, "unresolved_aliases": 0, "names_checked": 0, "names_not_checkable": 0}

    def add(path, line, rule, title, message, sev, excerpt, status=FindingStatus.ISSUE_DETECTED, caused=None):
        md = {"cross_file": True}
        if caused is not None:
            md["caused_by_change"] = caused  # True: the target had this name before the change; False: it never did
            if caused:
                message += " The name existed in the previous version of that file and was removed or renamed in this change."
        out.append((path, Finding(id="", check=CheckKind.DEPENDENCIES, tool="trustcode-imports", rule_id=rule, title=title,
                                  message=message, severity=sev, status=status, location=Location(line=line),
                                  code_excerpt=excerpt, metadata=md)))

    def had_py(target, name):
        base = proj.baseline(target)
        d = _py_defined_names(base) if base is not None else None
        return None if d is None else (name in d[0] or d[1])

    def had_js(target, tlang, name, default=False):
        base = proj.baseline(target)
        e = _js_exports(base, tlang) if base is not None else None
        return None if e is None else (e[2] or (e[1] if default else name in e[0]))

    for path, lang, code in analysed:
        lines = code.splitlines()
        ex = lambda ln: lines[ln - 1].strip()[:200] if 0 < ln <= len(lines) else None  # noqa: E731
        if lang == Language.PYTHON:
            for level, module, names, line in _py_imports(code)[:MAX_IMPORTS_PER_FILE]:
                top = module.split(".")[0] if module else ""
                if not level and top not in proj.py_local:
                    stats["external"] += 1
                    continue
                target, was_deleted = proj.resolve_py(path, level, module)
                shown = "." * level + module
                if target is None:
                    if was_deleted:
                        add(path, line, "import-of-deleted-file", "Imports a module deleted in this change",
                            f"`{shown}` resolves to a file that was deleted or renamed in the same set of changes.", Severity.HIGH, ex(line))
                    elif proj.have_listing:
                        add(path, line, "import-not-found", "Imported module not found in the workspace",
                            f"`{shown}` looks like a module of this project, but no matching file exists in the workspace.",
                            Severity.HIGH if level else Severity.MEDIUM, ex(line),
                            FindingStatus.ISSUE_DETECTED if level else FindingStatus.NEEDS_HUMAN_REVIEW)
                    continue
                stats["resolved"] += 1
                src = proj.content(target) if target.endswith(".py") else None
                defined = _py_defined_names(src) if src is not None else None
                for name in names:
                    if name == "*":
                        continue
                    if defined is None or defined[1]:
                        stats["names_not_checkable"] += 1
                        continue
                    stats["names_checked"] += 1
                    pkg_dir = posixpath.dirname(target) if target.endswith("__init__.py") else None
                    is_submodule = pkg_dir is not None and (
                        posixpath.join(pkg_dir, name + ".py") in proj.paths or posixpath.join(pkg_dir, name) in proj.dirs)
                    if name not in defined[0] and not is_submodule:
                        add(path, line, "imported-name-not-defined", f"`{name}` is not defined in {target}",
                            f"`from {shown} import {name}`: {target} was checked and defines no top-level name `{name}`. "
                            "This import raises ImportError when the module loads.", Severity.HIGH, ex(line),
                            caused=had_py(target, name))
        else:
            for spec, names, wants_default, line in _js_imports(code, lang)[:MAX_IMPORTS_PER_FILE]:
                if not spec.startswith("."):
                    stats["unresolved_aliases" if spec.startswith(("@/", "~/", "#")) else "external"] += 1
                    continue
                target, was_deleted = proj.resolve_js(path, spec)
                if target is None:
                    if was_deleted:
                        add(path, line, "import-of-deleted-file", "Imports a file deleted in this change",
                            f"`{spec}` resolves to a file that was deleted or renamed in the same set of changes.", Severity.HIGH, ex(line))
                    elif proj.have_listing:
                        add(path, line, "import-not-found", "Imported file not found in the workspace",
                            f"`{spec}` does not resolve to any file in the workspace (tried the usual extensions and index files).",
                            Severity.HIGH, ex(line))
                    continue
                stats["resolved"] += 1
                tlang = language_of(target)
                src = proj.content(target) if tlang else None
                exported = _js_exports(src, tlang) if src is not None and tlang else None
                if exported is None or exported[2]:
                    stats["names_not_checkable"] += len(names) + int(wants_default)
                    continue
                for name in names:
                    stats["names_checked"] += 1
                    if name not in exported[0] and not (name == "default" and exported[1]):
                        add(path, line, "imported-name-not-exported", f"`{name}` is not exported by {target}",
                            f"`import {{ {name} }} from '{spec}'`: {target} was checked and has no export named `{name}`.",
                            Severity.HIGH, ex(line), caused=had_js(target, tlang, name))
                if wants_default:
                    stats["names_checked"] += 1
                    if not exported[1]:
                        add(path, line, "default-import-without-default-export", f"{target} has no default export",
                            f"A default import is used for '{spec}', but {target} only has named exports.", Severity.HIGH, ex(line),
                            caused=had_js(target, tlang, "default", default=True))
    return out, stats


def _norm_dist(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _manifest_packages(path: str, text: str) -> set[str] | None:
    base = posixpath.basename(path).lower()
    try:
        if base == "package.json":
            data = json.loads(text)
            return {n for k in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies")
                    for n in (data.get(k) or {})}
        if base.startswith("requirements") and base.endswith(".txt"):
            out = set()
            for ln in text.splitlines():
                ln = ln.split("#")[0].strip()
                m = re.match(r"^([A-Za-z0-9][A-Za-z0-9._-]*)", ln)
                if m and not ln.startswith("-"):
                    out.add(_norm_dist(m.group(1)))
            return out
        if base == "pyproject.toml":
            import tomllib
            data = tomllib.loads(text)
            specs = list((data.get("project") or {}).get("dependencies") or [])
            for group in ((data.get("project") or {}).get("optional-dependencies") or {}).values():
                specs += list(group)
            out = {_norm_dist(re.match(r"^([A-Za-z0-9][A-Za-z0-9._-]*)", s).group(1)) for s in specs
                   if re.match(r"^[A-Za-z0-9]", s)}
            poetry = ((data.get("tool") or {}).get("poetry") or {})
            for key in ("dependencies", "dev-dependencies"):
                out |= {_norm_dist(n) for n in (poetry.get(key) or {})}
            return out
    except Exception:
        return None
    return None


def _nearest(path: str, manifests: dict[str, set[str]], names: tuple[str, ...]) -> tuple[str, set[str]] | None:
    d = posixpath.dirname(path)
    while True:
        hits = [(m, pk) for m, pk in manifests.items() if posixpath.dirname(m) == d and posixpath.basename(m).lower().startswith(names)]
        if hits:
            return hits[0][0], set().union(*[pk for _, pk in hits])
        if not d:
            return None
        d = posixpath.dirname(d)


def _declared_dependency_findings(proj: _Project, per_file: dict[str, dict]) -> tuple[list[tuple[str, Finding]], dict]:
    manifests: dict[str, set[str]] = {}
    unreadable = []
    for p, f in proj.files.items():
        if f.content is None or f.change == "deleted":
            continue
        base = posixpath.basename(p).lower()
        if base in ("package.json", "pyproject.toml") or (base.startswith("requirements") and base.endswith(".txt")):
            pk = _manifest_packages(p, f.content)
            if pk is None:
                unreadable.append(p)
            else:
                manifests[p] = pk
    out: list[tuple[str, Finding]] = []
    stats = {"manifests": sorted(manifests), "unreadable_manifests": unreadable, "files_without_manifest": [], "packages_checked": 0}
    for path, info in per_file.items():
        third: dict[str, int] = info["third_party"]
        if not third:
            continue
        py = info["language"] == Language.PYTHON
        near = _nearest(path, manifests, ("requirements", "pyproject") if py else ("package.json",))
        if near is None:
            stats["files_without_manifest"].append(path)
            continue
        mpath, declared = near
        lines = info["code"].splitlines()
        for name, line in third.items():
            stats["packages_checked"] += 1
            if py:
                ok = _norm_dist(PY_ALIASES.get(name, name)) in declared or _norm_dist(name) in declared
            else:
                ok = name in declared or ("@types/" + name) in declared
            if ok:
                continue
            out.append((path, Finding(
                id="", check=CheckKind.DEPENDENCIES, tool="trustcode-manifest", rule_id="undeclared-dependency",
                title=f"Package '{name}' is imported but not declared in {posixpath.basename(mpath)}",
                message=(f"`{name}` is imported here, but {mpath} does not list it"
                         + (" (Python import names can differ from distribution names, so check the name)." if py else
                            ". A fresh install of the project would not include it.")),
                severity=Severity.MEDIUM,
                status=FindingStatus.NEEDS_HUMAN_REVIEW if py else FindingStatus.ISSUE_DETECTED,
                location=Location(line=line), code_excerpt=lines[line - 1].strip()[:200] if 0 < line <= len(lines) else None,
                metadata={"cross_file": True, "manifest": mpath})))
    return out, stats


# --------------------------------------------------------------------------- data files
def _data_file_checks(path: str, text: str, depth: str) -> list[Check]:
    checks = []
    low = path.lower()
    if low.endswith(".json") or low.endswith(".toml"):
        kind = "JSON" if low.endswith(".json") else "TOML"
        try:
            if kind == "JSON":
                json.loads(text)
            else:
                import tomllib
                tomllib.loads(text)
            checks.append(Check(kind=CheckKind.SYNTAX, tool=f"{kind.lower()} parser", status=CheckStatus.PASSED,
                                summary=f"Valid {kind}.", scope=f"Confirms the file is well-formed {kind}. Says nothing about whether the values are right."))
        except Exception as e:
            line = getattr(e, "lineno", None) or 1
            checks.append(Check(kind=CheckKind.SYNTAX, tool=f"{kind.lower()} parser", status=CheckStatus.ISSUES_FOUND,
                                summary=f"Not valid {kind}.", scope=f"Confirms the file is well-formed {kind}.",
                                findings=[Finding(id="", check=CheckKind.SYNTAX, tool=f"{kind.lower()} parser", rule_id="syntax-error",
                                                  title=f"Invalid {kind}", message=str(e)[:300], severity=Severity.CRITICAL,
                                                  location=Location(line=line))]))
    if depth != "quick":
        checks.append(check_secrets(text))
    return checks


# --------------------------------------------------------------------------- entry point
NOT_EXECUTED = [
    {"check": "Project tests", "reason": "Tests were not run: the sandbox executes one file with supplied tests and cannot install or "
                                         "run a multi-file project. A test file being present says nothing about whether it passes."},
    {"check": "API contract consistency", "reason": "Not implemented: routes, clients and their request/response shapes were not compared."},
    {"check": "Database schema consistency", "reason": "Not implemented: migrations, models and queries were not compared."},
    {"check": "Integration / runtime behaviour", "reason": "Nothing was executed, so behaviour across files was not observed."},
]


def verify_session(req: SessionRequest, profile: str = "extended", max_workers: int = 4,
                   allow_registry: bool | None = None) -> dict:
    """`allow_registry`: whether this server may contact PyPI / npm. A client asking for the deep check can
    never switch outbound lookups on by itself; None reads the operator setting TRUSTCODE_REGISTRY_CHECK."""
    import os
    t0 = time.monotonic()
    proj = _Project(req)
    only = DEPTHS[req.depth]
    if allow_registry is None:
        allow_registry = os.environ.get("TRUSTCODE_REGISTRY_CHECK", "0") == "1"
    registry = bool(allow_registry) and req.depth == "deep"
    total = sum(len(f.content or "") + len(f.baseline or "") for f in req.files)
    if total > MAX_TOTAL_CHARS:
        raise ValueError(f"session payload too large ({total} characters; limit {MAX_TOTAL_CHARS})")

    def run_file(item: tuple[str, SessionFile]) -> dict:
        path, f = item
        entry: dict = {"path": path, "change": f.change, "renamed_from": f.renamed_from, "language": None, "analysed": False,
                       "reason": None, "lines": 0, "checks": [], "findings": [], "unverified": [], "attribution": "unknown"}
        if f.change == "deleted" or f.content is None:
            entry["reason"] = "File was deleted: there is no content to analyse. Imports of it from the other files are checked."
            return entry
        entry["lines"] = len(f.content.splitlines())
        if "\x00" in f.content:
            entry["reason"] = "Binary content: not analysed."
            return entry
        lang = language_of(path)
        if lang is None:
            checks = _data_file_checks(path, f.content, req.depth)
            entry["checks"] = checks
            entry["analysed"] = bool(checks)
            entry["language"] = "data"
            entry["reason"] = ("No code analyzer for this file type: only " +
                               (" and ".join(sorted({"well-formedness" if c.kind == CheckKind.SYNTAX else "credential formats" for c in checks}))
                                if checks else "nothing") + " was checked.")
            return entry
        entry["language"] = lang.value
        if f.change in ("context", "related"):
            # read for structure only (what it defines / imports): no analyzers are run on unchanged files
            if lang == Language.PYTHON:
                parses = _py_defined_names(f.content) is not None
            else:
                tree = parse_tree(f.content, lang)
                parses = tree is not None and not tree.root_node.has_error
            entry.update(analysed=parses, _code=f.content, _lang=lang, _third={}, _parses=parses,
                         reason=None if parses else "Does not parse: could not be used for cross-file checks.")
            return entry
        result = verify(VerificationRequest(code=f.content, language=lang), run_tests=False, profile=profile, only=only,
                        local_modules=proj.py_local if lang == Language.PYTHON else frozenset(), registry=registry)
        entry.update(analysed=True, checks=result.checks, unverified=[u for u in result.unverified
                                                                       if u.description not in ("Runtime behaviour",)])
        deps = result.check(CheckKind.DEPENDENCIES)
        entry["_code"], entry["_lang"] = f.content, lang
        entry["_parses"] = bool(result.checks[0].details.get("parses"))
        entry["_third"] = dict((deps.details or {}).get("third_party_lines") or {}) if deps else {}
        if f.change in ("context", "related"):
            return entry
        if f.change == "created" and not f.renamed_from:
            entry["attribution"] = "all_new"
        elif f.baseline is not None:
            base = verify(VerificationRequest(code=f.baseline, language=lang), run_tests=False, profile=profile, only=only,
                          local_modules=proj.py_local if lang == Language.PYTHON else frozenset(), registry=False)
            entry["_baseline_fps"] = [_fingerprint(x) for c in base.checks for x in c.findings]
            entry["attribution"] = "compared_with_baseline"
        return entry

    items = list(proj.files.items())
    with ThreadPoolExecutor(max_workers=max(1, min(max_workers, len(items))), thread_name_prefix="trustcode-file") as pool:
        entries = list(pool.map(run_file, items))

    # ---- cross-file checks (standard and deep)
    project_checks: list[dict] = []
    cross: list[tuple[str, Finding]] = []
    analysed_code = [(e["path"], e["_lang"], e["_code"]) for e in entries if e.get("_code") is not None and e["change"] != "context"
                     and e.get("_parses")]
    if req.depth == "quick":
        project_checks.append({"kind": "imports", "status": "not_run", "summary": "Not part of the Quick check.",
                               "scope": "Not run: imports between files were NOT checked.", "tool": "trustcode-imports"})
        project_checks.append({"kind": "declared_dependencies", "status": "not_run", "summary": "Not part of the Quick check.",
                               "scope": "Not run: package declarations were NOT checked.", "tool": "trustcode-manifest"})
    else:
        imp, st = _import_findings(proj, analysed_code)
        cross += imp
        note = "" if proj.have_listing else " No workspace file listing was supplied, so only imports of deleted files could be detected."
        project_checks.append({
            "kind": "imports", "tool": "trustcode-imports", "status": "issues_found" if imp else "passed",
            "summary": (f"{len(imp)} import problem(s) between files" if imp else
                        f"{st['resolved']} local import(s) resolve; {st['names_checked']} imported name(s) found in their module.") + note,
            "scope": ("Checks that relative/local imports in the changed files point at files that exist, are not deleted in this change, "
                      "and that imported names are defined/exported there (only when the target file's text was supplied). "
                      f"Not checked: {st['unresolved_aliases']} path-alias import(s), {st['names_not_checkable']} name(s) in modules "
                      "that were not supplied or export dynamically, and whether the imported thing is used correctly."),
            "details": st})
        dep, ds = _declared_dependency_findings(
            proj, {e["path"]: {"third_party": e["_third"], "language": e["_lang"], "code": e["_code"]}
                   for e in entries if e.get("_code") is not None and e["change"] not in ("context", "related")})
        cross += dep
        nothing = not ds["manifests"]
        project_checks.append({
            "kind": "declared_dependencies", "tool": "trustcode-manifest",
            "status": "not_run" if nothing else "issues_found" if dep else "passed",
            "summary": ("No package manifest (package.json / requirements.txt / pyproject.toml) was supplied." if nothing else
                        f"{len(dep)} imported package(s) not declared" if dep else
                        f"{ds['packages_checked']} imported package(s) are declared in their manifest."),
            "scope": ("Checks that third-party packages imported by the changed files are listed in the nearest manifest. "
                      "Does not check versions, lock files, or that the package is installed."
                      + (f" {len(ds['files_without_manifest'])} file(s) had no manifest to compare with." if ds["files_without_manifest"] else "")),
            "details": ds})
    by_path: dict[str, list[Finding]] = {}
    for path, f in cross:
        by_path.setdefault(path, []).append(f)

    # ---- assemble the report
    counters: dict[str, int] = {}
    files_out, all_findings = [], []
    matrix: dict[str, dict[str, int]] = {}
    for e in entries:
        checks: list[Check] = e["checks"]
        base_fps = list(e.get("_baseline_fps") or [])
        findings_out = []
        own = [(c.kind.value, f) for c in checks for f in c.findings] + [("cross_file", f) for f in by_path.get(e["path"], [])]
        if e["change"] == "context":
            own = []  # context files are read for structure only; their findings are not part of this change
        elif e["change"] == "related":
            own = [kf for kf in own if kf[1].metadata.get("cross_file") and kf[1].tool == "trustcode-imports"]
        base_text = proj.baseline(e["path"])
        for _, f in sorted(own, key=lambda kf: (SEVERITY_ORDER[kf[1].severity], kf[1].location.line if kf[1].location else 0)):
            if e["attribution"] == "all_new":
                introduced = "new"
            elif f.metadata.get("cross_file") and f.tool == "trustcode-imports":
                # caused by this change when the target vanished or lost the name; otherwise judged from the importer's history
                if f.rule_id == "import-of-deleted-file" or f.metadata.get("caused_by_change") is True:
                    introduced = "new"
                elif e["change"] == "related":
                    introduced = "preexisting" if f.metadata.get("caused_by_change") is False else "unknown"
                elif base_text is not None and f.code_excerpt:
                    introduced = "preexisting" if f.code_excerpt in base_text else "new"
                else:
                    introduced = "unknown"
            elif e["attribution"] == "compared_with_baseline" and not f.metadata.get("cross_file"):
                fp = _fingerprint(f)
                if fp in base_fps:
                    base_fps.remove(fp)
                    introduced = "preexisting"
                else:
                    introduced = "new"
            else:
                introduced = "unknown"
            prefix = {"syntax": "SYN", "lint": "LINT", "security": "SEC", "secrets": "SCRT", "types": "TYPE",
                      "dependencies": "DEP"}.get(f.check.value, "GEN")
            if f.tool == "trustcode-imports":
                prefix = "IMP"
            elif f.tool == "trustcode-manifest":
                prefix = "PKG"
            counters[prefix] = counters.get(prefix, 0) + 1
            f.id = f"{prefix}-{counters[prefix]}"
            d = f.model_dump(mode="json")
            d.update(path=e["path"], introduced=introduced)
            findings_out.append(d)
        for c in checks:
            if e["change"] not in ("context", "related"):
                matrix.setdefault(c.kind.value, {}).setdefault(c.status.value, 0)
                matrix[c.kind.value][c.status.value] += 1
        files_out.append({
            "path": e["path"], "change": e["change"], "renamed_from": e["renamed_from"], "language": e["language"],
            "analysed": e["analysed"], "reason": e["reason"], "lines": e["lines"], "attribution": e["attribution"],
            "checks": [{"kind": c.kind.value, "status": c.status.value, "summary": c.summary, "scope": c.scope, "tool": c.tool,
                        "tool_version": c.tool_version, "error": c.error, "findings": len(c.findings)} for c in checks],
            "unverified": [u.model_dump(mode="json") for u in e["unverified"]],
            "findings": findings_out})
        all_findings += findings_out
    changed = [f for f in files_out if f["change"] not in ("context", "related")]
    sev = {s.value: sum(1 for f in all_findings if f["severity"] == s.value) for s in Severity}
    not_executed = list(NOT_EXECUTED)
    if req.depth != "deep":
        not_executed.append({"check": "Package registry lookup", "reason": "Only part of the Deep check: whether imported packages exist on PyPI / npm was not looked up."})
    elif not registry:
        not_executed.append({"check": "Package registry lookup", "reason": "Registry lookups are switched off on this server, so whether imported packages exist on PyPI / npm was not looked up."})
    return {
        "kind": "session", "schema_version": "1.0", "engine_version": ENGINE_VERSION, "depth": req.depth, "profile": profile,
        "files": files_out, "project_checks": project_checks, "not_executed": not_executed,
        "summary": {
            "files_changed": len(changed), "files_analysed": sum(f["analysed"] for f in changed),
            "files_not_analysed": [{"path": f["path"], "reason": f["reason"]} for f in changed if not f["analysed"]],
            "context_files": sum(f["change"] == "context" for f in files_out),
            "related_files": sum(f["change"] == "related" for f in files_out),
            "findings": len(all_findings), "by_severity": sev,
            "new": sum(f["introduced"] == "new" for f in all_findings),
            "preexisting": sum(f["introduced"] == "preexisting" for f in all_findings),
            "unknown_origin": sum(f["introduced"] == "unknown" for f in all_findings),
            "checks": matrix, "duration_ms": int((time.monotonic() - t0) * 1000)},
        "disclaimer": ("These results describe what specific automated checks did and did not find in the supplied files. "
                       "Passing checks do not establish that the change is correct, complete or secure."),
    }
