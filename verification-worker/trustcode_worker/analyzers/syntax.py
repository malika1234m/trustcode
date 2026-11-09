"""Stage 1: syntax and structure (parse only, never execute).

Python: the standard-library `ast` parser.
JavaScript / TypeScript: tree-sitter grammars (parse-only, pure-Python wheels, no Node.js needed).
This replaced `node --check`, which on Node 20 silently skips parsing for ES-module code (QA-13)
and is unavailable on serverless hosts.

Besides "parses / does not parse" the stage classifies what was submitted, so later stages and the UI
can describe it correctly:
  * partial selections (starting inside a block comment, or mid-block in Python) get an explicit hint;
  * TypeScript type-declaration code (e.g. .d.ts content) is marked `declarations_only` — it contains no
    runnable code, so behaviour checks are "not applicable" rather than failures.
"""
from __future__ import annotations

import ast
import functools
import re
import time
from pathlib import Path

from ..models import Check, CheckKind, CheckStatus, Finding, Language, Location, Severity

_INCOMPLETE = re.compile(r"(TODO|FIXME|NotImplementedError|\.\.\.\s*$|pass\s*#\s*implement|throw new Error\(['\"]not implemented)", re.I | re.M)
SCOPE = "Confirms the code can be parsed. Says nothing about behaviour, logic or security."
# Node types that indicate runnable code (outside `declare ...` blocks).
_RUNNABLE = {"statement_block", "expression_statement", "lexical_declaration", "variable_declaration", "class_body"}


def _incomplete_markers(code: str) -> list[Finding]:
    out = []
    for i, line in enumerate(code.splitlines(), 1):
        if _INCOMPLETE.search(line):
            out.append(Finding(
                id="", check=CheckKind.SYNTAX, tool="trustcode-structure", rule_id="incomplete-marker",
                title="Possible incomplete implementation",
                message=f"Line contains a marker that often indicates unfinished code: {line.strip()[:120]}",
                severity=Severity.LOW, location=Location(line=i), code_excerpt=line.strip()[:200]))
    return out


def selection_hint(code: str, lang: Language) -> str | None:
    """Explain the most common cause of a parse error in a *selection*: it does not start at a statement."""
    first = next((ln for ln in code.splitlines() if ln.strip()), "")
    s = first.strip()
    if lang != Language.PYTHON and (s.startswith("*") and not s.startswith("*/") or s == "*/" or s.startswith("*/")):
        return "The selection starts inside a /** ... */ comment — include the opening /** (or start the selection after the comment)."
    if lang == Language.PYTHON and first[:1] in (" ", "\t"):
        return "The selection starts in the middle of an indented block — select the whole function or block, starting at its first line."
    return None


@functools.lru_cache
def _parser(lang: Language, tsx: bool = False):
    """Return a tree-sitter parser, or None if the grammar packages are not installed."""
    try:
        from tree_sitter import Language as TSLanguage, Parser
        if lang == Language.TYPESCRIPT:
            import tree_sitter_typescript as tst
            grammar = tst.language_tsx() if tsx else tst.language_typescript()
        else:
            import tree_sitter_javascript as tsj
            grammar = tsj.language()
        return Parser(TSLanguage(grammar))
    except Exception:
        return None


def _grammar_version() -> str | None:
    try:
        from importlib.metadata import version
        return f"tree-sitter {version('tree-sitter')}"
    except Exception:
        return None


def parse_tree(code: str, lang: Language):
    p = _parser(lang)
    if p is None:
        return None
    tree = p.parse(code.encode("utf-8"))
    if lang == Language.TYPESCRIPT and tree.root_node.has_error and re.search(r"<[A-Za-z]", code):
        tsx = _parser(lang, tsx=True)  # JSX inside TypeScript (.tsx)
        if tsx is not None:
            alt = tsx.parse(code.encode("utf-8"))
            if not alt.root_node.has_error:
                return alt
    return tree


def _first_error(node):
    """Depth-first search for the first ERROR or MISSING node."""
    stack = [node]
    while stack:
        n = stack.pop()
        if n.type == "ERROR" or n.is_missing:
            return n
        stack.extend(reversed(n.children))
    return None


def declarations_only(tree) -> bool:
    """True when the code contains only type-level declarations (interfaces, type aliases, `declare ...`,
    function signatures, imports/comments) and therefore nothing that can run."""
    root = tree.root_node
    if not root.named_children:
        return False
    stack = list(root.named_children)
    found_decl = False
    while stack:
        n = stack.pop()
        if n.type in ("comment",):
            continue
        if n.type in ("ambient_declaration", "interface_declaration", "type_alias_declaration", "function_signature",
                      "abstract_class_declaration"):
            found_decl = True
            continue  # contents of a declaration are types, never runnable
        if n.type in _RUNNABLE:
            return False
        stack.extend(n.named_children)
    return found_decl


def _functions(tree) -> list[str]:
    names, stack = [], [tree.root_node]
    while stack:
        n = stack.pop()
        if n.type in ("function_declaration", "method_definition", "function_signature", "generator_function_declaration"):
            name = n.child_by_field_name("name")
            if name is not None:
                names.append(name.text.decode("utf-8", "replace"))
        stack.extend(n.named_children)
    return names


def check_syntax(code: str, lang: Language, workdir: Path) -> Check:
    t0 = time.monotonic()
    if lang == Language.PYTHON:
        try:
            tree = ast.parse(code)
        except SyntaxError as e:
            hint = selection_hint(code, lang)
            f = Finding(id="", check=CheckKind.SYNTAX, tool="python-ast", rule_id="syntax-error",
                        title="Syntax error" + (" (partial selection?)" if hint else ""),
                        message=f"{e.msg}" + (f" — {hint}" if hint else ""), severity=Severity.CRITICAL,
                        location=Location(line=e.lineno or 1, column=e.offset), metadata={"hint": hint} if hint else {})
            return Check(kind=CheckKind.SYNTAX, tool="python-ast", tool_version=_py_version(), status=CheckStatus.ISSUES_FOUND,
                         summary="The code does not parse; later checks are unreliable or skipped.", scope=SCOPE,
                         findings=[f], duration_ms=_ms(t0), details={"parses": False, "partial_selection": bool(hint)})
        funcs = [n.name for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
        markers = _incomplete_markers(code)
        return Check(kind=CheckKind.SYNTAX, tool="python-ast", tool_version=_py_version(),
                     status=CheckStatus.ISSUES_FOUND if markers else CheckStatus.PASSED,
                     summary=("Parses successfully" + (f"; {len(markers)} incomplete-code marker(s)" if markers else "")),
                     scope=SCOPE, findings=markers, duration_ms=_ms(t0),
                     details={"parses": True, "functions": funcs, "lines": len(code.splitlines())})

    name = "TypeScript" if lang == Language.TYPESCRIPT else "JavaScript"
    tool = f"tree-sitter ({name.lower()})"
    tree = parse_tree(code, lang)
    if tree is None:
        return Check(kind=CheckKind.SYNTAX, tool=tool, status=CheckStatus.CHECK_FAILED,
                     summary=f"{name} parser not available; syntax not checked.", scope=SCOPE,
                     error="tree-sitter grammar not installed", duration_ms=_ms(t0))
    if tree.root_node.has_error:
        err = _first_error(tree.root_node) or tree.root_node
        line = err.start_point[0] + 1
        snippet = code.splitlines()[line - 1].strip()[:120] if 0 < line <= len(code.splitlines()) else ""
        hint = selection_hint(code, lang)
        what = "missing " + err.type if err.is_missing else f"unexpected syntax near `{snippet}`" if snippet else "unexpected syntax"
        if lang == Language.JAVASCRIPT and _parser(Language.TYPESCRIPT) is not None:
            ts_tree = parse_tree(code, Language.TYPESCRIPT)
            if ts_tree is not None and not ts_tree.root_node.has_error:
                hint = hint or "This is valid TypeScript, not JavaScript — verify it as TypeScript."
        f = Finding(id="", check=CheckKind.SYNTAX, tool=tool, rule_id="syntax-error",
                    title="Syntax error" + (" (partial selection?)" if hint and "selection" in hint else ""),
                    message=f"{name} parse error: {what}" + (f" — {hint}" if hint else ""), severity=Severity.CRITICAL,
                    location=Location(line=line, column=err.start_point[1] + 1), code_excerpt=snippet or None,
                    metadata={"hint": hint} if hint else {})
        return Check(kind=CheckKind.SYNTAX, tool=tool, tool_version=_grammar_version(), status=CheckStatus.ISSUES_FOUND,
                     summary="The code does not parse; later checks are unreliable or skipped.", scope=SCOPE,
                     findings=[f], duration_ms=_ms(t0), details={"parses": False, "partial_selection": bool(hint and "selection" in hint)})
    decl_only = lang == Language.TYPESCRIPT and declarations_only(tree)
    markers = _incomplete_markers(code)
    summary = ("Parses successfully — type declarations only (no runnable code)" if decl_only else "Parses successfully")
    if markers:
        summary += f"; {len(markers)} incomplete-code marker(s)"
    return Check(kind=CheckKind.SYNTAX, tool=tool, tool_version=_grammar_version(),
                 status=CheckStatus.ISSUES_FOUND if markers else CheckStatus.PASSED,
                 summary=summary, scope=SCOPE, findings=markers, duration_ms=_ms(t0),
                 details={"parses": True, "functions": _functions(tree), "lines": len(code.splitlines()),
                          "declarations_only": decl_only})


def _py_version() -> str:
    import sys
    return f"Python {sys.version.split()[0]}"


def _ms(t0: float) -> int:
    return int((time.monotonic() - t0) * 1000)
