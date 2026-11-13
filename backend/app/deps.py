"""Request-scoped dependencies: authentication, roles and rate limiting."""
import threading
import time
from collections import defaultdict, deque

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import Profile, User
from .security import decode_token

bearer = HTTPBearer(auto_error=False)


class RateLimiter:
    """In-memory sliding window. Single-instance only; use a shared store if scaled out (docs/project/known_issues.md)."""

    def __init__(self):
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window: float = 60.0):
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window:
                q.popleft()
            if len(q) >= limit:
                retry = int(window - (now - q[0])) + 1
                raise HTTPException(429, detail="rate limit exceeded", headers={"Retry-After": str(retry)})
            q.append(now)

    def reset(self):
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()


def client_ip(request: Request) -> str:
    from .config import ON_VERCEL
    if ON_VERCEL:  # set by Vercel's edge and not client-controllable
        v = request.headers.get("x-vercel-forwarded-for") or request.headers.get("x-real-ip")
        if v:
            return v.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(request: Request):
    """Strict per-IP limit for unauthenticated endpoints (brute-force / enumeration guard)."""
    limiter.check(f"ip-auth:{client_ip(request)}", get_settings().auth_rate_limit_per_minute)


def _credentials_error():
    return HTTPException(401, detail="invalid or expired credentials", headers={"WWW-Authenticate": "Bearer"})


def get_token_payload(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict:
    if not creds:
        raise _credentials_error()
    try:
        return decode_token(creds.credentials)
    except jwt.PyJWTError:
        raise _credentials_error()


def current_user(request: Request, payload: dict = Depends(get_token_payload), db: Session = Depends(get_db)) -> User:
    if payload.get("scope") != "user":
        raise HTTPException(403, detail="token not valid for this endpoint")
    user = db.get(User, payload["sub"])
    if not user or user.suspended:
        raise _credentials_error()
    limiter.check(f"user:{user.id}", get_settings().rate_limit_per_minute)
    # returned as X-TrustCode-Licence-Rev (app.main): the extension compares it with its licence and refreshes at once
    # when they differ, so a plan or device change is noticed on traffic it already makes
    request.state.licence_rev = user.licence_rev or 0
    return user


class CodedHTTPException(HTTPException):
    """An HTTP error with a stable machine-readable code (the default handler derives the code from the status)."""

    def __init__(self, status_code: int, code: str, detail: str):
        super().__init__(status_code, detail=detail)
        self.code = code


def licensed_user(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> User:
    """Server analysis: the account token is not enough. The caller must also prove it holds the key of a device
    that is active for this account, so a removed or blocked device - or a copied account token - gets nothing.
    Self-hosted local mode and servers without licensing have no devices and are not checked."""
    from .licensing import service, signing
    mode = get_settings().licence_device_enforcement
    if mode == "off" or user.is_local or not signing.configured():
        return user
    try:
        service.device_proof(db, user, request.headers.get("x-trustcode-device"))
    except service.Refused as e:
        if mode == "log":
            from datetime import timedelta
            from sqlalchemy import select
            from .models import LicenceEvent, now
            recent = db.scalar(select(LicenceEvent.id).where(LicenceEvent.user_id == user.id, LicenceEvent.event == "server_call_without_device",
                                                              LicenceEvent.created_at >= now() - timedelta(hours=1)).limit(1))
            if not recent:
                service.record(db, "server_call_without_device", user.id, detail=e.code)
                db.commit()
            return user
        service.record(db, "server_call_refused", user.id, detail=e.code)
        db.commit()
        raise CodedHTTPException(e.status, e.code, e.message)
    return user


def current_researcher(user: User = Depends(current_user)) -> User:
    if user.role != "researcher":
        raise HTTPException(403, detail="researcher role required")
    return user


def participant_session(payload: dict = Depends(get_token_payload)) -> str:
    if payload.get("scope") != "participant":
        raise HTTPException(403, detail="participant token required")
    limiter.check(f"participant:{payload['sub']}", get_settings().rate_limit_per_minute * 2)
    return payload["sub"]


def profile_of(db: Session, user: User) -> Profile:
    p = db.get(Profile, user.id)
    if not p:
        p = Profile(user_id=user.id)
        db.add(p)
        db.commit()
    return p
