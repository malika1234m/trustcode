"""Static analysis for JavaScript / TypeScript (extended profile).

A small set of deterministic, high-precision rules evaluated on the tree-sitter syntax tree (parse only,
never executes code, no Node.js needed). Each rule mirrors a well-known ESLint core rule so the meaning is
familiar; the rule id of the ESLint equivalent is recorded in the finding metadata.

Deliberately NOT implemented (reported in the scope text): undefined-name detection, type errors and data
flow. Those need whole-project information that a selected snippet does not carry, and guessing would
produce false alarms.
"""
from __future__ import annotations

import time

from ..models import Check, CheckKind, CheckStatus, Finding, Language, Location, Severity
from .syntax import _grammar_version, parse_tree

TOOL = "trustcode-jslint"
RULES = {
    # rule id: (title, severity, eslint equivalent)
    "nan-comparison": ("Comparison with NaN is always false", Severity.HIGH, "use-isnan"),
    "const-reassignment": ("Assignment to a const variable", Severity.HIGH, "no-const-assign"),
    "duplicate-object-key": ("Duplicate key in object literal", Severity.MEDIUM, "no-dupe-keys"),
    "duplicate-case": ("Duplicate case label in switch", Severity.MEDIUM, "no-duplicate-case"),
    "assignment-in-condition": ("Assignment used as an if-condition", Severity.MEDIUM, "no-cond-assign"),
    "self-assignment": ("Variable assigned to itself", Severity.MEDIUM, "no-self-assign"),
    "unreachable-code": ("Unreachable code", Severity.MEDIUM, "no-unreachable"),
    "empty-catch": ("Empty catch block swallows errors", Severity.LOW, "no-empty"),
    "unused-import": ("Imported name is never used", Severity.LOW, "no-unused-vars (imports)"),
}
SCOPE = (f"{len(RULES)} built-in syntax-tree rules ({', '.join(RULES)}). Does NOT check undefined names, types, "
         "data flow, logic or runtime behaviour; an unused import may be used outside the selected code.")

_TERMINATORS = {"return_statement", "throw_statement", "break_statement", "continue_statement"}
_HOISTED = {"function_declaration", "generator_function_declaration", "comment", "empty_statement",
            "class_declaration", "interface_declaration", "type_alias_declaration"}
_BINDING_PARENTS = {"formal_parameters", "required_parameter", "optional_parameter", "array_pattern", "object_pattern",
                    "pair_pattern", "assignment_pattern", "rest_pattern", "catch_clause", "import_specifier",
                    "import_clause", "namespace_import", "function_declaration", "class_declaration",
                    "generator_function_declaration", "arrow_function", "function_expression"}
_REF_TYPES = {"identifier", "type_identifier", "shorthand_property_identifier"}


def _text(n) -> str:
    return n.text.decode("utf-8", "replace")


def _walk(root):
    stack = [root]
    while stack:
        n = stack.pop()
        yield n
        stack.extend(reversed(n.children))


def _inside(n, type_names: set[str]) -> bool:
    p = n.parent
    while p is not None:
        if p.type in type_names:
            return True
        p = p.parent
    return False


def _literal_key(n) -> str | None:
    if n is None:
        return None
    if n.type in ("property_identifier", "number"):
        return _text(n)
    if n.type == "string":
        return _text(n)[1:-1]
    return None  # computed keys cannot be compared statically


def analyse(tree, lang: Language) -> list[tuple[str, object, str]]:
    """Return (rule id, node, detail) for every match."""
    out: list[tuple[str, object, str]] = []
    nodes = list(_walk(tree.root_node))
    has_jsx = any(n.type in ("jsx_element", "jsx_self_closing_element", "jsx_fragment") for n in nodes)

    # ---- bindings (for const-reassignment) and references (for unused-import)
    declared: dict[str, int] = {}
    consts: set[str] = set()
    imports: dict[str, object] = {}
    refs: dict[str, int] = {}
    for n in nodes:
        if n.type == "variable_declarator":
            name = n.child_by_field_name("name")
            if name is not None and name.type == "identifier":
                declared[_text(name)] = declared.get(_text(name), 0) + 1
                decl = n.parent
                if decl is not None and decl.type == "lexical_declaration" and decl.children and decl.children[0].type == "const":
                    consts.add(_text(name))
        elif n.type in ("identifier", "shorthand_property_identifier_pattern") and n.parent is not None \
                and n.parent.type in _BINDING_PARENTS:
            # a function/class name or a parameter/pattern element (not a default value expression)
            parent = n.parent
            is_default_value = parent.type == "assignment_pattern" and parent.child_by_field_name("right") == n
            is_fn_body = parent.type in ("arrow_function", "function_expression") and parent.child_by_field_name("body") == n
            if not is_default_value and not is_fn_body:
                declared[_text(n)] = declared.get(_text(n), 0) + 1
        if n.type in _REF_TYPES and not _inside(n, {"import_statement"}):
            refs[_text(n)] = refs.get(_text(n), 0) + 1
        if n.type == "import_statement":
            for m in _walk(n):
                if m.type == "import_specifier":
                    local = m.child_by_field_name("alias") or m.child_by_field_name("name")
                    if local is not None:
                        imports[_text(local)] = m
                elif m.type == "identifier" and m.parent is not None and m.parent.type in ("import_clause", "namespace_import"):
                    imports[_text(m)] = m

    for name, node in imports.items():
        if refs.get(name, 0) == 0 and not (name == "React" and has_jsx):
            out.append(("unused-import", node, f"`{name}` is imported but never referenced in the submitted code."))

    for n in nodes:
        t = n.type
        if t == "binary_expression":
            op = n.child_by_field_name("operator")
            if op is not None and _text(op) in ("==", "===", "!=", "!=="):
                for side in (n.child_by_field_name("left"), n.child_by_field_name("right")):
                    if side is not None and side.type == "identifier" and _text(side) == "NaN":
                        out.append(("nan-comparison", n, "NaN is not equal to anything, including itself; this comparison "
                                    f"is always {'true' if _text(op).startswith('!') else 'false'}. Use Number.isNaN(x)."))
                        break
        elif t == "object":
            seen: dict[str, object] = {}
            for c in n.named_children:
                key = None
                if c.type == "pair":
                    key = _literal_key(c.child_by_field_name("key"))
                elif c.type == "shorthand_property_identifier":
                    key = _text(c)
                elif c.type == "method_definition":
                    # getter + setter with the same name is legitimate
                    if any(ch.type in ("get", "set") for ch in c.children):
                        continue
                    key = _literal_key(c.child_by_field_name("name"))
                if key is None:
                    continue
                if key in seen:
                    out.append(("duplicate-object-key", c, f"Key `{key}` appears more than once; the later value silently replaces the earlier one."))
                seen[key] = c
        elif t == "switch_body":
            labels: set[str] = set()
            for c in n.named_children:
                if c.type != "switch_case":
                    continue
                v = c.child_by_field_name("value")
                if v is None or v.type not in ("string", "number", "true", "false", "null", "identifier", "member_expression"):
                    continue
                label = _text(v)
                if label in labels:
                    out.append(("duplicate-case", c, f"`case {label}` appears twice; the second branch can never run."))
                labels.add(label)
        elif t == "if_statement":
            cond = n.child_by_field_name("condition")
            inner = cond.named_children[0] if cond is not None and cond.named_children else None
            if inner is not None and inner.type == "assignment_expression":
                out.append(("assignment-in-condition", inner, "`=` assigns instead of comparing; the condition tests the assigned value. "
                            "Use `===` to compare (wrap in extra parentheses if the assignment is intended)."))
        elif t == "assignment_expression":
            left, right = n.child_by_field_name("left"), n.child_by_field_name("right")
            if left is not None and right is not None and left.type == right.type \
                    and left.type in ("identifier", "member_expression") and _text(left) == _text(right):
                out.append(("self-assignment", n, f"`{_text(left)}` is assigned to itself, which has no effect."))
        elif t in ("statement_block", "program"):
            kids = n.named_children
            for i, c in enumerate(kids[:-1]):
                if c.type in _TERMINATORS:
                    nxt = next((k for k in kids[i + 1:] if k.type not in _HOISTED), None)
                    if nxt is not None:
                        out.append(("unreachable-code", nxt, f"This code follows a `{c.type.split('_')[0]}` statement in the same block and can never run."))
                    break
        elif t == "catch_clause":
            body = n.child_by_field_name("body")
            if body is not None and not body.named_children:
                out.append(("empty-catch", n, "The catch block is empty: any error raised in the try block is silently discarded."))

        if t in ("assignment_expression", "augmented_assignment_expression", "update_expression"):
            target = n.child_by_field_name("left") or n.child_by_field_name("argument")
            if target is not None and target.type == "identifier":
                name = _text(target)
                if name in consts and declared.get(name, 0) == 1:
                    out.append(("const-reassignment", n, f"`{name}` is declared with const; assigning to it throws a TypeError at runtime."))
    return out


def check_js_lint(code: str, lang: Language) -> Check:
    t0 = time.monotonic()
    tree = parse_tree(code, lang)
    if tree is None:
        return Check(kind=CheckKind.LINT, tool=TOOL, status=CheckStatus.CHECK_FAILED,
                     summary="Parser not available; static analysis not run.", scope=SCOPE,
                     error="tree-sitter grammar not installed", duration_ms=_ms(t0))
    lines = code.splitlines()
    findings, seen = [], set()
    for rule, node, detail in analyse(tree, lang):
        line = node.start_point[0] + 1
        if (rule, line) in seen:
            continue
        seen.add((rule, line))
        title, sev, eslint = RULES[rule]
        findings.append(Finding(
            id="", check=CheckKind.LINT, tool=TOOL, rule_id=rule, title=title, message=detail, severity=sev,
            location=Location(line=line, end_line=node.end_point[0] + 1, column=node.start_point[1] + 1),
            code_excerpt=lines[line - 1].strip()[:200] if 0 < line <= len(lines) else None,
            metadata={"eslint_equivalent": eslint}))
    findings.sort(key=lambda f: (f.location.line, f.rule_id))
    return Check(kind=CheckKind.LINT, tool=TOOL, tool_version=_grammar_version(),
                 status=CheckStatus.ISSUES_FOUND if findings else CheckStatus.PASSED,
                 summary=f"{len(findings)} static-analysis finding(s)" if findings else "No findings for the built-in rules.",
                 scope=SCOPE, findings=findings, duration_ms=_ms(t0), details={"rules": list(RULES)})


def _ms(t0: float) -> int:
    return int((time.monotonic() - t0) * 1000)
