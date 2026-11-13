import os
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
    worker_mode: str = "inline"                    # inline (dev/test) | queue (worker process) | sync (serverless: analyse in-request, static checks only)
    run_tests: bool = True                         # sandboxed test execution enabled
    session_max_files: int = 0                     # files per multi-file request; 0 = automatic (8 in sync mode, else 40)
    billing_webhook_secret: str = ""               # empty = billing not live: no event can change a subscription
    min_extension_version: str = "0.4.0"           # oldest extension this API still serves
    engine_profile: str = "extended"  # "study-v1" pins the frozen research check set (ADR-005)
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

    trusted_proxies: str = ""                      # mirrors uvicorn --forwarded-allow-ips; validated in production
    local_secret_file: str = "~/.trustcode/local-secret"  # per-install secret for local mode (mode 0600)

    # Offline licences (app.licensing). Empty signing key = licensing not configured: activation answers 503 and
    # the extension simply stays on the Free plan, which needs no licence.
    licence_signing_key: str = ""                  # base64url Ed25519 private seed (32 bytes); never leaves the server
    licence_key_id: str = "k1"                     # must match a public key embedded in the extension
    licence_refresh_hours: int = 24                # the extension refreshes its licence after this long when online
    licence_status_minutes: int = 60               # device-signed status check interval while online (kept within 60-240)
    # Server analysis must come from an active device of the account ("require"), is only logged when it does not
    # ("log", for the period while older extensions are still in use), or is not checked ("off").
    licence_device_enforcement: str = "require"
    # Released builds: "1.2.0=<sha256>,1.2.1=<sha256>" (printed by `npm run build-hash`). A device reporting another
    # hash for a listed version, or an unlisted version, is logged as suspicious. It is never blocked. Empty = not checked.
    licence_known_builds: str = ""
    licence_device_rate_per_minute: int = 6        # per device and operation (refresh, status, release)
    licence_ip_rate_per_minute: int = 60           # all device-signed requests from one address
    licence_activate_rate_per_minute: int = 10     # per account


PLACEHOLDER_MARKERS = ("change-me", "change_me", "generate-with", "dev-only", "example", "secret", "password")


def strong_secret(value: str) -> bool:
    v = value or ""
    if len(v) < 32 or any(m in v.lower() for m in PLACEHOLDER_MARKERS):
        return False
    return len(set(v)) >= 12  # rejects low-entropy values such as "aaaa..." or "abababab..."


ON_VERCEL = os.environ.get("VERCEL") == "1"


def _valid_seed(value: str) -> bool:
    import base64
    v = value.strip()
    try:
        return len(base64.urlsafe_b64decode(v + "=" * (-len(v) % 4))) == 32
    except ValueError:
        return False


def _normalise_db_url(url: str) -> str:
    # Vercel/Neon provide DATABASE_URL as postgres://...; SQLAlchemy needs the psycopg2 dialect name.
    if url.startswith("postgres://"):
        url = "postgresql+psycopg2://" + url[len("postgres://"):]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg2://" + url[len("postgresql://"):]
    return url


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if "TRUSTCODE_DATABASE_URL" not in os.environ and os.environ.get("DATABASE_URL"):
        s.database_url = os.environ["DATABASE_URL"]
    s.database_url = _normalise_db_url(s.database_url)
    if s.env == "production":
        if not strong_secret(s.jwt_secret):
            raise RuntimeError("TRUSTCODE_JWT_SECRET must be a random value (>=32 chars, not a placeholder); "
                               "generate one with: openssl rand -hex 32")
        if s.worker_mode not in ("queue", "sync"):
            raise RuntimeError("Production requires TRUSTCODE_WORKER_MODE=queue or sync")
        if s.worker_mode == "sync" and s.run_tests:
            raise RuntimeError("sync mode analyses inside the API process, so TRUSTCODE_RUN_TESTS must be false "
                               "(untrusted code is never executed in the API)")
        if s.local_mode:
            raise RuntimeError("local_mode is not allowed in production")
        if s.licence_device_enforcement not in ("require", "log", "off"):
            raise RuntimeError("TRUSTCODE_LICENCE_DEVICE_ENFORCEMENT must be require, log or off")
        if s.licence_signing_key and not _valid_seed(s.licence_signing_key):
            raise RuntimeError("TRUSTCODE_LICENCE_SIGNING_KEY must be a base64url Ed25519 seed (32 bytes); "
                               "generate one with: python -m app.admin licence-keygen")
        tp = {x.strip() for x in s.trusted_proxies.split(",") if x.strip()}
        if ON_VERCEL:
            tp = {"vercel-edge"}  # client IP comes from Vercel's edge header (x-vercel-forwarded-for), not from proxies
        if not tp or tp & {"*", "127.0.0.1", "::1", "localhost"}:
            raise RuntimeError("TRUSTCODE_TRUSTED_PROXIES must be the reverse proxy address seen from the API container "
                               "(not empty, '*', or loopback); otherwise client IPs are spoofable or all users share one rate-limit bucket")
    return s
