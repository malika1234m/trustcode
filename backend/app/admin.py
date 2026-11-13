"""Server-side admin commands (run on the server, never exposed over HTTP).

    python -m app.admin create-researcher EMAIL   (preferred: creates the account, prints a one-time password)
    python -m app.admin create-admin EMAIL        (operator/administrator account for the admin dashboard)
    python -m app.admin grant-researcher EMAIL    (existing account: interactive confirmation required)
    python -m app.admin revoke-researcher EMAIL

Promoting a self-registered account is risky because email ownership is not verified (anyone
could register the address first), so grant-researcher shows the account's creation time and
login history and requires typing the email again on an interactive terminal.
    python -m app.admin purge-expired
    python -m app.admin licence-keygen          (new Ed25519 licence signing key: seed for the server, public key for the extension)
"""
import secrets
import sys

from sqlalchemy import func, select

from .db import Base, SessionLocal, engine
from .models import AuditLog, User
from .security import hash_password
from .services.jobs import purge_expired


def create_researcher(db, email: str, role: str = "researcher") -> str:
    email = email.strip().lower()
    if db.scalar(select(User).where(User.email == email)):
        raise ValueError("an account with this email already exists; it may have been registered by someone else. "
                         "Delete it (DELETE /api/v1/me/data by its owner) or use grant-researcher after checking ownership.")
    password = secrets.token_urlsafe(15)
    user = User(email=email, password_hash=hash_password(password), role=role)
    db.add(user)
    db.flush()
    from .models import Profile
    db.add(Profile(user_id=user.id))
    db.add(AuditLog(user_id=user.id, action=f"create_{role}", meta={"via": "admin-cli"}))
    db.commit()
    return password


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    if argv[0] == "licence-keygen":   # needs no database
        from .licensing.signing import generate_seed
        seed, pub = generate_seed()
        print("TRUSTCODE_LICENCE_SIGNING_KEY (server secret - store it in the hosting provider's secret settings only):")
        print(seed)
        print("Public key (add to extension/src/licence/keys.ts under the same key id as TRUSTCODE_LICENCE_KEY_ID):")
        print(pub)
        return 0
    Base.metadata.create_all(engine) if engine.dialect.name == "sqlite" else None
    db = SessionLocal()
    try:
        cmd = argv[0]
        if cmd in ("create-researcher", "create-admin") and len(argv) == 2:
            try:
                pw = create_researcher(db, argv[1], "admin" if cmd == "create-admin" else "researcher")
            except ValueError as e:
                print(e)
                return 1
            print(f"created {cmd.split('-')[1]} {argv[1]}; one-time password (share securely): {pw}")
            return 0
        if cmd in ("grant-researcher", "revoke-researcher") and len(argv) == 2:
            user = db.scalar(select(User).where(User.email == argv[1].strip().lower()))
            if not user:
                print("no such user")
                return 1
            if cmd == "grant-researcher":
                logins = db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.user_id == user.id,
                                                                                     AuditLog.action == "login")) or 0
                print(f"Account {user.email}: created {user.created_at:%Y-%m-%d %H:%M} UTC, {logins} login(s).")
                print("Email ownership is NOT verified. Confirm the owner registered it themselves.")
                if not sys.stdin.isatty():
                    print("refusing: interactive confirmation required (use create-researcher for scripted setup)")
                    return 1
                if input("Type the email again to confirm: ").strip().lower() != user.email:
                    print("not confirmed")
                    return 1
            user.role = "researcher" if cmd == "grant-researcher" else "developer"
            db.add(AuditLog(user_id=user.id, action=cmd.replace("-", "_"), meta={"via": "admin-cli"}))
            db.commit()
            print(f"{argv[1]} is now {user.role}")
            return 0
        if cmd == "purge-expired":
            print(f"purged {purge_expired(db)} results")
            return 0
        print(__doc__)
        return 2
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
