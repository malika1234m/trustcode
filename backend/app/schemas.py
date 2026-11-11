from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

Level = Literal["beginner", "intermediate", "advanced"]


class RegisterIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(min_length=10, max_length=200)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if "@" not in v or "." not in v.split("@")[-1] or " " in v:
            raise ValueError("invalid email address")
        return v


class LoginIn(RegisterIn):
    password: str = Field(min_length=1, max_length=200)


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str | None = None
    token_type: str = "bearer"
    expires_in: int


class RefreshIn(BaseModel):
    refresh_token: str = Field(max_length=200)


class ProfileIn(BaseModel):
    experience_level: Level | None = None
    store_history: bool | None = None
    allow_llm: bool | None = None
    adaptive_suggestions: bool | None = None


class ProfileOut(BaseModel):
    experience_level: Level
    store_history: bool
    allow_llm: bool
    adaptive_suggestions: bool
    llm_available: bool
    role: str


class VerifyIn(BaseModel):
    code: str = Field(min_length=1, max_length=50_000)
    language: Literal["python", "javascript", "typescript"] | None = None
    task: str | None = Field(default=None, max_length=10_000)
    tests: str | None = Field(default=None, max_length=50_000)
    client_consent: bool = Field(description="Client confirms the user explicitly approved sending this code")

    @field_validator("client_consent")
    @classmethod
    def _consent(cls, v: bool) -> bool:
        if v is not True:
            raise ValueError("explicit user consent is required to submit code")
        return v


class SessionFileIn(BaseModel):
    path: str = Field(min_length=1, max_length=500)
    change: Literal["created", "modified", "deleted", "renamed", "context", "related"] = "modified"
    content: str | None = Field(default=None, max_length=50_000)
    baseline: str | None = Field(default=None, max_length=50_000)
    renamed_from: str | None = Field(default=None, max_length=500)

    @field_validator("path", "renamed_from")
    @classmethod
    def _relative(cls, v: str | None) -> str | None:
        if v is None:
            return v
        p = v.replace("\\", "/")
        if p.startswith("/") or ".." in p.split("/") or "\x00" in p or (len(p) > 1 and p[1] == ":"):
            raise ValueError("paths must be workspace-relative")
        return p


class SessionVerifyIn(BaseModel):
    """A set of changed files verified together (AI coding session, Git changes, or a file selection)."""
    files: list[SessionFileIn] = Field(min_length=1, max_length=40)
    workspace_paths: list[str] = Field(default_factory=list, max_length=20_000)
    depth: Literal["quick", "standard", "deep"] = "standard"
    label: str | None = Field(default=None, max_length=200)
    client_consent: bool = Field(description="Client confirms the user explicitly approved sending these files")

    @field_validator("client_consent")
    @classmethod
    def _consent(cls, v: bool) -> bool:
        if v is not True:
            raise ValueError("explicit user consent is required before files are sent")
        return v

    @field_validator("workspace_paths")
    @classmethod
    def _paths(cls, v: list[str]) -> list[str]:
        if any(len(p) > 500 for p in v):
            raise ValueError("workspace path too long")
        return v


class JobOut(BaseModel):
    id: str
    status: str
    language: str | None
    code_lines: int
    created_at: datetime
    finished_at: datetime | None = None
    error: str | None = None
    result: dict | None = None


class JobPage(BaseModel):
    items: list[JobOut]
    next_cursor: str | None


class DecisionIn(BaseModel):
    decision: Literal["accept", "modify", "reject"]
    confidence: int | None = Field(default=None, ge=0, le=100)
    rationale: str | None = Field(default=None, max_length=2000)


class FeedbackIn(BaseModel):
    job_id: str | None = Field(default=None, max_length=32)
    finding_id: str | None = Field(default=None, max_length=20)
    rating: Literal["helpful", "not_helpful", "too_technical", "too_simple", "incorrect"]
    comment: str | None = Field(default=None, max_length=2000)


# ---- experiments ----
class SessionCreateIn(BaseModel):
    study_id: str = Field(default="main", max_length=40, pattern=r"^[a-z0-9_-]+$")


class SessionCreateOut(BaseModel):
    participant_code: str
    condition_order: list[str]
    adaptation: str
    n_trials: int


class JoinIn(BaseModel):
    participant_code: str = Field(max_length=16)
    consent: bool
    experience_level: Level
    years_experience: int = Field(ge=0, le=60)

    @field_validator("consent")
    @classmethod
    def _c(cls, v):
        if v is not True:
            raise ValueError("informed consent is required")
        return v


class TrialDecisionIn(BaseModel):
    decision: Literal["accept", "modify", "reject"]
    confidence: int = Field(ge=0, le=100)
    rationale: str | None = Field(default=None, max_length=2000)


class EventIn(BaseModel):
    trial_id: str | None = Field(default=None, max_length=32)
    type: Literal["evidence_expand", "evidence_collapse", "explanation_level_view", "unverified_view",
                  "request_more_checks", "code_scroll", "panel_focus", "panel_blur"]
    payload: dict | None = None


class QuestionnaireIn(BaseModel):
    instrument: Literal["nasa_tlx", "trust", "sus", "open"]
    condition: Literal["baseline", "trustcode"] | None = None
    responses: dict
