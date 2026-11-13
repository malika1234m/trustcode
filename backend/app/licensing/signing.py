"""Ed25519 licence signing. The private seed exists only in the server's environment (TRUSTCODE_LICENCE_SIGNING_KEY);
the extension holds the matching public key and verifies licences on the device without contacting the server.

Token format: "tcl1.<base64url(JSON payload)>.<base64url(signature)>", where the signature covers the ASCII bytes
"tcl1.<base64url(JSON payload)>" (so verification never depends on re-serialising JSON).
"""
from __future__ import annotations

import base64
import json

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from ..config import get_settings

PREFIX = "tcl1"


def b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def unb64u(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


class NotConfigured(RuntimeError):
    pass


def _private_key() -> Ed25519PrivateKey:
    seed = get_settings().licence_signing_key.strip()
    if not seed:
        raise NotConfigured("licensing is not configured on this server")
    try:
        raw = unb64u(seed)
        if len(raw) != 32:
            raise ValueError
        return Ed25519PrivateKey.from_private_bytes(raw)
    except ValueError:
        raise NotConfigured("TRUSTCODE_LICENCE_SIGNING_KEY is not a base64url-encoded 32-byte Ed25519 seed")


def configured() -> bool:
    try:
        _private_key()
        return True
    except NotConfigured:
        return False


def raw_public(key: Ed25519PublicKey) -> str:
    return b64u(key.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))


def public_key() -> dict:
    """The current verification key, published for reference. The extension pins its own copy."""
    return {"kid": get_settings().licence_key_id, "alg": "Ed25519", "public_key": raw_public(_private_key().public_key())}


def sign(payload: dict) -> str:
    body = b64u(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    signing_input = f"{PREFIX}.{body}".encode()
    return f"{PREFIX}.{body}.{b64u(_private_key().sign(signing_input))}"


def verify(token: str, public_b64u: str) -> dict:
    """Verifies a licence token against a raw public key. Raises ValueError when malformed or not authentic."""
    parts = token.split(".") if isinstance(token, str) else []
    if len(parts) != 3 or parts[0] != PREFIX:
        raise ValueError("malformed licence")
    try:
        Ed25519PublicKey.from_public_bytes(unb64u(public_b64u)).verify(unb64u(parts[2]), f"{parts[0]}.{parts[1]}".encode())
        return json.loads(unb64u(parts[1]))
    except (InvalidSignature, ValueError, json.JSONDecodeError):
        raise ValueError("licence signature is not valid")


def verify_with_keys(token: str, keys: dict[str, str]) -> dict:
    """Verifies a licence the way the extension does: the key is chosen by the `kid` the token claims, from a pinned
    set. An unknown key id is rejected before any signature is checked. Used by tests and by key rotation checks."""
    parts = token.split(".") if isinstance(token, str) else []
    if len(parts) != 3 or parts[0] != PREFIX:
        raise ValueError("malformed licence")
    try:
        kid = json.loads(unb64u(parts[1])).get("kid")
    except (ValueError, AttributeError):
        raise ValueError("malformed licence")
    if not isinstance(kid, str) or kid not in keys:
        raise ValueError("unknown signing key")
    return verify(token, keys[kid])


_P = 2 ** 255 - 19
_D = -121665 * pow(121666, _P - 2, _P) % _P
_SQRT_M1 = pow(2, (_P - 1) // 4, _P)


def usable_device_key(public_b64u: str) -> bool:
    """False for a device key that proves nothing: not 32 bytes, not a canonical point of the curve, or one of the
    eight small-order points. For a small-order key, signatures that verify can be produced without any private key
    (for the all-zero key, a signature of all zeros verifies for about one message in four), so it must never be
    registered as a device or accepted in a device-signed request."""
    try:
        raw = unb64u(public_b64u)
    except (ValueError, TypeError):
        return False
    if len(raw) != 32:
        return False
    y = int.from_bytes(raw, "little") & (2 ** 255 - 1)
    if y >= _P:
        return False
    u, v = (y * y - 1) % _P, (_D * y * y + 1) % _P            # x^2 = u / v
    x = u * pow(v, 3, _P) * pow(u * pow(v, 7, _P), (_P - 5) // 8, _P) % _P
    if v * x * x % _P == (-u) % _P:
        x = x * _SQRT_M1 % _P
    elif v * x * x % _P != u:
        return False                                           # not on the curve
    for _ in range(3):                                         # 8P is the neutral point (0, 1) exactly for small-order P
        t = _D * x * x * y * y % _P
        x, y = 2 * x * y * pow(1 + t, _P - 2, _P) % _P, (y * y + x * x) * pow(1 - t, _P - 2, _P) % _P
    return not (x == 0 and y == 1)


def verify_device_signature(public_b64u: str, signature_b64u: str, body: bytes) -> bool:
    """A refresh request must be signed by the device key registered at activation."""
    try:
        raw = unb64u(public_b64u)
        if len(raw) != 32 or not usable_device_key(public_b64u):
            return False
        Ed25519PublicKey.from_public_bytes(raw).verify(unb64u(signature_b64u), body)
        return True
    except (InvalidSignature, ValueError):
        return False


def generate_seed() -> tuple[str, str]:
    """(private seed, public key), both base64url. Used by `python -m app.admin licence-keygen`."""
    k = Ed25519PrivateKey.generate()
    seed = k.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
    return b64u(seed), raw_public(k.public_key())
