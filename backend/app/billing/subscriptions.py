"""Subscription state and entitlement decisions. The backend is the only authority: the extension and the
website display what this module decides and never decide it themselves.

No payment provider is connected yet (`billing_live` is false until TRUSTCODE_BILLING_WEBHOOK_SECRET is set).
State changes arrive only through signed webhook events in a provider-neutral format, so connecting a provider
later means writing a small translator from its events to these - not changing the rules below.

Billing periods come from the event (the provider's real period), never from the calendar month.
"""
from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import BillingEvent, Subscription, User, now
from .plans import PLANS

RENEWAL_GRACE = timedelta(days=3)      # period ended, renewal confirmation not received yet
PAYMENT_GRACE = timedelta(days=7)      # payment failed: time to fix the payment method
SIGNATURE_TOLERANCE_SECONDS = 300
EVENTS = ("subscription.activated", "subscription.renewed", "payment.failed", "subscription.cancelled",
          "subscription.expired", "payment.refunded", "payment.disputed")


def _aware(dt: datetime | None) -> datetime | None:
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def state_of(sub: Subscription | None, at: datetime | None = None) -> dict:
    """The entitlement state right now. `paid` is the only thing that unlocks a paid plan."""
    at = at or now()
    if sub is None:
        return {"state": "free", "paid": False, "plan_id": "free", "reason": "No subscription."}
    end, grace = _aware(sub.current_period_end), _aware(sub.grace_until)
    base = {"plan_id": sub.plan_id, "current_period_end": end, "grace_until": grace, "cancel_at_period_end": sub.cancel_at_period_end}
    if sub.status in ("refunded", "disputed", "expired"):
        return {**base, "state": sub.status, "paid": False, "plan_id": "free", "reason": f"Subscription {sub.status}."}
    if sub.status == "past_due":
        ok = grace is not None and at < grace
        return {**base, "state": "payment_failed" if ok else "expired", "paid": ok, "plan_id": sub.plan_id if ok else "free",
                "reason": "The last payment failed. Paid features stay on until the grace period ends." if ok else "Payment was not completed within the grace period."}
    if sub.status == "cancelled":
        ok = end is not None and at < end
        return {**base, "state": "cancelled" if ok else "expired", "paid": ok, "plan_id": sub.plan_id if ok else "free",
                "reason": "Cancelled; paid features stay on until the end of the period already paid for." if ok else "The paid period has ended."}
    if sub.provider == "admin" and sub.status == "active" and (end is None or at < end):
        return {**base, "state": "active", "paid": True, "reason": "Plan set by an administrator" + ("." if end is None else " until the end date.")}
    if end is not None and at < end:
        return {**base, "state": "active", "paid": True, "reason": "Paid for the current billing period."}
    if end is not None and at < end + RENEWAL_GRACE:
        return {**base, "state": "renewal_due", "paid": True, "grace_until": end + RENEWAL_GRACE,
                "reason": "The billing period ended and the renewal has not been confirmed yet."}
    return {**base, "state": "expired", "paid": False, "plan_id": "free", "reason": "The billing period ended and no renewal was confirmed."}


def subscription_of(db: Session, user: User) -> Subscription | None:
    return db.scalar(select(Subscription).where(Subscription.user_id == user.id))


def verify_signature(secret: str, header: str, body: bytes, at: float | None = None) -> bool:
    """`header` = "t=<unix seconds>,v1=<hex HMAC-SHA256 of '<t>.<body>'>". Rejects stale timestamps (replay)."""
    import time
    try:
        parts = dict(p.split("=", 1) for p in header.split(","))
        ts = int(parts["t"])
        given = parts["v1"]
    except (ValueError, KeyError):
        return False
    if abs((at or time.time()) - ts) > SIGNATURE_TOLERANCE_SECONDS:
        return False
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, given)


def _ts(v) -> datetime | None:
    return datetime.fromtimestamp(int(v), tz=timezone.utc) if isinstance(v, (int, float)) and v > 0 else None


def apply_event(db: Session, event: dict) -> str:
    """Applies one verified event. Returns 'applied', 'duplicate', 'stale' or 'ignored: <why>'. Idempotent."""
    eid, etype = str(event.get("id", ""))[:120], str(event.get("type", ""))
    data = event.get("data") if isinstance(event.get("data"), dict) else {}
    if not eid or etype not in EVENTS:
        return "ignored: unknown event"
    if db.get(BillingEvent, eid):
        return "duplicate"
    created = _ts(event.get("created")) or now()
    user = db.get(User, str(data.get("user_id", ""))) if data.get("user_id") else None
    if user is None and data.get("email"):
        user = db.scalar(select(User).where(User.email == str(data["email"]).strip().lower()))
    db.add(BillingEvent(id=eid, type=etype, user_id=user.id if user else None, payload_sha256=hashlib.sha256(json.dumps(event, sort_keys=True).encode()).hexdigest()))
    if user is None:
        db.commit()
        return "ignored: unknown account"
    sub = subscription_of(db, user)
    if sub is not None and _aware(sub.last_event_at) is not None and created < _aware(sub.last_event_at):
        db.commit()
        return "stale"   # an older event delivered late must not undo a newer state
    plan = str(data.get("plan", sub.plan_id if sub else "pro"))
    if plan not in PLANS or plan == "free":
        db.commit()
        return "ignored: unknown plan"
    if sub is None:
        sub = Subscription(user_id=user.id, plan_id=plan, status="expired")
        db.add(sub)
    # A billing event replaces a plan that an administrator set: from here on the subscription follows the billing
    # rules (period end and renewal grace), so it must not stay marked as an administrator's grant.
    provider = str(data.get("provider") or sub.provider or "manual")[:40]
    sub.last_event_at, sub.provider = created, "manual" if provider == "admin" else provider
    sub.provider_ref = str(data.get("subscription_ref", sub.provider_ref or ""))[:120] or None
    if etype in ("subscription.activated", "subscription.renewed"):
        end = _ts(data.get("period_end"))
        if end is None:
            db.rollback()
            return "ignored: missing period_end"
        sub.plan_id, sub.status, sub.current_period_start, sub.current_period_end = plan, "active", _ts(data.get("period_start")) or created, end
        sub.grace_until, sub.cancel_at_period_end = None, False
    elif etype == "payment.failed":
        sub.status, sub.grace_until = "past_due", created + PAYMENT_GRACE
    elif etype == "subscription.cancelled":
        sub.status, sub.cancel_at_period_end = "cancelled", True
    elif etype == "subscription.expired":
        sub.status = "expired"
    elif etype == "payment.refunded":
        sub.status = "refunded"
    elif etype == "payment.disputed":
        sub.status = "disputed"
    from ..licensing.service import bump_rev   # imported here: the licensing service imports this module
    bump_rev(db, user)    # devices pick the new entitlement up at their next contact
    db.commit()
    return "applied"


def paid_until(sub: Subscription | None, at: datetime | None = None) -> datetime | None:
    """The latest moment the current paid entitlement can last without any further billing event, or None when
    nothing is paid. Offline licences never extend past this, so a lapsed subscription ends offline too."""
    st = state_of(sub, at)
    if sub is None or not st["paid"]:
        return None
    end, grace = _aware(sub.current_period_end), _aware(sub.grace_until)
    if st["state"] == "payment_failed":
        return grace
    if st["state"] == "cancelled":
        return end
    if sub.provider == "admin":
        return end          # None = no end date; the offline licence still bounds it (licensing.service.issue)
    return end + RENEWAL_GRACE if end else None


def admin_set_plan(db: Session, user: User, plan_id: str, until: datetime | None) -> Subscription | None:
    """An administrator grants a plan (e.g. a team trial or a comp) or returns the account to Free. Recorded as a
    subscription with provider "admin", so the same entitlement rules apply. A later verified billing event for the
    account replaces it (it is newer)."""
    if plan_id not in PLANS:
        raise ValueError("unknown plan")
    sub = subscription_of(db, user)
    t = now()
    if plan_id == "free":
        if sub is not None:
            sub.status, sub.current_period_end, sub.grace_until, sub.last_event_at = "expired", t, None, t
        return sub
    if until is not None and _aware(until) <= t:
        raise ValueError("the end date must be in the future")
    if sub is None:
        sub = Subscription(user_id=user.id, plan_id=plan_id, status="active")
        db.add(sub)
    sub.plan_id, sub.status, sub.provider, sub.provider_ref = plan_id, "active", "admin", None
    sub.current_period_start, sub.current_period_end, sub.grace_until = t, until, None
    sub.cancel_at_period_end, sub.last_event_at = False, t
    return sub
