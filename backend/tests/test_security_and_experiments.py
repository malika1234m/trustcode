import csv
import io

from app import admin
from app.config import get_settings
from app.local_secret import ensure_local_secret

V = "/api/v1"


def _register(client, email):
    r = client.post(f"{V}/auth/register", json={"email": email, "password": "correct-horse-1"})
    assert r.status_code == 201
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ---------- security review 2026-11-03: no role escalation at registration ----------
def test_self_registration_never_grants_researcher(client):
    h = _register(client, "would-be-researcher@uni.example")
    assert client.get(f"{V}/profile", headers=h).json()["role"] == "developer"
    assert client.post(f"{V}/experiments/sessions", headers=h, json={}).status_code == 403


def test_admin_creates_researcher_and_refuses_squatted_email(client):
    from app.db import SessionLocal
    db = SessionLocal()
    pw = admin.create_researcher(db, "prof@uni.example")
    r = client.post(f"{V}/auth/login", json={"email": "prof@uni.example", "password": pw})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get(f"{V}/profile", headers=h).json()["role"] == "researcher"
    _register(client, "squatted@uni.example")
    import pytest
    with pytest.raises(ValueError):
        admin.create_researcher(db, "squatted@uni.example")
    db.close()


def test_grant_existing_account_requires_interactive_confirmation(client):
    _register(client, "existing@uni.example")
    assert admin.main(["grant-researcher", "existing@uni.example"]) == 1  # stdin is not a TTY under pytest


# ---------- security review 2026-11-03: local mode hardening ----------
def test_local_mode_requires_secret_host_and_no_origin(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "local_mode", True)
    secret = ensure_local_secret()
    ok_headers = {"x-trustcode-local-secret": secret}
    assert client.post(f"{V}/auth/local").status_code == 401                                   # no secret
    assert client.post(f"{V}/auth/local", headers={"x-trustcode-local-secret": "nope"}).status_code == 401
    assert client.post(f"{V}/auth/local", headers={**ok_headers, "origin": "http://evil.example"}).status_code == 403
    assert client.post(f"{V}/auth/local", headers={**ok_headers, "host": "evil.example"}).status_code == 403
    r = client.post(f"{V}/auth/local", headers=ok_headers)
    assert r.status_code == 200 and r.json()["access_token"]


def test_local_secret_file_is_private():
    import os
    import stat

    from app.local_secret import secret_path
    ensure_local_secret()
    assert stat.S_IMODE(os.stat(secret_path()).st_mode) == 0o600


# ---------- experiment mode end-to-end ----------
def test_experiment_full_session_and_export(client):
    from app.db import SessionLocal
    db = SessionLocal()
    pw = admin.create_researcher(db, "lead@uni.example")
    db.close()
    rh = {"Authorization": "Bearer " + client.post(f"{V}/auth/login", json={"email": "lead@uni.example", "password": pw}).json()["access_token"]}
    codes = []
    for _ in range(4):
        r = client.post(f"{V}/experiments/sessions", headers=rh, json={"study_id": "e2e"})
        assert r.status_code == 201 and r.json()["n_trials"] == 16
        codes.append(r.json())
    # counterbalancing: condition order alternates, adaptation factor present
    assert codes[0]["condition_order"] != codes[1]["condition_order"]
    # consent is mandatory
    bad = client.post(f"{V}/experiments/join", json={"participant_code": codes[0]["participant_code"], "consent": False,
                                                       "experience_level": "beginner", "years_experience": 1})
    assert bad.status_code == 422
    j = client.post(f"{V}/experiments/join", json={"participant_code": codes[0]["participant_code"], "consent": True,
                                                     "experience_level": "beginner", "years_experience": 1}).json()
    ph = {"Authorization": f"Bearer {j['access_token']}"}
    # participant tokens cannot use developer endpoints
    assert client.get(f"{V}/profile", headers=ph).status_code == 403
    seen_conditions, n = set(), 0
    while True:
        t = client.get(f"{V}/experiments/next", headers=ph).json()
        if t["done"]:
            break
        seen_conditions.add(t["condition"])
        if t["condition"] == "trustcode":
            assert "evidence" in t and t["evidence"]["checks"]
            assert "ground_truth" not in str(t) and "hidden_tests" not in t  # never leak answers
        else:
            assert "evidence" not in t
        client.post(f"{V}/experiments/events", headers=ph, json={"trial_id": t["trial_id"], "type": "evidence_expand"})
        r = client.post(f"{V}/experiments/trials/{t['trial_id']}/decision", headers=ph,
                        json={"decision": "accept" if n % 2 else "reject", "confidence": 70})
        assert r.status_code == 200
        assert client.post(f"{V}/experiments/trials/{t['trial_id']}/decision", headers=ph,
                           json={"decision": "accept", "confidence": 70}).status_code == 409
        n += 1
    assert n == 16 and seen_conditions == {"baseline", "trustcode"}
    assert client.post(f"{V}/experiments/questionnaires", headers=ph,
                       json={"instrument": "nasa_tlx", "condition": "trustcode", "responses": {"mental": 50}}).status_code == 201
    csv_text = client.get(f"{V}/experiments/export.csv?study_id=e2e", headers=rh).text
    rows = list(csv.DictReader(io.StringIO(csv_text)))
    assert len(rows) == 16                                 # only the consented session is exported
    assert all(r["decision_correct"] in ("0", "1") for r in rows)
    assert all("@" not in v for r in rows for v in r.values())  # no identifiers
    assert {r["item_class"] for r in rows} == {"C1", "C2", "D1", "D2"}


def test_unauthenticated_endpoints_have_strict_ip_limit(client, monkeypatch):
    from app.deps import limiter
    monkeypatch.setattr(get_settings(), "auth_rate_limit_per_minute", 5)
    limiter.reset()
    codes = [client.post(f"{V}/auth/login", json={"email": f"x{i}@uni.example", "password": "whatever-123"}).status_code
             for i in range(7)]
    assert codes[:5] == [401] * 5 and codes[5] == 429
    limiter.reset()
