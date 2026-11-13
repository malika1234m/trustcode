"""Subscription lifecycle: only signed billing events change entitlements; the backend alone decides access."""
import hashlib
import hmac
import json
import time
from datetime import timedelta

import pytest

from app.billing import subscriptions as subs
from app.config import get_settings
from app.models import Subscription, now

V = "/api/v1"
SECRET = "whsec_test_only_0123456789"


@pytest.fixture
def live(monkeypatch):
    monkeypatch.setattr(get_settings(), "billing_webhook_secret", SECRET)


def send(client, event, secret=SECRET, ts=None, tamper=False):
    body = json.dumps(event).encode()
    ts = int(ts or time.time())
    sig = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    if tamper:
        body = body.replace(b'"pro"', b'"team"')
    return client.post(f"{V}/billing/webhook", content=body, headers={"x-trustcode-signature": f"t={ts},v1={sig}", "content-type": "application/json"})


def me(client, auth):
    return client.get(f"{V}/me", headers=auth).json()


def ent(client, auth):
    return client.get(f"{V}/me/entitlements", headers=auth).json()


def event(uid, etype, eid, **data):
    return {"id": eid, "type": etype, "created": int(time.time()), "data": {"user_id": uid, "plan": "pro", **data}}


def test_free_account_and_billing_not_configured(client, auth):
    e = ent(client, auth)
    assert e["plan"]["id"] == "free" and e["subscription"] == {**e["subscription"], "state": "free", "paid": False, "billing_live": False}
    assert e["verified_at"] and e["usage"]["remaining"] == e["limits"]["verifications_per_month"]
    r = send(client, event(me(client, auth)["id"], "subscription.activated", "evt_x", period_end=int(time.time()) + 86400))
    assert r.status_code == 503, "without a configured secret no event may change anything"
    assert ent(client, auth)["plan"]["id"] == "free"


def test_activation_renewal_and_usage_follow_the_provider_period(client, auth, live):
    uid, end = me(client, auth)["id"], int(time.time()) + 30 * 86400
    assert send(client, event(uid, "subscription.activated", "evt_1", period_end=end)).json()["outcome"] == "applied"
    e = ent(client, auth)
    assert e["plan"]["id"] == "pro" and e["status"] == "active" and e["subscription"]["paid"] and e["limits"]["verifications_per_month"] is None
    assert e["subscription"]["current_period_end"].startswith(time.strftime("%Y-", time.gmtime(end)))
    assert send(client, event(uid, "subscription.renewed", "evt_2", period_end=end + 30 * 86400)).json()["outcome"] == "applied"
    assert ent(client, auth)["status"] == "active"


def test_forged_tampered_stale_and_malformed_notifications_are_rejected(client, auth, live):
    uid, end = me(client, auth)["id"], int(time.time()) + 86400
    ev = event(uid, "subscription.activated", "evt_f", period_end=end)
    assert send(client, ev, secret="guessed-secret").status_code == 401
    assert send(client, ev, tamper=True).status_code == 401
    assert send(client, ev, ts=time.time() - 3600).status_code == 401, "a replayed old signature must be refused"
    assert client.post(f"{V}/billing/webhook", json=ev).status_code == 401
    assert client.post(f"{V}/billing/webhook", json=ev, headers={"x-trustcode-signature": "garbage"}).status_code == 401
    # the browser / extension cannot grant a plan through any authenticated endpoint either
    assert client.patch(f"{V}/profile", headers=auth, json={"plan": "pro", "status": "active"}).status_code in (200, 422)
    assert ent(client, auth)["plan"]["id"] == "free"


def test_duplicate_events_are_processed_once_and_late_events_cannot_undo_newer_state(client, auth, live):
    uid, t = me(client, auth)["id"], int(time.time())
    first = {"id": "evt_d1", "type": "subscription.activated", "created": t - 100, "data": {"user_id": uid, "plan": "pro", "period_end": t + 86400}}
    assert send(client, first).json()["outcome"] == "applied"
    assert send(client, first).json()["outcome"] == "duplicate"
    assert send(client, {"id": "evt_d2", "type": "payment.refunded", "created": t - 10, "data": {"user_id": uid}}).json()["outcome"] == "applied"
    late = {"id": "evt_d3", "type": "subscription.renewed", "created": t - 50, "data": {"user_id": uid, "plan": "pro", "period_end": t + 99999}}
    assert send(client, late).json()["outcome"] == "stale"
    assert ent(client, auth)["status"] == "refunded" and ent(client, auth)["plan"]["id"] == "free"
    assert send(client, {"id": "evt_u", "type": "subscription.activated", "created": t, "data": {"user_id": "nobody", "period_end": t + 9}}).json()["outcome"] == "ignored: unknown account"
    assert send(client, {"id": "evt_p", "type": "subscription.activated", "created": t, "data": {"user_id": uid, "plan": "enterprise", "period_end": t + 9}}).json()["outcome"] == "ignored: unknown plan"


def test_failed_payment_grace_cancellation_expiry_refund_and_dispute(client, auth, live):
    uid, t = me(client, auth)["id"], int(time.time())
    send(client, event(uid, "subscription.activated", "evt_a", period_end=t + 5 * 86400))
    send(client, event(uid, "payment.failed", "evt_b"))
    e = ent(client, auth)
    assert e["status"] == "payment_failed" and e["plan"]["id"] == "pro" and e["subscription"]["grace_until"], "a failed payment starts a grace period, it does not cut access at once"
    send(client, event(uid, "subscription.renewed", "evt_c", period_end=t + 35 * 86400))
    assert ent(client, auth)["status"] == "active" and ent(client, auth)["subscription"]["grace_until"] is None
    send(client, event(uid, "subscription.cancelled", "evt_e"))
    e = ent(client, auth)
    assert e["status"] == "cancelled" and e["plan"]["id"] == "pro" and e["subscription"]["cancel_at_period_end"], "the period already paid for is honoured"
    for etype, eid in (("payment.refunded", "evt_g"), ("payment.disputed", "evt_h"), ("subscription.expired", "evt_i")):
        send(client, event(uid, "subscription.activated", eid + "_on", period_end=t + 86400))
        send(client, event(uid, etype, eid))
        e = ent(client, auth)
        assert e["plan"]["id"] == "free" and e["subscription"]["paid"] is False, etype


def test_entitlement_state_over_time_never_grants_paid_access_without_a_paid_period():
    t = now()
    def sub(status, end=None, grace=None):
        return Subscription(user_id="u", plan_id="pro", status=status, current_period_end=end, grace_until=grace, cancel_at_period_end=False)
    assert subs.state_of(None)["paid"] is False
    assert subs.state_of(sub("active", t + timedelta(days=1)), t)["state"] == "active"
    due = subs.state_of(sub("active", t - timedelta(days=1)), t)
    assert due["state"] == "renewal_due" and due["paid"], "a renewal that is a day late is not treated as non-payment"
    assert subs.state_of(sub("active", t - timedelta(days=4)), t) == {**subs.state_of(sub("active", t - timedelta(days=4)), t), "state": "expired", "paid": False, "plan_id": "free"}
    assert subs.state_of(sub("past_due", t + timedelta(days=9), t + timedelta(days=2)), t)["paid"]
    assert subs.state_of(sub("past_due", t + timedelta(days=9), t - timedelta(seconds=1)), t)["paid"] is False
    assert subs.state_of(sub("cancelled", t - timedelta(seconds=1)), t)["paid"] is False
    assert subs.state_of(sub("active", None), t)["paid"] is False, "no period end means nothing was paid for"


def test_quota_is_enforced_by_the_server_for_free_and_lifted_only_by_a_verified_subscription(client, auth, live, monkeypatch):
    from app.billing import plans
    monkeypatch.setitem(plans.PLANS["free"]["limits"], "verifications_per_month", 1)
    body = {"code": "x = 1\n", "client_consent": True}
    assert client.post(f"{V}/verifications", headers=auth, json=body).status_code == 202
    blocked = client.post(f"{V}/verifications", headers=auth, json=body)
    assert blocked.status_code == 403 and "limit reached" in blocked.text
    send(client, event(me(client, auth)["id"], "subscription.activated", "evt_q", period_end=int(time.time()) + 86400))
    assert client.post(f"{V}/verifications", headers=auth, json=body).status_code == 202


def test_health_reports_api_compatibility(client):
    h = client.get(f"{V}/health").json()
    assert h["api_version"] == 1 and h["min_extension_version"]
