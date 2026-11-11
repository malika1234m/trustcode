"""Verification job lifecycle using the database as a queue.

* API process: enqueue() only. In `queue` mode it never runs analysis.
* Worker process (app.worker_main): claim_next() + process() in a loop.
* `inline` mode (development/tests only) processes in a background thread of the API.
Source code and tests are purged from the database as soon as analysis finishes.
"""
from __future__ import annotations

import hashlib
import logging
import threading
from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import SessionLocal
from ..models import Profile, VerificationJob, now

log = logging.getLogger("trustcode.jobs")


def enqueue(db: Session, user_id: str, code: str, language: str | None, task: str | None, tests: str | None) -> VerificationJob:
    job = VerificationJob(user_id=user_id, code=code, tests=tests, task=task, language=language,
                          code_sha256=hashlib.sha256(code.encode()).hexdigest(), code_lines=len(code.splitlines()))
    db.add(job)
    db.commit()
    if get_settings().worker_mode == "sync":
        process_job_id(job.id)  # serverless: analyse before responding (static checks only; run_tests is false)
        db.refresh(job)
    elif get_settings().worker_mode == "inline":
        threading.Thread(target=process_job_id, args=(job.id,), daemon=True).start()
    return job


SESSION = "session"  # value of VerificationJob.language for multi-file jobs; the payload lives in `code` until analysed


def enqueue_session(db: Session, user_id: str, payload: dict, label: str | None) -> VerificationJob:
    import json
    text = json.dumps(payload, separators=(",", ":"))
    lines = sum(len((f.get("content") or "").splitlines()) for f in payload["files"] if f.get("change") not in ("context", "related"))
    job = VerificationJob(user_id=user_id, code=text, tests=None, task=label, language=SESSION,
                          code_sha256=hashlib.sha256(text.encode()).hexdigest(), code_lines=lines)
    db.add(job)
    db.commit()
    if get_settings().worker_mode == "sync":
        process_job_id(job.id)
        db.refresh(job)
    elif get_settings().worker_mode == "inline":
        threading.Thread(target=process_job_id, args=(job.id,), daemon=True).start()
    return job


def claim_next(db: Session) -> VerificationJob | None:
    q = select(VerificationJob.id).where(VerificationJob.status == "queued").order_by(VerificationJob.created_at).limit(1)
    if db.bind.dialect.name == "postgresql":
        q = q.with_for_update(skip_locked=True)
    job_id = db.execute(q).scalar_one_or_none()
    if not job_id:
        return None
    # atomic claim works on any backend: only one worker sees rowcount == 1
    res = db.execute(update(VerificationJob).where(VerificationJob.id == job_id, VerificationJob.status == "queued")
                     .values(status="running", started_at=now()))
    db.commit()
    return db.get(VerificationJob, job_id) if res.rowcount == 1 else None


def process(db: Session, job: VerificationJob):
    from trustcode_worker.models import VerificationRequest
    from trustcode_worker.pipeline import verify
    s = get_settings()
    try:
        if job.language == SESSION:
            import json

            from trustcode_worker.project import SessionRequest, verify_session
            # outbound registry lookups stay an operator decision (TRUSTCODE_REGISTRY_CHECK), whatever depth is requested
            report = verify_session(SessionRequest(**json.loads(job.code)), profile=s.engine_profile)
            report["label"] = job.task
            db.refresh(job)
            job.status, job.result = ("cancelled", None) if job.cancel_requested else ("done", report)
        else:
            result = verify(VerificationRequest(code=job.code, language=job.language, task=job.task, tests=job.tests),
                            run_tests=s.run_tests, profile=s.engine_profile)
            db.refresh(job)
            if job.cancel_requested:
                job.status, job.result = "cancelled", None
            else:
                job.status, job.result, job.language = "done", result.model_dump(mode="json"), result.language.value
    except Exception as e:  # never report a crash as a completed analysis
        log.exception("verification failed job=%s", job.id)
        job.status, job.error = "failed", f"analysis failed: {type(e).__name__}"
    prof = db.get(Profile, job.user_id)
    keep = prof.store_history if prof else False
    job.code, job.tests = None, None  # purge source immediately (privacy NFR-P2)
    job.finished_at = now()
    job.expires_at = job.finished_at + (timedelta(days=s.result_ttl_days_history) if keep
                                        else timedelta(hours=s.result_ttl_hours_no_history))
    db.commit()


def process_job_id(job_id: str):
    db = SessionLocal()
    try:
        res = db.execute(update(VerificationJob).where(VerificationJob.id == job_id, VerificationJob.status == "queued")
                         .values(status="running", started_at=now()))
        db.commit()
        if res.rowcount == 1:
            process(db, db.get(VerificationJob, job_id))
    finally:
        db.close()


def purge_expired(db: Session) -> int:
    res = db.execute(update(VerificationJob).where(VerificationJob.expires_at < now(), VerificationJob.result.is_not(None))
                     .values(result=None, task=None, status="expired"))
    db.commit()
    return res.rowcount
