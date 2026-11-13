# Offline licences

TrustCode runs on the developer's computer. Plan checks work the way installed desktop software does:
activate online once, check the licence on the device at every start, keep working offline for a bounded
period, and confirm the account in the background when a connection is available.

**TrustCode is free, but every user needs a registered account** (product decision, 2026-11-13). Nothing in the
extension runs without a valid licence: not Verify, Session, the Security scan, nor the startup scan. Code is still
analysed on the computer and never uploaded; the licence confirms who is using TrustCode and carries the plan.

When online, the device confirms its status 15 seconds after startup (unless the server answered in the last
5 minutes) and then every hour, and refreshes its licence about once a day. A removed, blocked, suspended or
deleted account stops TrustCode at the next status check: within one hour in the worst case, measured (section 8).
Offline, TrustCode keeps working until the licence's offline period ends (30 days by default), then pauses until
it can confirm the account.

Plans: administrators set an account's plan from **Admin → Users** (Free, Pro or Team, with an optional end
date; `POST /api/v1/admin/users/{id}/plan`). It is stored as a subscription with provider `admin`, so the same
entitlement rules apply, and a later verified billing event replaces it. Paid features will be added later.

The hardening described here (status call, revocation version, device proof, integrity signals, stop times) was
released in extension 1.2.0 (2026-11-14). The server side needs migration `0007` and goes live when the API is
redeployed; until then 1.2.0 falls back to the daily refresh (section 6, older servers). The test evidence is in
`docs/testing/licence_hardening_report.md`.

## 1. Architecture

```
 VS Code extension                                         TrustCode API (FastAPI)            Billing provider
 ┌───────────────────────────────┐   sign-in (PKCE)       ┌─────────────────────────────┐    (not connected yet)
 │ LicenceManager                │──────────────────────▶ │ /licence/activate  (account)│◀── signed webhooks ──
 │  · verify token (Ed25519,     │   signed by device key │ /licence/status    (device) │    → subscriptions
 │    pinned public keys)        │──────────────────────▶ │ /licence/refresh   (device) │
 │  · decide status locally      │                        │ /licence/release   (device) │
 │  · hourly status check        │◀── signed licence ─────│ app.licensing.service       │
 │  · back-off retries           │◀── revocation version ─│   policy = plan + override  │
 │ SecretStorage (OS keychain):  │    on every signed-in  │   signs with the private key│
 │  licence, device key, clock   │    response            │   (env only)                │
 └───────────────────────────────┘                        └─────────────────────────────┘
        │ server analysis (opt-in): account token + device proof ──▶ /verifications, /session-verifications
```

* **Source of truth:** the backend. It decides the plan from webhook-verified billing state (`app/billing`). It
  signs a licence that never extends past the paid period (`paid_until`) or the offline period (`offline_until`).
* **The device** only verifies what the backend signed, and may only narrow it. The checks are the pinned
  signature, this device's id, the paid period, the offline period and the clock. It never widens it.
* **Server features** check the account on every request, and server analysis also checks that the request comes
  from an active device of that account (section 7). A licence never unlocks anything on the server: the server
  never accepts a licence as a credential.

## 2. Database changes (migrations `0006` and `0007`)

| Table | Purpose | Notes |
|---|---|---|
| `licence_devices` | One row per activated installation | `(user_id, device_id)` unique; `public_key` is the device's Ed25519 key; `status` is active, deactivated or revoked; `last_request_counter` provides replay protection |
| `licences` | Metadata of every licence issued | Plan, key id, `issued_at`, `offline_until`, `paid_until`, and `revoked_at`/`revoked_reason` (superseded, deactivated, revoked, account_suspended). The token itself is not stored |
| `licence_policies` | Per-account admin override | `offline_grace_days` (1–365), `max_devices` (1–50); empty = plan default |
| `licence_events` | Validation history | See the event list below. No IP addresses. Erased with the account |

Migration `0007` adds:

| Column | Purpose |
|---|---|
| `users.licence_rev` | Revocation version. It grows whenever something changes what the account's devices may do: a device removed or blocked, the account suspended or restored, the plan or the licence policy changed, a billing event applied |
| `licence_devices.stops_by`, `stop_reason` | When a removed, blocked or suspended device will at the latest stop working offline: the end of the longest offline period ever signed for it. Cleared when the device is activated again or the account restored |
| `licence_devices.ext_version`, `build_hash`, `last_seen_at` | Integrity signals reported by the extension, and the last contact |

Events in `licence_events`: activated, refreshed, deactivated, revoked, restored, policy_changed, plan_changed,
account_suspended, account_restored, and the ones administrators see as suspicious: activation_refused,
refresh_refused, status_refused, signature_rejected, replay_rejected, unknown_build, build_not_reported,
server_call_refused, server_call_without_device.

Users and subscriptions are reused (no duplicate tables). Plan defaults are in `app/billing/plans.py`
(`licence.offline_grace_days` = 30 and `max_devices` = 3, or 5 for Team).

## 3. API

| Method and path | Auth | Purpose |
|---|---|---|
| `POST /api/v1/licence/activate` | account bearer token | Body: `device_id` (32 hex), `public_key` (base64url, 32 bytes), `name`, `platform`, and optionally `version` and `build`. Registers or reactivates the device and returns `{licence, server_time, plan, offline_until, paid_until, rev}`. Errors: `409 device_limit_reached`, `403 device_revoked`, `503 licensing_not_configured`, `422` for invalid input, including a device key that proves nothing (section 7) |
| `POST /api/v1/licence/status` | device signature | Body: `{user_id, device_id, counter}` plus what the device holds (`lid`, `rev`) and the integrity signals (`v`, `build`). Returns `{status: "ok", rev, refresh, check_after, server_time}`. Issues nothing. `refresh: true` means the device's licence is no longer the current one |
| `POST /api/v1/licence/refresh` | device signature | Same body. Returns a new licence |
| `POST /api/v1/licence/release` | device signature | Same body. The device deactivates itself (sign-out). Always allowed; it can only give an activation up |
| `GET /api/v1/licence/devices` | account | Plan, offline days, device limit and devices |
| `POST /api/v1/licence/devices/{id}/deactivate` | account (owner) | Sign out a device |
| `GET /api/v1/licence/history` | account | Your last validation events |
| `GET /api/v1/licence/keys` | public | Current public key (reference only; the extension pins its own) |
| `GET /api/v1/admin/licences` | admin | Devices, with search by email or id, a status filter, and `stopping=true` for devices that were stopped but can still run offline. Each device has `stops_by`, `stop_reason`, `stops_in_seconds` and `online_stop_within_seconds` |
| `POST /api/v1/admin/licences/devices/{id}/revoke` and `/restore` | admin | Block a device, or allow it to be activated again. The answer says when the device will at the latest stop |
| `POST /api/v1/admin/users/{id}/suspend` and `/restore` | admin | The answer lists each device with its `stops_by` |
| `GET /api/v1/admin/licences/users/{id}` | admin | An account's plan, policy, devices and history |
| `PATCH /api/v1/admin/licences/users/{id}/policy` | admin | Set the offline days and device limit |
| `GET /api/v1/admin/licences/events?suspicious=true` | admin | Rejected and refused requests, unknown builds, plus accounts with more than 5 activations in 7 days |

Device-signed requests carry the header `X-TrustCode-Device-Signature`: the base64url Ed25519 signature of the exact
body. Errors: `401 device_not_recognised` (unknown account, unknown device or wrong key: always the same answer),
`401 replayed_request`, `403 device_deactivated`, `403 device_revoked`, `403 account_suspended`.

Every signed-in response carries `X-TrustCode-Licence-Rev`, the account's revocation version.

Rate limits (per minute, configurable): activation 10 per account; device-signed requests 60 per address in total
and 6 per device and operation. Bodies are capped at 2 KB, also when sent without a declared length. Every admin
action is written to the audit log.

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
| `paid_until` | Period end plus renewal grace, the payment-failure grace end, the end date of an admin grant, or null |
| `refresh_after` | Normally `iat` + 24 h |
| `rev` | The account's revocation version when the licence was issued |
| `check_after` | Seconds between status checks while online (3600 by default; the server keeps it within 1–4 hours) |

Times are Unix seconds. The licence contains no password, private key or payment data.

Each issue supersedes the device's earlier licences in `licences`. The extension verifies the signature against
`extension/src/licence/keys.ts` (pinned by `kid`) every time the licence is loaded. A token is rejected if it is
malformed, has an unknown key, has a bad signature, has missing fields, or belongs to another device. A rejected
token means no licence: TrustCode asks the user to sign in.

## 5. Offline decisions (`extension/src/licence/state.ts`)

| Condition (checked in order) | Status | Usable |
|---|---|---|
| Server refused the device | Device deactivated (`revoked`) | No |
| No licence | Sign-in required | No |
| Clock earlier than the latest trusted time or `iat` (10 min tolerance) | Connection required | No |
| Now ≥ `offline_until` | Connection required | No, whatever the plan |
| Paid plan and now ≥ `paid_until` | Subscription ended | Yes, on the Free plan |
| Paid period ends within 5 days | Expiring soon | Yes |
| Offline and the offline period ends within 5 days | Expiring soon | Yes |
| Last attempt failed | Offline · checked on this computer | Yes |
| Otherwise | Active | Yes |

The offline period is checked before the paid period. Up to 1.1.1 the order was the other way round, so a device
whose paid plan had ended stayed usable on the Free plan indefinitely without confirming its account again, also
after it was removed or its account suspended. No account had a paid plan when this was found.

Clock protection works as follows. The latest plausible time is stored in SecretStorage. A successful contact
resets it to the server's time, which also repairs a clock that had been set too far ahead. Time zone and
daylight-saving changes have no effect: every comparison uses UTC timestamps.

User data is never deleted. The status bar and a notification appear only for states that need attention, and at
most once a day per state, also when two states alternate. Ordinary use shows no licence prompts.

## 6. Sync and device workflow

* **Sign-in** (browser PKCE, unchanged) is followed by activation. On first use the device gets a random install id
  and an Ed25519 key pair in SecretStorage. The id is not derived from hardware, so changing hardware never
  locks anyone out. Reinstalling simply re-activates the device after the next sign-in.
* **Startup:** the licence is loaded and verified locally with no network call, and the timers start. Fifteen
  seconds later the status is confirmed online, unless the server answered within the last 5 minutes (window
  reloads). After that a timer runs every 15 minutes; it contacts the server only when something is due.
* **Status check:** every `check_after` seconds while online (one hour by default). One small device-signed request;
  nothing is issued. If the answer says the licence is no longer current, one refresh follows.
* **Revocation version:** the server returns it with every signed-in response. The extension compares it with the
  version in its licence on traffic it already makes (opening the Account tab, history, server analysis). When
  nothing changed, this costs no request. When it differs, the extension refreshes at once.
* **A signed-in request answered 401** (session ended, account suspended or deleted) triggers one status check,
  at most once a minute.
* **Refresh:** when the licence is past `refresh_after` (once a day), when a status check or the revocation version
  asks for it, when the status is Connection required, or when the user asks.
* **Traffic when nothing changes** (measured with a simulated clock): 23 status calls and 1 refresh in 24 hours.
* **Failures:** a network error, timeout (15 s), 5xx, 429 or an answer that is not from the TrustCode server (a
  captive portal) keeps the licence and marks the device offline. It then retries after 1, 2, 4, 8, 16 and 32
  minutes, then 1, 2, 4 and 6 hours, with ±20% jitter. Only one retry is pending at a time. Regaining window focus
  retries early if the last attempt is more than 2 minutes old.
* **Refusals** (`device_not_recognised`, deactivated, revoked, `account_suspended`) remove the licence, and the
  file watcher of a tracked session is detached. Signing in again re-activates the device, unless it was revoked
  by an administrator.
* **Device limit:** activation answers 409, and the extension offers *Manage devices* (web dashboard → Settings →
  Devices). Re-activating a device that is already active never counts twice.
* **Sign-out** sends a device-signed release (best effort) and always removes the licence locally. *Delete my
  account* also erases devices, licences and licence history.
* **Older servers:** against a server without the status call (404 or 405) the extension falls back to the daily
  refresh and makes no hourly requests.
* **Storage problems:** if SecretStorage cannot be read or written, nothing throws. The user signs in, and the
  licence lasts for that session only.

## 7. Security notes

* The private signing key exists only in the server environment. Licences cannot be generated without it, and
  editing the licence breaks the Ed25519 signature.
* **Device requests** are authenticated by the device key. A copied licence file does not work on another device
  (`dev` mismatch). A captured request cannot be replayed: the counter is advanced with one conditional `UPDATE`,
  so of several copies arriving at the same moment exactly one is accepted, on SQLite and on PostgreSQL.
* **Device limit:** activations are serialised per account by a write to the account row, so simultaneous
  activations cannot exceed the limit, on SQLite and on PostgreSQL.
* **Device keys that prove nothing are refused.** For a small-order Ed25519 public key (for example the all-zero
  key), signatures that verify can be produced without any private key. Such keys are rejected at activation and
  never accepted in a device-signed request.
* **Identifiers are matched exactly.** Account and device ids must be exactly 32 lowercase hex characters.
* **No enumeration:** an unknown account, an unknown device and a wrong key all receive the same answer.
* **Revocation reaches a device in three ways:** the hourly status check, the revocation version on signed-in
  responses, and the daily refresh. Refresh needs no account token, so a device that was offline longer than a
  sign-in session (7 days) still resynchronises.

### What requires the server, and what the server enforces by itself

| Server capability | Endpoints | Enforced on the server |
|---|---|---|
| Account and session | `/auth/*`, `/me`, `/profile` | Account token; suspended and deleted accounts get 401 |
| Plan and entitlements | `/me/entitlements`, `/plans` | Computed from webhook-verified billing state or an admin grant. Nothing sent by the extension or a browser can set a plan |
| Server analysis (opt-in) | `POST /verifications`, `POST /session-verifications` | Account token **and** device proof **and** the monthly quota of the plan (`enforce_quota`) **and** rate limits |
| Results, history, decisions, feedback | `GET /verifications…`, `/feedback` | Account token; only the account's own jobs |
| Licence issue and status | `/licence/*` | Account token (activate) or device signature; the server re-decides plan, policy and device state on every call |
| Support | `/support/*` | Account token; own tickets only |
| Administration | `/admin/*` | Administrator role, checked on every request |
| Research study | `/experiments/*` | Researcher role or participant session |

**Device proof.** Server analysis carries the header `X-TrustCode-Device`:
`<device id>.<unix seconds>.<Ed25519 signature of "tcdev1.<account id>.<device id>.<unix seconds>">`. The server
accepts it for 5 minutes either side of its own time and checks that the device is active for the account of the
bearer token. A removed or blocked device, another account's device, or a copied account token without a device
key gets `403`. `TRUSTCODE_LICENCE_DEVICE_ENFORCEMENT` is `require` (default), `log` (allow and record
`server_call_without_device`, at most once an hour per account; for the period while extensions older than this
change are in use) or `off`. Self-hosted local mode and servers without licensing are not checked. Within the
5-minute window a captured proof can be reused, but only together with the account token.

**Integrity signals.** The extension sends its version and a SHA-256 of its compiled code with activation, status
and refresh. If `TRUSTCODE_LICENCE_KNOWN_BUILDS` lists released builds (`npm run build-hash` prints the entry), a
device reporting another hash, or an unlisted version, is recorded as `unknown_build`, once per change. A device
that stops reporting is recorded as `build_not_reported`. Nothing is ever blocked on these signals: a modified
extension can report any value, and an honest user must not be hurt by a release whose hash was not registered.

### Server-side work that future paid features must depend on (design; not implemented)

No feature differs between plans today, so nothing here is built yet. The rule for the first paid feature:

1. **The valuable work happens on the server.** A paid feature is one whose result the server computes or holds:
   explanations from a language model, analysis that needs server-held rules or data, team policy and shared
   baselines, organisation dashboards. A feature that ships complete inside the extension can be switched on by a
   patched extension and must not be the thing that is sold.
2. **The endpoint decides, per request.** A dependency `require_feature("<feature>")` on top of `licensed_user`
   computes the plan from the subscription state at that moment (`policy_for`), never from a licence the client
   presents. The answer is `403` with a stable code when the plan does not include the feature.
3. **Metering is on the server**, per account and period, like `enforce_quota` today.
4. **Results are bound to the account and short-lived**, so one paying account cannot feed many users for long:
   per-account and per-device rate limits, device proof, and the suspicious-activity view.
5. **The extension only reflects the decision.** `LicenceManager.allows()` hides or shows the feature and explains
   why. It is a convenience for honest users, not a control.

## 8. Tests

Counts are from the run of 2026-11-13 (macOS, Python 3.14.5, Node 20.20.2, PostgreSQL 16.13). The scenario table
with the expected result, the actual result and the test name for each is in
`docs/testing/licence_hardening_report.md`.

* `backend/tests/test_licensing.py`: 14 tests (the suite from before the hardening).
* `backend/tests/test_licensing_hardening.py`: 48 tests, in-process: status call, refusals, counters, input and
  rate limits, revocation version, stop times, deletion, device proof, integrity signals, plan changes, tampered
  tokens, key rotation, enumeration and device-id reuse.
* `backend/tests/test_licence_http.py`: 13 tests, each run on SQLite and on PostgreSQL (26 in total), against a
  real server process on `127.0.0.1:8000` with a throw-away key and a temporary database built by the migrations:
  the migration round trip, a full device life cycle, HTTP-level limits, concurrent activations at the device
  limit, concurrent copies of one request, and the simulated attacks. Without `TRUSTCODE_TEST_POSTGRES_URL` the
  PostgreSQL runs are reported as skipped.
* `scripts/security/licence_attacks.py`: 42 attack attempts against the local server (forged licences, a reused
  device id, replays, removed and blocked devices, enumeration, rate limits). All failed safely; 23 are confirmed
  in the licence history, 11 are refused before the licence code (request log only), 4 never reach the server (a
  forged licence is rejected on the device) and 4 are controls or ordinary requests with nothing to log.
* `extension/test/licence.test.ts` (21 tests) and `extension/test/licence-hardening.test.ts` (75 tests): a fake
  server that signs real Ed25519 licences, with an injected clock, storage and network.
* `extension/test/integration/licence.ts`: 6 scenarios in a real VS Code window while signed out.
* Both concurrency protections were checked with a negative control: with the account lock removed, all four
  simultaneous activations succeeded on both databases; with the counter checked by read-then-write, all six
  copies of one request were accepted on both databases. With the shipped code the tests pass.

**Revocation delay while online, measured** (`extension/test/measure-revocation.ts`, simulated clock, worst case:
the change happens just after the device last heard from the server):

| Change | 1.1.1 | With this change |
|---|---|---|
| Device blocked by an administrator | 24.0 h | 60 min |
| Account suspended | 24.0 h | 60 min |
| Account deleted | 24.0 h | 60 min |
| Any of these, when the extension makes a signed-in request | not noticed | at that request (0 s after the response, 1 extra request) |
| Any of these, at the next start of VS Code | within an hour of startup only if last confirmed over an hour ago | 15 s after startup |

Not tested: Windows and Linux; a real billing provider; load; the status interval on real clocks over hours (the
timing tests use a simulated clock); sign-in and activation inside VS Code against a live server (the extension
only accepts licences signed with the pinned production key, so these run against the fake server).

## 9. Known limitations

* **Client-side checks can be bypassed.** Someone who modifies the installed extension can skip any local check,
  including the status check, and can report any version and build hash. Local analysis (the engine and the
  scanner) then runs without an account. What a modified client cannot do is obtain anything from the server:
  server analysis needs the account, an active device of it and the plan's quota, all checked on the server.
  Because no paid feature exists yet, a bypass currently gains use of the free local analysis without registering.
* **Revocation is not instant.** Online, a stopped device keeps working until its next status check: up to one
  hour by default (the server can set 1–4 hours). Offline, it keeps working until the end of the longest offline
  period ever signed for it, which administrators see as `stops_by`. Shorter offline periods reduce this window; a
  shorter policy does not shorten licences already issued.
* **A device that never contacts the server again** cannot be told anything. It stops at `stops_by`.
* **The device proof is not bound to the request body** and can be reused for 5 minutes, together with the account
  token. It proves possession of an active device key, not the integrity of the client.
* **Clock checks catch only some changes.** Rollback detection notices a clock turned back after TrustCode last
  ran. It cannot detect a clock that was already wrong at the time of the first activation; the server time in
  each licence bounds this.
* **Storage depends on the OS keychain.** SecretStorage uses the OS keychain where VS Code supports one. On Linux
  without a keyring, VS Code may fall back to weaker storage (Linux is untested).
* **Rate limits are per instance.** The in-memory rate limiter is per server instance
  (`docs/project/known_issues.md`), so on several instances the effective limits are higher. A rate-limited
  request is written to the request log, not to the licence history.
* **Every rejected device request writes a history row.** The per-address limit (60 a minute) bounds the growth.
* **Deleted accounts leave no device record.** Only the times at which their devices stop are kept (audit log).
* **The web admin pages do not show the stop times yet.** The API returns them; the website is maintained
  separately.
* **No paid features yet.** Plans can be set by administrators, but no feature differs between plans.
* **The account gate lives in the extension.** Git hooks and the CI scanner run the open-source scanner directly,
  outside VS Code, and are not covered. Hooks that were already installed keep working.
* **Released 1.0.0 builds do not enforce accounts**, and released 1.1.x builds do not send a device proof or make
  status checks. Only builds that include this change do.

## 10. Deployment and key configuration

1. Generate a key: `cd backend && python -m app.admin licence-keygen`. It prints the server seed and the public key.
2. Put the seed in the hosting provider's secret settings as `TRUSTCODE_LICENCE_SIGNING_KEY`, and set
   `TRUSTCODE_LICENCE_KEY_ID` (default `k1`). Never commit the seed. In production, startup fails on a malformed seed.
3. Make sure the public key is in `extension/src/licence/keys.ts` under the same id, then release the extension.
4. Run migrations: `alembic upgrade head` (adds 0006 and 0007).
5. Without a seed, licensing is off. Activation answers 503 and nothing else changes.
6. **Rolling out the device proof.** Extensions up to 1.1.1 send no device proof. Deploy the server with
   `TRUSTCODE_LICENCE_DEVICE_ENFORCEMENT=log` first, release the extension that sends it, watch
   `server_call_without_device` in Admin → Licences, and switch to `require` when it stops appearing. Deploying
   `require` (the default) straight away refuses server analysis from 1.1.1 with "Update TrustCode and sign in".
   Local analysis is not affected either way.
7. **Registering a release build.** After `npm run compile` at release time, `npm run build-hash` prints
   `<version>=<sha256>`. Add it to `TRUSTCODE_LICENCE_KNOWN_BUILDS` (comma separated). Empty = builds not checked.
8. **Settings:** `TRUSTCODE_LICENCE_STATUS_MINUTES` (60; kept within 60–240), `TRUSTCODE_LICENCE_REFRESH_HOURS`
   (24), `TRUSTCODE_LICENCE_DEVICE_RATE_PER_MINUTE` (6), `TRUSTCODE_LICENCE_IP_RATE_PER_MINUTE` (60),
   `TRUSTCODE_LICENCE_ACTIVATE_RATE_PER_MINUTE` (10).
9. **Rotation:** add the new public key under a new id, release the extension, switch the key id and seed on the
   server, and keep the old public key until every licence it signed has passed its offline period (at most 365 days).

`cryptography>=42` is a backend dependency (Ed25519). The extension uses Node's built-in `crypto`.
