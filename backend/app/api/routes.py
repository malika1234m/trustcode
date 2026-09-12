"""HTTP API (v1). All responses are JSON; errors use {"error": {code, message, request_id}}."""
from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..adaptation.engine import decide
from ..config import get_settings
from ..db import get_db
from ..deps import (current_researcher, current_user, limiter, participant_session, profile_of, rate_limit)
from ..experiments import service as exp
from ..explanations.engine import build_explanation
from ..models import (AuditLog, Decision, ExperimentEvent, ExperimentSession, ExperimentTrial, Feedback, Profile,
                      Questionnaire, RefreshToken, User, VerificationJob, now)
from ..schemas import (DecisionIn, EventIn, FeedbackIn, JobOut, JobPage, JoinIn, LoginIn, ProfileIn, ProfileOut,
                       QuestionnaireIn, RefreshIn, RegisterIn, SessionCreateIn, SessionCreateOut, TokenOut,
                       TrialDecisionIn, VerifyIn)
from ..security import (create_access_token, hash_password, hash_refresh, new_refresh_token, verify_password)
from ..services import jobs

router = APIRouter(prefix="/api/v1")


def audit(db: Session, request: Request, action: str, user_id: str | None = None, **meta):
    db.add(AuditLog(user_id=user_id, action=action, request_id=getattr(request.state, "request_id", None), meta=meta or None))


def _tokens(db: Session, user: User) -> TokenOut:
    s = get_settings()
    raw, h = new_refresh_token()
    db.add(RefreshToken(user_id=user.id, token_hash=h, expires_at=now() + timedelta(days=s.refresh_token_days)))
    db.commit()
    return TokenOut(access_token=create_access_token(user.id), refresh_token=raw, expires_in=s.access_token_minutes * 60)


# ------------------------------------------------------------------ health
@router.get("/health", tags=["system"])
def health(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False
    from trustcode_worker.sandbox.docker_runner import docker_available
    s = get_settings()
    return {"status": "ok" if db_ok else "degraded", "database": db_ok, "worker_mode": s.worker_mode,
            "sandbox": docker_available()[0] if s.worker_mode == "inline" else "remote-worker",
            "llm_configured": bool(s.anthropic_api_key), "local_mode": s.local_mode}


# ------------------------------------------------------------------ auth
@router.post("/auth/register", response_model=TokenOut, status_code=201, tags=["auth"], dependencies=[Depends(rate_limit)])
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    if get_settings().local_mode:
        raise HTTPException(400, "registration disabled in local mode; use /auth/local")
    if db.scalar(select(User).where(User.email == body.email)):
        raise HTTPException(409, "account already exists")
    # Roles are never granted at self-registration; researchers are promoted by an admin
    # command on the server (python -m app.admin grant-researcher EMAIL).
    user = User(email=body.email, password_hash=hash_password(body.password), role="developer")
    db.add(user)
    db.flush()
    db.add(Profile(user_id=user.id))
    audit(db, request, "register", user.id)
    return _tokens(db, user)


@router.post("/auth/login", response_model=TokenOut, tags=["auth"], dependencies=[Depends(rate_limit)])
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    limiter.check(f"login:{body.email}", 10)  # brute-force guard per account
    user = db.scalar(select(User).where(User.email == body.email))
    if not user or not verify_password(body.password, user.password_hash):
        audit(db, request, "login_failed")
        db.commit()
        raise HTTPException(401, "invalid email or password")
    audit(db, request, "login", user.id)
    return _tokens(db, user)


@router.post("/auth/refresh", response_model=TokenOut, tags=["auth"], dependencies=[Depends(rate_limit)])
def refresh(body: RefreshIn, db: Session = Depends(get_db)):
    rt = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_refresh(body.refresh_token)))
    if not rt or rt.revoked or rt.expires_at.replace(tzinfo=rt.expires_at.tzinfo or now().tzinfo) < now():
        raise HTTPException(401, "invalid refresh token")
    rt.revoked = True  # rotation: each refresh token is single-use
    return _tokens(db, db.get(User, rt.user_id))


@router.post("/auth/logout", status_code=204, tags=["auth"])
def logout(body: RefreshIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    rt = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_refresh(body.refresh_token),
                                              RefreshToken.user_id == user.id))
    if rt:
        rt.revoked = True
        db.commit()
    return Response(status_code=204)


LOCAL_HOSTS = {"localhost", "127.0.0.1", "[::1]", "testserver"}


@router.post("/auth/local", response_model=TokenOut, tags=["auth"])
def local_login(request: Request, db: Session = Depends(get_db)):
    """Local mode: single implicit user. Requires the per-install secret (file readable only by the
    OS user who started the server), a loopback Host header, and no browser Origin (DNS-rebinding/CSRF)."""
    from ..local_secret import check_local_secret
    if not get_settings().local_mode:
        raise HTTPException(404, "not found")
    host = (request.headers.get("host") or "").rsplit(":", 1)[0] if not (request.headers.get("host") or "").startswith("[") \
        else (request.headers.get("host") or "").split("]")[0] + "]"
    if host not in LOCAL_HOSTS or request.headers.get("origin"):
        raise HTTPException(403, "local mode accepts direct loopback requests only")
    if not check_local_secret(request.headers.get("x-trustcode-local-secret", "")):
        raise HTTPException(401, "invalid local secret")
    user = db.scalar(select(User).where(User.is_local.is_(True)))
    if not user:
        user = User(is_local=True, role="researcher")
        db.add(user)
        db.flush()
        db.add(Profile(user_id=user.id))
    return _tokens(db, user)


# ------------------------------------------------------------------ profile
@router.get("/profile", response_model=ProfileOut, tags=["profile"])
def get_profile(user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = profile_of(db, user)
    return ProfileOut(experience_level=p.experience_level, store_history=p.store_history, allow_llm=p.allow_llm,
                      adaptive_suggestions=p.adaptive_suggestions, llm_available=bool(get_settings().anthropic_api_key),
                      role=user.role)


@router.patch("/profile", response_model=ProfileOut, tags=["profile"])
def update_profile(body: ProfileIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = profile_of(db, user)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(p, k, v)
    audit(db, request, "profile_update", user.id, fields=list(body.model_dump(exclude_none=True)))
    db.commit()
    return get_profile(user, db)


# ------------------------------------------------------------------ verification
def _job_out(j: VerificationJob, include_result=True) -> JobOut:
    return JobOut(id=j.id, status=j.status, language=j.language, code_lines=j.code_lines, created_at=j.created_at,
                  finished_at=j.finished_at, error=j.error, result=j.result if include_result else None)


def _own_job(db: Session, user: User, job_id: str) -> VerificationJob:
    j = db.get(VerificationJob, job_id)
    if not j or j.user_id != user.id:  # 404 (not 403) avoids leaking job existence
        raise HTTPException(404, "verification not found")
    return j


@router.post("/verifications", response_model=JobOut, status_code=202, tags=["verification"])
def create_verification(body: VerifyIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    limiter.check(f"verify:{user.id}", get_settings().verify_rate_limit_per_minute)
    j = jobs.enqueue(db, user.id, body.code, body.language, body.task, body.tests)
    audit(db, request, "verification_submitted", user.id, job_id=j.id, lines=j.code_lines, has_tests=bool(body.tests))
    db.commit()
    return _job_out(j, include_result=False)


@router.get("/verifications", response_model=JobPage, tags=["verification"])
def list_verifications(cursor: str | None = None, limit: int = Query(20, ge=1, le=100),
                       user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = select(VerificationJob).where(VerificationJob.user_id == user.id).order_by(VerificationJob.created_at.desc(),
                                                                                  VerificationJob.id.desc())
    if cursor:
        c = db.get(VerificationJob, cursor)
        if c and c.user_id == user.id:
            q = q.where(VerificationJob.created_at < c.created_at)
    rows = list(db.scalars(q.limit(limit + 1)))
    return JobPage(items=[_job_out(j, include_result=False) for j in rows[:limit]],
                   next_cursor=rows[limit - 1].id if len(rows) > limit else None)


@router.get("/verifications/{job_id}", response_model=JobOut, tags=["verification"])
def get_verification(job_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _job_out(_own_job(db, user, job_id))


@router.post("/verifications/{job_id}/cancel", response_model=JobOut, tags=["verification"])
def cancel_verification(job_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    j = _own_job(db, user, job_id)
    if j.status == "queued":
        j.status, j.code, j.tests, j.finished_at = "cancelled", None, None, now()
    elif j.status == "running":
        j.cancel_requested = True
    db.commit()
    return _job_out(j, include_result=False)


@router.get("/verifications/{job_id}/explanation", tags=["verification"])
def get_explanation(job_id: str, level: str | None = Query(None, pattern="^(beginner|intermediate|advanced)$"),
                    llm: bool = False, user: User = Depends(current_user), db: Session = Depends(get_db)):
    j = _own_job(db, user, job_id)
    if j.status != "done" or not j.result:
        raise HTTPException(409, f"verification is {j.status}; no result to explain")
    p = profile_of(db, user)
    ratings = list(db.scalars(select(Feedback.rating).where(Feedback.user_id == user.id).order_by(Feedback.created_at)))
    n = sum(len(c["findings"]) for c in j.result["checks"])
    adaptation = decide(p.experience_level, n, ratings, p.adaptive_suggestions, override=level)
    s = get_settings()
    use_llm = llm and p.allow_llm and bool(s.anthropic_api_key)
    return build_explanation(j.result, adaptation, use_llm=use_llm, api_key=s.anthropic_api_key, model=s.llm_model,
                             code=None, task=j.task)


@router.post("/verifications/{job_id}/decision", status_code=201, tags=["verification"])
def record_decision(job_id: str, body: DecisionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    j = _own_job(db, user, job_id)
    d = Decision(job_id=j.id, user_id=user.id, **body.model_dump())
    db.add(d)
    db.commit()
    return {"id": d.id, "recorded": True, "note": "Decision recorded. TrustCode never modifies your source files."}


@router.post("/feedback", status_code=201, tags=["feedback"])
def feedback(body: FeedbackIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.job_id:
        _own_job(db, user, body.job_id)
    f = Feedback(user_id=user.id, **body.model_dump())
    db.add(f)
    db.commit()
    return {"id": f.id}


@router.delete("/me/data", status_code=204, tags=["profile"])
def delete_my_data(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Right to erasure: removes the account and all product data (cascade)."""
    audit(db, request, "account_deleted", None)
    db.delete(user)
    db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------ experiments (research)
@router.post("/experiments/sessions", response_model=SessionCreateOut, status_code=201, tags=["experiments"])
def create_session(body: SessionCreateIn, request: Request, user: User = Depends(current_researcher), db: Session = Depends(get_db)):
    try:
        s = exp.create_session(db, body.study_id)
    except ValueError as e:
        raise HTTPException(409, str(e))
    audit(db, request, "experiment_session_created", user.id, study_id=body.study_id)
    db.commit()
    n = sum(len(b) for b in s.item_blocks)
    return SessionCreateOut(participant_code=s.participant_code, condition_order=s.condition_order, adaptation=s.adaptation, n_trials=n)


@router.post("/experiments/join", tags=["experiments"], dependencies=[Depends(rate_limit)])
def join_session(body: JoinIn, db: Session = Depends(get_db)):
    s = db.scalar(select(ExperimentSession).where(ExperimentSession.participant_code == body.participant_code))
    if not s or s.completed_at:
        raise HTTPException(404, "unknown or completed participant code")
    s.consent_at = s.consent_at or now()
    s.experience_level, s.years_experience = body.experience_level, body.years_experience
    db.commit()
    tok = create_access_token(s.id, scope="participant", minutes=240)
    return {"access_token": tok, "token_type": "bearer", "condition_order": s.condition_order}


def _trials(db, sid):
    return list(db.scalars(select(ExperimentTrial).where(ExperimentTrial.session_id == sid).order_by(ExperimentTrial.position)))


@router.get("/experiments/next", tags=["experiments"])
def next_trial(sid: str = Depends(participant_session), db: Session = Depends(get_db)):
    s = db.get(ExperimentSession, sid)
    pending = [t for t in _trials(db, sid) if t.decision is None]
    if not pending:
        s.completed_at = s.completed_at or now()
        db.commit()
        return {"done": True}
    t = pending[0]
    t.shown_at = t.shown_at or now()
    db.commit()
    total = len(_trials(db, sid))
    return {"done": False, "total": total, **exp.present(t, s)}


@router.post("/experiments/trials/{trial_id}/decision", tags=["experiments"])
def trial_decision(trial_id: str, body: TrialDecisionIn, sid: str = Depends(participant_session), db: Session = Depends(get_db)):
    t = db.get(ExperimentTrial, trial_id)
    if not t or t.session_id != sid:
        raise HTTPException(404, "trial not found")
    if t.decision is not None:
        raise HTTPException(409, "decision already recorded")
    if t.shown_at is None:
        raise HTTPException(409, "trial has not been presented")
    t.decision, t.confidence, t.rationale, t.decided_at = body.decision, body.confidence, body.rationale, now()
    db.commit()
    return {"recorded": True}


@router.post("/experiments/events", status_code=201, tags=["experiments"])
def trial_event(body: EventIn, sid: str = Depends(participant_session), db: Session = Depends(get_db)):
    if body.trial_id:
        t = db.get(ExperimentTrial, body.trial_id)
        if not t or t.session_id != sid:
            raise HTTPException(404, "trial not found")
    db.add(ExperimentEvent(session_id=sid, trial_id=body.trial_id, type=body.type, payload=body.payload))
    db.commit()
    return {"recorded": True}


@router.post("/experiments/questionnaires", status_code=201, tags=["experiments"])
def questionnaire(body: QuestionnaireIn, sid: str = Depends(participant_session), db: Session = Depends(get_db)):
    db.add(Questionnaire(session_id=sid, **body.model_dump()))
    db.commit()
    return {"recorded": True}


@router.get("/experiments/export.csv", tags=["experiments"])
def export(request: Request, study_id: str | None = None, user: User = Depends(current_researcher), db: Session = Depends(get_db)):
    audit(db, request, "experiment_export", user.id, study_id=study_id)
    db.commit()
    return Response(exp.export_csv(db, study_id), media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=trustcode_trials.csv"})
