#!/usr/bin/env python3
"""Simulated attacks on the licence system, run against a LOCAL TrustCode API only.

Acts like a malicious user with an account of their own and no access to the server's keys or database:

  1. forging a licence without the private key
  2. reusing another user's device id
  3. replaying captured requests
  4. calling server endpoints with a removed, blocked or expired device
  5. enumerating user ids through the licence endpoints
  6. hitting the rate limits

Every attempt must fail safely (the right refusal, no server error, nothing gained), and the ones that reach the
server's licence code must appear in the licence history that administrators see.

    python scripts/security/licence_attacks.py --base http://127.0.0.1:8000 [--admin-token <access token>]

The script registers two throw-away accounts. It refuses any address that is not this computer. Without an
administrator token it cannot read the licence history or block a device, and says so for the rows concerned.
Exit status: 0 when every attempt failed safely, 1 otherwise.

The server should be freshly started with its default rate limits: the attacks before the last one are sized to stay
inside them, and the last one deliberately exceeds them.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import sys
import time
import uuid
from urllib.parse import urlparse

import httpx
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

V = "/api/v1"
REQUEST_LOG = "request log only (refused before the licence code)"
ON_DEVICE = "not a server event: a forged licence is rejected on the device"
SUBMIT = {"code": "x = 1\n", "client_consent": True}


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def unb64u(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


class Device:
    def __init__(self, device_id: str | None = None):
        self.key = Ed25519PrivateKey.generate()
        self.id = device_id or uuid.uuid4().hex
        self.counter = int(time.time() * 1000)

    @property
    def public(self) -> str:
        return b64u(self.key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))

    def signed(self, user_id: str, counter: int | None = None, key: Ed25519PrivateKey | None = None) -> tuple[bytes, dict]:
        if counter is None:
            self.counter += 1
            counter = self.counter
        body = json.dumps({"user_id": user_id, "device_id": self.id, "counter": counter}).encode()
        return body, {"x-trustcode-device-signature": b64u((key or self.key).sign(body)), "content-type": "application/json"}

    def proof(self, user_id: str, at: float | None = None, key: Ed25519PrivateKey | None = None) -> str:
        t = int(at if at is not None else time.time())
        return f"{self.id}.{t}.{b64u((key or self.key).sign(f'tcdev1.{user_id}.{self.id}.{t}'.encode()))}"


def describe(r: httpx.Response) -> str:
    try:
        return f"{r.status_code} {r.json()['error']['code']}"
    except Exception:
        return str(r.status_code)


class Run:
    def __init__(self, base: str, admin_token: str | None):
        self.http = httpx.Client(base_url=base, timeout=30)
        self.admin = {"Authorization": f"Bearer {admin_token}"} if admin_token else None
        self.rows: list[dict] = []
        self.device_calls = 0

    # ---- plumbing
    def row(self, attack: str, attempt: str, expected: str, actual: str, safe: bool, logged=REQUEST_LOG):
        """`logged`: (event, account id) that must be in the licence history administrators see, or a text saying
        why the attempt is not a licence event."""
        self.rows.append({"attack": attack, "attempt": attempt, "expected": expected, "actual": actual, "safe": bool(safe), "logged": logged})

    def expect(self, attack: str, attempt: str, r: httpx.Response, expected: str, logged=REQUEST_LOG):
        """The attempt is safe when the server answered exactly the expected refusal (never a 5xx, never a success)."""
        self.row(attack, attempt, expected, describe(r), describe(r) == expected, logged)

    def register(self, label: str) -> dict:
        r = self.http.post(f"{V}/auth/register", json={"email": f"{label}-{uuid.uuid4().hex[:10]}@attack.example", "password": "correct-horse-1"})
        r.raise_for_status()
        auth = {"Authorization": f"Bearer {r.json()['access_token']}"}
        return {"auth": auth, "id": self.http.get(f"{V}/me", headers=auth).json()["id"]}

    def activate(self, account: dict, device: Device) -> httpx.Response:
        return self.http.post(f"{V}/licence/activate", headers=account["auth"],
                              json={"device_id": device.id, "public_key": device.public, "name": "attack simulation", "platform": "test"})

    def device_call(self, op: str, body: bytes, headers: dict) -> httpx.Response:
        self.device_calls += 1
        return self.http.post(f"{V}/licence/{op}", content=body, headers=headers)

    def submit(self, auth: dict, proof: str | None) -> httpx.Response:
        return self.http.post(f"{V}/verifications", headers={**auth, **({"X-TrustCode-Device": proof} if proof else {})}, json=SUBMIT)

    def rows_of(self, account: dict) -> list[dict]:
        return self.http.get(f"{V}/licence/devices", headers=account["auth"]).json()["items"]

    # ---- 1
    def forge_a_licence(self, victim: dict, device: Device, token: str):
        A = "1. forge a licence without the private key"
        published = self.http.get(f"{V}/licence/keys").json()["keys"][0]
        server_key = Ed25519PublicKey.from_public_bytes(unb64u(published["public_key"]))
        head, body, sig = token.split(".")
        payload = json.loads(unb64u(body))

        def verifies(t: str) -> bool:
            try:
                h, b, s = t.split(".")
                server_key.verify(unb64u(s), f"{h}.{b}".encode())
                return h == "tcl1" and json.loads(unb64u(b)).get("kid") == published["kid"]
            except (InvalidSignature, ValueError):
                return False

        assert verifies(token), "control: the genuine licence must verify with the server's published key"
        better = b64u(json.dumps({**payload, "plan": {"id": "team", "name": "Team"}, "offline_until": payload["offline_until"] + 3650 * 86400,
                                  "paid_until": payload["iat"] + 3650 * 86400}, separators=(",", ":"), sort_keys=True).encode())
        mine = Ed25519PrivateKey.generate()
        forgeries = {
            "payload edited, original signature kept": f"{head}.{better}.{sig}",
            "payload edited, signed with the attacker's own key": f"{head}.{better}.{b64u(mine.sign(f'{head}.{better}'.encode()))}",
            "payload edited, signature removed": f"{head}.{better}.",
            "payload edited, all-zero signature": f"{head}.{better}.{b64u(bytes(64))}",
        }
        for name, forged in forgeries.items():
            ok = not verifies(forged)
            self.row(A, name, "does not verify with the server's key", "does not verify" if ok else "VERIFIES", ok, ON_DEVICE)
        forged = forgeries["payload edited, signed with the attacker's own key"]
        self.expect(A, "forged licence used as an account token (GET /me)", self.http.get(f"{V}/me", headers={"Authorization": f"Bearer {forged}"}), "401 unauthorized")
        self.expect(A, "forged licence used as an account token (server analysis)", self.submit({"Authorization": f"Bearer {forged}"}, device.proof(victim["id"])), "401 unauthorized")
        body, headers = device.signed(victim["id"], key=mine)
        self.expect(A, "asking the server for a genuine licence for the victim's device, signed with the attacker's key",
                    self.device_call("refresh", body, headers), "401 device_not_recognised", ("signature_rejected", victim["id"]))

    # ---- 2
    def reuse_a_device_id(self, victim: dict, device: Device, attacker: dict):
        A = "2. reuse another user's device id"
        copy = Device(device.id)                      # same id, the attacker's own key
        r = self.activate(attacker, copy)
        sub = json.loads(unb64u(r.json()["licence"].split(".")[1]))["sub"] if r.status_code == 200 else None
        self.row(A, "activating the victim's device id under the attacker's account", "a device of the attacker's own account only",
                 f"{r.status_code}, licence issued to {'the attacker' if sub == attacker['id'] else 'THE VICTIM' if sub == victim['id'] else sub}", sub == attacker["id"], "not suspicious: an ordinary activation in the attacker's own history")
        for op in ("refresh", "status", "release"):
            body, headers = copy.signed(victim["id"])
            self.expect(A, f"{op} for the victim's account, signed with the attacker's key", self.device_call(op, body, headers), "401 device_not_recognised",
                        ("signature_rejected", victim["id"]))
        self.expect(A, "server analysis with the attacker's token and a proof naming the victim's account", self.submit(attacker["auth"], copy.proof(victim["id"])),
                    "403 device_not_recognised", ("server_call_refused", attacker["id"]))
        self.expect(A, "server analysis with the attacker's token and a proof signed by an unknown key",
                    self.submit(attacker["auth"], copy.proof(attacker["id"], key=Ed25519PrivateKey.generate())), "403 device_not_recognised", ("server_call_refused", attacker["id"]))
        body, headers = device.signed(victim["id"])
        r = self.device_call("refresh", body, headers)
        active = sum(d["status"] == "active" for d in self.rows_of(victim))
        self.row(A, "effect on the victim", "the victim's device still works; device count unchanged", f"refresh {r.status_code}, {active} active device(s)", r.status_code == 200 and active == 1, "nothing to log")

    # ---- 3
    def replay(self, victim: dict, device: Device):
        A = "3. replay captured requests"
        old_body, old_headers = device.signed(victim["id"])           # captured, but delivered late (see below)
        for op in ("status", "refresh"):
            body, headers = device.signed(victim["id"])
            first = self.device_call(op, body, headers)                # the victim's own request, seen on the network
            assert first.status_code == 200, f"control: the genuine {op} must work ({describe(first)})"
            self.expect(A, f"the captured {op} request sent again, byte for byte", self.device_call(op, body, headers), "401 replayed_request", ("replay_rejected", victim["id"]))
        self.expect(A, "a captured request with a lower counter, delivered late", self.device_call("status", old_body, old_headers), "401 replayed_request", ("replay_rejected", victim["id"]))
        second = Device()
        assert self.activate(victim, second).status_code == 200
        body, headers = second.signed(victim["id"])
        assert self.device_call("release", body, headers).json() == {"status": "deactivated"}
        self.expect(A, "the captured sign-out (release) request sent again", self.device_call("release", body, headers), "401 replayed_request", ("replay_rejected", victim["id"]))
        self.expect(A, "a captured device proof used after ten minutes", self.submit(victim["auth"], device.proof(victim["id"], at=time.time() - 600)), "403 device_proof_expired",
                    ("server_call_refused", victim["id"]))
        self.expect(A, "a device proof dated in the future", self.submit(victim["auth"], device.proof(victim["id"], at=time.time() + 3600)), "403 device_proof_expired",
                    ("server_call_refused", victim["id"]))

    # ---- 4
    def stopped_devices(self, victim: dict, attacker: dict):
        A = "4. server endpoints with a removed, blocked or expired device"
        removed = Device()
        assert self.activate(victim, removed).status_code == 200
        control = self.submit(victim["auth"], removed.proof(victim["id"]))
        self.row(A, "control: an active device of the account", "202 (accepted)", describe(control), control.status_code == 202, "nothing to log")
        row = max(self.rows_of(victim), key=lambda d: d["activated_at"])["id"]      # the device just activated
        self.http.post(f"{V}/licence/devices/{row}/deactivate", headers=victim["auth"])
        for op in ("status", "refresh"):
            body, headers = removed.signed(victim["id"])
            self.expect(A, f"{op} from a device the owner removed", self.device_call(op, body, headers), "403 device_deactivated", (f"{op}_refused", victim["id"]))
        self.expect(A, "server analysis from a device the owner removed", self.submit(victim["auth"], removed.proof(victim["id"])), "403 device_deactivated", ("server_call_refused", victim["id"]))
        self.expect(A, "server analysis with the account token and no device at all", self.submit(victim["auth"], None), "403 device_proof_required", ("server_call_refused", victim["id"]))
        if self.admin:
            blocked = Device()
            assert self.activate(victim, blocked).status_code == 200
            row = max(self.rows_of(victim), key=lambda d: d["activated_at"])["id"]
            assert self.http.post(f"{V}/admin/licences/devices/{row}/revoke", headers=self.admin).json()["status"] == "revoked"
            for op in ("status", "refresh"):
                body, headers = blocked.signed(victim["id"])
                self.expect(A, f"{op} from a device an administrator blocked", self.device_call(op, body, headers), "403 device_revoked", (f"{op}_refused", victim["id"]))
            self.expect(A, "server analysis from a blocked device", self.submit(victim["auth"], blocked.proof(victim["id"])), "403 device_revoked", ("server_call_refused", victim["id"]))
            self.expect(A, "signing in again on a blocked device (activation)", self.activate(victim, blocked), "403 device_revoked", ("activation_refused", victim["id"]))
        else:
            self.row(A, "a device an administrator blocked", "403 device_revoked", "NOT RUN (needs an administrator token)", True, "not run")
        # an expired or made-up account session: a token with a valid shape, signed without the server's secret
        seg = lambda o: b64u(json.dumps(o, separators=(",", ":")).encode())  # noqa: E731
        signing_input = f"{seg({'alg': 'HS256', 'typ': 'JWT'})}.{seg({'sub': victim['id'], 'scope': 'user', 'exp': int(time.time()) - 60})}"
        fake = {"Authorization": "Bearer " + signing_input + "." + b64u(hmac.new(b"guessed-secret", signing_input.encode(), hashlib.sha256).digest())}
        none = {"Authorization": "Bearer " + f"{seg({'alg': 'none', 'typ': 'JWT'})}.{seg({'sub': victim['id'], 'scope': 'user', 'exp': int(time.time()) + 600})}."}
        self.expect(A, "an expired account token signed with a guessed secret (device list)", self.http.get(f"{V}/licence/devices", headers=fake), "401 unauthorized")
        self.expect(A, "an unsigned account token, algorithm 'none' (server analysis)", self.submit(none, removed.proof(victim["id"])), "401 unauthorized")
        self.expect(A, "managing the victim's device with the attacker's account", self.http.post(f"{V}/licence/devices/{row}/deactivate", headers=attacker["auth"]), "404 not_found")

    # ---- 5
    def enumerate_ids(self, victim: dict, device: Device, attacker: dict):
        A = "5. enumerate user ids through the licence endpoints"
        stranger, known = Device(), Device()
        assert self.activate(victim, known).status_code == 200      # a real device with an untouched allowance
        for op in ("refresh", "status", "release"):
            cases = {"unknown account, unknown device": stranger.signed(uuid.uuid4().hex), "real account, unknown device": stranger.signed(victim["id"]),
                     "real account, real device, wrong key": known.signed(victim["id"], key=stranger.key)}
            answers = {name: self.device_call(op, *args) for name, args in cases.items()}
            distinct = sorted({describe(r) + ("" if r.status_code == 401 else f" {r.text[:60]}") for r in answers.values()})
            same = len({(r.status_code, r.text) for r in answers.values()}) == 1
            leak = any(victim["id"] in r.text or known.id in r.text for r in answers.values())
            self.row(A, f"{op}: unknown account, real account with an unknown device, real device with a wrong key", "one identical answer (401 device_not_recognised)",
                     f"{'identical' if same else 'DIFFERENT'} answers: {' / '.join(distinct)}", same and not leak and distinct == ["401 device_not_recognised"],
                     ("signature_rejected", None))
        a = self.http.get(f"{V}/admin/licences/users/{victim['id']}", headers=attacker["auth"])
        b = self.http.get(f"{V}/admin/licences/users/{uuid.uuid4().hex}", headers=attacker["auth"])
        self.row(A, "administrator licence view for a real and a made-up user id, as an ordinary account", "the same refusal for both (403)",
                 f"{describe(a)} / {describe(b)}", describe(a) == describe(b) == "403 forbidden")
        a = self.http.post(f"{V}/licence/devices/{self.rows_of(victim)[0]['id']}/deactivate", headers=attacker["auth"])
        b = self.http.post(f"{V}/licence/devices/{uuid.uuid4().hex}/deactivate", headers=attacker["auth"])
        self.row(A, "another account's device row and a made-up row id", "the same refusal for both (404)", f"{describe(a)} / {describe(b)}", describe(a) == describe(b) == "404 not_found")
        keys = self.http.get(f"{V}/licence/keys")
        self.row(A, "the public key endpoint", "the public key only", f"{keys.status_code}, fields: {sorted(keys.json())}", sorted(keys.json()) == ["configured", "keys"] and victim["id"] not in keys.text, "public endpoint")

    # ---- 6
    def rate_limits(self, attacker: dict):
        A = "6. hit the rate limits"
        used, LIMITED = self.device_calls, "request log only: a rate-limited request is answered before the licence code"
        own = Device()
        self.activate(attacker, own)
        codes = []
        for _ in range(20):
            codes.append(self.device_call("status", *own.signed(attacker["id"])).status_code)
        self.row(A, "20 status checks in a row from one device", "at most 6 answered, the rest 429", f"{codes.count(200)} answered, {codes.count(429)} refused (429)",
                 codes.count(200) <= 6 and codes.count(200) + codes.count(429) == 20, LIMITED)
        codes = [self.activate(attacker, Device()).status_code for _ in range(15)]
        self.row(A, "15 more activations on one account", "at most 10 a minute reach the licence code, the rest 429",
                 f"{codes.count(200)} activated, {codes.count(409)} refused at the device limit, {codes.count(429)} rate limited", codes.count(429) >= 5 and 500 not in codes and codes.count(200) <= 3, LIMITED)
        codes = []
        for _ in range(80):
            r = self.device_call("refresh", *Device().signed(uuid.uuid4().hex))
            codes.append(r.status_code)
        answered = codes.count(401)
        self.row(A, "80 requests with made-up device ids from one address", "at most 60 device-signed requests a minute in total, the rest 429",
                 f"{answered} answered (401), {codes.count(429)} refused (429); {used + 20} had been made before", set(codes) <= {401, 429} and used + 20 + answered <= 60 and codes.count(429) >= 20, LIMITED)
        self.row(A, "what a refused request reveals", "429 with a Retry-After header and nothing else", f"{r.status_code}, Retry-After: {r.headers.get('retry-after')}, body: {r.text[:60]}",
                 r.status_code == 429 and r.headers.get("retry-after", "").isdigit() and "rate limit" in r.text, LIMITED)

    # ---- what the server recorded
    def check_history(self):
        """Replaces each row's (event, account) with what the licence history administrators see actually contains."""
        seen: set[tuple[str, str | None]] = set()
        if self.admin:
            for offset in (0, 200, 400):
                page = self.http.get(f"{V}/admin/licences/events", headers=self.admin, params={"suspicious": True, "limit": 200, "offset": offset})
                page.raise_for_status()
                seen |= {(e["event"], e["user_id"]) for e in page.json()["items"]}
        self.missing = []
        for row in self.rows:
            if isinstance(row["logged"], tuple):
                event = row["logged"]
                if not self.admin:
                    row["logged"] = f"NOT CHECKED (needs an administrator token): {event[0]}"
                elif event in seen:
                    row["logged"] = f"yes: {event[0]}"
                else:
                    row["logged"] = f"MISSING: {event[0]}"
                    self.missing.append(f"{row['attempt']}: {event[0]}")

    def run(self) -> list[dict]:
        victim, attacker = self.register("victim"), self.register("attacker")
        device = Device()
        first = self.activate(victim, device)
        first.raise_for_status()
        self.forge_a_licence(victim, device, first.json()["licence"])
        self.reuse_a_device_id(victim, device, attacker)
        self.replay(victim, device)
        self.stopped_devices(victim, attacker)
        self.enumerate_ids(victim, device, attacker)
        self.rate_limits(attacker)                      # last: it uses up this address's allowance
        self.check_history()
        return self.rows


def run(base: str, admin_token: str | None = None) -> tuple[list[dict], list[str]]:
    """(rows, missing): one row per attempt, and the attempts whose expected licence-history entry was not found."""
    host = urlparse(base).hostname or ""
    if host not in ("127.0.0.1", "localhost", "::1"):
        raise SystemExit(f"refusing to run against {host!r}: these attacks are for a local test server only")
    r = Run(base, admin_token)
    return r.run(), r.missing


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--admin-token", default=None, help="access token of an administrator of the local test server")
    args = ap.parse_args()
    rows, missing = run(args.base, args.admin_token)
    print("| Attack | Attempt | Expected | Actual | Failed safely | Logged |\n|---|---|---|---|---|---|")
    for r in rows:
        print(f"| {r['attack']} | {r['attempt']} | {r['expected']} | {r['actual']} | {'yes' if r['safe'] else 'NO'} | {r['logged']} |")
    unsafe = [r for r in rows if not r["safe"]]
    print(f"\n{len(rows)} attempts, {len(rows) - len(unsafe)} failed safely, {len(unsafe)} did not; expected licence-history entries missing: {len(missing)}.")
    return 1 if unsafe or missing else 0


if __name__ == "__main__":
    sys.exit(main())
