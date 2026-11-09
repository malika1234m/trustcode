"""Browser sign-in for the VS Code extension (OAuth 2.0 authorization-code flow with PKCE, RFC 7636).

1. The extension opens  GET /auth/extension?redirect_uri=vscode://trustcode-research.trustcode/auth-callback
                                        &state=<random>&code_challenge=<S256(verifier)>[&mode=register]
2. The user signs in / creates an account on this page (the password never touches VS Code).
3. We issue a one-time code (5 min, single use, bound to the challenge and redirect URI; only its hash is stored)
   and send the browser back to the editor: <redirect_uri>?code=...&state=...
4. The extension checks `state` and exchanges code + verifier at POST /api/v1/auth/extension/token.
"""
from __future__ import annotations

import base64
import hashlib
import html
import re
import secrets
from datetime import timedelta
from urllib.parse import parse_qs, urlencode, urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..deps import client_ip, limiter
from ..models import AuditLog, AuthCode, Profile, User, now
from ..schemas import RegisterIn, TokenOut
from ..security import hash_password, verify_password

router = APIRouter()
EXTENSION_ID = "trustcode-research.trustcode"
ALLOWED_SCHEMES = {"vscode", "vscode-insiders", "vscodium", "cursor", "windsurf"}
CODE_TTL = timedelta(minutes=5)
_STATE = re.compile(r"^[A-Za-z0-9_-]{16,128}$")
_CHALLENGE = re.compile(r"^[A-Za-z0-9_-]{43,128}$")
SECURITY_HEADERS = {
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    "Referrer-Policy": "no-referrer",
}


def valid_redirect(uri: str) -> bool:
    """Only editor deep links that belong to this extension may receive codes."""
    try:
        u = urlsplit(uri)
    except ValueError:
        return False
    return (u.scheme in ALLOWED_SCHEMES and u.netloc.lower() == EXTENSION_ID and u.path == "/auth-callback"
            and not u.query and not u.fragment)


def s256(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


EDITORS = {"vscode": "VS Code", "vscode-insiders": "VS Code Insiders", "vscodium": "VSCodium", "cursor": "Cursor", "windsurf": "Windsurf"}


def editor_name(redirect_uri: str) -> str:
    return EDITORS.get(redirect_uri.split("://", 1)[0], "VS Code")


# The TrustCode mark (selection frame + a check whose stroke fades); see docs/brand.
MARK = ('<svg class="mark" viewBox="0 0 48 48" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        '<path d="M6 17V10a4 4 0 0 1 4-4h7M42 31v7a4 4 0 0 1-4 4h-7" stroke="var(--frame)" stroke-width="4"/>'
        '<path d="M14 25l7 7 6.3-7.65" stroke="var(--check)" stroke-width="4.5"/>'
        '<path d="M29.2 21.9l2.3-2.8" stroke="var(--check)" stroke-width="4.5" stroke-linecap="butt" stroke-opacity=".55"/>'
        '<path d="M33.4 16.8l1.6-1.95" stroke="var(--check)" stroke-width="4.5" stroke-linecap="butt" stroke-opacity=".3"/></svg>')

# Tiny progressive enhancement (show/hide password, caps-lock and length hints). The page works without it.
_SCRIPT = """
document.querySelectorAll('[data-toggle]').forEach(function (b) {
  var i = document.getElementById(b.getAttribute('data-toggle'));
  b.hidden = false;
  b.addEventListener('click', function () { var show = i.type === 'password'; i.type = show ? 'text' : 'password';
    b.setAttribute('aria-pressed', String(show)); b.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); b.textContent = show ? 'Hide' : 'Show'; });
});
var pw = document.getElementById('password'), caps = document.getElementById('caps'), len = document.getElementById('len');
if (pw) {
  pw.addEventListener('keyup', function (e) { if (caps && e.getModifierState) caps.hidden = !e.getModifierState('CapsLock'); });
  pw.addEventListener('input', function () { if (!len) return; var n = pw.value.length;
    len.textContent = n >= 10 ? 'Length looks good.' : (10 - n) + ' more character' + (10 - n === 1 ? '' : 's') + ' needed.';
    len.className = 'hint' + (n >= 10 ? ' good' : ''); });
}
var em = document.getElementById('email'), emErr = document.getElementById('email-err');
if (em && emErr) em.addEventListener('blur', function () { var bad = em.value && !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(em.value);
  emErr.hidden = !bad; em.setAttribute('aria-invalid', String(bad)); });
var alertEl = document.querySelector('.err'); if (alertEl) alertEl.focus();
"""


def _page(title: str, body: str, status: int = 200, extra_head: str = "", aside: str = "") -> HTMLResponse:
    nonce = secrets.token_urlsafe(16)
    doc = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><meta name="color-scheme" content="dark light">
<title>{html.escape(title)} · TrustCode</title>{extra_head}
<style>
:root {{ --bg:#0C1322; --bg2:#0F1728; --card:#121B2E; --field:#0F1728; --line:#24304A; --line2:#33415F; --text:#E7ECF5; --muted:#A7B1C7; --dim:#8C97AE;
  --brand:#8E96FF; --ink:#0C1322; --ok:#4FD1B5; --err:#FF7A70; --warn:#F2B544; --frame:#8E96FF; --check:#4FD1B5; --hatch:rgba(142,150,255,.16); }}
@media (prefers-color-scheme: light) {{ :root {{ --bg:#F6F8FC; --bg2:#EEF2F8; --card:#FFFFFF; --field:#F6F8FC; --line:#DCE2EE; --line2:#C6CFE0; --text:#0C1322;
  --muted:#45506A; --dim:#596480; --brand:#4650D6; --ink:#FFFFFF; --ok:#0B7A63; --err:#C2382E; --warn:#8A5A00; --frame:#4650D6; --check:#0B8A70; --hatch:rgba(70,80,214,.10); }} }}
* {{ box-sizing:border-box }}
body {{ margin:0; min-height:100dvh; font:16px/1.55 "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background:var(--bg); color:var(--text);
  display:grid; grid-template-columns:1fr; }}
@media (min-width: 960px) {{ body {{ grid-template-columns: 1fr 1fr; }} }}
.aside {{ display:none; position:relative; overflow:hidden; border-right:1px solid var(--line); background:var(--bg2); padding:48px; }}
@media (min-width: 960px) {{ .aside {{ display:flex; flex-direction:column; }} }}
.aside::before {{ content:""; position:absolute; inset:0; background-image:repeating-linear-gradient(135deg, var(--hatch) 0 2px, transparent 2px 7px);
  mask-image:radial-gradient(80% 60% at 100% 100%, #000, transparent 70%); }}
.aside > * {{ position:relative }}
.aside-mid {{ flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:36px; }}
.tag {{ font-size:24px; font-weight:600; letter-spacing:-.015em; margin:0; }}
.art {{ width:100%; max-width:420px; }} .win {{ border:1px solid var(--line2); border-radius:16px; overflow:hidden; background:var(--card); box-shadow:0 40px 100px -40px rgba(0,0,0,.6); }}
.bar {{ display:flex; gap:6px; padding:10px 14px; border-bottom:1px solid var(--line); background:var(--bg2); }} .bar i {{ width:8px; height:8px; border-radius:50%; background:var(--line2); }}
.code {{ padding:8px 0; font:12px/24px ui-monospace, "IBM Plex Mono", Menlo, monospace; }}
.ln {{ display:flex; padding:0 16px 0 12px; white-space:pre; overflow:hidden; }} .ln span {{ width:20px; color:var(--dim); }} .ln b {{ width:16px; }}
.ln b.d::before {{ content:""; display:block; width:6px; height:6px; margin-top:9px; border-radius:50%; background:var(--warn); }}
.ln.h {{ background-image:repeating-linear-gradient(135deg, var(--hatch) 0 2px, transparent 2px 7px); }} .ln.w {{ background:color-mix(in srgb, var(--warn) 10%, transparent); }}
.chk {{ display:grid; gap:6px; padding:12px; border-top:1px solid var(--line); background:var(--bg2); }}
.row {{ display:flex; align-items:center; gap:8px; font-size:12px; padding:6px 10px; border:1px solid var(--line); border-radius:8px; background:var(--card); }}
.row.w {{ border-color:color-mix(in srgb, var(--warn) 45%, transparent); }} .row svg {{ width:14px; height:14px; }}
.brand {{ display:flex; align-items:center; gap:10px; font-weight:600; font-size:18px; letter-spacing:-.01em; color:var(--text); }}
.mark {{ width:28px; height:28px; }}
main {{ display:flex; flex-direction:column; align-items:center; justify-content:center; padding:40px 20px; }}
main .brand {{ margin-bottom:28px; }} @media (min-width: 960px) {{ main .brand {{ display:none; }} }}
.panel {{ width:100%; max-width:400px; }}
.ctx {{ display:flex; align-items:center; gap:8px; font-size:14px; color:var(--muted); margin:0 0 16px; }}
.ctx .dot {{ width:8px; height:8px; border-radius:50%; background:var(--ok); box-shadow:0 0 0 4px color-mix(in srgb, var(--ok) 20%, transparent); }}
h1 {{ font-size:30px; line-height:1.15; letter-spacing:-.015em; margin:0 0 8px; }}
.sub {{ color:var(--muted); margin:0 0 24px; }}
.tabs {{ display:grid; grid-template-columns:1fr 1fr; background:var(--field); border:1px solid var(--line); border-radius:12px; padding:4px; margin:0 0 20px; }}
.tabs a {{ display:flex; align-items:center; justify-content:center; min-height:40px; border-radius:8px; color:var(--muted); text-decoration:none; font-weight:500; font-size:15px; }}
.tabs a[aria-current] {{ background:var(--card); color:var(--text); box-shadow:0 0 0 1px var(--line2); }}
.tabs a:hover {{ color:var(--text) }}
label {{ display:block; font-weight:600; font-size:15px; margin:16px 0 6px; }}
.field {{ position:relative; }}
input[type=email], input[type=password], input[type=text] {{ width:100%; min-height:48px; padding:12px 14px; border:1px solid var(--line2); border-radius:10px;
  background:var(--field); color:var(--text); font:inherit; transition:border-color .15s; }}
input[aria-invalid=true] {{ border-color:var(--err); }}
.field input {{ padding-right:72px; }}
.toggle {{ position:absolute; right:4px; top:4px; bottom:4px; min-width:60px; border:0; border-radius:8px; background:transparent; color:var(--muted); font:inherit; font-size:14px; cursor:pointer; }}
.toggle:hover {{ color:var(--text); background:var(--card); }}
:focus-visible {{ outline:2px solid var(--brand); outline-offset:2px; }}
input:focus-visible {{ outline-offset:0; border-color:var(--brand); }}
.hint {{ color:var(--dim); font-size:13px; margin:6px 0 0; }} .hint.good {{ color:var(--ok); }} .hint.warn {{ color:var(--warn); }}
.field-err {{ color:var(--err); font-size:13px; margin:6px 0 0; }}
.btn {{ display:flex; align-items:center; justify-content:center; width:100%; min-height:48px; margin-top:24px; padding:12px; border:0; border-radius:10px;
  background:var(--brand); color:var(--ink); font:inherit; font-weight:600; cursor:pointer; text-decoration:none; transition:filter .15s, transform .15s; }}
.btn:hover {{ filter:brightness(1.08); }} .btn:active {{ transform:scale(.98); }}
.err {{ border:1px solid color-mix(in srgb, var(--err) 45%, transparent); background:color-mix(in srgb, var(--err) 10%, transparent); color:var(--err);
  border-radius:10px; padding:10px 12px; margin:0 0 4px; font-size:15px; }}
.err:focus {{ outline:none; }}
.foot {{ color:var(--dim); font-size:13px; margin-top:20px; display:flex; gap:8px; }} .foot svg {{ flex:none; width:16px; height:16px; margin-top:2px; }}
.done {{ text-align:left; }} .done .mark {{ width:64px; height:64px; margin-bottom:20px; }}
@media (prefers-reduced-motion: reduce) {{ * {{ transition:none !important; }} }}
</style></head><body>
<aside class="aside">{aside or _ASIDE}</aside>
<main><div class="brand">{MARK}TrustCode</div><div class="panel">{body}</div></main>
<script nonce="{nonce}">{_SCRIPT}</script>
</body></html>"""
    headers = dict(SECURITY_HEADERS)
    headers["Content-Security-Policy"] = headers["Content-Security-Policy"] + f"; script-src 'nonce-{nonce}'"
    return HTMLResponse(doc, status_code=status, headers=headers)


_TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
_LOCK = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
         '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>')
_ART = """<div class="art" aria-hidden="true"><div class="win"><div class="bar"><i></i><i></i><i></i></div>
<div class="code"><div class="ln h"><b></b><span>1</span>def find_user(conn, name):</div><div class="ln w"><b class="d"></b><span>2</span>    q = f"SELECT \u2026 {name}"</div>
<div class="ln h"><b></b><span>3</span>    return conn.execute(q)</div></div>
<div class="chk"><div class="row">%(ok)sSyntax</div><div class="row w">%(warn)sSecurity</div><div class="row">%(ok)sDependencies</div><div class="row">%(none)sTests</div></div></div></div>""" % {
    "ok": '<svg viewBox="0 0 24 24" fill="none" stroke="var(--ok)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    "warn": '<svg viewBox="0 0 24 24" fill="none" stroke="var(--warn)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/></svg>',
    "none": '<svg viewBox="0 0 24 24" fill="none" stroke="var(--dim)" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>'}
_ASIDE = f"""<div class="brand">{MARK}TrustCode</div><div class="aside-mid">{_ART}<p class="tag">Evidence, not guesses.</p></div>"""


def _form(mode: str, redirect_uri: str, state: str, challenge: str, email: str = "", error: str = "") -> HTMLResponse:
    reg = mode == "register"
    q = lambda m: "?" + urlencode({"redirect_uri": redirect_uri, "state": state, "code_challenge": challenge, "mode": m})
    e = html.escape
    editor = e(editor_name(redirect_uri))
    body = f"""<p class="ctx"><span class="dot" aria-hidden="true"></span>{editor} is waiting</p>
<h1 style="margin-bottom:24px">{'Create your account' if reg else 'Sign in to TrustCode'}</h1>
<nav class="tabs" aria-label="Account"><a href="{e(q('login'))}"{'' if reg else ' aria-current="page"'}>Sign in</a><a href="{e(q('register'))}"{' aria-current="page"' if reg else ''}>Create account</a></nav>
{f'<p class="err" role="alert" tabindex="-1">{e(error)}</p>' if error else ''}
<form method="post" action="/auth/extension">
  <input type="hidden" name="redirect_uri" value="{e(redirect_uri)}"><input type="hidden" name="state" value="{e(state)}">
  <input type="hidden" name="code_challenge" value="{e(challenge)}"><input type="hidden" name="mode" value="{'register' if reg else 'login'}">
  <label for="email">Email</label>
  <input id="email" name="email" type="email" autocomplete="email" inputmode="email" required value="{e(email)}" aria-describedby="email-err"{'' if email else ' autofocus'}>
  <p id="email-err" class="field-err" hidden>Enter an email address like name@example.com.</p>
  <label for="password">Password</label>
  <div class="field">
    <input id="password" name="password" type="password" autocomplete="{'new-password' if reg else 'current-password'}" required minlength="{10 if reg else 1}"
           aria-describedby="{'len ' if reg else ''}caps"{' autofocus' if email else ''}>
    <button type="button" class="toggle" data-toggle="password" aria-pressed="false" aria-label="Show password" hidden>Show</button>
  </div>
  {'<p id="len" class="hint" aria-live="polite">At least 10 characters.</p>' if reg else ''}
  <p id="caps" class="hint warn" hidden>Caps Lock is on.</p>
  <button type="submit" class="btn">{'Create account' if reg else 'Sign in'}</button>
</form>
<p class="foot">{_LOCK}<span>{editor} never sees your password.</span></p>"""
    return _page("Create account" if reg else "Sign in", body, 400 if error else 200)


def _bad_request(msg: str) -> HTMLResponse:
    return _page("Invalid request", f'<h1>Invalid sign-in link</h1><p class="sub">{html.escape(msg)}</p>'
                 '<p class="sub">Start again from your editor: open the Command Palette and run <strong>TrustCode: Sign In</strong>.</p>', 400)


def _check_params(redirect_uri: str, state: str, challenge: str) -> str | None:
    if not valid_redirect(redirect_uri):
        return "This sign-in link does not come from the TrustCode VS Code extension."
    if not _STATE.match(state or "") or not _CHALLENGE.match(challenge or ""):
        return "The sign-in link is incomplete or has expired."
    return None


@router.get("/auth/extension", response_class=HTMLResponse, include_in_schema=False)
def sign_in_page(request: Request, redirect_uri: str = "", state: str = "", code_challenge: str = "", mode: str = "login"):
    problem = _check_params(redirect_uri, state, code_challenge)
    if problem:
        return _bad_request(problem)
    return _form("register" if mode == "register" else "login", redirect_uri, state, code_challenge)


@router.post("/auth/extension", response_class=HTMLResponse, include_in_schema=False)
async def sign_in_submit(request: Request, db: Session = Depends(get_db)):
    limiter.check(f"web-auth:{client_ip(request)}", get_settings().auth_rate_limit_per_minute)
    raw = (await request.body())[:10_000].decode("utf-8", "replace")
    f = {k: v[0] for k, v in parse_qs(raw, keep_blank_values=True).items()}
    redirect_uri, state, challenge = f.get("redirect_uri", ""), f.get("state", ""), f.get("code_challenge", "")
    mode = "register" if f.get("mode") == "register" else "login"
    email, password = f.get("email", "").strip().lower()[:254], f.get("password", "")[:200]
    problem = _check_params(redirect_uri, state, challenge)
    if problem:
        return _bad_request(problem)
    if mode == "register":
        try:
            RegisterIn(email=email, password=password)
        except ValidationError as e:
            msg = "; ".join(err["msg"].replace("Value error, ", "") for err in e.errors())
            return _form(mode, redirect_uri, state, challenge, email, f"Please check your details: {msg}.")
        if db.scalar(select(User).where(User.email == email)):
            return _form(mode, redirect_uri, state, challenge, email, "An account with this email already exists. Log in instead.")
        user = User(email=email, password_hash=hash_password(password), role="developer")
        db.add(user)
        db.flush()
        db.add(Profile(user_id=user.id))
        db.add(AuditLog(user_id=user.id, action="register", meta={"via": "web-extension-login"}))
    else:
        limiter.check(f"login:{email}", 10)
        user = db.scalar(select(User).where(User.email == email))
        if not user or not verify_password(password, user.password_hash) or user.suspended:
            db.add(AuditLog(user_id=None, action="login_failed", meta={"via": "web-extension-login"}))
            db.commit()
            return _form(mode, redirect_uri, state, challenge, email, "Incorrect email or password.")
        db.add(AuditLog(user_id=user.id, action="login", meta={"via": "web-extension-login"}))
    code = secrets.token_urlsafe(32)
    db.add(AuthCode(code_hash=hashlib.sha256(code.encode()).hexdigest(), user_id=user.id, code_challenge=challenge,
                    redirect_uri=redirect_uri, expires_at=now() + CODE_TTL))
    db.commit()
    target = f"{redirect_uri}?{urlencode({'code': code, 'state': state})}"
    t = html.escape(target)
    editor = html.escape(editor_name(redirect_uri))
    body = f"""<div class="done">{MARK}<h1>You're signed in</h1>
<p class="sub">If your browser asks, choose <strong>Open</strong>.</p>
<a class="btn" href="{t}">Open {editor}</a>
<p class="foot">You can close this tab.</p></div>"""
    return _page("Signed in", body, extra_head=f'<meta http-equiv="refresh" content="0;url={t}">')


class TokenExchangeIn(BaseModel):
    code: str = Field(min_length=20, max_length=100)
    code_verifier: str = Field(min_length=43, max_length=128, pattern=r"^[A-Za-z0-9._~-]+$")
    redirect_uri: str = Field(max_length=300)


@router.post("/api/v1/auth/extension/token", response_model=TokenOut, tags=["auth"])
def exchange_code(body: TokenExchangeIn, request: Request, db: Session = Depends(get_db)):
    limiter.check(f"ip-auth:{client_ip(request)}", get_settings().auth_rate_limit_per_minute)
    row = db.scalar(select(AuthCode).where(AuthCode.code_hash == hashlib.sha256(body.code.encode()).hexdigest()))
    expired = row is not None and row.expires_at.replace(tzinfo=row.expires_at.tzinfo or now().tzinfo) < now()
    if (row is None or row.used or expired or row.redirect_uri != body.redirect_uri
            or not secrets.compare_digest(row.code_challenge, s256(body.code_verifier))):
        if row is not None:
            row.used = True  # any failed attempt burns the code
            db.commit()
        raise HTTPException(400, "invalid or expired sign-in code")
    row.used = True
    user = db.get(User, row.user_id)
    from .routes import _tokens  # local import avoids a module cycle
    return _tokens(db, user)
