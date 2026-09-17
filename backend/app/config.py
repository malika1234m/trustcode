from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="TRUSTCODE_", env_file=".env", extra="ignore")

    env: str = "development"                       # development | test | production
    database_url: str = "sqlite:///./trustcode.db"
    jwt_secret: str = "dev-only-change-me"         # MUST be overridden in production (checked at startup)
    access_token_minutes: int = 15
    refresh_token_days: int = 7
    local_mode: bool = False                       # single-user, no registration; bind to 127.0.0.1 only
    worker_mode: str = "inline"                    # inline (dev/test only) | queue (production)
    run_tests: bool = True                         # sandboxed test execution enabled
    rate_limit_per_minute: int = 300                # general authenticated limit (status polling included)
    verify_rate_limit_per_minute: int = 10
    auth_rate_limit_per_minute: int = 20            # per-IP limit on unauthenticated endpoints (login, register, refresh, join)
    max_code_chars: int = 50_000
    result_ttl_hours_no_history: int = 24
    result_ttl_days_history: int = 30
    anthropic_api_key: str | None = None           # optional; LLM explanations disabled when absent
    llm_model: str = "claude-opus-5-5"
    benchmark_dir: str = "../datasets/benchmark"
    cors_origins: str = ""

    local_secret_file: str = "~/.trustcode/local-secret"  # per-install secret for local mode (mode 0600)


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.env == "production":
        if s.jwt_secret == "dev-only-change-me" or len(s.jwt_secret) < 32:
            raise RuntimeError("TRUSTCODE_JWT_SECRET must be set to >=32 random characters in production")
        if s.worker_mode != "queue":
            raise RuntimeError("Production requires TRUSTCODE_WORKER_MODE=queue (API must never execute code)")
        if s.local_mode:
            raise RuntimeError("local_mode is not allowed in production")
    return s
