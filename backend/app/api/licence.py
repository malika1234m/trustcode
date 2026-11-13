"""Licence endpoints: activation (signed-in account), device-signed refresh, device management, administration.

The backend decides; the extension only verifies what the backend signed. See docs/LICENSING.md.
"""
from __future__ import annotations

import json
import re
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import client_ip, current_user, limiter
from ..licensing import service, signing
from ..models import LicenceDevice, LicenceEvent, LicencePolicy, User, now
from .saas import audit, current_admin

router = APIRouter(prefix="/api/v1", tags=["licence"])
REFRESH_MAX_BYTES = 2048
_ID = re.compile(r"^[a-f0-9]{32}$")
_KEY = re.compile(r"^[A-Za-z0-9_-]{43}$")   # 32 raw bytes, base64url without padding


def _refused(e: service.Refused) -> JSONResponse:
    return JSONResponse({"error": {"code": e.code, "message": e.message}}, status_code=e.status)


def _issued(token: str, payload: dict) -> dict:
    return {"licence": token, "server_time": int(now().timestamp()), "plan": payload["plan"],
            "offline_until": payload["offline_until"], "paid_until": payload["paid_until"]}


class ActivateIn(BaseModel):
    device_id: str = Field(min_length=32, max_length=32)
    public_key: str = Field(min_length=43, max_length=43)
    name: str = Field(default="VS Code", min_length=1, max_length=80)
    platform: str | None = Field(default=None, max_length=40)

    @field_validator("device_id")
    @classmethod
    def _dev(cls, v):
        if not _ID.match(v):
            raise ValueError("device_id must be 32 lowercase hex characters")
        return v

    @field_validator("public_key")
    @classmethod
    def _key(cls, v):
        if not _KEY.match(v):
            raise ValueError("public_key must be a base64url Ed25519 public key")
        return v

    @field_validator("name", "platform")
    @classmethod
    def _text(cls, v):
        return v if v is None else re.sub(r"[\x00-\x1f\x7f]", "", v).strip() or "VS Code"


@router.get("/licence/keys")
def licence_keys():
    """The current public verification key (reference only; the extension ships with its own pinned copy)."""
    if not signing.configured():
        return {"configured": False, "keys": []}
    return {"configured": True, "keys": [signing.public_key()]}


@router.post("/licence/activate")
def activate(body: ActivateIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    limiter.check(f"licence-activate:{user.id}", 10)
    try:
        token, payload = service.activate(db, user, body.device_id, body.public_key, body.name, body.platform)
    except service.Refused as e:
        return _refused(e)
    audit(db, request, "licence_activated", user.id, plan=payload["plan"]["id"])
    db.commit()
    return _issued(token, payload)


async def _device_request(request: Request) -> tuple[bytes, dict]:
    limiter.check(f"licence-refresh:{client_ip(request)}", 30)
    body = b""
    async for chunk in request.stream():
        body += chunk
        if len(body) > REFRESH_MAX_BYTES:
            raise HTTPException(413, "request too large")
    try:
        data = json.loads(body)
        assert isinstance(data, dict) and isinstance(data.get("user_id"), str) and isinstance(data.get("device_id"), str)
        assert _ID.match(data["user_id"]) and _ID.match(data["device_id"])
    except Exception:
        raise HTTPException(400, "invalid request")
    limiter.check(f"licence-refresh-dev:{data['device_id']}", 6)
    return body, data


@router.post("/licence/refresh")
async def refresh(request: Request, db: Session = Depends(get_db)):
    """Refresh without an account token: the device proves itself with its own key (see service.authenticate_device)."""
    body, data = await _device_request(request)
    try:
        token, payload = service.refresh(db, body, request.headers.get("x-trustcode-device-signature", ""), data)
    except service.Refused as e:
        return _refused(e)
    return _issued(token, payload)


@router.post("/licence/release")
async def release(request: Request, db: Session = Depends(get_db)):
    """Sign-out from the extension: the device deactivates itself, freeing a device slot."""
    body, data = await _device_request(request)
    try:
        dev = service.release(db, body, request.headers.get("x-trustcode-device-signature", ""), data)
    except service.Refused as e:
        return _refused(e)
    return {"status": dev.status}


@router.get("/licence/devices")
def my_devices(user: User = Depends(current_user), db: Session = Depends(get_db)):
    pol = service.policy_for(db, user)
    rows = db.scalars(select(LicenceDevice).where(LicenceDevice.user_id == user.id, LicenceDevice.status != "deactivated")
                      .order_by(LicenceDevice.activated_at.desc()))
    return {"configured": signing.configured(), "plan": {"id": pol["plan"]["id"], "name": pol["plan"]["name"]},
            "offline_grace_days": pol["offline_grace_days"], "max_devices": pol["max_devices"],
            "active_devices": service.active_devices(db, user.id), "items": [service.device_out(d) for d in rows]}


@router.post("/licence/devices/{device_row_id}/deactivate")
def deactivate_my_device(device_row_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    d = db.get(LicenceDevice, device_row_id)
    if not d or d.user_id != user.id:
        raise HTTPException(404, "device not found")
    if d.status == "active":
        service.deactivate(db, d)
        audit(db, request, "licence_device_deactivated", user.id, device=d.id)
        db.commit()
    return service.device_out(d)


@router.get("/licence/history")
def my_history(limit: int = Query(50, ge=1, le=200), user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(LicenceEvent).where(LicenceEvent.user_id == user.id)
                      .order_by(LicenceEvent.created_at.desc(), LicenceEvent.id).limit(limit))
    return {"items": [service.event_out(e) for e in rows]}


# ------------------------------------------------------------------ administration
@router.get("/admin/licences")
def admin_licences(q: str | None = Query(None, max_length=254), status: str | None = Query(None, pattern="^(active|deactivated|revoked)$"),
                   limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0),
                   admin: User = Depends(current_admin), db: Session = Depends(get_db)):
    stmt = select(LicenceDevice, User).join(User, User.id == LicenceDevice.user_id)
    if q:
        stmt = stmt.where((User.email.ilike(f"%{q.strip().lower()}%")) | (User.id == q.strip()))
    if status:
        stmt = stmt.where(LicenceDevice.status == status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(stmt.order_by(LicenceDevice.activated_at.desc(), LicenceDevice.id).offset(offset).limit(limit)).all()
    return {"configured": signing.configured(), "total": total,
            "active_total": db.scalar(select(func.count()).select_from(LicenceDevice).where(LicenceDevice.status == "active")) or 0,
            "items": [service.device_out(d) | {"user_id": u.id, "email": u.email, "suspended": u.suspended} for d, u in rows]}


@router.post("/admin/licences/devices/{device_row_id}/{action}")
def admin_device_action(device_row_id: str, action: Literal["revoke", "restore"], request: Request,
                        admin: User = Depends(current_admin), db: Session = Depends(get_db)):
    d = db.get(LicenceDevice, device_row_id)
    if not d:
        raise HTTPException(404, "device not found")
    if action == "revoke" and d.status != "revoked":
        service.deactivate(db, d, by_admin=True, revoke=True)
    elif action == "restore" and d.status == "revoked":
        d.status = "deactivated"     # the owner can activate it again by signing in
        service.record(db, "restored", d.user_id, d, detail="administrator")
    audit(db, request, f"admin_licence_{action}", admin.id, target=d.user_id, device=d.id)
    db.commit()
    return service.device_out(d)


class PolicyIn(BaseModel):
    offline_grace_days: int | None = Field(default=None, ge=service.GRACE_DAYS_RANGE[0], le=service.GRACE_DAYS_RANGE[1])
    max_devices: int | None = Field(default=None, ge=service.MAX_DEVICES_RANGE[0], le=service.MAX_DEVICES_RANGE[1])


@router.get("/admin/licences/users/{user_id}")
def admin_user_licence(user_id: str, admin: User = Depends(current_admin), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "user not found")
    pol = service.policy_for(db, u)
    o = db.get(LicencePolicy, u.id)
    devices = db.scalars(select(LicenceDevice).where(LicenceDevice.user_id == u.id).order_by(LicenceDevice.activated_at.desc()))
    events = db.scalars(select(LicenceEvent).where(LicenceEvent.user_id == u.id).order_by(LicenceEvent.created_at.desc()).limit(50))
    return {"user": {"id": u.id, "email": u.email, "suspended": u.suspended},
            "plan": {"id": pol["plan"]["id"], "name": pol["plan"]["name"]}, "subscription_state": pol["state"],
            "policy": {"offline_grace_days": pol["offline_grace_days"], "max_devices": pol["max_devices"],
                       "override": {"offline_grace_days": o.offline_grace_days if o else None, "max_devices": o.max_devices if o else None}},
            "devices": [service.device_out(d) for d in devices], "events": [service.event_out(e) for e in events]}


@router.patch("/admin/licences/users/{user_id}/policy")
def admin_set_policy(user_id: str, body: PolicyIn, request: Request, admin: User = Depends(current_admin), db: Session = Depends(get_db)):
    """Per-account offline period and device limit (e.g. an organisation). Takes effect at the next licence refresh."""
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "user not found")
    o = db.get(LicencePolicy, u.id) or LicencePolicy(user_id=u.id)
    o.offline_grace_days, o.max_devices, o.updated_by = body.offline_grace_days, body.max_devices, admin.id
    db.merge(o)
    service.record(db, "policy_changed", u.id, detail=f"grace={body.offline_grace_days} devices={body.max_devices}")
    audit(db, request, "admin_licence_policy", admin.id, target=u.id, offline_grace_days=body.offline_grace_days, max_devices=body.max_devices)
    db.commit()
    pol = service.policy_for(db, u)
    return {"offline_grace_days": pol["offline_grace_days"], "max_devices": pol["max_devices"]}


SUSPICIOUS = ("signature_rejected", "replay_rejected", "activation_refused", "refresh_refused")


@router.get("/admin/licences/events")
def admin_events(event: str | None = Query(None, max_length=30), suspicious: bool = False,
                 limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
                 admin: User = Depends(current_admin), db: Session = Depends(get_db)):
    stmt = select(LicenceEvent)
    if suspicious:
        stmt = stmt.where(LicenceEvent.event.in_(SUSPICIOUS))
    elif event:
        stmt = stmt.where(LicenceEvent.event == event)
    rows = db.scalars(stmt.order_by(LicenceEvent.created_at.desc(), LicenceEvent.id).offset(offset).limit(limit))
    since = now() - timedelta(days=7)
    churn = db.execute(select(LicenceEvent.user_id, func.count()).where(LicenceEvent.event == "activated", LicenceEvent.created_at >= since,
                                                                           LicenceEvent.user_id.is_not(None))
                       .group_by(LicenceEvent.user_id).having(func.count() > 5).order_by(func.count().desc()).limit(20)).all()
    return {"items": [service.event_out(e) for e in rows],
            "frequent_activations_7d": [{"user_id": uid, "activations": n} for uid, n in churn]}
