"""Per-install secret for local mode.

Created on first use with permissions 0600 in the OS user's home directory, so only the
user who runs the server (and the VS Code extension running as that user) can read it.
A malicious web page cannot read it, which defeats DNS-rebinding/CSRF against /auth/local.
"""
import hmac
import os
import secrets
from pathlib import Path

from .config import get_settings


def secret_path() -> Path:
    return Path(os.path.expanduser(get_settings().local_secret_file))


def ensure_local_secret() -> str:
    p = secret_path()
    if p.exists():
        return p.read_text().strip()
    p.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    value = secrets.token_urlsafe(32)
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as fh:
        fh.write(value)
    return value


def check_local_secret(candidate: str) -> bool:
    if not candidate:
        return False
    return hmac.compare_digest(candidate.encode(), ensure_local_secret().encode())
