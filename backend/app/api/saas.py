"""SaaS endpoints: plans, entitlements, account, support tickets and administration.

Authorization is enforced here on the backend (role checks, ownership checks); the website only renders.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Literal

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..billing.plans import PLANS, plan_for
from ..db import get_db
from ..deps import bearer, client_ip, current_user, limiter
from ..models import AuditLog, SupportTicket, TicketMessage, User, VerificationJob, now
from ..security import decode_token

router = APIRouter(prefix="/api/v1")
Category = Literal["bug", "feature", "account", "billing", "question"]


def month_start():
    n = now()
    return n.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def usage_this_month(db: Session, user_id: str) -> int:
    return db.scalar(select(func.count()).select_from(VerificationJob)
                     .where(VerificationJob.user_id == user_id, VerificationJob.created_at >= month_start())) or 0


def entitlements_for(db: Session, user: User) -> dict:
    """The single answer to "what may this account do right now". Decided here, from verified billing state."""
    from ..billing.subscriptions import state_of, subscription_of
    from ..config import get_settings
    st = state_of(subscription_of(db, user))
    plan = PLANS.get(st["plan_id"], PLANS["free"]) if st["paid"] else PLANS["free"]
    used = usage_this_month(db, user.id)
    limit = plan["limits"]["verifications_per_month"]
    nxt = (month_start() + timedelta(days=32)).replace(day=1)
    iso = lambda d: d.isoformat() if d else None  # noqa: E731
    return {"plan": {"id": plan["id"], "name": plan["name"]}, "status": "active" if st["state"] == "free" else st["state"], "limits": plan["limits"],
            "features": plan["features"],
            "subscription": {"state": st["state"], "paid": st["paid"], "reason": st["reason"], "current_period_end": iso(st.get("current_period_end")),
                             "grace_until": iso(st.get("grace_until")), "cancel_at_period_end": bool(st.get("cancel_at_period_end")),
                             "billing_live": bool(get_settings().billing_webhook_secret)},
            "verified_at": now().isoformat(),
            "usage": {"verifications_this_month": used, "remaining": None if limit is None else max(limit - used, 0),
                      "resets_at": nxt.isoformat()}}


@router.post("/billing/webhook", tags=["billing"], include_in_schema=False)
async def billing_webhook(request: Request, db: Session = Depends(get_db)):
    """Billing events. Only a request signed with the server-side secret can change a subscription; the body is
    never trusted on its own, and nothing sent by a browser or the extension can mark an account as paid."""
    from ..billing.subscriptions import apply_event, verify_signature
    from ..config import get_settings
    secret = get_settings().billing_webhook_secret
    if not secret:
        raise HTTPException(503, "billing is not configured")
    body = await request.body()
    if len(body) > 65536 or not verify_signature(secret, request.headers.get("x-trustcode-signature", ""), body):
        audit(db, request, "billing_webhook_rejected", None)
        db.commit()
        raise HTTPException(401, "invalid signature")
    try:
        import json
        event = json.loads(body)
        assert isinstance(event, dict)
    except Exception:
        raise HTTPException(400, "invalid event")
    outcome = apply_event(db, event)
    audit(db, request, "billing_event", None, event_type=str(event.get("type"))[:40], outcome=outcome)
    db.commit()
    return {"received": True, "outcome": outcome}


def enforce_quota(db: Session, user: User):
    """Called before a verification is accepted. The backend, not the client, decides."""
    e = entitlements_for(db, user)
    if e["usage"]["remaining"] == 0:
        raise HTTPException(403, f"monthly verification limit reached ({e['limits']['verifications_per_month']}); "
                                 f"it resets on {e['usage']['resets_at'][:10]}")


def _count(db: Session, stmt) -> int:
    return db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0


def audit(db: Session, request: Request, action: str, user_id: str | None, **meta):
    db.add(AuditLog(user_id=user_id, action=action, request_id=getattr(request.state, "request_id", None), meta=meta or None))


# ------------------------------------------------------------------ public
@router.get("/plans", tags=["billing"])
def plans():
    return {"billing_live": False, "plans": list(PLANS.values())}


# ------------------------------------------------------------------ account
@router.get("/me", tags=["profile"])
def me(user: User = Depends(current_user)):
    return {"id": user.id, "email": user.email, "role": user.role, "created_at": user.created_at, "local": user.is_local}


@router.get("/me/entitlements", tags=["billing"])
def my_entitlements(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return entitlements_for(db, user)


# ------------------------------------------------------------------ support
class TicketIn(BaseModel):
    category: Category
    subject: str = Field(min_length=3, max_length=200)
    message: str = Field(min_length=10, max_length=5000)
    email: str | None = Field(default=None, max_length=254)
    website: str | None = Field(default=None, max_length=200, description="honeypot: must be empty")

    @field_validator("email")
    @classmethod
    def _email(cls, v):
        if v is None:
            return v
        v = v.strip().lower()
        if "@" not in v or "." not in v.split("@")[-1] or " " in v:
            raise ValueError("invalid email address")
        return v


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


def optional_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)) -> User | None:
    if not creds:
        return None
    try:
        payload = decode_token(creds.credentials)
    except jwt.PyJWTError:
        raise HTTPException(401, "invalid or expired credentials")
    user = db.get(User, payload["sub"]) if payload.get("scope") == "user" else None
    if not user or user.suspended:
        raise HTTPException(401, "invalid or expired credentials")
    return user


def _ticket_out(t: SupportTicket, messages: list[TicketMessage] | None = None) -> dict:
    out = {"id": t.id, "category": t.category, "subject": t.subject, "status": t.status, "email": t.email,
           "created_at": t.created_at, "updated_at": t.updated_at, "resolved_at": t.resolved_at}
    if messages is not None:
        out["messages"] = [{"author": m.author, "body": m.body, "created_at": m.created_at} for m in messages]
    return out


@router.post("/support/tickets", status_code=201, tags=["support"])
def create_ticket(body: TicketIn, request: Request, user: User | None = Depends(optional_user), db: Session = Depends(get_db)):
    limiter.check(f"ticket:{client_ip(request)}", 5)
    if body.website:  # bots fill hidden fields; accept silently, store nothing
        return {"id": None, "status": "received"}
    email = user.email if user and user.email else body.email
    if not email:
        raise HTTPException(422, "email is required when not signed in")
    t = SupportTicket(user_id=user.id if user else None, email=email, category=body.category, subject=body.subject.strip())
    db.add(t)
    db.flush()
    db.add(TicketMessage(ticket_id=t.id, author="customer", body=body.message.strip()))
    audit(db, request, "ticket_created", user.id if user else None, ticket_id=t.id, category=body.category)
    db.commit()
    return {"id": t.id, "status": t.status}


@router.get("/support/tickets", tags=["support"])
def my_tickets(limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0),
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = select(SupportTicket).where(SupportTicket.user_id == user.id)
    rows = db.scalars(stmt.order_by(SupportTicket.created_at.desc(), SupportTicket.id).offset(offset).limit(limit))
    return {"total": _count(db, stmt), "limit": limit, "offset": offset, "items": [_ticket_out(t) for t in rows]}


def _own_ticket(db: Session, user: User, ticket_id: str) -> SupportTicket:
    t = db.get(SupportTicket, ticket_id)
    if not t or (t.user_id != user.id and user.role != "admin"):
        raise HTTPException(404, "ticket not found")
    return t


@router.get("/support/tickets/{ticket_id}", tags=["support"])
def get_ticket(ticket_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    t = _own_ticket(db, user, ticket_id)
    msgs = list(db.scalars(select(TicketMessage).where(TicketMessage.ticket_id == t.id).order_by(TicketMessage.created_at)))
    return _ticket_out(t, msgs)


@router.post("/support/tickets/{ticket_id}/messages", status_code=201, tags=["support"])
def reply_ticket(ticket_id: str, body: MessageIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    t = _own_ticket(db, user, ticket_id)
    if t.status == "closed":
        raise HTTPException(409, "ticket is closed")
    staff = user.role == "admin" and t.user_id != user.id
    db.add(TicketMessage(ticket_id=t.id, author="staff" if staff else "customer", body=body.body.strip()))
    t.status = "pending" if staff else "open"
    t.updated_at = now()
    audit(db, request, "ticket_reply", user.id, ticket_id=t.id, staff=staff)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ admin
def current_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "administrator role required")
    return user


@router.get("/admin/overview", tags=["admin"])
def admin_overview(admin: User = Depends(current_admin), db: Session = Depends(get_db)):
    n = now()
    count = lambda q: db.scalar(q) or 0
    return {
        "users_total": count(select(func.count()).select_from(User).where(User.is_local.is_(False))),
        "users_new_7d": count(select(func.count()).select_from(User).where(User.created_at >= n - timedelta(days=7))),
        "users_suspended": count(select(func.count()).select_from(User).where(User.suspended.is_(True))),
        "active_users_30d": count(select(func.count(func.distinct(VerificationJob.user_id))).where(VerificationJob.created_at >= n - timedelta(days=30))),
        "verifications_this_month": count(select(func.count()).select_from(VerificationJob).where(VerificationJob.created_at >= month_start())),
        "tickets_open": count(select(func.count()).select_from(SupportTicket).where(SupportTicket.status.in_(["open", "pending"]))),
        "plans": {"free": count(select(func.count()).select_from(User).where(User.is_local.is_(False)))},
        "billing_live": False,
    }


@router.get("/admin/users", tags=["admin"])
def admin_users(q: str | None = Query(None, max_length=254), limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0),
                admin: User = Depends(current_admin), db: Session = Depends(get_db)):
    stmt = select(User).where(User.is_local.is_(False))
    if q:
        stmt = stmt.where(or_(User.email.ilike(f"%{q.strip().lower()}%"), User.id == q.strip()))
    total = _count(db, stmt)
    rows = list(db.scalars(stmt.order_by(User.created_at.desc(), User.id).offset(offset).limit(limit)))
    return {"total": total, "items": [{"id": u.id, "email": u.email, "role": u.role, "suspended": u.suspended,
                                       "created_at": u.created_at, "plan": plan_for(u, db)["id"],
                                       "verifications_this_month": usage_this_month(db, u.id)} for u in rows]}


@router.post("/admin/users/{user_id}/{action}", tags=["admin"])
def admin_user_action(user_id: str, action: Literal["suspend", "restore"], request: Request,
                      admin: User = Depends(current_admin), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "user not found")
    if u.id == admin.id:
        raise HTTPException(409, "administrators cannot suspend themselves")
    u.suspended = action == "suspend"
    audit(db, request, f"admin_{action}", admin.id, target=u.id)
    db.commit()
    return {"id": u.id, "suspended": u.suspended}


@router.get("/admin/tickets", tags=["admin"])
def admin_tickets(status: str | None = Query(None, pattern="^(open|pending|resolved|closed)$"),
                  limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0),
                  admin: User = Depends(current_admin), db: Session = Depends(get_db)):
    stmt = select(SupportTicket)
    if status:
        stmt = stmt.where(SupportTicket.status == status)
    rows = db.scalars(stmt.order_by(SupportTicket.updated_at.desc(), SupportTicket.id).offset(offset).limit(limit))
    return {"total": _count(db, stmt), "limit": limit, "offset": offset,
            "items": [_ticket_out(t) | {"assignee_id": t.assignee_id} for t in rows]}


class TicketUpdate(BaseModel):
    status: Literal["open", "pending", "resolved", "closed"] | None = None
    assign_to_me: bool | None = None


@router.patch("/admin/tickets/{ticket_id}", tags=["admin"])
def admin_update_ticket(ticket_id: str, body: TicketUpdate, request: Request, admin: User = Depends(current_admin), db: Session = Depends(get_db)):
    t = db.get(SupportTicket, ticket_id)
    if not t:
        raise HTTPException(404, "ticket not found")
    if body.status:
        t.status = body.status
        t.resolved_at = now() if body.status in ("resolved", "closed") else None
    if body.assign_to_me:
        t.assignee_id = admin.id
    t.updated_at = now()
    audit(db, request, "admin_ticket_update", admin.id, ticket_id=t.id, status=body.status)
    db.commit()
    return _ticket_out(t) | {"assignee_id": t.assignee_id}


@router.get("/admin/audit", tags=["admin"])
def admin_audit(limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
                admin: User = Depends(current_admin), db: Session = Depends(get_db)):
    stmt = select(AuditLog)
    rows = db.scalars(stmt.order_by(AuditLog.created_at.desc(), AuditLog.id).offset(offset).limit(limit))
    return {"total": _count(db, stmt), "limit": limit, "offset": offset, "items": [{"action": a.action, "user_id": a.user_id, "created_at": a.created_at, "request_id": a.request_id} for a in rows]}
