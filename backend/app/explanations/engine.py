"""Explanation engine entry point: evidence (immutable) -> adapted explanation view.

The deterministic part lives in the engine package (shared with the local engine); this module adds the
server-only optional LLM wording step."""
from __future__ import annotations

from trustcode_worker.present.explain import SEV_RANK, build_explanation as _build

from ..adaptation.engine import AdaptationDecision
from . import llm as llm_mod

__all__ = ["SEV_RANK", "build_explanation"]


def build_explanation(result: dict, adaptation: AdaptationDecision, *, use_llm: bool = False, api_key: str | None = None,
                      model: str = "claude-opus-5-5", code: str | None = None, task: str | None = None,
                      rule_feedback: dict[str, dict] | None = None) -> dict:
    def rewrite(findings: list[dict], items: list[dict]) -> tuple[list[dict], dict]:
        out = llm_mod.generate(result, code, task, adaptation.level, api_key, model)
        if out is None:
            return items, {"used": False, "fallback": "template", "reason": "LLM unavailable or output rejected"}
        items, notes = llm_mod.validate(out, items)
        return items, {"used": True, "model": model, "validation_notes": notes,
                       "assumptions": [{"statement": a.statement, "line": a.line, "status": "needs_human_review",
                                        "source": "llm"} for a in out.assumptions[:5]]}

    return _build(result, adaptation, rule_feedback=rule_feedback, rewrite=rewrite if use_llm and api_key else None)
