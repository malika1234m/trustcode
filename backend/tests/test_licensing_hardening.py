"""Licence hardening: the status call, revocation version, stop times, device proof for server analysis, integrity
signals, input limits, rate limits, plan changes, tampered tokens, key rotation and account deletion.

These run in-process. Concurrency, the migration and the simulated attacks run against a real server in
test_licence_http.py."""
import hashlib
import hmac
import json
import time
import uuid
from datetime import timedelta

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sqlalchemy import func, select

from app.config import get_settings
from app.db import SessionLocal
from app.licensing import service, signing
from app.models import AuditLog, Licence, LicenceDevice, LicenceEvent, Subscription, User, now
from licence_helpers import Device, V, b64u, code, decode, register, unb64u

DAY = 86400
SUBMIT = {"code": "x = 1\n", "client_consent": True}


@pytest.fixture(autouse=True)
def roomy_limits(monkeypatch):
    """Licence rate limits are tested on their own (with the real defaults); elsewhere they must not get in the way."""
    for name in ("licence_device_rate_per_minute", "licence_ip_rate_per_minute", "licence_activate_rate_per_minute"):
        monkeypatch.setattr(get_settings(), name, 10_000)


@pytest.fixture
def admin(client):
    a = register(client, "admin")
    with SessionLocal() as db:
        db.get(User, a["id"]).role = "admin"
        db.commit()
    return a["auth"]


@pytest.fixture
def user(client):
    return register(client)


def events(user_id=None, event=None) -> list[LicenceEvent]:
    with SessionLocal() as db:
        stmt = select(LicenceEvent)
        if user_id:
            stmt = stmt.where(LicenceEvent.user_id == user_id)
        if event:
            stmt = stmt.where(LicenceEvent.event == event)
        return list(db.scalars(stmt.order_by(LicenceEvent.created_at)))


def licence_count(user_id) -> int:
    with SessionLocal() as db:
        return db.scalar(select(func.count()).select_from(Licence).where(Licence.user_id == user_id))


def rev_of(user_id) -> int:
    with SessionLocal() as db:
        return db.get(User, user_id).licence_rev


def device_row(client, auth) -> dict:
    return client.get(f"{V}/licence/devices", headers=auth).json()["items"][0]


def verified(r) -> dict:
    return signing.verify(r.json()["licence"], signing.public_key()["public_key"])


# ------------------------------------------------------------------ activation
def test_first_activation_then_reactivation_of_the_same_device(client, user):
    d = Device()
    first = verified(d.activate(client, user["auth"]))
    again = verified(d.activate(client, user["auth"]))
    assert first["lid"] != again["lid"] and first["dev"] == again["dev"] == d.id
    listing = client.get(f"{V}/licence/devices", headers=user["auth"]).json()
    assert listing["active_devices"] == 1 and len(listing["items"]) == 1, "the same device never counts twice"
    with SessionLocal() as db:
        rows = list(db.scalars(select(Licence).where(Licence.user_id == user["id"]).order_by(Licence.issued_at, Licence.revoked_at.is_(None))))
    assert [r.revoked_reason for r in rows if r.revoked_at] == ["superseded"] and sum(r.revoked_at is None for r in rows) == 1
    assert len(events(user["id"], "activated")) == 2


# ------------------------------------------------------------------ status call
def test_status_is_cheap_and_reports_whether_the_licence_is_current(client, user, admin):
    d = Device()
    p = verified(d.activate(client, user["auth"]))
    issued = licence_count(user["id"])
    r = d.status(client, user["id"])
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "ok" and out["refresh"] is False and out["rev"] == p["rev"]
    assert out["check_after"] == 3600 == p["check_after"] and abs(out["server_time"] - time.time()) < 5
    assert "licence" not in out and licence_count(user["id"]) == issued, "a status check issues nothing"
    # the device holds no licence id (or an old one): told to refresh
    assert d.status(client, user["id"], lid=None).json()["refresh"] is True
    assert d.status(client, user["id"], lid="0" * 32).json()["refresh"] is True
    # an administrator changes the plan: the next status check says refresh, and a refresh brings the plan
    assert client.post(f"{V}/admin/users/{user['id']}/plan", headers=admin, json={"plan": "pro"}).status_code == 200
    out = d.status(client, user["id"]).json()
    assert out["refresh"] is True and out["rev"] == p["rev"] + 1
    assert verified(d.refresh(client, user["id"]))["plan"]["id"] == "pro"
    assert d.status(client, user["id"]).json()["refresh"] is False
    with SessionLocal() as db:
        assert db.scalar(select(LicenceDevice.last_seen_at).where(LicenceDevice.device_id == d.id)) is not None


def test_status_interval_is_kept_within_one_to_four_hours(monkeypatch):
    for configured, expected in ((1, 3600), (60, 3600), (90, 5400), (240, 14400), (100000, 14400)):
        monkeypatch.setattr(get_settings(), "licence_status_minutes", configured)
        assert service.status_seconds() == expected


@pytest.mark.parametrize("op", ["refresh", "status", "release"])
def test_device_signed_calls_reject_bad_signatures_replays_and_unknown_devices(client, user, op):
    d = Device()
    d.activate(client, user["auth"])
    # wrong signature: the device id is known, the key is not
    r = d.call(client, op, user["id"], key=Ed25519PrivateKey.generate())
    assert (r.status_code, code(r)) == (401, "device_not_recognised")
    # a signature that is not base64 at all
    body = d.body(user["id"])
    r = client.post(f"{V}/licence/{op}", content=body, headers={"x-trustcode-device-signature": "!!!", "content-type": "application/json"})
    assert (r.status_code, code(r)) == (401, "device_not_recognised")
    assert client.post(f"{V}/licence/{op}", content=body).status_code == 401, "no signature header"
    # a body changed after signing
    signed = d.body(user["id"])
    r = client.post(f"{V}/licence/{op}", content=signed.replace(b'"counter"', b'"counter" '),
                    headers={"x-trustcode-device-signature": b64u(d.key.sign(signed)), "content-type": "application/json"})
    assert (r.status_code, code(r)) == (401, "device_not_recognised")
    # unknown device
    r = Device().call(client, op, user["id"])
    assert (r.status_code, code(r)) == (401, "device_not_recognised")
    # replay: a captured request is refused, and so is any lower counter
    captured = d.body(user["id"])
    assert d.call(client, op if op != "release" else "status", user["id"], body=captured).status_code == 200
    r = d.call(client, op, user["id"], body=captured)
    assert (r.status_code, code(r)) == (401, "replayed_request")
    r = d.call(client, op, user["id"], body=d.body(user["id"], counter=1))
    assert (r.status_code, code(r)) == (401, "replayed_request")
    logged = {e.event for e in events(user["id"])}
    assert {"signature_rejected", "replay_rejected"} <= logged
    assert client.get(f"{V}/licence/devices", headers=user["auth"]).json()["active_devices"] == 1, "nothing above changed the device"


@pytest.mark.parametrize("op", ["refresh", "status"])
def test_removed_blocked_suspended_and_deleted_accounts_are_refused(client, admin, op):
    # deactivated by the owner
    u, d = register(client), Device()
    d.activate(client, u["auth"])
    client.post(f"{V}/licence/devices/{device_row(client, u['auth'])['id']}/deactivate", headers=u["auth"])
    r = d.call(client, op, u["id"])
    assert (r.status_code, code(r)) == (403, "device_deactivated")
    # blocked by an administrator
    u, d = register(client), Device()
    d.activate(client, u["auth"])
    client.post(f"{V}/admin/licences/devices/{device_row(client, u['auth'])['id']}/revoke", headers=admin)
    r = d.call(client, op, u["id"])
    assert (r.status_code, code(r)) == (403, "device_revoked")
    # suspended account
    u, d = register(client), Device()
    d.activate(client, u["auth"])
    assert client.post(f"{V}/admin/users/{u['id']}/suspend", headers=admin).json()["suspended"] is True
    r = d.call(client, op, u["id"])
    assert (r.status_code, code(r)) == (403, "account_suspended")
    assert f"{op}_refused" in {e.event for e in events(u["id"])}
    client.post(f"{V}/admin/users/{u['id']}/restore", headers=admin)
    assert d.call(client, op, u["id"]).status_code == 200, "restored accounts work again without a new sign-in"
    # deleted account: the device no longer exists
    u, d = register(client), Device()
    d.activate(client, u["auth"])
    assert client.delete(f"{V}/me/data", headers=u["auth"]).status_code == 204
    r = d.call(client, op, u["id"])
    assert (r.status_code, code(r)) == (401, "device_not_recognised")


def test_release_only_ever_gives_an_activation_up(client, admin):
    """Signing out is always allowed and issues nothing; it cannot bring a removed or blocked device back."""
    u, d = register(client), Device()
    d.activate(client, u["auth"])
    assert d.release(client, u["id"]).json() == {"status": "deactivated"}
    assert d.release(client, u["id"]).json() == {"status": "deactivated"}
    assert (d.refresh(client, u["id"]).status_code, client.get(f"{V}/licence/devices", headers=u["auth"]).json()["active_devices"]) == (403, 0)
    u, d = register(client), Device()
    d.activate(client, u["auth"])
    client.post(f"{V}/admin/licences/devices/{device_row(client, u['auth'])['id']}/revoke", headers=admin)
    assert d.release(client, u["id"]).json() == {"status": "revoked"}
    assert code(d.activate(client, u["auth"])) == "device_revoked", "a blocked device stays blocked after a release"


@pytest.mark.parametrize("counter", [True, False, 0, -5, 1.5, "12", None, [1], 2 ** 62, 2 ** 63, 10 ** 30])
def test_counters_that_are_not_a_fresh_integer_are_refused_without_an_error(client, user, counter):
    d = Device()
    d.activate(client, user["auth"])
    r = d.status(client, user["id"], body=json.dumps({"user_id": user["id"], "device_id": d.id, "counter": counter}).encode())
    assert (r.status_code, code(r)) == (401, "replayed_request")
    assert d.status(client, user["id"]).status_code == 200, "the device still works afterwards"


# ------------------------------------------------------------------ input limits and rate limits
@pytest.mark.parametrize("op", ["refresh", "status", "release"])
def test_malformed_oversized_and_invalid_requests_are_rejected(client, user, op):
    post = lambda body, **h: client.post(f"{V}/licence/{op}", content=body, headers=h)  # noqa: E731
    for body in (b"", b"{not json", b"[]", b"null", b'"text"', b"\xff\xfe", b'{"user_id": 1, "device_id": 2}',
                 json.dumps({"user_id": user["id"]}).encode(),
                 json.dumps({"user_id": user["id"].upper(), "device_id": "a" * 32, "counter": 1}).encode(),
                 json.dumps({"user_id": "../../etc/passwd", "device_id": "a" * 32, "counter": 1}).encode(),
                 json.dumps({"user_id": "a" * 31, "device_id": "a" * 32, "counter": 1}).encode(),
                 json.dumps({"user_id": "a" * 32 + "\n", "device_id": "a" * 32, "counter": 1}).encode(),
                 json.dumps({"user_id": "a" * 32, "device_id": "a' OR '1'='1", "counter": 1}).encode()):
        r = post(body)
        assert (r.status_code, code(r)) == (400, "bad_request"), body
    assert post(b"x" * 2049).status_code == 413
    assert post(json.dumps({"user_id": "a" * 32, "device_id": "b" * 32, "counter": 1, "pad": "x" * 3000}).encode()).status_code == 413
    assert post(b"x" * 2048).status_code == 400, "at the limit the body is read and then rejected as malformed"


def test_activation_input_is_validated(client, user):
    ok = {"device_id": "a" * 32, "public_key": Device().public}
    for bad in ({"device_id": "A" * 32}, {"device_id": "a" * 31}, {"device_id": "../" * 10 + "ab"}, {"public_key": "x" * 42},
                {"public_key": "=" * 43}, {"name": "n" * 81}, {"platform": "p" * 41}, {"version": "v" * 21}, {"build": "b" * 65}):
        assert client.post(f"{V}/licence/activate", headers=user["auth"], json={**ok, **bad}).status_code == 422, bad
    assert client.post(f"{V}/licence/activate", json=ok).status_code == 401, "no account"
    r = client.post(f"{V}/licence/activate", headers=user["auth"], json={**ok, "name": "Mac\x00\x1b[31m\n"})
    assert r.status_code == 200 and device_row(client, user["auth"])["name"] == "Mac[31m", "control characters are removed"


P25519 = 2 ** 255 - 19
WEAK_KEYS = {   # the small-order points of the curve, and encodings that are not canonical
    "all zero (order 4)": bytes(32), "neutral point": (1).to_bytes(32, "little"), "order 2": (P25519 - 1).to_bytes(32, "little"),
    "order 8 (a)": bytes.fromhex("26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05"),
    "order 8 (b)": bytes.fromhex("c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a"),
    "all zero with the sign bit": bytes(31) + b"\x80", "not canonical (p)": P25519.to_bytes(32, "little"),
    "not canonical (p + 1)": (P25519 + 1).to_bytes(32, "little"), "all ones": b"\xff" * 32,
}


def test_device_keys_that_anyone_could_sign_for_are_refused(client, user):
    """For a small-order public key a signature can be made without a private key (an all-zero signature verifies
    for about one message in four with the all-zero key), so such a key is never registered or accepted."""
    for name, raw in WEAK_KEYS.items():
        r = client.post(f"{V}/licence/activate", headers=user["auth"], json={"device_id": "c" * 32, "public_key": b64u(raw)})
        assert r.status_code == 422, name
        assert signing.usable_device_key(b64u(raw)) is False, name
    assert client.get(f"{V}/licence/devices", headers=user["auth"]).json()["items"] == []
    assert all(signing.usable_device_key(Device().public) for _ in range(50)), "real device keys are accepted"
    # a row that already holds such a key (registered before this check existed) is not accepted either
    with SessionLocal() as db:
        db.add(LicenceDevice(user_id=user["id"], device_id="c" * 32, public_key=b64u(bytes(32)), name="old", platform=None))
        db.commit()
    accepted = 0
    for counter in range(1, 41):
        body = json.dumps({"user_id": user["id"], "device_id": "c" * 32, "counter": counter}).encode()
        r = client.post(f"{V}/licence/status", content=body, headers={"x-trustcode-device-signature": b64u(bytes(64))})
        accepted += r.status_code != 401
    assert accepted == 0, "an all-zero signature must never be accepted"


def test_rate_limits_per_device_per_account_and_per_address(client, user, monkeypatch):
    from app.config import Settings
    for name in ("licence_device_rate_per_minute", "licence_ip_rate_per_minute", "licence_activate_rate_per_minute"):
        monkeypatch.setattr(get_settings(), name, Settings.model_fields[name].default)      # the shipped defaults: 6, 60, 10
    d = Device()
    d.activate(client, user["auth"])
    assert [d.status(client, user["id"]).status_code for _ in range(7)] == [200] * 6 + [429], "6 a minute per device and operation"
    limited = d.status(client, user["id"])
    assert code(limited) == "rate_limited" and int(limited.headers["retry-after"]) > 0
    assert d.refresh(client, user["id"]).status_code == 200, "each operation has its own allowance"
    # activation: 10 a minute per account (one was used above)
    codes = [Device().activate(client, user["auth"]).status_code for _ in range(10)]
    assert codes.count(429) == 1 and codes[-1] == 429 and set(codes[:9]) <= {200, 409}
    # everything device-signed from one address: 60 a minute (9 were used above), whatever the device ids are
    codes = [Device().status(client, user["id"]).status_code for _ in range(52)]
    assert codes == [401] * 51 + [429]


def test_rate_limit_of_one_device_cannot_be_used_up_from_another_address(client, user, monkeypatch):
    from app.api import licence as api
    monkeypatch.setattr(get_settings(), "licence_device_rate_per_minute", 6)
    d = Device()
    d.activate(client, user["auth"])
    monkeypatch.setattr(api, "client_ip", lambda request: "203.0.113.9")       # someone who learnt the device id
    for _ in range(7):
        Device.call(d, client, "status", user["id"], key=Ed25519PrivateKey.generate())
    monkeypatch.setattr(api, "client_ip", lambda request: "198.51.100.4")      # the real device, elsewhere
    assert d.status(client, user["id"]).status_code == 200


# ------------------------------------------------------------------ revocation version
def test_revocation_version_is_returned_with_signed_in_responses_and_grows_on_every_change(client, user, admin, monkeypatch):
    d = Device()
    p = verified(d.activate(client, user["auth"]))
    header = lambda: int(client.get(f"{V}/me", headers=user["auth"]).headers["x-trustcode-licence-rev"])  # noqa: E731
    assert header() == p["rev"] == d.activate(client, user["auth"]).json()["rev"]
    assert "x-trustcode-licence-rev" not in client.get(f"{V}/health").headers, "only signed-in responses carry it"
    assert "x-trustcode-licence-rev" not in client.get(f"{V}/me").headers
    seen = [header()]

    def changed(what):
        seen.append(header())
        assert seen[-1] > seen[-2], what

    client.patch(f"{V}/admin/licences/users/{user['id']}/policy", headers=admin, json={"offline_grace_days": 14})
    changed("licence policy")
    client.post(f"{V}/admin/users/{user['id']}/plan", headers=admin, json={"plan": "team"})
    changed("plan set by an administrator")
    monkeypatch.setattr(get_settings(), "billing_webhook_secret", WEBHOOK_SECRET)
    assert webhook(client, user["id"], "subscription.activated", period_end=int(time.time()) + 30 * DAY).json()["outcome"] == "applied"
    changed("billing event")
    extra = Device()
    extra.activate(client, user["auth"])
    rows = client.get(f"{V}/licence/devices", headers=user["auth"]).json()["items"]
    client.post(f"{V}/licence/devices/{rows[0]['id']}/deactivate", headers=user["auth"])
    changed("device removed by the owner")
    client.post(f"{V}/admin/licences/devices/{rows[1]['id']}/revoke", headers=admin)
    changed("device blocked by an administrator")
    before = rev_of(user["id"])
    client.post(f"{V}/admin/users/{user['id']}/suspend", headers=admin)
    assert rev_of(user["id"]) == before + 1, "suspension"
    client.post(f"{V}/admin/users/{user['id']}/restore", headers=admin)
    assert rev_of(user["id"]) == before + 2, "restoration"
    assert header() == rev_of(user["id"])


# ------------------------------------------------------------------ stop times
def test_admins_see_when_a_blocked_device_will_at_the_latest_stop(client, user, admin):
    d = Device()
    p = verified(d.activate(client, user["auth"]))
    row = device_row(client, user["auth"])
    assert row["stops_by"] is None and row["stops_in_seconds"] is None and row["stop_reason"] is None
    out = client.post(f"{V}/admin/licences/devices/{row['id']}/revoke", headers=admin).json()
    assert out["status"] == "revoked" and out["stop_reason"] == "revoked"
    assert abs(out["stops_in_seconds"] - 30 * DAY) < 10 and out["online_stop_within_seconds"] == 3600
    with SessionLocal() as db:
        dev = db.get(LicenceDevice, row["id"])
        assert int(service._aware(dev.stops_by).timestamp()) == p["offline_until"], "the end of the offline period of its last licence"
    listing = client.get(f"{V}/admin/licences", headers=admin, params={"stopping": True, "q": user["id"]}).json()
    assert [i["id"] for i in listing["items"]] == [row["id"]] and listing["status_check_seconds"] == 3600
    assert listing["items"][0]["stops_in_seconds"] > 29 * DAY
    detail = [e.detail for e in events(user["id"], "revoked")][0]
    assert detail.startswith("administrator; offline it stops by ") and detail.endswith(" UTC")
    # restoring and signing in again clears the stop time
    client.post(f"{V}/admin/licences/devices/{row['id']}/restore", headers=admin)
    assert d.activate(client, user["auth"]).status_code == 200
    assert device_row(client, user["auth"])["stops_by"] is None
    assert client.get(f"{V}/admin/licences", headers=admin, params={"stopping": True, "q": user["id"]}).json()["total"] == 0


def test_stop_time_is_the_longest_offline_period_ever_signed_for_the_device(client, user, admin):
    """A device that once received a 90-day licence can use it offline for 90 days, even if the policy is shorter now."""
    policy = lambda days: client.patch(f"{V}/admin/licences/users/{user['id']}/policy", headers=admin, json={"offline_grace_days": days})  # noqa: E731
    policy(90)
    d = Device()
    long = verified(d.activate(client, user["auth"]))
    policy(7)
    short = verified(d.refresh(client, user["id"]))
    assert short["offline_until"] - short["iat"] == 7 * DAY and long["offline_until"] - long["iat"] == 90 * DAY
    out = client.post(f"{V}/licence/devices/{device_row(client, user['auth'])['id']}/deactivate", headers=user["auth"]).json()
    assert out["stop_reason"] == "deactivated" and abs(out["stops_in_seconds"] - 90 * DAY) < 10


def test_suspension_records_a_stop_time_for_every_device_and_restoring_clears_it(client, user, admin):
    devices = [Device(), Device()]
    for d in devices:
        d.activate(client, user["auth"])
    out = client.post(f"{V}/admin/users/{user['id']}/suspend", headers=admin).json()
    assert out["suspended"] and out["online_stop_within_seconds"] == 3600 and len(out["devices"]) == 2
    assert all(d["stops_by"] for d in out["devices"])
    detail = client.get(f"{V}/admin/licences/users/{user['id']}", headers=admin).json()
    assert {d["stop_reason"] for d in detail["devices"]} == {"account_suspended"}
    assert all(abs(d["stops_in_seconds"] - 30 * DAY) < 10 for d in detail["devices"])
    with SessionLocal() as db:
        meta = db.scalar(select(AuditLog.meta).where(AuditLog.action == "admin_suspend").order_by(AuditLog.created_at.desc()))
    assert len(meta["device_stops"]) == 2
    assert len(events(user["id"], "account_suspended")) == 2
    # suspending twice changes nothing
    again = client.post(f"{V}/admin/users/{user['id']}/suspend", headers=admin).json()
    assert again["suspended"] and len(events(user["id"], "account_suspended")) == 2
    back = client.post(f"{V}/admin/users/{user['id']}/restore", headers=admin).json()
    assert back == {"id": user["id"], "suspended": False, "online_stop_within_seconds": None, "devices": []}
    detail = client.get(f"{V}/admin/licences/users/{user['id']}", headers=admin).json()
    assert {d["stops_by"] for d in detail["devices"]} == {None}


def test_account_deletion_erases_devices_licences_and_history_and_keeps_only_stop_times(client, user):
    devices = [Device(), Device()]
    for d in devices:
        d.activate(client, user["auth"])
        d.refresh(client, user["id"])
    assert licence_count(user["id"]) == 4 and len(events(user["id"])) >= 4
    assert client.delete(f"{V}/me/data", headers=user["auth"]).status_code == 204
    with SessionLocal() as db:
        assert db.get(User, user["id"]) is None
        for model in (LicenceDevice, Licence, LicenceEvent):
            assert db.scalar(select(func.count()).select_from(model).where(model.user_id == user["id"])) == 0, model.__name__
        log = db.scalars(select(AuditLog).where(AuditLog.action == "account_deleted").order_by(AuditLog.created_at.desc())).first()
    assert log.user_id is None and log.meta["devices"] == 2 and len(log.meta["device_stops"]) == 2
    raw = json.dumps(log.meta)
    assert user["id"] not in raw and all(d.id not in raw for d in devices), "no account or device identifier is kept"
    assert client.get(f"{V}/me", headers=user["auth"]).status_code == 401
    for d in devices:
        assert code(d.status(client, user["id"])) == "device_not_recognised"
        assert code(d.refresh(client, user["id"])) == "device_not_recognised"


# ------------------------------------------------------------------ device proof for server analysis
@pytest.fixture
def require(monkeypatch):
    monkeypatch.setattr(get_settings(), "licence_device_enforcement", "require")


def submit(client, auth, proof=None, path="/verifications", body=SUBMIT):
    return client.post(f"{V}{path}", headers={**auth, **({"X-TrustCode-Device": proof} if proof is not None else {})}, json=body)


def test_production_default_requires_a_device_for_server_analysis():
    from app.config import Settings
    assert Settings.model_fields["licence_device_enforcement"].default == "require"


def test_server_analysis_needs_the_account_and_an_active_device_of_that_account(client, user, require):
    d = Device()
    d.activate(client, user["auth"])
    assert submit(client, user["auth"], d.proof(user["id"])).status_code == 202
    session_body = {"files": [{"path": "a.py", "content": "x = 1\n", "change": "modified"}], "client_consent": True}
    with_proof = submit(client, user["auth"], d.proof(user["id"]), "/session-verifications", session_body)
    assert with_proof.status_code != 403, with_proof.text
    for path, body in (("/verifications", SUBMIT), ("/session-verifications", session_body)):
        r = submit(client, user["auth"], None, path, body)
        assert (r.status_code, code(r)) == (403, "device_proof_required"), path
    assert submit(client, {}, d.proof(user["id"])).status_code == 401, "a device proof without the account gets nothing"
    # malformed proofs
    good = d.proof(user["id"])
    for bad in ("", "x", "a.b", good + ".extra", good.replace(d.id, d.id.upper()), f"{d.id}.notanumber.sig", f"{d.id}.{'9' * 13}.sig",
                " " + good, "\x00"):
        assert code(submit(client, user["auth"], bad)) == "device_proof_required", bad
    # signed by another key, for another account, or by another account's device
    assert code(submit(client, user["auth"], d.proof(user["id"], key=Ed25519PrivateKey.generate()))) == "device_not_recognised"
    assert code(submit(client, user["auth"], d.proof("f" * 32))) == "device_not_recognised"
    other, od = register(client), Device()
    od.activate(client, other["auth"])
    assert code(submit(client, user["auth"], od.proof(other["id"]))) == "device_not_recognised", "another account's device"
    assert code(submit(client, user["auth"], od.proof(user["id"]))) == "device_not_recognised"
    assert code(submit(client, other["auth"], d.proof(user["id"]))) == "device_not_recognised", "a copied proof with another account's token"
    # outside the accepted time window, both ways
    for skew in (-301, -3600, 301, 86400):
        assert code(submit(client, user["auth"], d.proof(user["id"], at=time.time() + skew))) == "device_proof_expired", skew
    for skew in (-240, 240):
        assert submit(client, user["auth"], d.proof(user["id"], at=time.time() + skew)).status_code == 202, skew
    refused = events(user["id"], "server_call_refused")
    assert refused and {"device_proof_required", "device_not_recognised", "device_proof_expired"} <= {e.detail for e in refused}
    # reading one's own results needs the account only
    assert client.get(f"{V}/verifications", headers=user["auth"]).status_code == 200


def test_a_removed_or_blocked_device_gets_no_server_analysis(client, user, admin, require):
    d = Device()
    d.activate(client, user["auth"])
    row = device_row(client, user["auth"])["id"]
    client.post(f"{V}/licence/devices/{row}/deactivate", headers=user["auth"])
    assert code(submit(client, user["auth"], d.proof(user["id"]))) == "device_deactivated"
    d.activate(client, user["auth"])
    assert submit(client, user["auth"], d.proof(user["id"])).status_code == 202
    client.post(f"{V}/admin/licences/devices/{row}/revoke", headers=admin)
    r = submit(client, user["auth"], d.proof(user["id"]))
    assert (r.status_code, code(r)) == (403, "device_revoked")
    client.post(f"{V}/admin/users/{user['id']}/suspend", headers=admin)
    assert submit(client, user["auth"], d.proof(user["id"])).status_code == 401, "a suspended account is refused before anything else"


def test_log_mode_lets_older_extensions_through_and_records_it_once_an_hour(client, user, monkeypatch):
    monkeypatch.setattr(get_settings(), "licence_device_enforcement", "log")
    assert submit(client, user["auth"]).status_code == 202
    assert submit(client, user["auth"], "garbage").status_code == 202
    logged = events(user["id"], "server_call_without_device")
    assert len(logged) == 1 and logged[0].detail == "device_proof_required"
    monkeypatch.setattr(get_settings(), "licence_device_enforcement", "off")
    assert submit(client, user["auth"]).status_code == 202 and len(events(user["id"], "server_call_without_device")) == 1


def test_servers_without_licensing_do_not_ask_for_a_device(client, user, require, monkeypatch):
    monkeypatch.setattr(get_settings(), "licence_signing_key", "")
    assert submit(client, user["auth"]).status_code == 202


# ------------------------------------------------------------------ integrity signals
def test_unknown_builds_are_logged_as_suspicious_and_never_blocked(client, user, admin, monkeypatch):
    released, other = "a" * 64, "b" * 64
    monkeypatch.setattr(get_settings(), "licence_known_builds", f"1.2.0={released}, 1.2.1={'c' * 64},not-a-version=zz")
    assert service.known_builds() == {"1.2.0": {released}, "1.2.1": {"c" * 64}}
    d = Device()
    assert d.activate(client, user["auth"], version="1.2.0", build=released).status_code == 200
    assert device_row(client, user["auth"])["extension_version"] == "1.2.0"
    assert d.status(client, user["id"], v="1.2.0", build=released).status_code == 200
    assert not events(user["id"], "unknown_build"), "a released build is not reported"
    # a modified build of a released version: works, and is logged once (not on every request)
    for _ in range(2):
        assert d.status(client, user["id"], v="1.2.0", build=other).status_code == 200
    assert verified(d.refresh(client, user["id"], v="1.2.0", build=other))["plan"]["id"] == "free"
    assert [e.detail for e in events(user["id"], "unknown_build")] == [f"1.2.0 {other[:16]}"]
    # a version that was never released
    assert d.refresh(client, user["id"], v="9.9.9", build=released).status_code == 200
    assert len(events(user["id"], "unknown_build")) == 2
    # a client that stops reporting, or reports nonsense
    assert d.status(client, user["id"], v="<script>", build=["x"]).status_code == 200
    assert [e.detail for e in events(user["id"], "build_not_reported")] == ["previously 9.9.9"]
    assert device_row(client, user["auth"])["extension_version"] is None
    suspicious = {e["event"] for e in client.get(f"{V}/admin/licences/events", headers=admin, params={"suspicious": True, "limit": 200}).json()["items"]}
    assert {"unknown_build", "build_not_reported"} <= suspicious


def test_builds_are_not_checked_when_no_released_builds_are_configured(client, user):
    d = Device()
    assert d.activate(client, user["auth"], version="1.2.0", build="d" * 64).status_code == 200
    assert d.refresh(client, user["id"], v="1.2.0", build="e" * 64).status_code == 200
    assert not events(user["id"], "unknown_build")


# ------------------------------------------------------------------ plan changes
WEBHOOK_SECRET = "whsec_test_only_0123456789"


_event_clock = [0]


def webhook(client, user_id, etype, **data):
    # each event is newer than the one before and than anything an administrator just did (older events are "stale")
    _event_clock[0] = max(_event_clock[0] + 1, int(time.time()) + 2)
    event = {"id": f"evt_{uuid.uuid4().hex[:12]}", "type": etype, "created": _event_clock[0], "data": {"user_id": user_id, "plan": "pro", **data}}
    body, ts = json.dumps(event).encode(), int(time.time())
    sig = hmac.new(WEBHOOK_SECRET.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return client.post(f"{V}/billing/webhook", content=body, headers={"x-trustcode-signature": f"t={ts},v1={sig}", "content-type": "application/json"})


def test_admin_plan_open_ended_with_an_end_date_expired_and_past_dates(client, user, admin):
    set_plan = lambda **body: client.post(f"{V}/admin/users/{user['id']}/plan", headers=admin, json=body)  # noqa: E731
    d = Device()
    d.activate(client, user["auth"])
    # open-ended: paid for as long as the device keeps confirming, never longer than the offline period
    assert set_plan(plan="pro").status_code == 200
    p = verified(d.refresh(client, user["id"]))
    assert p["plan"]["id"] == "pro" and p["paid_until"] == p["offline_until"]
    # with an end date: the licence ends with the plan (the end of that day, no renewal grace), before the offline period
    until = now() + timedelta(days=10)
    assert set_plan(plan="team", until=until.strftime("%Y-%m-%d")).status_code == 200
    p = verified(d.refresh(client, user["id"]))
    end = until.replace(hour=23, minute=59, second=59, microsecond=0)
    assert p["plan"]["id"] == "team" and p["paid_until"] == int(end.timestamp()) < p["offline_until"]
    # the end date passes: the next licence is Free, with no paid period at all
    with SessionLocal() as db:
        db.scalars(select(Subscription).where(Subscription.user_id == user["id"])).one().current_period_end = now() - timedelta(days=4)
        db.commit()
    p = verified(d.refresh(client, user["id"]))
    assert p["plan"]["id"] == "free" and p["paid_until"] is None and p["features"] == verified(Device().activate(client, register(client)["auth"]))["features"]
    # dates in the past, impossible dates and unknown plans are rejected
    for body in ({"plan": "pro", "until": "2001-01-01"}, {"plan": "pro", "until": (now() - timedelta(days=1)).strftime("%Y-%m-%d")},
                 {"plan": "pro", "until": "2026-13-45"}, {"plan": "pro", "until": "tomorrow"}, {"plan": "enterprise"}):
        assert set_plan(**body).status_code == 422, body
    assert client.post(f"{V}/admin/users/{user['id']}/plan", headers=user["auth"], json={"plan": "team"}).status_code == 403
    assert verified(d.refresh(client, user["id"]))["plan"]["id"] == "free"


def test_a_billing_event_replaces_an_admin_plan_and_paid_until_never_exceeds_it(client, user, admin, monkeypatch):
    monkeypatch.setattr(get_settings(), "billing_webhook_secret", WEBHOOK_SECRET)
    d = Device()
    d.activate(client, user["auth"])
    client.post(f"{V}/admin/users/{user['id']}/plan", headers=admin, json={"plan": "team"})
    assert verified(d.refresh(client, user["id"]))["plan"]["id"] == "team"
    end = int(time.time()) + 5 * DAY
    assert webhook(client, user["id"], "subscription.activated", period_end=end).json()["outcome"] == "applied"
    p = verified(d.refresh(client, user["id"]))
    assert p["plan"]["id"] == "pro" and p["paid_until"] == end + 3 * DAY, "the verified billing period plus the renewal grace"
    with SessionLocal() as db:
        assert db.scalars(select(Subscription).where(Subscription.user_id == user["id"])).one().provider != "admin", "no longer an administrator's grant"
    forged_admin = webhook(client, user["id"], "subscription.renewed", period_end=end, provider="admin")
    assert forged_admin.json()["outcome"] == "applied"
    with SessionLocal() as db:
        assert db.scalars(select(Subscription).where(Subscription.user_id == user["id"])).one().provider == "manual", "an event cannot make itself an administrator's grant"
    # whatever happens to the subscription, a licence never promises more than it
    for etype, data, expect in (("subscription.renewed", {"period_end": end + 30 * DAY}, ("pro", end + 33 * DAY)),
                                ("subscription.cancelled", {}, ("pro", end + 30 * DAY)),      # the period paid for, no grace
                                ("payment.refunded", {}, ("free", None)),
                                ("subscription.activated", {"period_end": end + 400 * DAY}, ("pro", end + 403 * DAY)),
                                ("payment.disputed", {}, ("free", None)),
                                ("subscription.activated", {"period_end": end}, ("pro", end + 3 * DAY)),
                                ("subscription.expired", {}, ("free", None))):
        assert webhook(client, user["id"], etype, **data).json()["outcome"] == "applied", etype
        p = verified(d.refresh(client, user["id"]))
        assert (p["plan"]["id"], p["paid_until"]) == expect, etype
        assert p["offline_until"] - p["iat"] == 30 * DAY, "the offline period is independent of the paid period"
    with SessionLocal() as db:
        for lic in db.scalars(select(Licence).where(Licence.user_id == user["id"], Licence.plan_id != "free")):
            assert lic.paid_until is not None, "every paid licence carries an end"


# ------------------------------------------------------------------ tampered tokens and key rotation
def test_tampered_tokens_are_all_rejected(client, user):
    token = Device().activate(client, user["auth"]).json()["licence"]
    other = Device().activate(client, register(client)["auth"]).json()["licence"]
    pub = signing.public_key()
    keys = {pub["kid"]: pub["public_key"]}
    assert signing.verify_with_keys(token, keys)["sub"] == user["id"]
    head, body, sig = token.split(".")
    edit = lambda **change: b64u(json.dumps({**decode(token), **change}, separators=(",", ":"), sort_keys=True).encode())  # noqa: E731
    none_alg = b64u(b'{"alg":"none","typ":"JWT"}')
    forged = {
        "payload edited (plan)": f"{head}.{edit(plan={'id': 'team', 'name': 'Team'})}.{sig}",
        "payload edited (offline period)": f"{head}.{edit(offline_until=decode(token)['offline_until'] + 365 * DAY)}.{sig}",
        "payload edited (device)": f"{head}.{edit(dev='f' * 32)}.{sig}",
        "signature of another licence": f"{head}.{body}.{other.split('.')[2]}",
        "payload of another licence": f"{head}.{other.split('.')[1]}.{sig}",
        "key id changed": f"{head}.{edit(kid='k9')}.{sig}",
        "key id removed": f"{head}.{b64u(json.dumps({k: v for k, v in decode(token).items() if k != 'kid'}).encode())}.{sig}",
        "prefix changed": f"tcl2.{body}.{sig}",
        "prefix upper case": f"TCL1.{body}.{sig}",
        "algorithm none (JWT style)": f"{none_alg}.{body}.",
        "algorithm header added": f"{head}.{none_alg}.{body}.{sig}",
        "signature removed": f"{head}.{body}.",
        "signature all zero": f"{head}.{body}.{b64u(bytes(64))}",
        "signature truncated": f"{head}.{body}.{sig[:-4]}",
        "one signature bit flipped": f"{head}.{body}.{b64u(bytes([unb64u(sig)[0] ^ 1]) + unb64u(sig)[1:])}",
        "token truncated": token[: len(token) // 2],
        "payload truncated": f"{head}.{body[:-6]}.{sig}",
        "extra segment": f"{token}.x",
        "whitespace added": f" {token}",
        "payload not JSON": f"{head}.{b64u(b'not json')}.{sig}",
        "payload not base64": f"{head}.%%%.{sig}",
        "empty": "",
        "dots only": "..",
        "not a string": None,
    }
    for name, t in forged.items():
        with pytest.raises(ValueError):
            signing.verify_with_keys(t, keys)
        with pytest.raises(ValueError):
            signing.verify(t, pub["public_key"])
    # signed correctly, but by a key that is not the server's
    mine = Ed25519PrivateKey.generate()
    self_signed = f"{head}.{body}.{b64u(mine.sign(f'{head}.{body}'.encode()))}"
    with pytest.raises(ValueError):
        signing.verify_with_keys(self_signed, keys)


def test_key_rotation_old_key_still_verifies_new_key_signs_unknown_key_is_rejected(client, user, monkeypatch):
    d = Device()
    old_token = d.activate(client, user["auth"]).json()["licence"]
    old = signing.public_key()
    new_seed, new_public = signing.generate_seed()
    monkeypatch.setattr(get_settings(), "licence_signing_key", new_seed)
    monkeypatch.setattr(get_settings(), "licence_key_id", "k2")
    assert client.get(f"{V}/licence/keys").json()["keys"] == [{"kid": "k2", "alg": "Ed25519", "public_key": new_public}]
    new_token = d.refresh(client, user["id"]).json()["licence"]
    assert decode(old_token)["kid"] == old["kid"] != "k2" and decode(new_token)["kid"] == "k2"
    pinned = {old["kid"]: old["public_key"], "k2": new_public}       # what an extension released during the rotation holds
    assert signing.verify_with_keys(old_token, pinned)["lid"] == decode(old_token)["lid"], "licences signed before the rotation keep working"
    assert signing.verify_with_keys(new_token, pinned)["kid"] == "k2"
    with pytest.raises(ValueError, match="unknown signing key"):     # an extension that only knows the old key
        signing.verify_with_keys(new_token, {old["kid"]: old["public_key"]})
    with pytest.raises(ValueError, match="unknown signing key"):     # after the old key is retired
        signing.verify_with_keys(old_token, {"k2": new_public})
    # a licence that names one key and is signed by the other
    head, body, sig = old_token.split(".")
    relabelled = b64u(json.dumps({**decode(old_token), "kid": "k2"}, separators=(",", ":"), sort_keys=True).encode())
    with pytest.raises(ValueError, match="not valid"):
        signing.verify_with_keys(f"{head}.{relabelled}.{sig}", pinned)
    with pytest.raises(ValueError):
        signing.verify(old_token, new_public)


# ------------------------------------------------------------------ what an attacker can learn or reuse
@pytest.mark.parametrize("op", ["refresh", "status", "release"])
def test_user_and_device_ids_cannot_be_enumerated(client, user, op):
    d = Device()
    d.activate(client, user["auth"])
    stranger = Device()
    answers = [
        stranger.call(client, op, "0" * 32),                                    # unknown account, unknown device
        stranger.call(client, op, user["id"]),                                  # real account, unknown device
        d.call(client, op, "0" * 32),                                           # unknown account, real device id
        d.call(client, op, user["id"], key=stranger.key),                       # real account and device, no key
        d.call(client, op, register(client)["id"]),                             # real device under another real account
    ]
    assert {(r.status_code, r.text) for r in answers} == {(401, answers[0].text)}, "every case answers exactly the same"
    assert code(answers[0]) == "device_not_recognised"
    assert user["id"] not in answers[0].text and d.id not in answers[0].text


def test_reusing_another_accounts_device_id_gains_nothing(client, user):
    victim = Device()
    victim.activate(client, user["auth"])
    attacker, copy = register(client), Device()
    copy.id = victim.id                                   # the attacker learnt the victim's device id
    assert copy.activate(client, attacker["auth"]).status_code == 200, "it becomes a device of the attacker's own account only"
    assert decode(copy.activate(client, attacker["auth"]).json()["licence"])["sub"] == attacker["id"]
    # the attacker's key is not accepted for the victim's account, in any operation
    for op in ("refresh", "status", "release"):
        assert code(copy.call(client, op, user["id"])) == "device_not_recognised", op
    # the victim's device is untouched
    assert verified(victim.refresh(client, user["id"]))["sub"] == user["id"]
    assert client.get(f"{V}/licence/devices", headers=user["auth"]).json()["active_devices"] == 1
    # and the attacker cannot manage the victim's device through the account endpoints
    row = device_row(client, user["auth"])["id"]
    assert client.post(f"{V}/licence/devices/{row}/deactivate", headers=attacker["auth"]).status_code == 404
    assert client.get(f"{V}/admin/licences/users/{user['id']}", headers=attacker["auth"]).status_code == 403
    assert row not in client.get(f"{V}/licence/devices", headers=attacker["auth"]).text
    assert "signature_rejected" in {e.event for e in events(user["id"])}


def test_licence_history_and_admin_endpoints_need_the_right_account(client, user):
    Device().activate(client, user["auth"])
    for path in ("/licence/devices", "/licence/history"):
        assert client.get(f"{V}{path}").status_code == 401
    for method, path in (("get", "/admin/licences"), ("get", "/admin/licences/events"), ("get", f"/admin/licences/users/{user['id']}"),
                         ("patch", f"/admin/licences/users/{user['id']}/policy"), ("post", f"/admin/licences/devices/{'a' * 32}/revoke"),
                         ("post", f"/admin/users/{user['id']}/plan"), ("post", f"/admin/users/{user['id']}/suspend")):
        kw = {"json": {"plan": "pro"}} if method != "get" else {}
        assert getattr(client, method)(f"{V}{path}", **kw).status_code == 401, path
        assert getattr(client, method)(f"{V}{path}", headers=user["auth"], **kw).status_code == 403, path
    other = register(client)
    assert client.get(f"{V}/licence/history", headers=other["auth"]).json()["items"] == [], "history is per account"
