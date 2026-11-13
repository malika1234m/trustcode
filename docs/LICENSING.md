# Offline licences

TrustCode runs on the developer's computer. Plan checks work the way installed desktop software does:
activate online once, check the licence on the device at every start, keep working offline for a bounded
period, and refresh in the background when a connection is available.

**One rule overrides the rest: the Free plan needs no licence.** Local analysis works without an account,
offline from the moment the engine is set up, and nothing in this system can turn it off. A licence only carries
what an account is entitled to beyond Free (paid plans, once billing is live), so the device can honour that plan
without contacting the server on every start.

## 1. Architecture

```
 VS Code extension                                         TrustCode API (FastAPI)            Billing provider
 ┌───────────────────────────────┐   sign-in (PKCE)       ┌─────────────────────────────┐    (not connected yet)
 │ LicenceManager                │──────────────────────▶ │ /licence/activate  (account)│◀── signed webhooks ──
 │  · verify token (Ed25519,     │   POST /licence/refresh│ /licence/refresh   (device) │    → subscriptions
 │    pinned public keys)        │──signed by device key─▶│ /licence/release   (device) │
 │  · decide status locally      │                        │ app.licensing.service       │
 │  · back-off retries           │◀── signed licence ─────│   policy = plan + override  │
 │ SecretStorage (OS keychain):  │                        │   signs with the private key│
 │  licence, device key, clock   │                        │   (env only)                │
 └───────────────────────────────┘                        └─────────────────────────────┘
```

* **Source of truth:** the backend. It decides the plan from webhook-verified billing state (`app/billing`). It
  signs a licence that never extends past the paid period (`paid_until`) or the offline period (`offline_until`).
* **The device** only verifies what the backend signed, and may only narrow it. The checks are the pinned
  signature, this device's id, the paid period, the offline period and the clock. It never widens it.
* **Server features** (server analysis, hosted limits) still check the account on every request. A licence never
  unlocks anything on the server.

## 2. Database changes (migration `0006`)

| Table | Purpose | Notes |
|---|---|---|
| `licence_devices` | One row per activated installation | `(user_id, device_id)` unique; `public_key` is the device's Ed25519 key; `status` is active, deactivated or revoked; `last_request_counter` provides replay protection |
| `licences` | Metadata of every licence issued | Plan, key id, `issued_at`, `offline_until`, `paid_until`, and `revoked_at`/`revoked_reason` (superseded, deactivated, revoked, account_suspended). The token itself is not stored |
| `licence_policies` | Per-account admin override | `offline_grace_days` (1–365), `max_devices` (1–50); empty = plan default |
| `licence_events` | Validation history | activated, refreshed, refresh_refused, activation_refused, signature_rejected, replay_rejected, deactivated, revoked, restored, policy_changed. No IP addresses. Erased with the account |

Users and subscriptions are reused (no duplicate tables). Plan defaults are in `app/billing/plans.py`
(`licence.offline_grace_days` = 30 and `max_devices` = 3, or 5 for Team).

## 3. API

| Method and path | Auth | Purpose |
|---|---|---|
| `POST /api/v1/licence/activate` | account bearer token | Body: `device_id` (32 hex), `public_key` (base64url, 32 bytes), `name`, `platform`. Registers or reactivates the device and returns `{licence, server_time, plan, offline_until, paid_until}`. Errors: `409 device_limit_reached`, `403 device_revoked`, `503 licensing_not_configured` |
| `POST /api/v1/licence/refresh` | device signature | Body: `{user_id, device_id, counter}`. Header `X-TrustCode-Device-Signature`: base64url Ed25519 signature of the exact body. Returns a new licence. Errors: `401 device_not_recognised`, `401 replayed_request`, `403 device_deactivated`, `403 device_revoked`, `403 account_suspended` |
| `POST /api/v1/licence/release` | device signature | Same body. The device deactivates itself (sign-out) |
| `GET /api/v1/licence/devices` | account | Plan, offline days, device limit and devices |
| `POST /api/v1/licence/devices/{id}/deactivate` | account (owner) | Sign out a device |
| `GET /api/v1/licence/history` | account | Your last validation events |
| `GET /api/v1/licence/keys` | public | Current public key (reference only; the extension pins its own) |
| `GET /api/v1/admin/licences` | admin | Devices, with search by email or id and a status filter |
| `POST /api/v1/admin/licences/devices/{id}/revoke` and `/restore` | admin | Block a device, or allow it to be activated again |
| `GET /api/v1/admin/licences/users/{id}` | admin | An account's plan, policy, devices and history |
| `PATCH /api/v1/admin/licences/users/{id}/policy` | admin | Set the offline days and device limit |
| `GET /api/v1/admin/licences/events?suspicious=true` | admin | Rejected and refused requests, plus accounts with more than 5 activations in 7 days |

Rate limits: activation is limited to 10 per minute per account. Refresh and release are limited to 30 per minute
per IP and 6 per minute per device. Bodies are capped at 2 KB. Every admin action is written to the audit log.

## 4. Licence format, issue and verification

`tcl1.<base64url(JSON)>.<base64url(Ed25519 signature over "tcl1.<base64url(JSON)>")>`

Payload fields:

| Field | Meaning |
|---|---|
| `v` | Licence version (1) |
| `kid` | Signing key id |
| `lid` | Licence id |
| `sub` | Account id |
| `dev` | Device id |
| `plan` | Plan id and name |
| `state` | Subscription state |
| `features`, `limits` | Plan features and limits |
| `act` | Device activation time |
| `iat`, `validated_at` | Server time when the licence was issued and validated |
| `grace_days` | Offline days |
| `offline_until` | End of the offline period |
| `paid_until` | Period end plus renewal grace, the payment-failure grace end, or null |
| `refresh_after` | Normally `iat` + 24 h |

Times are Unix seconds. The licence contains no password, private key or payment data.

Each issue supersedes the device's earlier licences in `licences`. The extension verifies the signature against
`extension/src/licence/keys.ts` (pinned by `kid`) every time the licence is loaded. A token is rejected if it is
malformed, has an unknown key, has a bad signature, has missing fields, or belongs to another device. When a
token is rejected, the plan falls back to Free.

## 5. Offline decisions (`extension/src/licence/state.ts`)

| Condition (checked in order) | Status | Plan in force |
|---|---|---|
| Server refused the device | Device deactivated (`revoked`) | Free |
| No licence | Free plan | Free |
| Clock earlier than the latest trusted time or `iat` (10 min tolerance) | Connection required | Free |
| Paid plan and now ≥ `paid_until` | Subscription ended | Free |
| Now ≥ `offline_until` | Connection required | Free |
| Paid period ends within 5 days | Expiring soon | Licensed plan |
| Offline and the offline period ends within 5 days | Expiring soon | Licensed plan |
| Last attempt failed | Offline · checked on this computer | Licensed plan |
| Otherwise | Active | Licensed plan |

Clock protection works as follows. The latest plausible time is stored in SecretStorage. A successful refresh
resets it to the server's time, which also repairs a clock that had been set too far ahead.

User data is never deleted. When a status pauses paid features, only paid features stop.

The status bar and a notification appear only for states that need attention, and at most once a day per state.
Ordinary use shows no licence prompts.

## 6. Sync and device workflow

* **Sign-in** (browser PKCE, unchanged) is followed by activation. On first use the device gets a random install id
  and an Ed25519 key pair in SecretStorage. The id is not derived from hardware, so changing hardware never
  locks anyone out. Reinstalling simply re-activates the device after the next sign-in.
* **Startup:** the licence is loaded and verified locally with no network call, and the timers start. The first
  check runs after 15 s, then hourly. A check contacts the server only when the licence is past `refresh_after`,
  after a failed attempt, or when the status is Connection required.
* **Failures:** a network error, timeout (15 s), 5xx or 429 keeps the licence and marks the device offline. It then
  retries after 1, 2, 4, 8, 16 and 32 minutes, then 1, 2, 4 and 6 hours, with ±20% jitter. Only one retry is
  pending at a time. Regaining window focus retries early if the last attempt is more than 2 minutes old.
* **Refusals** (`device_not_recognised`, deactivated, revoked, `account_suspended`) remove the licence. Signing
  in again re-activates the device, unless it was revoked by an administrator.
* **Device limit:** activation answers 409, and the extension offers *Manage devices* (web dashboard → Settings →
  Devices). Re-activating a device that is already active never counts twice.
* **Sign-out** sends a device-signed release (best effort) and always removes the licence locally. *Delete my
  account* also erases devices, licences and licence history.

## 7. Security notes

* The private signing key exists only in the server environment. Licences cannot be generated without it, and
  editing the licence breaks the Ed25519 signature.
* A refresh is authenticated by the device key. A copied licence file does not work on another device (`dev`
  mismatch), and a captured refresh request cannot be replayed because the counter must increase.
* Refresh needs no account token, so a device that was offline longer than a sign-in session (7 days) still
  resynchronises.
* The backend re-decides the plan on every refresh. Suspension, cancellation, refunds and revocation take effect
  at the next refresh.
* The code paths that call the server are unchanged: server features still check the account on every request.

## 8. Tests

* `backend/tests/test_licensing.py`: 13 tests. They cover activation, tampering, wrong key, device-signed
  refresh, replay, device limit, deactivate and reactivate, ownership, suspension, admin revoke and restore,
  admin policy, `paid_until` and cancellation, input validation, an unconfigured server, history and release.
* `extension/test/licence.test.ts`: 18 tests. They use a fake server that signs real Ed25519 licences, and
  cover the following scenarios:
  * first activation and verification
  * launch and restart offline
  * working within the offline period, the warning near its end, and the pause after it
  * subscription ending while offline, and expiry or cancellation after reconnecting
  * revocation
  * a modified licence and an invalid signature
  * a copied licence
  * a clock turned back
  * the device limit
  * sign-out and release
  * corrupted storage
  * the connection dropping or the server failing during sync, with back-off
  * reconnecting after several days
  * no network call when the licence is not due
  * the account card escaping server text
* A cross-language check confirmed that a backend-signed licence verifies in the TypeScript verifier and that a
  tampered one fails. An end-to-end run against a local API covered activate, restart, forced refresh, release
  and history.
* Tested on macOS (Apple silicon), the only platform the extension is tested on.

## 9. Known limitations

* **Client-side checks can be bypassed.** Someone who modifies the installed extension can skip any local check.
  The licence makes casual tampering fail, but no client-side scheme can stop a modified client. What a modified
  client cannot do is obtain server features, because those are checked on the server.
* **Revocation is not instant offline.** A revoked or cancelled device keeps its licensed plan until its next
  refresh, which happens within about a day when online. Offline, it lasts until `offline_until` or `paid_until`,
  whichever comes first. Shorter offline periods reduce this window.
* **Clock checks catch only some changes.** Rollback detection notices a clock turned back after TrustCode last
  ran. It cannot detect a clock that was already wrong at the time of the first activation; the server time in
  each licence bounds this.
* **Storage depends on the OS keychain.** SecretStorage uses the OS keychain where VS Code supports one. On Linux
  without a keyring, VS Code may fall back to weaker storage (Linux is untested).
* **No paid plan is on sale yet.** Today every licence carries the Free plan, and no local feature is gated. When
  a paid local feature is added, gate it with `LicenceManager.allows(feature)`.
* **Admins cannot change an account's plan.** Plans change only through signed billing events, by design (see
  `app/billing/subscriptions.py`). Admins control offline days, device limits and device revocation.
* **Rate limits are per instance.** The in-memory rate limiter is per instance (`docs/project/known_issues.md`).

## 10. Deployment and key configuration

1. Generate a key: `cd backend && python -m app.admin licence-keygen`. It prints the server seed and the public key.
2. Put the seed in the hosting provider's secret settings as `TRUSTCODE_LICENCE_SIGNING_KEY`, and set
   `TRUSTCODE_LICENCE_KEY_ID` (default `k1`). Never commit the seed. In production, startup fails on a malformed seed.
3. Make sure the public key is in `extension/src/licence/keys.ts` under the same id, then release the extension.
4. Run migrations: `alembic upgrade head` (adds 0006).
5. Without a seed, licensing is off. Activation answers 503, the extension stays on Free, and nothing else changes.
6. **Rotation:** add the new public key under a new id, release the extension, switch the key id and seed on the
   server, and keep the old public key until every licence it signed has passed its offline period (at most 365 days).

`cryptography>=42` is now a backend dependency (Ed25519). The extension uses Node's built-in `crypto`.
