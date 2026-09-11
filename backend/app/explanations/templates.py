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

CHECK_LIMITS = {
    "security": "Whether untrusted input can actually reach this line was not traced.",
    "lint": "Static analysis cannot tell whether this affects the program's results.",
    "tests": "Only the inputs used by this test were checked; other inputs remain untested.",
    "dependencies": "Whether this is the package the author intended was not verified.",
    "syntax": "Nothing about behaviour can be verified until the code parses.",
    "requirements": "No automated check compared the code with the task.",
}

METHOD = {
    "security": "Semgrep pattern rule", "lint": "ruff static analysis", "tests": "sandboxed test execution",
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


def _why(f: dict, level: str) -> str:
    md, check = f.get("metadata") or {}, f["check"]
    if check == "security":
        return md.get("why_beginner") if level == "beginner" else md.get("why", f["message"])
    if check == "lint":
        b, t = LINT_WHY.get(f.get("rule_id"), ("This pattern often signals a bug or unfinished code.",
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
    if check == "security":
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
        "method": f"{METHOD.get(f['check'], f['tool'])} ({f['tool']})",
        "why": _why(f, level),
        "evidence": f["message"],                       # verbatim tool output - identical at all levels
        "could_not_verify": CHECK_LIMITS.get(f["check"], ""),
        "next_step": _next(f, level),
        "source": "template",
    }
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
