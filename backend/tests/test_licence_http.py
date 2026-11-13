"""Licence tests over real HTTP: a TrustCode API started as its own process on 127.0.0.1 (port 8000 unless it is in
use), with a throw-away signing key, a temporary database built by the Alembic migrations, and the production
defaults for device enforcement and rate limits. Never a production server.

Covered here because they need real processes, real sockets or a real database:
- the migrations (0001 to 0007, down to 0006 and up again);
- concurrent activations at the device limit, and concurrent copies of one device-signed request;
- the simulated attacks (scripts/security/licence_attacks.py).

Every test runs on SQLite. It also runs on PostgreSQL when TRUSTCODE_TEST_POSTGRES_URL names a database that may
be wiped (for example postgresql://user@127.0.0.1:54329/trustcode_licence_test); without it the PostgreSQL runs
are reported as skipped, not passed.
"""
import base64
import importlib.util
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

import httpx
import pytest
from sqlalchemy import create_engine, inspect, text

from licence_helpers import Device, V, b64u, code, decode, register

BACKEND = Path(__file__).resolve().parents[1]
POSTGRES_URL = os.environ.get("TRUSTCODE_TEST_POSTGRES_URL", "")
SUBMIT = {"code": "x = 1\n", "client_consent": True}


def _free(port: int) -> bool:
    with socket.socket() as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def _port() -> int:
    wanted = int(os.environ.get("TRUSTCODE_TEST_PORT", "8000"))
    if _free(wanted):
        return wanted
    with socket.socket() as s:      # 8000 is taken (a development server?): any free port on this computer
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _sqlalchemy_url(url: str) -> str:
    return url.replace("postgresql://", "postgresql+psycopg2://", 1).replace("postgres://", "postgresql+psycopg2://", 1)


@pytest.fixture(scope="module", params=["sqlite", "postgresql"])
def database(request, tmp_path_factory):
    """An empty database, its schema built by the migrations (which also proves 0007 applies and reverts)."""
    if request.param == "postgresql":
        if not POSTGRES_URL:
            pytest.skip("PostgreSQL not tested: set TRUSTCODE_TEST_POSTGRES_URL to a database that may be wiped")
        url = POSTGRES_URL
        eng = create_engine(_sqlalchemy_url(url), isolation_level="AUTOCOMMIT")
        with eng.connect() as c:
            assert c.execute(text("select current_database()")).scalar().endswith("_test"), "refusing to wipe a database whose name does not end in _test"
            c.execute(text("drop schema public cascade"))
            c.execute(text("create schema public"))
        eng.dispose()
    else:
        url = f"sqlite:///{tmp_path_factory.mktemp('licence-http')}/api.db"
    tmp = tempfile.mkdtemp(prefix="trustcode-http-")
    env = {**os.environ, "TRUSTCODE_ENV": "test", "TRUSTCODE_DATABASE_URL": url, "TRUSTCODE_JWT_SECRET": "http-test-secret-" + "y" * 32,
           "TRUSTCODE_LOCAL_SECRET_FILE": f"{tmp}/local-secret", "TRUSTCODE_WORKER_MODE": "inline", "TRUSTCODE_RUN_TESTS": "false",
           "TRUSTCODE_LICENCE_SIGNING_KEY": base64.urlsafe_b64encode(os.urandom(32)).rstrip(b"=").decode(), "TRUSTCODE_LICENCE_KEY_ID": "t1"}
    for name in ("TRUSTCODE_LICENCE_DEVICE_ENFORCEMENT", "TRUSTCODE_RATE_LIMIT_PER_MINUTE", "TRUSTCODE_AUTH_RATE_LIMIT_PER_MINUTE",
                 "TRUSTCODE_VERIFY_RATE_LIMIT_PER_MINUTE", "DATABASE_URL"):
        env.pop(name, None)         # the server under test runs with the shipped defaults, not this test process's settings
    steps = []
    for args in (["upgrade", "head"], ["downgrade", "0006"], ["upgrade", "head"]):
        r = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND, env=env, capture_output=True, text=True, timeout=120)
        assert r.returncode == 0, f"alembic {' '.join(args)} failed on {request.param}:\n{r.stdout}\n{r.stderr}"
        cols = {c["name"] for c in inspect(create_engine(_sqlalchemy_url(url))).get_columns("licence_devices")}
        steps.append("stops_by" in cols)
    assert steps == [True, False, True], "0007 adds the columns, its downgrade removes them, and it applies again"
    return {"kind": request.param, "url": url, "env": env}


@pytest.fixture
def api(database):
    """A freshly started server per test, so every test begins with untouched rate limits."""
    port = _port()
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
                            cwd=BACKEND, env=database["env"], stdout=log, stderr=subprocess.STDOUT)
    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(150):
            try:
                if httpx.get(f"{base}{V}/health", timeout=1).status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            if proc.poll() is not None:
                break
            time.sleep(0.1)
        else:
            raise AssertionError("the test server did not start")
        assert proc.poll() is None, f"the test server exited:\n{Path(log.name).read_text()[-2000:]}"
        with httpx.Client(base_url=base, timeout=30) as client:
            yield {"client": client, "base": base, "db": create_engine(_sqlalchemy_url(database["url"])), "kind": database["kind"], "log": Path(log.name)}
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()


def make_admin(api) -> dict:
    a = register(api["client"], "admin")
    with api["db"].begin() as c:
        c.execute(text("update users set role = 'admin' where id = :id"), {"id": a["id"]})
    return a


def together(n, fn):
    """Runs fn(i) in n threads released at the same instant; returns the results in order."""
    barrier, out = threading.Barrier(n), [None] * n

    def work(i):
        with httpx.Client(timeout=30) as c:
            barrier.wait()
            out[i] = fn(i, c)
    threads = [threading.Thread(target=work, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(60)
    return out


def server_errors(api) -> list[str]:
    """Lines of the server's own log that show an unhandled error (a 500), with the exception that caused it."""
    return [line for line in api["log"].read_text().splitlines()
            if "unhandled error" in line or "database is locked" in line or line.startswith(("sqlalchemy.exc.", "sqlite3.", "psycopg2."))]


# ------------------------------------------------------------------ schema
def test_migrations_build_the_licence_schema(api):
    insp = inspect(api["db"])
    assert {"licence_rev"} <= {c["name"] for c in insp.get_columns("users")}
    assert {"stops_by", "stop_reason", "ext_version", "build_hash", "last_seen_at"} <= {c["name"] for c in insp.get_columns("licence_devices")}
    with api["db"].connect() as c:
        assert c.execute(text("select version_num from alembic_version")).scalar() == "0007"
    assert api["db"].dialect.name == api["kind"]
    u = register(api["client"])
    with api["db"].connect() as c:
        assert c.execute(text("select licence_rev from users where id = :id"), {"id": u["id"]}).scalar() == 0


# ------------------------------------------------------------------ a real client, end to end
def test_activate_status_refresh_release_over_http(api):
    c, u, d = api["client"], register(api["client"]), Device()
    r = d.activate(c, u["auth"], version="1.2.0", build="a" * 64)
    assert r.status_code == 200, r.text
    p = decode(r.json()["licence"])
    assert p["kid"] == "t1" and p["sub"] == u["id"] and p["dev"] == d.id and p["check_after"] == 3600
    assert c.get(f"{V}/me", headers=u["auth"]).headers["x-trustcode-licence-rev"] == str(p["rev"])
    s = d.status(c, u["id"])
    assert s.status_code == 200 and s.json()["refresh"] is False and s.headers["cache-control"] == "no-store"
    assert decode(d.refresh(c, u["id"]).json()["licence"])["lid"] != p["lid"]
    # the shipped default: server analysis needs the account and an active device of it
    refused = c.post(f"{V}/verifications", headers=u["auth"], json=SUBMIT)
    assert (refused.status_code, code(refused)) == (403, "device_proof_required")
    assert c.post(f"{V}/verifications", headers={**u["auth"], "X-TrustCode-Device": d.proof(u["id"])}, json=SUBMIT).status_code == 202
    assert d.release(c, u["id"]).json() == {"status": "deactivated"}
    gone = c.post(f"{V}/verifications", headers={**u["auth"], "X-TrustCode-Device": d.proof(u["id"])}, json=SUBMIT)
    assert (gone.status_code, code(gone)) == (403, "device_deactivated")
    assert code(d.status(c, u["id"])) == "device_deactivated"
    assert not server_errors(api)


def test_http_level_limits(api):
    c, u, d = api["client"], register(api["client"]), Device()
    d.activate(c, u["auth"])
    for op in ("refresh", "status", "release"):
        # a body sent in chunks, with no declared length, is cut off at the limit
        r = c.post(f"{V}/licence/{op}", content=(b"x" * 500 for _ in range(10)))
        assert r.status_code == 413, op
        assert c.post(f"{V}/licence/{op}", content=b"x" * 100_000).status_code == 413
        assert c.post(f"{V}/licence/{op}", content=b"<html>captive portal</html>", headers={"content-type": "text/html"}).status_code == 400
        assert c.get(f"{V}/licence/{op}").status_code == 405
    assert c.post(f"{V}/licence/activate", headers=u["auth"], content=b"{").status_code == 422
    assert c.post(f"{V}/licence/activate", headers=u["auth"], json={"device_id": d.id, "public_key": "A" * 43}).status_code == 422, "weak device key"
    assert d.status(c, u["id"]).status_code == 200, "the device is unaffected"
    assert not server_errors(api)


# ------------------------------------------------------------------ concurrency
def test_concurrent_activations_never_exceed_the_device_limit(api):
    """Two (here: four) sign-ins on new devices at the same instant, with one slot left: exactly one gets it."""
    c = api["client"]
    for round_ in range(4):
        u = register(c)
        for _ in range(2):                                   # two of the three devices are in use
            assert Device().activate(c, u["auth"]).status_code == 200
        new = [Device() for _ in range(4)]
        results = together(4, lambda i, http: http.post(f"{api['base']}{V}/licence/activate", headers=u["auth"],
                                                        json={"device_id": new[i].id, "public_key": new[i].public, "name": f"racer {i}"}))
        codes = sorted(r.status_code for r in results)
        assert codes == [200, 409, 409, 409], f"round {round_} on {api['kind']}: {[(r.status_code, r.text[:80]) for r in results]}"
        listing = c.get(f"{V}/licence/devices", headers=u["auth"]).json()
        assert listing["active_devices"] == 3 == listing["max_devices"]
        with api["db"].connect() as conn:
            assert conn.execute(text("select count(*) from licence_devices where user_id = :u and status = 'active'"), {"u": u["id"]}).scalar() == 3
    assert not server_errors(api)


def test_concurrent_activations_of_one_new_device_create_one_device(api):
    u, d = register(api["client"]), Device()
    results = together(4, lambda i, http: http.post(f"{api['base']}{V}/licence/activate", headers=u["auth"],
                                                    json={"device_id": d.id, "public_key": d.public, "name": "same device"}))
    assert [r.status_code for r in results] == [200] * 4, [(r.status_code, r.text[:80]) for r in results]
    with api["db"].connect() as conn:
        assert conn.execute(text("select count(*) from licence_devices where user_id = :u"), {"u": u["id"]}).scalar() == 1
        assert conn.execute(text("select count(*) from licences where user_id = :u and revoked_at is null"), {"u": u["id"]}).scalar() == 1, "one current licence"
    assert not server_errors(api)


@pytest.mark.parametrize("op", ["refresh", "status", "release"])
def test_two_copies_of_one_request_at_the_same_instant_only_one_is_accepted(api, op):
    c = api["client"]
    for round_ in range(3):
        u, d = register(c), Device()
        d.activate(c, u["auth"])
        body = d.body(u["id"], lid=d.lid, rev=d.rev)
        headers = {"x-trustcode-device-signature": b64u(d.key.sign(body)), "content-type": "application/json"}
        results = together(5, lambda i, http: http.post(f"{api['base']}{V}/licence/{op}", content=body, headers=headers))
        outcome = sorted((r.status_code, code(r) if r.status_code != 200 else "") for r in results)
        assert outcome == [(200, "")] + [(401, "replayed_request")] * 4, f"round {round_} on {api['kind']}: {outcome}"
        with api["db"].connect() as conn:
            issued = conn.execute(text("select count(*) from licences where user_id = :u"), {"u": u["id"]}).scalar()
            replays = conn.execute(text("select count(*) from licence_events where user_id = :u and event = 'replay_rejected'"), {"u": u["id"]}).scalar()
        assert issued == (2 if op == "refresh" else 1), "a refresh issues exactly one new licence"
        assert replays == 4
    assert not server_errors(api)


@pytest.mark.parametrize("op", ["refresh", "status", "release"])
def test_copies_of_one_request_in_separate_transactions_only_one_is_accepted(database, op):
    """The replay counter itself, without a web server in front. One server process handles device-signed requests
    one after another, which hides this race; several server instances (as in production) do not. Here every copy
    of the request runs in its own database transaction at the same instant."""
    from sqlalchemy.orm import sessionmaker
    from app.licensing import service
    from app.models import LicenceEvent, User
    Session = sessionmaker(bind=create_engine(_sqlalchemy_url(database["url"]), pool_size=10), autoflush=False, expire_on_commit=False)
    for round_ in range(5):
        with Session() as db:
            user = User(email=f"race-{os.urandom(6).hex()}@uni.example", password_hash="x")
            db.add(user)
            db.commit()
            d = Device()
            service.activate(db, user, d.id, d.public, "race", None)
        body = d.body(user.id)
        signature, data = b64u(d.key.sign(body)), json.loads(body)
        barrier, results = threading.Barrier(6), []

        def copy():
            with Session() as db:
                barrier.wait()
                try:
                    getattr(service, op)(db, body, signature, data)
                    results.append("accepted")
                except service.Refused as e:
                    results.append(e.code)
                except Exception as e:      # a database error would be a server error for the caller
                    results.append(f"{type(e).__name__}: {e}"[:120])
        threads = [threading.Thread(target=copy) for _ in range(6)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(60)
        assert sorted(results) == ["accepted"] + ["replayed_request"] * 5, f"round {round_}, {op} on {database['kind']}: {results}"
        with Session() as db:
            assert db.query(LicenceEvent).filter_by(user_id=user.id, event="replay_rejected").count() == 5


def test_concurrent_revocation_version_changes_are_not_lost(api):
    c, u, admin = api["client"], register(api["client"]), make_admin(api)
    Device().activate(c, u["auth"])
    results = together(6, lambda i, http: http.patch(f"{api['base']}{V}/admin/licences/users/{u['id']}/policy", headers=admin["auth"],
                                                     json={"offline_grace_days": 10 + i}))
    assert [r.status_code for r in results] == [200] * 6, [(r.status_code, r.text[:80]) for r in results]
    with api["db"].connect() as conn:
        assert conn.execute(text("select licence_rev from users where id = :u"), {"u": u["id"]}).scalar() == 6
    assert not server_errors(api)


# ------------------------------------------------------------------ simulated attacks
def test_simulated_attacks_all_fail_safely_and_are_logged(api, capsys):
    spec = importlib.util.spec_from_file_location("licence_attacks", BACKEND.parent / "scripts" / "security" / "licence_attacks.py")
    attacks = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(attacks)
    admin = make_admin(api)
    rows, missing = attacks.run(api["base"], admin["auth"]["Authorization"].split(" ", 1)[1])
    with capsys.disabled():
        print(f"\n--- simulated attacks against {api['base']} ({api['kind']})")
        for r in rows:
            print(f"{'ok  ' if r['safe'] else 'FAIL'} | {r['attack']} | {r['attempt']} | expected: {r['expected']} | actual: {r['actual']} | logged: {r['logged']}")
    assert len(rows) >= 40
    assert not [r for r in rows if not r["safe"]], "an attack did not fail safely"
    assert not missing, f"refusals that are not in the licence history: {missing}"
    assert sum(r["logged"].startswith("yes: ") for r in rows) >= 20
    assert {r["attack"][0] for r in rows} == set("123456")
    assert not server_errors(api)
    with pytest.raises(SystemExit):
        attacks.run("https://trustcode-api.vercel.app")       # refuses anything that is not this computer
