"""Single source of truth for plans and entitlements (the website and the extension both read this via the API).

Prices are intentionally absent: billing is not live yet. When a Merchant of Record (Paddle / Lemon Squeezy) is
connected, a plan gains `prices` and a `provider_price_ids` mapping, and subscriptions (verified by webhook on the
backend) map users to paid plans. See docs/saas/billing_plan.md.
"""
from __future__ import annotations

PLANS: dict[str, dict] = {
    "free": {
        "id": "free", "name": "Free", "status": "available", "tagline": "Everything you need to check AI-generated code.",
        "prices": None,
        "limits": {"verifications_per_month": 300, "max_code_chars": 50_000, "history_days": 30},
        "licence": {"offline_grace_days": 30, "max_devices": 3},
        "features": {
            "languages": ["python", "javascript", "typescript"],
            "syntax_lint_security_dependencies": True,
            "sandboxed_tests": "self-hosted",      # hosted service never executes code
            "explanation_levels": True,
            "history": True,
            "llm_explanations": False,
            "support": "community",
        },
    },
    "pro": {
        "id": "pro", "name": "Pro", "status": "planned", "tagline": "For professionals who verify AI code every day.",
        "prices": None,
        "limits": {"verifications_per_month": None, "max_code_chars": 50_000, "history_days": 365},
        "licence": {"offline_grace_days": 30, "max_devices": 3},
        "features": {"languages": ["python", "javascript", "typescript"], "syntax_lint_security_dependencies": True,
                     "sandboxed_tests": "hosted (planned)", "explanation_levels": True, "history": True,
                     "llm_explanations": True, "support": "email"},
    },
    "team": {
        "id": "team", "name": "Team", "status": "planned", "tagline": "Shared billing and administration for teams.",
        "prices": None, "limits": {"verifications_per_month": None, "max_code_chars": 50_000, "history_days": 365},
        "licence": {"offline_grace_days": 30, "max_devices": 5},   # per-account overrides: admin licence policy
        "features": {"languages": ["python", "javascript", "typescript"], "syntax_lint_security_dependencies": True,
                     "sandboxed_tests": "hosted (planned)", "explanation_levels": True, "history": True,
                     "llm_explanations": True, "support": "priority email", "seats": "per seat"},
    },
}


def plan_for(user, db=None) -> dict:
    """The plan an account is entitled to right now, from its webhook-verified subscription (Free without one)."""
    if db is None:
        return PLANS["free"]
    from .subscriptions import state_of, subscription_of
    st = state_of(subscription_of(db, user))
    return PLANS.get(st["plan_id"], PLANS["free"]) if st["paid"] else PLANS["free"]
