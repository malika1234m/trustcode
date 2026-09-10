"""Explanation engine entry point: evidence (immutable) -> adapted explanation view."""
from __future__ import annotations

from ..adaptation.engine import AdaptationDecision
from . import llm as llm_mod
from .templates import GUIDANCE, explain_check, explain_finding, explain_unverified

SEV_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}


def build_explanation(result: dict, adaptation: AdaptationDecision, *, use_llm: bool = False, api_key: str | None = None,
                      model: str = "claude-opus-5-5", code: str | None = None, task: str | None = None) -> dict:
    level = adaptation.level
    findings = sorted((f for c in result["checks"] for f in c["findings"]), key=lambda f: SEV_RANK[f["severity"]])
    items = [explain_finding(f, level) for f in findings]
    llm_info = {"used": False}
    if use_llm and api_key and findings:
        out = llm_mod.generate(result, code, task, level, api_key, model)
        if out is not None:
            items, notes = llm_mod.validate(out, items)
            llm_info = {"used": True, "model": model, "validation_notes": notes,
                        "assumptions": [{"statement": a.statement, "line": a.line, "status": "needs_human_review",
                                         "source": "llm"} for a in out.assumptions[:5]]}
        else:
            llm_info = {"used": False, "fallback": "template", "reason": "LLM unavailable or output rejected"}
    if adaptation.collapse_low_severity:
        for it in items:
            it["collapsed"] = it["severity"] in ("low", "info")
    return {
        "level": level,
        "adaptation": adaptation.to_dict(),
        "checks": [explain_check(c, level) for c in result["checks"]],
        "findings": items,
        "unverified": [explain_unverified(u, level) for u in result.get("unverified", [])],
        "guidance": GUIDANCE[level],
        "disclaimer": result.get("disclaimer"),
        "llm": llm_info,
    }
