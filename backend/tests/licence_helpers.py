"""Shared helpers for the licence tests. They work with the in-process TestClient and with a real HTTP client
(httpx.Client with a base URL), so the same device code drives both."""
import base64
import json
import time
import uuid

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

V = "/api/v1"
PASSWORD = "correct-horse-1"


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def unb64u(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def decode(token: str) -> dict:
    """The payload of a licence token, without checking the signature."""
    return json.loads(unb64u(token.split(".")[1]))


class Device:
    """An installation: a random id, an Ed25519 key pair and a request counter, like the extension keeps."""

    def __init__(self):
        self.key = Ed25519PrivateKey.generate()
        self.id = uuid.uuid4().hex
        self.counter = int(time.time() * 1000)
        self.lid = None
        self.rev = None

    @property
    def public(self) -> str:
        return b64u(self.key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))

    def activate(self, client, auth, name="Test Mac", **extra):
        r = client.post(f"{V}/licence/activate", headers=auth,
                        json={"device_id": self.id, "public_key": self.public, "name": name, "platform": "darwin-arm64", **extra})
        self._remember(r)
        return r

    def _remember(self, r):
        if r.status_code == 200 and "licence" in r.json():
            p = decode(r.json()["licence"])
            self.lid, self.rev = p["lid"], p["rev"]

    def body(self, user_id, counter=None, **extra) -> bytes:
        if counter is None:
            self.counter += 1
            counter = self.counter
        return json.dumps({**extra, "user_id": user_id, "device_id": self.id, "counter": counter}).encode()

    def call(self, client, op, user_id, body=None, key=None, **extra):
        """A device-signed request: op is refresh, status or release."""
        body = body if body is not None else self.body(user_id, **extra)
        r = client.post(f"{V}/licence/{op}", content=body,
                        headers={"x-trustcode-device-signature": b64u((key or self.key).sign(body)), "content-type": "application/json"})
        if op == "refresh":
            self._remember(r)
        return r

    def refresh(self, client, user_id, **kw):
        return self.call(client, "refresh", user_id, **kw)

    def status(self, client, user_id, **kw):
        """What the extension sends: the licence id and revocation version it holds."""
        if "body" not in kw:
            kw.setdefault("lid", self.lid)
            kw.setdefault("rev", self.rev)
        return self.call(client, "status", user_id, **kw)

    def release(self, client, user_id, **kw):
        return self.call(client, "release", user_id, **kw)

    def proof(self, user_id, at=None, key=None, device_id=None) -> str:
        """The X-TrustCode-Device header for a server feature."""
        t = int(at if at is not None else time.time())
        dev = device_id or self.id
        return f"{dev}.{t}.{b64u((key or self.key).sign(f'tcdev1.{user_id}.{dev}.{t}'.encode()))}"


def register(client, prefix="u") -> dict:
    """A new account: {"auth": headers, "id": user id, "email": ...}."""
    email = f"{prefix}{uuid.uuid4().hex[:10]}@uni.example"
    r = client.post(f"{V}/auth/register", json={"email": email, "password": PASSWORD})
    assert r.status_code == 201, r.text
    auth = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return {"auth": auth, "id": client.get(f"{V}/me", headers=auth).json()["id"], "email": email}


def code(r) -> str:
    """The error code of a refused request."""
    try:
        return r.json()["error"]["code"]
    except Exception:
        return f"<no error code: {r.status_code} {r.text[:80]}>"
