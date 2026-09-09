"""Database schema. Research data (experiment_*) is stored separately from product
analytics and keyed only by pseudonymous participant codes (no user link)."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def _id() -> str:
    return uuid.uuid4().hex


def now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    email: Mapped[str | None] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(300))
    role: Mapped[str] = mapped_column(String(20), default="developer")      # developer | researcher
    is_local: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Profile(Base):
    __tablename__ = "profiles"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    experience_level: Mapped[str] = mapped_column(String(20), default="intermediate")
    store_history: Mapped[bool] = mapped_column(Boolean, default=False)
    allow_llm: Mapped[bool] = mapped_column(Boolean, default=False)
    adaptive_suggestions: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class VerificationJob(Base):
    __tablename__ = "verification_jobs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)  # queued|running|done|failed|cancelled
    language: Mapped[str | None] = mapped_column(String(20))
    task: Mapped[str | None] = mapped_column(Text)
    code: Mapped[str | None] = mapped_column(Text)        # purged as soon as analysis finishes
    tests: Mapped[str | None] = mapped_column(Text)       # purged as soon as analysis finishes
    code_sha256: Mapped[str] = mapped_column(String(64))
    code_lines: Mapped[int] = mapped_column(Integer, default=0)
    result: Mapped[dict | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(Text)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Decision(Base):
    __tablename__ = "decisions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    job_id: Mapped[str] = mapped_column(ForeignKey("verification_jobs.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    decision: Mapped[str] = mapped_column(String(10))     # accept | modify | reject
    confidence: Mapped[int | None] = mapped_column(Integer)
    rationale: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Feedback(Base):
    __tablename__ = "feedback"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    job_id: Mapped[str | None] = mapped_column(ForeignKey("verification_jobs.id", ondelete="SET NULL"))
    finding_id: Mapped[str | None] = mapped_column(String(20))
    rating: Mapped[str] = mapped_column(String(20))       # helpful | not_helpful | too_technical | too_simple | incorrect
    comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    user_id: Mapped[str | None] = mapped_column(String(32), index=True)
    action: Mapped[str] = mapped_column(String(50))
    request_id: Mapped[str | None] = mapped_column(String(32))
    meta: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


# ---------------- research data (pseudonymous, separate from product data) ----------------
class ExperimentSession(Base):
    __tablename__ = "experiment_sessions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    participant_code: Mapped[str] = mapped_column(String(16), unique=True)
    study_id: Mapped[str] = mapped_column(String(40), default="main")
    sequence_index: Mapped[int] = mapped_column(Integer)          # drives counterbalancing
    condition_order: Mapped[list] = mapped_column(JSON)           # e.g. ["baseline","trustcode"]
    item_blocks: Mapped[list] = mapped_column(JSON)               # [[item ids block1],[block2]]
    adaptation: Mapped[str] = mapped_column(String(10))           # fixed | adapted
    experience_level: Mapped[str | None] = mapped_column(String(20))
    years_experience: Mapped[int | None] = mapped_column(Integer)
    consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    software_version: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ExperimentTrial(Base):
    __tablename__ = "experiment_trials"
    __table_args__ = (UniqueConstraint("session_id", "position"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    session_id: Mapped[str] = mapped_column(ForeignKey("experiment_sessions.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    item_id: Mapped[str] = mapped_column(String(40))
    condition: Mapped[str] = mapped_column(String(20))
    shown_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision: Mapped[str | None] = mapped_column(String(10))
    confidence: Mapped[int | None] = mapped_column(Integer)
    rationale: Mapped[str | None] = mapped_column(Text)


class ExperimentEvent(Base):
    __tablename__ = "experiment_events"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    session_id: Mapped[str] = mapped_column(ForeignKey("experiment_sessions.id", ondelete="CASCADE"), index=True)
    trial_id: Mapped[str | None] = mapped_column(String(32))
    type: Mapped[str] = mapped_column(String(40))
    payload: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Questionnaire(Base):
    __tablename__ = "experiment_questionnaires"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    session_id: Mapped[str] = mapped_column(ForeignKey("experiment_sessions.id", ondelete="CASCADE"), index=True)
    instrument: Mapped[str] = mapped_column(String(20))       # nasa_tlx | trust | sus | open
    condition: Mapped[str | None] = mapped_column(String(20))
    responses: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
