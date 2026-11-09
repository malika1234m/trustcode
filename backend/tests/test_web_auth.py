import base64
import hashlib
import re
import secrets
from datetime import timedelta
from urllib.parse import parse_qs, urlencode, urlsplit

REDIRECT = "vscode://trustcode-research.trustcode/auth-callback"


def pkce():
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def params(challenge, state="s" * 24, redirect=REDIRECT, mode="login"):
    return {"redirect_uri": redirect, "state": state, "code_challenge": challenge, "mode": mode}


def submit(client, challenge, email, password, mode="login", state="s" * 24, redirect=REDIRECT):
    body = urlencode({**params(challenge, state, redirect, mode), "email": email, "password": password})
    return client.post("/auth/extension", content=body, headers={"Content-Type": "application/x-www-form-urlencoded"})


def code_from(page_html):
    m = re.search(r'href="([^"]+)">Open VS Code', page_html)
    assert m, "no return link on success page"
    target = m.group(1).replace("&amp;", "&")
    q = parse_qs(urlsplit(target).query)
    return target, q["code"][0], q["state"][0]


def test_login_page_renders_with_security_headers(client):
    _, ch = pkce()
    r = client.get("/auth/extension", params=params(ch))
    assert r.status_code == 200 and "Sign in to TrustCode" in r.text and 'type="password"' in r.text
    assert r.headers["x-frame-options"] == "DENY" and "frame-ancestors 'none'" in r.headers["content-security-policy"]
    assert "Create your account" in client.get("/auth/extension", params=params(ch, mode="register")).text


def test_foreign_redirects_are_rejected(client):
    _, ch = pkce()
    for bad in ["https://evil.example/cb", "vscode://evil.extension/auth-callback", "javascript:alert(1)",
                "vscode://trustcode-research.trustcode/other", REDIRECT + "?x=1", "http://localhost:6677/cb"]:
        r = client.get("/auth/extension", params=params(ch, redirect=bad))
        assert r.status_code == 400 and "Invalid sign-in link" in r.text, bad
    assert client.get("/auth/extension", params=params("short")).status_code == 400


def test_full_flow_login_and_pkce_exchange(client):
    client.post("/api/v1/auth/register", json={"email": "web@uni.example", "password": "correct-horse-1"})
    verifier, ch = pkce()
    r = submit(client, ch, "web@uni.example", "correct-horse-1")
    assert r.status_code == 200 and "You're signed in" in r.text
    target, code, state = code_from(r.text)
    assert target.startswith(REDIRECT + "?") and state == "s" * 24
    tok = client.post("/api/v1/auth/extension/token", json={"code": code, "code_verifier": verifier, "redirect_uri": REDIRECT})
    assert tok.status_code == 200
    h = {"Authorization": f"Bearer {tok.json()['access_token']}"}
    assert client.get("/api/v1/profile", headers=h).status_code == 200
    again = client.post("/api/v1/auth/extension/token", json={"code": code, "code_verifier": verifier, "redirect_uri": REDIRECT})
    assert again.status_code == 400, "code must be single-use"


def test_wrong_verifier_burns_the_code(client):
    client.post("/api/v1/auth/register", json={"email": "web2@uni.example", "password": "correct-horse-1"})
    verifier, ch = pkce()
    _, code, _ = code_from(submit(client, ch, "web2@uni.example", "correct-horse-1").text)
    bad = client.post("/api/v1/auth/extension/token", json={"code": code, "code_verifier": secrets.token_urlsafe(48), "redirect_uri": REDIRECT})
    assert bad.status_code == 400
    good = client.post("/api/v1/auth/extension/token", json={"code": code, "code_verifier": verifier, "redirect_uri": REDIRECT})
    assert good.status_code == 400, "a failed exchange must invalidate the code"


def test_redirect_mismatch_and_expiry_are_rejected(client):
    from app.db import SessionLocal
    from app.models import AuthCode, now
    client.post("/api/v1/auth/register", json={"email": "web3@uni.example", "password": "correct-horse-1"})
    verifier, ch = pkce()
    _, code, _ = code_from(submit(client, ch, "web3@uni.example", "correct-horse-1").text)
    other = "vscode-insiders://trustcode-research.trustcode/auth-callback"
    assert client.post("/api/v1/auth/extension/token", json={"code": code, "code_verifier": verifier, "redirect_uri": other}).status_code == 400
    verifier2, ch2 = pkce()
    _, code2, _ = code_from(submit(client, ch2, "web3@uni.example", "correct-horse-1").text)
    db = SessionLocal()
    row = db.query(AuthCode).filter(AuthCode.code_hash == hashlib.sha256(code2.encode()).hexdigest()).one()
    row.expires_at = now() - timedelta(seconds=1)
    db.commit(); db.close()
    assert client.post("/api/v1/auth/extension/token", json={"code": code2, "code_verifier": verifier2, "redirect_uri": REDIRECT}).status_code == 400


def test_wrong_password_shows_error_and_issues_no_code(client):
    client.post("/api/v1/auth/register", json={"email": "web4@uni.example", "password": "correct-horse-1"})
    _, ch = pkce()
    r = submit(client, ch, "web4@uni.example", "wrong-password")
    assert r.status_code == 400 and "Incorrect email or password" in r.text and "Open VS Code" not in r.text
    assert 'value="web4@uni.example"' in r.text  # email kept, password not echoed
    assert "wrong-password" not in r.text


def test_register_via_web_creates_account_and_code(client):
    verifier, ch = pkce()
    r = submit(client, ch, "new-web@uni.example", "brand-new-pass-1", mode="register")
    _, code, _ = code_from(r.text)
    tok = client.post("/api/v1/auth/extension/token", json={"code": code, "code_verifier": verifier, "redirect_uri": REDIRECT})
    assert tok.status_code == 200
    weak = submit(client, ch, "weak@uni.example", "short", mode="register")
    assert weak.status_code == 400 and "Please check your details" in weak.text
    dup = submit(client, ch, "new-web@uni.example", "brand-new-pass-1", mode="register")
    assert "already exists" in dup.text


def test_html_injection_in_parameters_is_escaped(client):
    _, ch = pkce()
    r = submit(client, ch, '"><script>alert(1)</script>@x.io', "x")
    assert "<script>alert(1)</script>" not in r.text


def test_page_script_is_nonce_bound_and_editor_named(client):
    _, ch = pkce()
    p = params(ch)
    p["redirect_uri"] = "cursor://trustcode-research.trustcode/auth-callback"
    r = client.get("/auth/extension", params=p)
    csp = r.headers["content-security-policy"]
    nonce = re.search(r"script-src 'nonce-([^']+)'", csp).group(1)
    assert f'<script nonce="{nonce}">' in r.text and "unsafe-inline" not in csp.split("script-src")[1]
    assert "Cursor is waiting" in r.text
    r2 = client.get("/auth/extension", params=p)
    assert re.search(r"nonce-([^']+)", r2.headers["content-security-policy"]).group(1) != nonce  # fresh per response
