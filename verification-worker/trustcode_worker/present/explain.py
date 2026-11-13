"""Evidence (immutable) -> the adapted view shown to the developer. Shared by the server and the local engine."""
from __future__ import annotations

from collections.abc import Callable

from .adaptation import AdaptationDecision
from .templates import GUIDANCE, explain_check, explain_finding, explain_unverified

SEV_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}


def feedback_note(n: int) -> str:
    return f"You marked findings from this rule as wrong {n} times. It is still reported; decide whether this one is different."


def build_explanation(result: dict, adaptation: AdaptationDecision, *, rule_feedback: dict[str, dict] | None = None,
                      rewrite: Callable[[list[dict], list[dict]], tuple[list[dict], dict]] | None = None) -> dict:
    """`rewrite(findings, items) -> (items, info)` lets a caller replace wording (the server's optional LLM step).
    It receives template items and must return items for the same findings; evidence is never passed through it."""
    level = adaptation.level
    findings = sorted((f for c in result["checks"] for f in c["findings"]), key=lambda f: SEV_RANK[f["severity"]])
    items = [explain_finding(f, level) for f in findings]
    llm_info: dict = {"used": False}
    if rewrite is not None and findings:
        items, llm_info = rewrite(findings, items)
    learned = []
    if rule_feedback:
        rule_of = {f["id"]: f"{f['tool']}:{f.get('rule_id')}" for f in findings}
        for it in items:
            hist = rule_feedback.get(rule_of.get(it["finding_id"], ""))
            if not hist:
                continue
            n = hist["incorrect"]
            it["your_feedback"] = {"marked_wrong": n, "rule": rule_of[it["finding_id"]], "note": feedback_note(n)}
            # presentation only: never collapse what must always be explained
            if it["severity"] not in adaptation.always_explain_severities:
                it["collapsed"] = True
            learned.append(rule_of[it["finding_id"]])
    if adaptation.collapse_low_severity:
        for it in items:
            it["collapsed"] = it.get("collapsed", False) or it["severity"] in ("low", "info")
    return {
        "level": level,
        "adaptation": adaptation.to_dict(),
        "checks": [explain_check(c, level) for c in result["checks"]],
        "findings": items,
        "unverified": [explain_unverified(u, level) for u in result.get("unverified", [])],
        "guidance": GUIDANCE[level],
        "disclaimer": result.get("disclaimer"),
        "llm": llm_info,
        "learned_from_feedback": sorted(set(learned)),
    }


def explain_session(report: dict, level: str, rule_feedback: dict[str, dict] | None = None) -> dict:
    """The multi-file report with an explanation attached to every finding. Evidence is never altered."""
    files = []
    for f in report["files"]:
        items = []
        for x in f["findings"]:
            e = explain_finding(x, level)
            rule = f"{x['tool']}:{x.get('rule_id')}"
            hist = (rule_feedback or {}).get(rule)
            if hist:
                e["your_feedback"] = {"marked_wrong": hist["incorrect"], "rule": rule, "note": feedback_note(hist["incorrect"])}
            items.append({**x, "explained": e})
        files.append({**f, "findings": items})
    return {**report, "level": level, "files": files}
