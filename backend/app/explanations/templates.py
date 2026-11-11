"""Deterministic (non-LLM) explanations at three levels.

Invariant (tested): for every level, the set of finding IDs and the `evidence` text are
identical - only wording/depth changes. Explanations never assert that code is safe or correct.
"""
from __future__ import annotations

LEVELS = ("beginner", "intermediate", "advanced")

LINT_WHY = {
    "F821": ("The code uses a name that is never defined, so it will crash with a NameError when this line runs.",
             "Undefined name -> NameError at runtime on this path."),
    "F401": ("Something is imported but never used. Harmless, but it can hint that the code is unfinished or copied.",
             "Unused import; possible leftover or missing usage."),
    "F841": ("A value is stored in a variable that is never used - the author may have forgotten a step.",
             "Assigned but unused local; may indicate missing logic."),
    "F811": ("A name is defined twice; the second definition silently replaces the first.",
             "Redefinition shadows an earlier definition."),
    "B006": ("A list or dict used as a default argument is shared between calls, so data can leak from one call to the next.",
             "Mutable default argument is shared across calls."),
    "B008": ("A function call in a default argument runs only once, when the function is defined.",
             "Call in default argument evaluated once at definition time."),
}

JS_LINT_WHY = {
    "nan-comparison": ("NaN never equals anything - not even itself - so this test always gives the same answer and the "
                       "'missing value' case is never caught.", "Comparison with NaN is constant; use Number.isNaN()."),
    "const-reassignment": ("The code changes a value that was declared as constant. JavaScript stops with an error when this line runs.",
                           "Assignment to a const binding -> TypeError at runtime on this path."),
    "duplicate-object-key": ("The same key is written twice in one object, so the first value is silently thrown away.",
                             "Duplicate key: the later value overrides the earlier one."),
    "duplicate-case": ("Two branches of the switch have the same label, so the second one can never run.",
                       "Duplicate case label: second branch is dead code."),
    "assignment-in-condition": ("A single = stores a value instead of comparing. The 'if' then checks the stored value, "
                                "so it is probably always true - and the variable has been changed.",
                                "Assignment in condition: tests the assigned value and mutates the operand."),
    "self-assignment": ("A variable is set to its own value, which does nothing - a step was probably left out.",
                        "Self-assignment has no effect; likely a missing operation."),
    "unreachable-code": ("This code comes after a return/throw in the same block, so it never runs.",
                         "Statement after return/throw/break/continue is unreachable."),
    "empty-catch": ("If something goes wrong in the 'try' part, the error is thrown away and the program carries on as if it worked.",
                    "Empty catch discards the error; failures become silent."),
    "unused-import": ("Something is imported but never used in the code you selected. Harmless, but it can hint that the code is unfinished.",
                      "Unused import in the submitted code; possible leftover or missing usage."),
}
LINT_WHY_EXTENDED = {
    "S110": ("Any error inside the 'try' is ignored, so the code can report success even when it failed.",
             "Exception swallowed (try/except/pass): failures become silent."),
    "E722": ("A bare 'except:' catches everything, including Ctrl-C and programming mistakes, which hides real bugs.",
             "Bare except catches BaseException; masks unrelated errors."),
    "F601": ("The same key appears twice in one dictionary, so the first value is silently thrown away.",
             "Duplicate dict key: later value overrides the earlier one."),
    "B012": ("A return inside 'finally' always wins: it replaces any other return value and hides errors.",
             "return/break/continue in finally overrides the try result and swallows exceptions."),
    "B023": ("Each function created in the loop uses the loop variable's final value, not the value it had when it was created.",
             "Closure captures loop variable by reference (late binding)."),
    "PLW0127": ("A variable is set to its own value, which does nothing - a step was probably left out.",
                "Self-assignment has no effect."),
}

CHECK_LIMITS = {
    "secrets": "Whether the credential is real and still active was not checked.",
    "types": "Only type consistency inside the submitted code was checked; imported code was not followed.",
    "security": "Whether untrusted input can actually reach this line was not traced.",
    "lint": "Static analysis cannot tell whether this affects the program's results.",
    "tests": "Only the inputs used by this test were checked; other inputs remain untested.",
    "dependencies": "Whether this is the package the author intended was not verified.",
    "syntax": "Nothing about behaviour can be verified until the code parses.",
    "requirements": "No automated check compared the code with the task.",
}

METHOD = {
    "secrets": "credential-format scan", "types": "static type checker",
    "security": "Semgrep pattern rule", "lint": "static analysis", "tests": "sandboxed test execution",
    "dependencies": "package registry lookup", "syntax": "parser", "requirements": "none (human review)",
}


def _where(f: dict, level: str) -> str:
    loc = f.get("location") or {}
    if not loc:
        return "Whole snippet"
    line = loc.get("line")
    end = loc.get("end_line")
    span = f"line {line}" if not end or end == line else f"lines {line}-{end}"
    if level == "beginner":
        return f"In the submitted code, {span}" + (f": `{f['code_excerpt']}`" if f.get("code_excerpt") else "")
    return span[0].upper() + span[1:] + (f" - `{f['code_excerpt']}`" if f.get("code_excerpt") and level == "intermediate" else "")


CROSS_FILE_WHY = {
    "import-of-deleted-file": ("This file still uses another file that was deleted or renamed in the same set of changes, so it will fail as soon as it is loaded.",
                               "Dangling import: the target was removed or renamed in this change set."),
    "import-not-found": ("This file uses another file of the project that does not exist. AI assistants sometimes refer to files they never created.",
                         "Unresolvable local import: target file absent from the workspace."),
    "imported-name-not-defined": ("This file asks another file for something that file does not contain, so loading it fails. AI assistants sometimes call functions they never wrote.",
                                  "Imported name absent from the target module -> ImportError at load."),
    "imported-name-not-exported": ("This file asks another file for something that file does not make available, so the value is missing when the code runs.",
                                   "Named import has no matching export in the target module."),
    "default-import-without-default-export": ("This file expects a main (default) value from another file, but that file only offers named values.",
                                              "Default import from a module without a default export."),
    "undeclared-dependency": ("The code uses a package that is not listed in the project's dependency file, so it works only if that package happens to be installed already.",
                              "Imported package missing from the manifest: breaks on a clean install."),
}
CROSS_FILE_NEXT = {
    "import-of-deleted-file": "Update the import to the new location, or restore the file.",
    "import-not-found": "Create the missing file, or correct the import path.",
    "imported-name-not-defined": "Define the name in the target module, or import the name that actually exists.",
    "imported-name-not-exported": "Export the name from the target module, or import a name it does export.",
    "default-import-without-default-export": "Use a named import ({ ... }), or add a default export to the target.",
    "undeclared-dependency": "Add the package to the manifest (after confirming its exact name on the registry), or remove the import.",
}


def _why(f: dict, level: str) -> str:
    md, check = f.get("metadata") or {}, f["check"]
    if f.get("rule_id") in CROSS_FILE_WHY and md.get("cross_file"):
        return CROSS_FILE_WHY[f["rule_id"]][0 if level == "beginner" else 1]
    if check in ("security", "secrets"):
        return (md.get("why_beginner") or f["message"]) if level == "beginner" else md.get("why", f["message"])
    if check == "types":
        return ("The code uses a value as one kind of thing (for example text) where another kind (for example a number) "
                "is declared. When this line runs it can crash or produce a wrong result." if level == "beginner"
                else "Static type mismatch inside the submitted code; likely TypeError or wrong value at runtime.")
    if check == "lint":
        b, t = ({**LINT_WHY, **LINT_WHY_EXTENDED, **JS_LINT_WHY}).get(f.get("rule_id"), ("This pattern often signals a bug or unfinished code.",
                                               "Lint rule violation; may indicate a defect."))
        return b if level == "beginner" else t
    if check == "tests":
        return ("When the code was run with the test's input, it gave a different result than the test expects - "
                "so the code does not behave as intended for at least this case." if level == "beginner"
                else "Observed behaviour diverges from the test oracle for this input.")
    if check == "dependencies":
        return ("The code imports a package that could not be found. AI assistants sometimes invent package names; "
                "installing a look-alike package can be dangerous." if level == "beginner"
                else "Unresolvable dependency: possible package hallucination / typosquatting risk.")
    if check == "syntax":
        return ("The code is not valid as written, so it cannot run at all." if f.get("rule_id") == "syntax-error"
                else "This line suggests part of the code may be unfinished.") if level == "beginner" else (
            "Parse failure: no further analysis is reliable." if f.get("rule_id") == "syntax-error"
            else "Incomplete-implementation marker.")
    return f["message"]


def _next(f: dict, level: str) -> str:
    md, check = f.get("metadata") or {}, f["check"]
    if f.get("rule_id") in CROSS_FILE_NEXT and md.get("cross_file"):
        return CROSS_FILE_NEXT[f["rule_id"]]
    if check == "types":
        return ("Compare the type the function promises with what this line really produces, then fix whichever is wrong."
                if level != "advanced" else "Fix the annotation or the expression.")
    if check in ("security", "secrets"):
        fix = md.get("fix", "Review how input reaches this line.")
        if level == "beginner":
            return f"Ask: can a user or another system control the data used here? If yes, change it. Suggested fix: {fix}"
        return fix
    if check == "tests":
        return ("Read the failing test's expected value, work out the correct answer by hand, and fix the code or the test."
                if level == "beginner" else "Reproduce with the failing input; fix the logic or confirm the test oracle.")
    if check == "lint":
        return "Check whether the line does what was intended; remove or complete it." if level != "advanced" else "Resolve or justify."
    if check == "dependencies":
        return ("Search the package registry yourself and confirm the exact name before installing anything."
                if level == "beginner" else "Confirm the distribution name/owner on the registry before installing.")
    if check == "syntax":
        if md.get("hint"):
            return md["hint"]
        return "Fix the reported line before trusting any other result." if level != "advanced" else "Fix parse error."
    return "Review manually."


def explain_finding(f: dict, level: str) -> dict:
    title = f["title"]
    ids = f"{f.get('rule_id') or ''}" + (f" ({', '.join(f['cwe'])})" if f.get("cwe") else "")
    what = {
        "beginner": title,
        "intermediate": f"{title} [{ids}]" if ids.strip() else title,
        "advanced": f"{f['id']} {f['tool']}:{ids}".strip(),
    }[level]
    item = {
        "finding_id": f["id"],
        "severity": f["severity"],
        "status": f["status"],
        "what": what,
        "where": _where(f, level),
        "method": (f"cross-file comparison ({f['tool']})" if (f.get("metadata") or {}).get("cross_file")
                   else f"{METHOD.get(f['check'], f['tool'])} ({f['tool']})"),
        "why": _why(f, level),
        "evidence": f["message"],                       # verbatim tool output - identical at all levels
        "could_not_verify": ("Only the files supplied with this change were compared; build tooling, path aliases and "
                             "runtime-generated modules were not considered." if (f.get("metadata") or {}).get("cross_file")
                             else CHECK_LIMITS.get(f["check"], "")),
        "next_step": _next(f, level),
        "source": "template",
    }
    if (f.get("metadata") or {}).get("also_reported_by"):
        item["also_reported_by"] = list(f["metadata"]["also_reported_by"])  # merged duplicate reports (same line + weakness)
    if level == "beginner" and (f.get("metadata") or {}).get("confidence"):
        item["why"] += " Note: this rule often produces false alarms - " + f["metadata"]["confidence"].split(" - ")[-1]
    elif (f.get("metadata") or {}).get("confidence"):
        item["confidence_note"] = f["metadata"]["confidence"]
    if level == "advanced":
        item["why"] = item["why"].split(";")[0]
    return item


STATUS_TEXT = {
    "passed": {"beginner": "This check ran and found nothing - but only within what it looks for.",
               "intermediate": "No findings within this check's scope.", "advanced": "No findings (scoped)."},
    "issues_found": {"beginner": "This check found something to look at.", "intermediate": "Findings reported.",
                     "advanced": "Findings."},
    "check_failed": {"beginner": "This check could not run, so we know nothing from it.",
                     "intermediate": "Check did not complete - treat as unknown.", "advanced": "Failed - unknown."},
    "not_run": {"beginner": "This was not checked at all.", "intermediate": "Not run.", "advanced": "Not run."},
    "needs_review": {"beginner": "A person needs to judge this - the tools cannot decide.",
                     "intermediate": "Requires human review.", "advanced": "Human review."},
}


def explain_check(c: dict, level: str) -> dict:
    return {"kind": c["kind"], "status": c["status"], "status_text": STATUS_TEXT[c["status"]][level],
            "summary": c["summary"], "scope": c["scope"] if level != "advanced" else c["scope"].split(".")[0] + ".",
            "tool": c["tool"], "tool_version": c.get("tool_version"), "error": c.get("error")}


def explain_unverified(u: dict, level: str) -> dict:
    return {"id": u["id"], "description": u["description"],
            "explanation": (f"{u['reason']} Any bug here would not have been caught by the checks."
                            if level == "beginner" else u["reason"]),
            "location": u.get("location")}


GUIDANCE = {
    "beginner": ["Passing checks are not proof of correctness. Look at the 'Not verified' list - that is where hidden bugs live.",
                 "Try one unusual input yourself (empty, negative, very large) and predict what should happen."],
    "intermediate": ["Checks are independent; review 'Not verified' areas and edge cases not covered by tests."],
    "advanced": ["No aggregate verdict is computed; see per-check scope."],
}
