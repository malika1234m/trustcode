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
    researcher_emails: str = ""                    # comma-separated accounts granted the researcher role
    rate_limit_per_minute: int = 60
    verify_rate_limit_per_minute: int = 10
    max_code_chars: int = 50_000
    result_ttl_hours_no_history: int = 24
    result_ttl_days_history: int = 30
    anthropic_api_key: str | None = None           # optional; LLM explanations disabled when absent
    llm_model: str = "claude-sonnet-5-5"
    benchmark_dir: str = "../datasets/benchmark"
    cors_origins: str = ""

    @property
    def researchers(self) -> set[str]:
        return {e.strip().lower() for e in self.researcher_emails.split(",") if e.strip()}


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
