"""Licence decisions. The backend is the source of truth: it decides the plan from verified billing state
(app.billing) and signs a licence that lets the extension keep paid features on while offline, for a bounded time.

What the licence can never do:
- unlock anything the account is not entitled to at issue time;
- outlive the paid period (`paid_until`) - a lapsed subscription lapses offline too;
- be refreshed by anyone without the device's private key, or by a deactivated/revoked device or a suspended account.

The Free plan never needs a licence: local analysis works without an account.
"""
from __future__ import annotations

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
    }
    return signing.sign(payload), payload


def activate(db: Session, user: User, device_id: str, public_key: str, name: str, platform: str | None) -> tuple[str, dict]:
    if not signing.configured():
        raise Refused(503, "licensing_not_configured", "Licensing is not set up on this server. The Free plan needs no licence.")
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
    if not isinstance(counter, int) or isinstance(counter, bool) or counter <= (dev.last_request_counter or 0):
        record(db, "replay_rejected", dev.user_id, dev)
        db.commit()
        raise Refused(401, "replayed_request", "This request was already used.")
    dev.last_request_counter = counter
    return dev


def refresh(db: Session, body: bytes, signature: str, data: dict) -> tuple[str, dict]:
    """Device-authenticated refresh: works without an account token, so a device that was offline for longer than a
    sign-in session lasts can still resynchronise. The backend re-decides everything from current state."""
    dev = authenticate_device(db, body, signature, data)
    user = db.get(User, dev.user_id)
    if user is None or user.suspended:
        _revoke_licences(db, dev, "account_suspended")
        record(db, "refresh_refused", dev.user_id, dev, detail="account suspended")
        db.commit()
        raise Refused(403, "account_suspended", "This account is suspended.")
    if dev.status != "active":
        record(db, "refresh_refused", dev.user_id, dev, detail=f"device {dev.status}")
        db.commit()
        raise Refused(403, f"device_{dev.status}",
                      "This device was blocked by an administrator." if dev.status == "revoked" else "This device was deactivated. Sign in again to activate it.")
    token, payload = issue(db, user, dev)
    record(db, "refreshed", user.id, dev, payload["lid"], detail=payload["plan"]["id"])
    db.commit()
    return token, payload


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
    _revoke_licences(db, dev, "revoked" if revoke else "deactivated")
    record(db, "revoked" if revoke else "deactivated", dev.user_id, dev, detail="administrator" if by_admin else "account owner")


def device_out(d: LicenceDevice) -> dict:
    return {"id": d.id, "name": d.name, "platform": d.platform, "status": d.status, "activated_at": d.activated_at,
            "last_validated_at": d.last_validated_at, "deactivated_at": d.deactivated_at}


def event_out(e: LicenceEvent) -> dict:
    return {"event": e.event, "detail": e.detail, "device": e.device_row_id, "user_id": e.user_id, "created_at": e.created_at}
