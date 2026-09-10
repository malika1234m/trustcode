"""Verification worker process (production): polls the job table, runs the pipeline,
and periodically purges expired results. Run with: python -m app.worker_main
This is the ONLY process that needs access to the Docker daemon."""
import logging
import signal
import time

from .db import Base, SessionLocal, engine
from .services.jobs import claim_next, process, purge_expired

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("trustcode.worker")
_running = True


def _stop(*_):
    global _running
    _running = False


def main(poll_seconds: float = 1.0):
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    Base.metadata.create_all(engine) if engine.dialect.name == "sqlite" else None
    last_purge = 0.0
    log.info("worker started")
    while _running:
        db = SessionLocal()
        try:
            job = claim_next(db)
            if job:
                log.info("processing job=%s", job.id)
                process(db, job)
                continue
            if time.monotonic() - last_purge > 600:
                n = purge_expired(db)
                last_purge = time.monotonic()
                if n:
                    log.info("purged %d expired results", n)
        except Exception:
            log.exception("worker loop error")
        finally:
            db.close()
        time.sleep(poll_seconds)
    log.info("worker stopped")


if __name__ == "__main__":
    main()
