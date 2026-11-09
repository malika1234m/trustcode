from app import admin
from app.db import SessionLocal

V = "/api/v1"


def _reg(client, email):
    r = client.post(f"{V}/auth/register", json={"email": email, "password": "correct-horse-1"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _admin(client, email="ops@uni.example"):
    db = SessionLocal()
    pw = admin.create_researcher(db, email, "admin")
    db.close()
    r = client.post(f"{V}/auth/login", json={"email": email, "password": pw})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_plans_are_public_and_have_no_fake_prices(client):
    r = client.get(f"{V}/plans").json()
    assert r["billing_live"] is False
    ids = {p["id"]: p for p in r["plans"]}
    assert ids["free"]["status"] == "available" and ids["pro"]["status"] == "planned"
    assert all(p["prices"] is None for p in r["plans"])


def test_entitlements_report_real_usage(client):
    h = _reg(client, "ent@uni.example")
    e = client.get(f"{V}/me/entitlements", headers=h).json()
    assert e["plan"]["id"] == "free" and e["usage"]["verifications_this_month"] == 0
    client.post(f"{V}/verifications", headers=h, json={"code": "x = 1\n", "client_consent": True})
    assert client.get(f"{V}/me/entitlements", headers=h).json()["usage"]["verifications_this_month"] == 1
    assert client.get(f"{V}/me", headers=h).json()["email"] == "ent@uni.example"


def test_quota_is_enforced_by_the_backend(client, monkeypatch):
    from app.billing import plans
    h = _reg(client, "quota@uni.example")
    monkeypatch.setitem(plans.PLANS["free"]["limits"], "verifications_per_month", 2)
    for i in range(2):
        assert client.post(f"{V}/verifications", headers=h, json={"code": f"x = {i}\n", "client_consent": True}).status_code == 202
    r = client.post(f"{V}/verifications", headers=h, json={"code": "x = 9\n", "client_consent": True})
    assert r.status_code == 403 and "monthly verification limit" in r.json()["error"]["message"]
    assert client.get(f"{V}/me/entitlements", headers=h).json()["usage"]["remaining"] == 0


def test_public_contact_ticket_with_honeypot_and_validation(client):
    ok = client.post(f"{V}/support/tickets", json={"category": "question", "subject": "Hello", "message": "How does it work?", "email": "v@x.io"})
    assert ok.status_code == 201 and ok.json()["id"]
    bot = client.post(f"{V}/support/tickets", json={"category": "question", "subject": "Buy", "message": "spam spam spam", "email": "b@x.io", "website": "http://spam"})
    assert bot.status_code == 201 and bot.json()["id"] is None
    assert client.post(f"{V}/support/tickets", json={"category": "question", "subject": "Hi", "message": "no email given"}).status_code == 422
    assert client.post(f"{V}/support/tickets", json={"category": "hack", "subject": "Hi", "message": "invalid category", "email": "a@b.io"}).status_code == 422


def test_ticket_thread_ownership_and_staff_reply(client):
    h = _reg(client, "cust@uni.example")
    other = _reg(client, "other@uni.example")
    tid = client.post(f"{V}/support/tickets", headers=h, json={"category": "bug", "subject": "Crash", "message": "It crashes on save"}).json()["id"]
    assert client.get(f"{V}/support/tickets/{tid}", headers=other).status_code == 404
    assert len(client.get(f"{V}/support/tickets", headers=h).json()["items"]) == 1
    a = _admin(client)
    assert client.post(f"{V}/support/tickets/{tid}/messages", headers=a, json={"body": "Fixed in 0.4.1"}).status_code == 201
    t = client.get(f"{V}/support/tickets/{tid}", headers=h).json()
    assert [m["author"] for m in t["messages"]] == ["customer", "staff"] and t["status"] == "pending"
    assert client.patch(f"{V}/admin/tickets/{tid}", headers=a, json={"status": "closed", "assign_to_me": True}).json()["status"] == "closed"
    assert client.post(f"{V}/support/tickets/{tid}/messages", headers=h, json={"body": "thanks"}).status_code == 409


def test_admin_endpoints_require_admin_role(client):
    h = _reg(client, "plain@uni.example")
    for path in ["/admin/overview", "/admin/users", "/admin/tickets", "/admin/audit"]:
        assert client.get(f"{V}{path}", headers=h).status_code == 403, path
        assert client.get(f"{V}{path}").status_code == 401, path


def test_admin_overview_users_search_and_suspension(client):
    a = _admin(client, "ops2@uni.example")
    victim = _reg(client, "suspend-me@uni.example")
    ov = client.get(f"{V}/admin/overview", headers=a).json()
    assert ov["users_total"] >= 2 and ov["billing_live"] is False
    found = client.get(f"{V}/admin/users", headers=a, params={"q": "suspend-me"}).json()
    assert found["total"] == 1
    uid = found["items"][0]["id"]
    assert client.post(f"{V}/admin/users/{uid}/suspend", headers=a).json()["suspended"] is True
    assert client.get(f"{V}/me", headers=victim).status_code == 401, "suspended user must lose access immediately"
    assert client.post(f"{V}/auth/login", json={"email": "suspend-me@uni.example", "password": "correct-horse-1"}).status_code == 401
    assert client.post(f"{V}/admin/users/{uid}/restore", headers=a).json()["suspended"] is False
    assert client.post(f"{V}/auth/login", json={"email": "suspend-me@uni.example", "password": "correct-horse-1"}).status_code == 200
    me_id = client.get(f"{V}/me", headers=a).json()["id"]
    assert client.post(f"{V}/admin/users/{me_id}/suspend", headers=a).status_code == 409
    assert any(x["action"] == "admin_suspend" for x in client.get(f"{V}/admin/audit", headers=a).json()["items"])


def test_api_root_redirects_to_website(client):
    r = client.get("/", follow_redirects=False)
    assert r.status_code == 307 and r.headers["location"].startswith("https://")
