import os
import sys
import tempfile
import time
from pathlib import Path

_tmp = tempfile.mkdtemp(prefix="trustcode-test-")
os.environ.update({
    "TRUSTCODE_ENV": "test",
    "TRUSTCODE_DATABASE_URL": f"sqlite:///{_tmp}/test.db",
    "TRUSTCODE_JWT_SECRET": "test-secret-" + "x" * 32,
    "TRUSTCODE_LOCAL_SECRET_FILE": f"{_tmp}/local-secret",
    "TRUSTCODE_WORKER_MODE": "inline",
    "TRUSTCODE_BENCHMARK_DIR": str(Path(__file__).resolve().parents[2] / "datasets" / "benchmark"),
    "TRUSTCODE_VERIFY_RATE_LIMIT_PER_MINUTE": "1000",
    "TRUSTCODE_RATE_LIMIT_PER_MINUTE": "1000",
    "TRUSTCODE_AUTH_RATE_LIMIT_PER_MINUTE": "1000",
})
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.deps import limiter  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture
def client():
    limiter.reset()
    with TestClient(app) as c:
        yield c


_counter = [0]


@pytest.fixture
def auth(client):
    _counter[0] += 1
    r = client.post("/api/v1/auth/register", json={"email": f"dev{_counter[0]}@uni.example", "password": "correct-horse-1"})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def wait_done(client, headers, job_id, timeout=120):
    t0 = time.time()
    while time.time() - t0 < timeout:
        j = client.get(f"/api/v1/verifications/{job_id}", headers=headers).json()
        if j["status"] not in ("queued", "running"):
            return j
        time.sleep(0.3)
    raise AssertionError("job did not finish")
