"""Server-side admin commands (run on the server, never exposed over HTTP).

    python -m app.admin grant-researcher EMAIL
    python -m app.admin revoke-researcher EMAIL
    python -m app.admin purge-expired
"""
import sys

from sqlalchemy import select

from .db import Base, SessionLocal, engine
from .models import AuditLog, User
from .services.jobs import purge_expired


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    Base.metadata.create_all(engine) if engine.dialect.name == "sqlite" else None
    db = SessionLocal()
    try:
        cmd = argv[0]
        if cmd in ("grant-researcher", "revoke-researcher") and len(argv) == 2:
            user = db.scalar(select(User).where(User.email == argv[1].strip().lower()))
            if not user:
                print("no such user (the account must register first)")
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
