"""Licence decisions. The backend is the source of truth: it decides the plan from verified billing state
(app.billing) and signs a licence that lets the extension keep paid features on while offline, for a bounded time.

What the licence can never do:
- unlock anything the account is not entitled to at issue time;
- outlive the paid period (`paid_until`) - a lapsed subscription lapses offline too;
- be refreshed by anyone without the device's private key, or by a deactivated/revoked device or a suspended account.

TrustCode is free, but every user needs a registered account: the Free plan is licensed too.

Revocation reaches a device in three ways, all decided here: the device-signed status call (`status`), the
account's revocation version returned with signed-in responses (`User.licence_rev`), and the licence refresh.
Offline, a device stops when the offline period of its last licence ends; that moment is recorded (`stops_by`).
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ..billing.plans import PLANS
from ..billing.subscriptions import paid_until, state_of, subscription_of
from ..config import get_settings
from ..models import Licence, LicenceDevice, LicenceEvent, LicencePolicy, User, now
from . import signing

LICENCE_VERSION = 1
GRACE_DAYS_RANGE = (1, 365)
MAX_DEVICES_RANGE = (1, 50)
STATUS_MINUTES_RANGE = (60, 240)
COUNTER_MAX = 2 ** 62                 # fits the BIGINT column; larger values are refused instead of failing in the database
PROOF_WINDOW_SECONDS = 300            # a device proof for a server call is accepted this long either side of server time
_ID = re.compile(r"\A[a-f0-9]{32}\Z")
_VERSION = re.compile(r"\A[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}\Z")
_HASH = re.compile(r"\A[a-f0-9]{64}\Z")


class Refused(Exception):
    """A licence request the server declines. `code` is stable and shown to the extension; `status` is HTTP."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def _aware(dt: datetime | None) -> datetime | None:
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def record(db: Session, event: str, user_id: str | None = None, device: LicenceDevice | None = None,
           licence_id: str | None = None, detail: str | None = None):
    db.add(LicenceEvent(user_id=user_id, device_row_id=device.id if device else None, licence_id=licence_id,
                        event=event, detail=(detail or None) and detail[:120]))


def status_seconds() -> int:
    """How often a device confirms its status while online."""
    lo, hi = STATUS_MINUTES_RANGE
    return max(lo, min(hi, get_settings().licence_status_minutes)) * 60


def bump_rev(db: Session, user: User | None):
    """Something changed what this account's devices may do: every device refreshes at its next contact."""
    if user is None:
        return
    user.licence_rev = User.licence_rev + 1     # incremented in the database, so concurrent changes are not lost
    db.flush()
    db.refresh(user, ["licence_rev"])


def latest_stop(db: Session, device: LicenceDevice) -> datetime:
    """The latest moment any licence ever signed for this device lets it run offline."""
    t = _aware(db.scalar(select(func.max(Licence.offline_until)).where(Licence.device_row_id == device.id)))
    return t or now()


def mark_stopped(db: Session, device: LicenceDevice, reason: str) -> datetime:
    device.stops_by, device.stop_reason = latest_stop(db, device), reason
    return device.stops_by


def known_builds() -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for item in get_settings().licence_known_builds.split(","):
        version, _, digest = item.strip().partition("=")
        if _VERSION.match(version) and _HASH.match(digest):
            out.setdefault(version, set()).add(digest)
    return out


def note_build(db: Session, device: LicenceDevice, data: dict):
    """Integrity signal: the extension reports its version and a hash of its own code. An unknown build is logged
    as suspicious and never blocked - a modified client can report anything, and honest users must not be hurt
    by a release whose hash was not registered."""
    v, b = data.get("v"), data.get("build")
    v = v if isinstance(v, str) and _VERSION.match(v) else None
    b = b if isinstance(b, str) and _HASH.match(b) else None
    if (v, b) == (device.ext_version, device.build_hash):
        return
    known = known_builds()
    if v is None or b is None:
        if device.build_hash is not None:
            record(db, "build_not_reported", device.user_id, device, detail=f"previously {device.ext_version}")
    elif known and b not in known.get(v, ()):
        record(db, "unknown_build", device.user_id, device, detail=f"{v} {b[:16]}")
    device.ext_version, device.build_hash = v, b


def policy_for(db: Session, user: User) -> dict:
    """Plan, features and licence policy for this account right now (plan default, then admin override)."""
    sub = subscription_of(db, user)
    st = state_of(sub)
    plan = PLANS.get(st["plan_id"], PLANS["free"]) if st["paid"] else PLANS["free"]
    base = plan.get("licence", PLANS["free"]["licence"])
    override = db.get(LicencePolicy, user.id)
    return {
        "plan": plan, "state": st["state"], "paid_until": paid_until(sub),
        "offline_grace_days": (override.offline_grace_days if override and override.offline_grace_days else base["offline_grace_days"]),
        "max_devices": (override.max_devices if override and override.max_devices else base["max_devices"]),
        "overridden": bool(override and (override.offline_grace_days or override.max_devices)),
    }


def active_devices(db: Session, user_id: str) -> int:
    return db.scalar(select(func.count()).select_from(LicenceDevice)
                     .where(LicenceDevice.user_id == user_id, LicenceDevice.status == "active")) or 0


def _revoke_licences(db: Session, device: LicenceDevice, reason: str):
    db.execute(update(Licence).where(Licence.device_row_id == device.id, Licence.revoked_at.is_(None))
               .values(revoked_at=now(), revoked_reason=reason))


def issue(db: Session, user: User, device: LicenceDevice) -> tuple[str, dict]:
    """Signs a fresh licence for an active device. Earlier licences of the device are superseded."""
    pol = policy_for(db, user)
    s = get_settings()
    t = now().replace(microsecond=0)
    offline_until = t + timedelta(days=pol["offline_grace_days"])
    paid = pol["paid_until"]
    if paid is None and pol["plan"]["id"] != "free":
        paid = offline_until   # open-ended plan (admin grant): bounded by the offline period, renewed at each refresh
    _revoke_licences(db, device, "superseded")
    lic = Licence(user_id=user.id, device_row_id=device.id, plan_id=pol["plan"]["id"], key_id=s.licence_key_id,
                  issued_at=t, offline_until=offline_until, paid_until=paid)
    db.add(lic)
    db.flush()
    device.last_validated_at = t
    ts = lambda d: int(d.timestamp()) if d else None  # noqa: E731
    payload = {
        "v": LICENCE_VERSION, "kid": s.licence_key_id, "lid": lic.id, "sub": user.id, "dev": device.device_id,
        "plan": {"id": pol["plan"]["id"], "name": pol["plan"]["name"]}, "state": pol["state"],
        "features": pol["plan"]["features"], "limits": pol["plan"]["limits"],
        "act": ts(_aware(device.activated_at)), "iat": ts(t), "validated_at": ts(t),
        "grace_days": pol["offline_grace_days"], "offline_until": ts(offline_until), "paid_until": ts(paid),
        "refresh_after": ts(t + timedelta(hours=max(1, s.licence_refresh_hours))),
        "rev": user.licence_rev or 0, "check_after": status_seconds(),
    }
    return signing.sign(payload), payload


def activate(db: Session, user: User, device_id: str, public_key: str, name: str, platform: str | None,
             client: dict | None = None) -> tuple[str, dict]:
    if not signing.configured():
        raise Refused(503, "licensing_not_configured", "Licensing is not set up on this server. The Free plan needs no licence.")
    # Serialise activations per account so two simultaneous requests cannot both pass the device-limit check.
    # A write to the account row takes the lock on every database: a row lock until commit on Postgres, the single
    # write lock on SQLite (which ignores FOR UPDATE and would otherwise let both requests count devices first).
    db.execute(update(User).where(User.id == user.id).values(licence_rev=User.licence_rev))
    dev = db.scalar(select(LicenceDevice).where(LicenceDevice.user_id == user.id, LicenceDevice.device_id == device_id))
    if dev is not None and dev.status == "revoked":
        record(db, "activation_refused", user.id, dev, detail="device revoked by an administrator")
        db.commit()
        raise Refused(403, "device_revoked", "This device was blocked by an administrator. Contact support.")
    if dev is None or dev.status != "active":
        limit = policy_for(db, user)["max_devices"]
        if active_devices(db, user.id) >= limit:
            record(db, "activation_refused", user.id, dev, detail=f"device limit {limit} reached")
            db.commit()
            raise Refused(409, "device_limit_reached",
                          f"This account is already active on {limit} devices. Deactivate one in your account dashboard, then try again.")
    if dev is None:
        dev = LicenceDevice(user_id=user.id, device_id=device_id, public_key=public_key, name=name, platform=platform)
        db.add(dev)
        db.flush()
    else:   # reinstall or reactivation: the account owner just signed in, so the new device key replaces the old one
        dev.public_key, dev.name, dev.platform, dev.status, dev.deactivated_at = public_key, name, platform, "active", None
        dev.activated_at, dev.last_request_counter = now(), 0
        dev.stops_by, dev.stop_reason = None, None
    note_build(db, dev, client or {})
    dev.last_seen_at = now()
    token, payload = issue(db, user, dev)
    record(db, "activated", user.id, dev, payload["lid"], detail=payload["plan"]["id"])
    db.commit()
    return token, payload


def authenticate_device(db: Session, body: bytes, signature: str, data: dict) -> LicenceDevice:
    """The request must be signed by the device key registered at activation, and its counter must be higher than
    any counter seen before from that device, so a captured request cannot be replayed."""
    if not signing.configured():
        raise Refused(503, "licensing_not_configured", "Licensing is not set up on this server.")
    user_id, device_id, counter = data.get("user_id"), data.get("device_id"), data.get("counter")
    dev = db.scalar(select(LicenceDevice).where(LicenceDevice.user_id == user_id, LicenceDevice.device_id == device_id))
    if dev is None or not signing.verify_device_signature(dev.public_key, signature, body):
        record(db, "signature_rejected", user_id if dev else None, dev)
        db.commit()
        raise Refused(401, "device_not_recognised", "This device is not activated. Sign in again to activate it.")
    # The counter is advanced with one conditional UPDATE, so of two copies of a request arriving together exactly
    # one wins on any database (no read-then-write gap). Values that do not fit the column are refused, not stored.
    fresh = False
    if isinstance(counter, int) and not isinstance(counter, bool) and 0 < counter < COUNTER_MAX:
        fresh = db.execute(update(LicenceDevice).where(LicenceDevice.id == dev.id, LicenceDevice.last_request_counter < counter)
                           .values(last_request_counter=counter)).rowcount == 1
    if not fresh:
        db.rollback()
        record(db, "replay_rejected", dev.user_id, dev)
        db.commit()
        raise Refused(401, "replayed_request", "This request was already used.")
    db.refresh(dev)   # the row is now locked by this transaction until it commits
    return dev


def _require_live(db: Session, dev: LicenceDevice, op: str) -> User:
    """The account and the device must both still be allowed. Refusals are recorded and tell the device to stop."""
    user = db.get(User, dev.user_id)
    if user is None or user.suspended:
        _revoke_licences(db, dev, "account_suspended")
        record(db, f"{op}_refused", dev.user_id, dev, detail="account suspended")
        db.commit()
        raise Refused(403, "account_suspended", "This account is suspended.")
    if dev.status != "active":
        record(db, f"{op}_refused", dev.user_id, dev, detail=f"device {dev.status}")
        db.commit()
        raise Refused(403, f"device_{dev.status}",
                      "This device was blocked by an administrator." if dev.status == "revoked" else "This device was deactivated. Sign in again to activate it.")
    return user


def refresh(db: Session, body: bytes, signature: str, data: dict) -> tuple[str, dict]:
    """Device-authenticated refresh: works without an account token, so a device that was offline for longer than a
    sign-in session lasts can still resynchronise. The backend re-decides everything from current state."""
    dev = authenticate_device(db, body, signature, data)
    user = _require_live(db, dev, "refresh")
    note_build(db, dev, data)
    dev.last_seen_at = now()
    token, payload = issue(db, user, dev)
    record(db, "refreshed", user.id, dev, payload["lid"], detail=payload["plan"]["id"])
    db.commit()
    return token, payload


def status(db: Session, body: bytes, signature: str, data: dict) -> dict:
    """Device-authenticated status check: the cheap way for a device to learn that it was removed, blocked or its
    account suspended or deleted. Nothing is signed and no licence is issued. `refresh` tells the device that its
    licence is no longer the current one (plan, policy or revocation version changed) and it should refresh now."""
    dev = authenticate_device(db, body, signature, data)
    user = _require_live(db, dev, "status")
    note_build(db, dev, data)
    dev.last_seen_at = now()
    current = db.scalar(select(Licence.id).where(Licence.device_row_id == dev.id, Licence.revoked_at.is_(None))
                        .order_by(Licence.issued_at.desc()).limit(1))
    rev = user.licence_rev or 0
    stale = current is None or data.get("lid") != current or data.get("rev") != rev
    db.commit()
    return {"status": "ok", "rev": rev, "refresh": stale, "check_after": status_seconds()}


def device_proof(db: Session, user: User, header: str | None) -> LicenceDevice:
    """A server feature was requested: the caller must also hold the key of an active device of this account.
    Header: "<device id>.<unix seconds>.<Ed25519 signature of 'tcdev1.<user id>.<device id>.<unix seconds>'>"."""
    parts = (header or "").split(".")
    if len(parts) != 3 or not _ID.match(parts[0]) or not (parts[1].isdigit() and len(parts[1]) <= 12):
        raise Refused(403, "device_proof_required", "This server feature needs TrustCode to be activated on this device. Update TrustCode and sign in.")
    dev = db.scalar(select(LicenceDevice).where(LicenceDevice.user_id == user.id, LicenceDevice.device_id == parts[0]))
    if dev is None or not signing.verify_device_signature(dev.public_key, parts[2], f"tcdev1.{user.id}.{parts[0]}.{parts[1]}".encode()):
        raise Refused(403, "device_not_recognised", "This device is not activated for this account. Sign in again to activate it.")
    if abs(now().timestamp() - int(parts[1])) > PROOF_WINDOW_SECONDS:
        raise Refused(403, "device_proof_expired", "The request was signed at a time the server does not accept. Check this computer's date and time.")
    if dev.status != "active":
        raise Refused(403, f"device_{dev.status}", "This device is no longer active for this account.")
    return dev


def release(db: Session, body: bytes, signature: str, data: dict) -> LicenceDevice:
    """The device gives up its activation (sign-out), freeing a device slot."""
    dev = authenticate_device(db, body, signature, data)
    if dev.status == "active":
        deactivate(db, dev)
    db.commit()
    return dev


def deactivate(db: Session, dev: LicenceDevice, by_admin: bool = False, revoke: bool = False):
    dev.status = "revoked" if revoke else "deactivated"
    dev.deactivated_at = now()
    stop = mark_stopped(db, dev, dev.status)
    _revoke_licences(db, dev, "revoked" if revoke else "deactivated")
    bump_rev(db, db.get(User, dev.user_id))
    record(db, "revoked" if revoke else "deactivated", dev.user_id, dev,
           detail=f"{'administrator' if by_admin else 'account owner'}; offline it stops by {stop:%Y-%m-%d %H:%M} UTC")


def account_suspension(db: Session, user: User, suspended: bool) -> list[LicenceDevice]:
    """An administrator suspended or restored the account: record, per device, when it will at the latest stop."""
    devices = list(db.scalars(select(LicenceDevice).where(LicenceDevice.user_id == user.id)))
    for dev in devices:
        if suspended and dev.status == "active":
            stop = mark_stopped(db, dev, "account_suspended")
            record(db, "account_suspended", user.id, dev, detail=f"offline it stops by {stop:%Y-%m-%d %H:%M} UTC")
        elif not suspended and dev.stop_reason == "account_suspended":
            dev.stops_by, dev.stop_reason = None, None
            record(db, "account_restored", user.id, dev)
    bump_rev(db, user)
    return devices


def account_deletion_stops(db: Session, user: User) -> list[str]:
    """Before an account is erased: when each device that could still run will at the latest stop. The device rows
    and the licence history are erased with the account, so the caller keeps only these times (audit log)."""
    t = now()
    out = []
    for dev in db.scalars(select(LicenceDevice).where(LicenceDevice.user_id == user.id)):
        stop = _aware(dev.stops_by) if dev.status != "active" else latest_stop(db, dev)
        if stop and stop > t:
            out.append(stop.replace(microsecond=0).isoformat())
    return sorted(out)


def device_out(d: LicenceDevice) -> dict:
    stop = _aware(d.stops_by)
    left = None if stop is None else max(0, int((stop - now()).total_seconds()))
    return {"id": d.id, "name": d.name, "platform": d.platform, "status": d.status, "activated_at": d.activated_at,
            "last_validated_at": d.last_validated_at, "deactivated_at": d.deactivated_at,
            "last_seen_at": d.last_seen_at, "extension_version": d.ext_version,
            # set when the device was removed or blocked, or its account suspended: it stops at its next status check
            # when online (within `online_stop_within_seconds`), and at `stops_by` at the latest when it stays offline
            "stops_by": stop, "stop_reason": d.stop_reason, "stops_in_seconds": left,
            "online_stop_within_seconds": None if stop is None else status_seconds()}


def event_out(e: LicenceEvent) -> dict:
    return {"event": e.event, "detail": e.detail, "device": e.device_row_id, "user_id": e.user_id, "created_at": e.created_at}
