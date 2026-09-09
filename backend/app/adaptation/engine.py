"""Explicit, transparent adaptation (no opaque profiling).

Inputs: developer-selected level, opt-in feedback history, result complexity.
Outputs: the level to render, presentation options, and (only if the user opted in)
a *suggestion* to change level. The level is never changed automatically.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

LEVELS = ("beginner", "intermediate", "advanced")


@dataclass
class AdaptationDecision:
    level: str
    reasons: list[str] = field(default_factory=list)
    always_explain_severities: list[str] = field(default_factory=lambda: ["critical", "high"])
    collapse_low_severity: bool = False
    suggestion: dict | None = None

    def to_dict(self):
        return asdict(self)


def decide(selected_level: str, n_findings: int, recent_ratings: list[str], suggestions_enabled: bool,
           override: str | None = None) -> AdaptationDecision:
    level = override if override in LEVELS else selected_level if selected_level in LEVELS else "intermediate"
    d = AdaptationDecision(level=level, reasons=[f"level '{level}' " + ("requested for this view" if override in LEVELS
                                                                         else "selected in your profile")])
    if n_findings > 8 and level != "advanced":
        d.collapse_low_severity = True
        d.reasons.append(f"{n_findings} findings: low-severity items are collapsed (all remain available)")
    d.reasons.append("critical/high findings always include why they matter, at every level")
    if suggestions_enabled and len(recent_ratings) >= 3:
        last = recent_ratings[-5:]
        idx = LEVELS.index(selected_level) if selected_level in LEVELS else 1
        if last.count("too_technical") >= 3 and idx > 0:
            d.suggestion = {"to": LEVELS[idx - 1], "because": "3+ of your last 5 ratings said explanations were too technical"}
        elif last.count("too_simple") >= 3 and idx < 2:
            d.suggestion = {"to": LEVELS[idx + 1], "because": "3+ of your last 5 ratings said explanations were too simple"}
    return d
