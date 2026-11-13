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


WRONG_THRESHOLD = 2


def rule_history(rows: list[tuple[str, str]]) -> dict[str, dict]:
    """Learning from feedback, transparently: per-rule counts of this user's own ratings.

    `rows` are (rule, rating) pairs. A rule the user has marked "incorrect" at least WRONG_THRESHOLD times - and
    more often than "helpful" - is reported as a likely false alarm *for this user*. The caller only changes
    presentation (a note, and collapsing below high severity): evidence is never hidden, deleted or re-scored,
    and nothing is learned across users.
    """
    counts: dict[str, dict] = {}
    for rule, rating in rows:
        if not rule:
            continue
        c = counts.setdefault(rule, {"incorrect": 0, "helpful": 0})
        if rating in c:
            c[rating] += 1
    return {rule: c for rule, c in counts.items() if c["incorrect"] >= WRONG_THRESHOLD and c["incorrect"] > c["helpful"]}
