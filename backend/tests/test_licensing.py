"""Offline licences: activation, device-signed refresh, revocation, device limits, tampering and admin policy."""
import base64
import json
import time
import uuid
from datetime import timedelta

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.config import get_settings
from app.db import SessionLocal
from app.licensing import signing
from app.models import LicencePolicy, Subscription, User, now

V = "/api/v1"


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


class Device:
    def __init__(self):
        self.key = Ed25519PrivateKey.generate()
        self.id = uuid.uuid4().hex
        self.counter = int(time.time() * 1000)

    @property
    def public(self) -> str:
        return b64u(self.key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))

    def activate(self, client, auth, name="Test Mac"):
        return client.post(f"{V}/licence/activate", headers=auth,
                           json={"device_id": self.id, "public_key": self.public, "name": name, "platform": "darwin-arm64"})

    def refresh_body(self, user_id, counter=None):
        if counter is None:
            self.counter += 1
            counter = self.counter
        return json.dumps({"user_id": user_id, "device_id": self.id, "counter": counter}).encode()

    def refresh(self, client, user_id, body=None, key=None):
        body = body or self.refresh_body(user_id)
        sig = b64u((key or self.key).sign(body))
        return client.post(f"{V}/licence/refresh", content=body,
                           headers={"x-trustcode-device-signature": sig, "content-type": "application/json"})


def uid(client, auth):
    return client.get(f"{V}/me", headers=auth).json()["id"]


def payload(r):
    return signing.verify(r.json()["licence"], signing.public_key()["public_key"])


def make_admin(client, auth):
    db = SessionLocal()
    u = db.get(User, uid(client, auth))
    u.role = "admin"
    db.commit()
    db.close()


def test_first_activation_issues_a_signed_licence(client, auth):
    d = Device()
    r = d.activate(client, auth)
    assert r.status_code == 200, r.text
    p = payload(r)
    assert p["v"] == 1 and p["kid"] == get_settings().licence_key_id and p["dev"] == d.id
    assert p["plan"]["id"] == "free" and p["paid_until"] is None
    assert p["offline_until"] - p["iat"] == 30 * 86400 and p["grace_days"] == 30
    assert p["refresh_after"] > p["iat"]
    # no secrets in the licence
    raw = json.dumps(p)
    assert "password" not in raw and get_settings().licence_signing_key not in raw


def test_modified_licence_fails_verification(client, auth):
    tok = Device().activate(client, auth).json()["licence"]
    head, body, sig = tok.split(".")
    data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    data["plan"] = {"id": "pro", "name": "Pro"}
    forged = ".".join([head, b64u(json.dumps(data).encode()), sig])
    with pytest.raises(ValueError):
        signing.verify(forged, signing.public_key()["public_key"])
    with pytest.raises(ValueError):   # signed by another key
        other = Ed25519PrivateKey.generate()
        signing.verify(tok, b64u(other.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)))
    with pytest.raises(ValueError):
        signing.verify("not-a-licence", signing.public_key()["public_key"])


def test_refresh_is_signed_by_the_device_and_cannot_be_replayed(client, auth):
    d = Device()
    d.activate(client, auth)
    user = uid(client, auth)
    r = d.refresh(client, user)
    assert r.status_code == 200, r.text
    assert payload(r)["dev"] == d.id
    # the same body again (captured request) is refused
    body = d.refresh_body(user)
    assert d.refresh(client, user, body).status_code == 200
    replay = d.refresh(client, user, body)
    assert replay.status_code == 401 and replay.json()["error"]["code"] == "replayed_request"
    # signed with a different key (stolen device id, no device key)
    bad = d.refresh(client, user, key=Ed25519PrivateKey.generate())
    assert bad.status_code == 401 and bad.json()["error"]["code"] == "device_not_recognised"


def test_device_limit_and_deactivation(client, auth):
    devices = [Device() for _ in range(3)]
    for d in devices:
        assert d.activate(client, auth).status_code == 200
    fourth = Device().activate(client, auth)
    assert fourth.status_code == 409 and fourth.json()["error"]["code"] == "device_limit_reached"
    # re-activating an already active device does not count twice
    assert devices[0].activate(client, auth).status_code == 200
    listing = client.get(f"{V}/licence/devices", headers=auth).json()
    assert listing["active_devices"] == 3 and listing["max_devices"] == 3
    first = listing["items"][0]["id"]
    assert client.post(f"{V}/licence/devices/{first}/deactivate", headers=auth).json()["status"] == "deactivated"
    assert Device().activate(client, auth).status_code == 200


def test_deactivated_device_cannot_refresh_but_can_reactivate_by_signing_in(client, auth):
    d = Device()
    d.activate(client, auth)
    user = uid(client, auth)
    row = client.get(f"{V}/licence/devices", headers=auth).json()["items"][0]["id"]
    client.post(f"{V}/licence/devices/{row}/deactivate", headers=auth)
    r = d.refresh(client, user)
    assert r.status_code == 403 and r.json()["error"]["code"] == "device_deactivated"
    d2 = Device()
    d2.id = d.id   # same installation after a reinstall: new device key
    assert d2.activate(client, auth).status_code == 200


def test_other_accounts_cannot_touch_my_devices(client, auth):
    Device().activate(client, auth)
    row = client.get(f"{V}/licence/devices", headers=auth).json()["items"][0]["id"]
    other = client.post(f"{V}/auth/register", json={"email": f"o{uuid.uuid4().hex[:6]}@uni.example", "password": "correct-horse-1"}).json()
    h = {"Authorization": f"Bearer {other['access_token']}"}
    assert client.post(f"{V}/licence/devices/{row}/deactivate", headers=h).status_code == 404
    assert client.get(f"{V}/admin/licences", headers=h).status_code == 403


def test_suspended_account_and_admin_revocation(client, auth):
    d = Device()
    d.activate(client, auth)
    user = uid(client, auth)
    db = SessionLocal()
    db.get(User, user).suspended = True
    db.commit()
    r = d.refresh(client, user)
    assert r.status_code == 403 and r.json()["error"]["code"] == "account_suspended"
    db.get(User, user).suspended = False
    db.commit()
    db.close()
    assert d.refresh(client, user).status_code == 200

    admin_reg = client.post(f"{V}/auth/register", json={"email": f"a{uuid.uuid4().hex[:6]}@uni.example", "password": "correct-horse-1"}).json()
    ah = {"Authorization": f"Bearer {admin_reg['access_token']}"}
    make_admin(client, ah)
    row = client.get(f"{V}/admin/licences", headers=ah, params={"q": user}).json()["items"][0]["id"]
    assert client.post(f"{V}/admin/licences/devices/{row}/revoke", headers=ah).json()["status"] == "revoked"
    r = d.refresh(client, user)
    assert r.status_code == 403 and r.json()["error"]["code"] == "device_revoked"
    again = d.activate(client, auth)
    assert again.status_code == 403 and again.json()["error"]["code"] == "device_revoked"
    client.post(f"{V}/admin/licences/devices/{row}/restore", headers=ah)
    assert d.activate(client, auth).status_code == 200
    events = client.get(f"{V}/admin/licences/events", headers=ah, params={"suspicious": True}).json()["items"]
    assert any(e["event"] == "refresh_refused" for e in events)


def test_admin_policy_sets_offline_period_and_device_limit(client, auth):
    user = uid(client, auth)
    admin_reg = client.post(f"{V}/auth/register", json={"email": f"p{uuid.uuid4().hex[:6]}@uni.example", "password": "correct-horse-1"}).json()
    ah = {"Authorization": f"Bearer {admin_reg['access_token']}"}
    make_admin(client, ah)
    assert client.patch(f"{V}/admin/licences/users/{user}/policy", headers=ah, json={"offline_grace_days": 400}).status_code == 422
    r = client.patch(f"{V}/admin/licences/users/{user}/policy", headers=ah, json={"offline_grace_days": 90, "max_devices": 1})
    assert r.json() == {"offline_grace_days": 90, "max_devices": 1}
    d = Device()
    p = payload(d.activate(client, auth))
    assert p["grace_days"] == 90 and p["offline_until"] - p["iat"] == 90 * 86400
    assert Device().activate(client, auth).status_code == 409
    detail = client.get(f"{V}/admin/licences/users/{user}", headers=ah).json()
    assert detail["policy"]["override"]["max_devices"] == 1 and detail["devices"]


def test_paid_licence_never_outlives_the_paid_period(client, auth):
    user = uid(client, auth)
    db = SessionLocal()
    end = now() + timedelta(days=10)
    db.add(Subscription(user_id=user, plan_id="pro", status="active", current_period_end=end))
    db.commit()
    p = payload(Device().activate(client, auth))
    assert p["plan"]["id"] == "pro"
    assert abs(p["paid_until"] - int((end + timedelta(days=3)).timestamp())) <= 1   # period end + renewal grace
    sub = db.query(Subscription).filter_by(user_id=user).one()
    sub.status = "cancelled"
    sub.current_period_end = now() - timedelta(days=1)
    db.commit()
    db.close()
    p = payload(Device().activate(client, auth))
    assert p["plan"]["id"] == "free" and p["paid_until"] is None


def test_validation_input_and_unconfigured_server(client, auth, monkeypatch):
    bad = client.post(f"{V}/licence/activate", headers=auth, json={"device_id": "../../etc", "public_key": "x" * 43})
    assert bad.status_code == 422
    assert client.post(f"{V}/licence/refresh", content=b"{not json").status_code == 400
    assert client.post(f"{V}/licence/refresh", content=b"x" * 5000).status_code == 413
    assert client.post(f"{V}/licence/activate", json={}).status_code == 401
    monkeypatch.setattr(get_settings(), "licence_signing_key", "")
    r = Device().activate(client, auth)
    assert r.status_code == 503 and r.json()["error"]["code"] == "licensing_not_configured"
    assert client.get(f"{V}/licence/keys").json() == {"configured": False, "keys": []}


def test_history_is_recorded(client, auth):
    d = Device()
    d.activate(client, auth)
    d.refresh(client, uid(client, auth))
    events = [e["event"] for e in client.get(f"{V}/licence/history", headers=auth).json()["items"]]
    assert "activated" in events and "refreshed" in events


def test_policy_override_table_is_per_account(client, auth):
    db = SessionLocal()
    assert db.get(LicencePolicy, uid(client, auth)) is None
    db.close()


def test_device_can_release_its_own_activation(client, auth):
    d = Device()
    d.activate(client, auth)
    user = uid(client, auth)
    body = d.refresh_body(user)
    r = client.post(f"{V}/licence/release", content=body,
                    headers={"x-trustcode-device-signature": b64u(d.key.sign(body)), "content-type": "application/json"})
    assert r.json() == {"status": "deactivated"}
    assert client.get(f"{V}/licence/devices", headers=auth).json()["active_devices"] == 0
    assert d.refresh(client, user).status_code == 403


def _admin_headers(client):
    reg = client.post(f"{V}/auth/register", json={"email": f"pl{uuid.uuid4().hex[:6]}@uni.example", "password": "correct-horse-1"}).json()
    h = {"Authorization": f"Bearer {reg['access_token']}"}
    make_admin(client, h)
    return h


def test_admin_sets_plan_and_licence_follows(client, auth):
    user = uid(client, auth)
    ah = _admin_headers(client)
    assert client.post(f"{V}/admin/users/{user}/plan", headers=auth, json={"plan": "pro"}).status_code == 403
    r = client.post(f"{V}/admin/users/{user}/plan", headers=ah, json={"plan": "pro"})
    assert r.status_code == 200 and r.json()["plan"] == "pro"
    p = payload(Device().activate(client, auth))
    assert p["plan"]["id"] == "pro" and p["paid_until"] == p["offline_until"]   # open-ended grant, bounded offline
    assert client.get(f"{V}/me/entitlements", headers=auth).json()["plan"]["id"] == "pro"
    until = (now() + timedelta(days=10)).strftime("%Y-%m-%d")
    client.post(f"{V}/admin/users/{user}/plan", headers=ah, json={"plan": "team", "until": until})
    p = payload(Device().activate(client, auth))
    assert p["plan"]["id"] == "team" and p["paid_until"] < p["offline_until"]
    assert client.post(f"{V}/admin/users/{user}/plan", headers=ah, json={"plan": "pro", "until": "2001-01-01"}).status_code == 422
    assert client.post(f"{V}/admin/users/{user}/plan", headers=ah, json={"plan": "gold"}).status_code == 422
    client.post(f"{V}/admin/users/{user}/plan", headers=ah, json={"plan": "free"})
    assert client.get(f"{V}/me/entitlements", headers=auth).json()["plan"]["id"] == "free"
    listing = client.get(f"{V}/admin/users", headers=ah, params={"q": user}).json()["items"][0]
    assert listing["plan"] == "free" and listing["plan_until"] is None
    events = [e["event"] for e in client.get(f"{V}/licence/history", headers=auth).json()["items"]]
    assert "plan_changed" in events
