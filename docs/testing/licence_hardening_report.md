# Licence hardening: test report

Run on 2026-11-13, macOS (Apple silicon), Python 3.14.5, Node 20.20.2, PostgreSQL 16.13 (a throw-away local
cluster; Docker was not running), VS Code 1.146.0 (test build). Everything ran against local servers with a
throw-away signing key and temporary databases. Nothing was run against production. Released in extension 1.2.0.

How the system works is in `docs/LICENSING.md`. This file records what was tested and what came out.

## Results

| Suite | Command | Result |
|---|---|---|
| Backend, all tests | `cd backend && TRUSTCODE_TEST_POSTGRES_URL=postgresql://…/…_test ../.venv/bin/python -m pytest tests` | **157 passed, 1 skipped** (the skip is `test_workflow_c_logical_defect`, which needs the Docker sandbox and is unrelated to licensing) |
| of which licence tests | `tests/test_licensing.py`, `test_licensing_hardening.py`, `test_licence_http.py` | 14 + 48 + 26 passed (13 real-HTTP tests, each on SQLite and PostgreSQL) |
| Backend without PostgreSQL | same, without `TRUSTCODE_TEST_POSTGRES_URL` | the 13 PostgreSQL runs are reported as **skipped**, not passed |
| Extension unit tests | `cd extension && npm test` | **186 passed**, 0 failed (21 in `licence.test.ts`, 75 in `licence-hardening.test.ts`) |
| Extension in a real VS Code, signed out | `TRUSTCODE_TEST_MODE=licence node out/test/integration/run.js` (or `scripts/e2e/run_vscode_integration.sh licence`) | **11 passed** (5 general, 6 licence scenarios) |
| Simulated attacks | `scripts/security/licence_attacks.py`, run by `test_simulated_attacks_all_fail_safely_and_are_logged` | **42 of 42 attempts failed safely**, on SQLite and on PostgreSQL |

Not run: the older VS Code integration modes (`default` with a backend, `session-git`, `session-nogit`, `security`,
the engine modes). They were written before an account became mandatory and were not re-run in this work.

## Defects found by these tests and fixed

| # | Found by | Defect | Fix |
|---|---|---|---|
| 1 | `evaluate: after the offline period no licence is usable…` | A device with a paid-plan licence whose paid period had ended stayed usable on the Free plan for ever offline, also after it was removed or its account suspended. The paid period was checked before the offline period. Present in 1.1.0 and 1.1.1; no account had a paid plan | `extension/src/licence/state.ts`: the offline period is checked first |
| 2 | `test_device_keys_that_anyone_could_sign_for_are_refused` | Activation accepted small-order Ed25519 public keys. With the all-zero key, an all-zero signature verified for 110 of 400 messages (measured). Impact was limited to the account that registered such a key | `signing.usable_device_key`: such keys are refused at activation and in every device-signed request |
| 3 | `test_malformed_oversized_and_invalid_requests_are_rejected` | Identifiers were matched with `$`, which also accepts a trailing newline | `\A…\Z` in `api/licence.py` and `licensing/service.py` |
| 4 | `test_concurrent_revocation_version_changes_are_not_lost` | Two administrators saving a licence policy for the same account at the same moment: one request failed with a server error (duplicate policy row) | `admin_set_policy` takes the account row first |
| 5 | `test_a_billing_event_replaces_an_admin_plan…` | After a billing event replaced an admin-set plan, the subscription was still marked as an administrator's grant (no renewal grace, wrong reason shown) | `billing/subscriptions.py`: a billing event never leaves or sets provider `admin` |
| 6 | Code review, confirmed by the negative controls below | The device limit and the replay counter were protected by `SELECT … FOR UPDATE`, which SQLite ignores (development and self-hosted servers). The old code was not re-measured; the controls show that without a working protection both races succeed on both databases | A write to the account row serialises activations; the counter is advanced with one conditional `UPDATE` |

## Revocation delay, before and after (measured)

`extension/test/measure-revocation.ts`, simulated clock, the same scenario run against the licence manager of
1.1.1 and the current one. Worst case: the change happens just after the device last heard from the server.

| Change while online | 1.1.1 | Now | Requests until it stopped |
|---|---|---|---|
| Device blocked by an administrator | 1440 min (24.0 h) | 60 min | 1 |
| Account suspended | 1440 min (24.0 h) | 60 min | 1 |
| Account deleted | 1440 min (24.0 h) | 60 min | 1 |

| Other paths | Measured |
|---|---|
| The extension makes any signed-in request after the change (revocation version) | stopped 0 s after the response, 1 extra request |
| VS Code is started after the change | stopped 15 s after startup |
| Nothing changed for 24 hours online | 23 status calls + 1 refresh; the revocation version adds no request |
| Offline | until the end of the offline period (30 days by default), shown to administrators as `stops_by` |

## Concurrency: proof and negative controls

| Protection | Test | Shipped code | With the protection removed (control) |
|---|---|---|---|
| Device limit under simultaneous activations (4 new devices, 1 free slot, 4 rounds) | `test_concurrent_activations_never_exceed_the_device_limit` | SQLite and PostgreSQL: exactly one `200`, three `409`, 3 active devices | Lock removed: all four activations returned `200` on SQLite and on PostgreSQL (test fails) |
| Replay counter (6 copies of one request, each in its own transaction, 5 rounds, 3 operations) | `test_copies_of_one_request_in_separate_transactions_only_one_is_accepted` | SQLite and PostgreSQL: exactly one accepted, five `replayed_request` | Read-then-write counter: all six copies accepted on both databases (test fails) |
| The same over HTTP (5 copies, 3 rounds) | `test_two_copies_of_one_request_at_the_same_instant_only_one_is_accepted` | one `200`, four `401 replayed_request` | Does not detect the control: one server process handles these requests one after another. Kept as an end-to-end check only |
| Simultaneous activations of one new device | `test_concurrent_activations_of_one_new_device_create_one_device` | four `200`, one device row, one current licence | not run |
| Six simultaneous policy changes | `test_concurrent_revocation_version_changes_are_not_lost` | six `200`, revocation version 6 | found defect 4 |

## Scenario table

Every row passed in the run above; "Actual" is what the test observed.

### Backend (`backend/tests/`)

| Scenario | Expected | Actual | Test |
|---|---|---|---|
| First activation | Signed licence, Free, 30 offline days | as expected | `test_first_activation_issues_a_signed_licence` |
| Re-activation of the same device | New licence, old one superseded, still one device | 1 active device, 1 current licence, 2 `activated` events | `test_first_activation_then_reactivation_of_the_same_device` |
| Device limit | 4th device refused | `409 device_limit_reached` | `test_device_limit_and_deactivation` |
| Two concurrent activations at the limit | Exactly one succeeds | one `200`, three `409` (SQLite, PostgreSQL) | `test_concurrent_activations_never_exceed_the_device_limit` |
| Status: valid | `ok`, nothing issued | `refresh: false`, licence count unchanged | `test_status_is_cheap_and_reports_whether_the_licence_is_current` |
| Status: licence no longer current | Told to refresh | `refresh: true`, version + 1 after a plan change | same |
| Refresh, status, release: wrong signature | Refused, logged | `401 device_not_recognised`, `signature_rejected` | `test_device_signed_calls_reject_bad_signatures_replays_and_unknown_devices[…]` |
| …replayed or lower counter | Refused, logged | `401 replayed_request`, `replay_rejected` | same |
| …unknown device | Refused | `401 device_not_recognised` | same |
| …two concurrent identical requests | One accepted | one accepted, the rest `replayed_request` | the two tests in the concurrency table |
| Refresh, status: deactivated, revoked, suspended, deleted | Refused; restored account works again | `403 device_deactivated`, `403 device_revoked`, `403 account_suspended`, `401 device_not_recognised` | `test_removed_blocked_suspended_and_deleted_accounts_are_refused[…]` |
| Release on a removed or blocked device | Nothing regained | status unchanged; blocked device stays blocked | `test_release_only_ever_gives_an_activation_up` |
| Counters that are not a fresh integer (booleans, 0, negative, fractions, text, 2^62, 2^63, 10^30) | Refused without a server error | `401 replayed_request`; device still works | `test_counters_that_are_not_a_fresh_integer_are_refused_without_an_error[…]` |
| Malformed JSON, wrong types, invalid ids, trailing newline, SQL text in ids | `400` | `400 bad_request` | `test_malformed_oversized_and_invalid_requests_are_rejected[…]` |
| Oversized body, declared or sent in chunks | `413` | `413` | same; `test_http_level_limits` |
| Captive-portal HTML, wrong method | `400`, `405` | as expected | `test_http_level_limits` |
| Invalid activation input | `422`; control characters removed from names | as expected | `test_activation_input_is_validated` |
| Weak device keys (9 encodings) | Refused at activation and in requests | `422`; 0 of 40 zero signatures accepted | `test_device_keys_that_anyone_could_sign_for_are_refused` |
| Rate limits with the shipped defaults | 6 per device and operation, 10 activations per account, 60 device requests per address | 7th `429` with `Retry-After`; 11th activation `429`; 61st request `429` | `test_rate_limits_per_device_per_account_and_per_address` |
| One device's allowance used up from another address | The real device is not locked out | `200` | `test_rate_limit_of_one_device_cannot_be_used_up_from_another_address` |
| Revocation version | On signed-in responses only; grows on every change | grew after policy, admin plan, billing event, device removed, device blocked, suspend, restore | `test_revocation_version_is_returned_with_signed_in_responses_and_grows_on_every_change` |
| Admin revokes a device | Exact stop time recorded and shown | `stops_by` = end of the offline period, `stops_in_seconds` ≈ 30 days, listed under `stopping=true` | `test_admins_see_when_a_blocked_device_will_at_the_latest_stop` |
| Policy shortened after a long licence | Stop time is the longest period ever signed | 90 days, not 7 | `test_stop_time_is_the_longest_offline_period_ever_signed_for_the_device` |
| Admin suspends, then restores | Stop time per device; cleared on restore | 2 devices with `stops_by`, audit entry, cleared | `test_suspension_records_a_stop_time_for_every_device_and_restoring_clears_it` |
| Account deletion | Devices, licences and history erased; only stop times kept | 0 rows left; audit entry has 2 times and no identifier | `test_account_deletion_erases_devices_licences_and_history_and_keeps_only_stop_times` |
| Server analysis without a device, with a foreign, forged, expired or malformed proof | Refused, logged | `403 device_proof_required` / `device_not_recognised` / `device_proof_expired`, `server_call_refused` | `test_server_analysis_needs_the_account_and_an_active_device_of_that_account` |
| Server analysis from a removed or blocked device | Refused | `403 device_deactivated`, `403 device_revoked` | `test_a_removed_or_blocked_device_gets_no_server_analysis` |
| `log` and `off` modes; servers without licensing | Allowed; `log` records once an hour | 1 event for 2 calls | `test_log_mode_lets_older_extensions_through_and_records_it_once_an_hour`, `test_servers_without_licensing_do_not_ask_for_a_device` |
| Unknown build, unlisted version, build no longer reported | Logged as suspicious, never blocked | `200` each time; `unknown_build` once per change; `build_not_reported` | `test_unknown_builds_are_logged_as_suspicious_and_never_blocked` |
| Admin plan: open-ended | Paid for as long as the device confirms | `paid_until` = `offline_until` | `test_admin_plan_open_ended_with_an_end_date_expired_and_past_dates` |
| Admin plan: with an end date | Ends with that day | `paid_until` = 23:59:59 UTC of the date | same |
| Admin plan: end date passed | Free | Free, `paid_until` null | same |
| Admin plan: past, impossible date, unknown plan, non-admin caller | Rejected | `422`, `422`, `422`, `403` | same |
| Billing event replaces an admin plan | Billing rules apply | Pro, `paid_until` = period end + 3 days, no longer marked as a grant | `test_a_billing_event_replaces_an_admin_plan_and_paid_until_never_exceeds_it` |
| `paid_until` never exceeds the plan | Through renewal, cancellation, refund, dispute, expiry | matched the subscription at each of 7 steps | same |
| Tampered tokens (24 variants: payload edited, signature swapped, key id changed or removed, prefix or algorithm changed, truncated, empty, …) | All rejected | all rejected | `test_tampered_tokens_are_all_rejected` |
| Key rotation | Old key still verifies; new key signs; unknown key id rejected | as expected | `test_key_rotation_old_key_still_verifies_new_key_signs_unknown_key_is_rejected` |
| Enumerating user ids | One identical answer | identical status and body in 5 cases × 3 operations | `test_user_and_device_ids_cannot_be_enumerated[…]` |
| Reusing another account's device id | Gains nothing | own account only; victim unaffected | `test_reusing_another_accounts_device_id_gains_nothing` |
| Licence and admin endpoints without the right account | `401` / `403` | as expected | `test_licence_history_and_admin_endpoints_need_the_right_account` |
| Migrations 0001–0007, down to 0006, up again | Clean on both databases | clean on SQLite and PostgreSQL | `database` fixture, `test_migrations_build_the_licence_schema` |
| Full life cycle over HTTP with the shipped defaults | Works; server analysis needs the device | as expected | `test_activate_status_refresh_release_over_http` |

### Extension (`extension/test/licence-hardening.test.ts` unless noted)

| Scenario | Expected | Actual | Test |
|---|---|---|---|
| First start with no account | Blocked, no network call | blocked, 0 calls | `startup: first start with no account is blocked and makes no network call, now or later` |
| Sign in, activate, use every feature | Usable | usable | `startup: sign in, activate, then every feature is available` |
| Restart offline | Decided locally, 0 calls | 0 calls | `startup: restart offline is decided locally with zero network calls` |
| Status at startup | 15 s after start, not during it | 15 s | `startup: the status is confirmed 15 seconds after start, not during it` |
| Window reload | No call | 0 calls | `startup: a window reload within a few minutes of the last answer makes no call` |
| Offline 1, 24, 25, 29, 30, 31 days | Works; warning from 5 days before; blocked after 30 | offline, offline, expiring_soon, expiring_soon, blocked, blocked | `offline for N days: …` |
| Online again after 1–400 days | Refreshed, no new sign-in | refreshed | `online again after N days offline: refreshed without a new sign-in` |
| Per-account offline period | Honoured | 7 days | `a per-account offline period from the server is honoured (7 days)` |
| Paid plan ended while offline | Free until the offline period ends, then blocked | as expected (defect 1) | `paid plan that ended while offline: …`, `paid plan, device removed while offline: …`, `evaluate: after the offline period no licence is usable…` |
| Clock turned back | Blocked until confirmed online | blocked, then repaired | `clock turned back: …`, `clock turned back before the licence was issued is blocked (signed issue time)` |
| Clock turned forward, then corrected | Repaired by the next online check | repaired | `clock turned forward and then corrected: …` |
| Clock a few minutes fast | Tolerated | tolerated | `clock a few minutes fast and then corrected is tolerated (10 minute tolerance)` |
| Time zone change | No effect | no effect | `time zone change does not affect the licence` |
| Daylight-saving change | Exact elapsed time; repeated hour is not a rollback | as expected | `daylight-saving change: …` |
| Revocation, suspension, deletion while online | Stops at the next check | 60 min each | `MEASURED revocation while online (…)` |
| Noticed on existing traffic | No waiting | 0 s, 1 request | `MEASURED revocation noticed on traffic the extension already makes (revocation version): no waiting` |
| Noticed at the next start | 15 s | 15 s | `MEASURED revocation noticed at the next start: 15 seconds after startup` |
| Traffic when nothing changes | One status call per interval, one refresh a day | 23 + 1 | `MEASURED traffic when nothing changes: …` |
| Revocation version unchanged / changed | 0 requests / exactly 1 refresh | as expected | `revocation version: nothing changed means no request; a change means exactly one refresh` |
| A 401 on a signed-in request | One status check, at most one a minute | as expected | `a signed-in request refused as unauthorised triggers one status check (at most one a minute)` |
| Older server without the status call | Daily refresh only | no hourly traffic | `a server from before the status call: falls back to the daily refresh, without hourly traffic` |
| Revocation while offline | Works until the offline period ends, then stops | as expected | `revocation while offline: …` |
| Licence edited in storage | Rejected | rejected | `storage: an edited licence is rejected` |
| Licence copied from another device | Rejected | rejected, with or without that device's key | `storage: a licence copied from another device is rejected, …` |
| Device key deleted | Sign in again | sign-in required; new activation works | `storage: device key deleted means sign in again; a fresh activation works` |
| Corrupted storage (6 forms) | No error | handled | `storage: corrupted licence record (…) is handled without an error` |
| SecretStorage unavailable | Never throws | blocked until sign-in, then this session only | `storage: SecretStorage unavailable never throws; …` |
| Tampered tokens | Rejected | rejected | `tampered tokens are all rejected by the extension` |
| Key rotation | As on the server | as expected | `key rotation: …` |
| Timeout, 500, 503, 429, DNS failure, captive portal, connection dropped; during a status check and during a refresh | Licence kept, one retry after about a minute | as expected in all 14 cases | `network fault during a …: … keeps the licence and retries with back-off` |
| Captive portal answering 200 | Licence neither dropped nor replaced | kept | `a captive portal cannot make the extension drop its licence or accept a fake one` |
| Repeated failures | 1, 2, 4 … minutes up to 6 hours, one pending retry | as expected | `repeated failures back off (…) with a single pending retry` |
| Nothing blocks startup | Loaded without waiting for the network | loaded while the network never answered | `the licence is loaded without waiting for the network, even when the network never answers` |
| Notifications | One per state per day, also when states alternate | as expected | `notifications: at most one per state per day, also when states alternate` |
| No call when not due | 0 calls | 0 calls | `no network call when the licence is not yet due` (`licence.test.ts`) |
| Device proof and API hooks | Signed for this account and time; added to server analysis only | as expected | `device proof: …`, `API client: …` |
| Build hash | Stable; changes with any file | as expected | `build hash: …` |

### Extension in a real VS Code window, signed out (`extension/test/integration/licence.ts`)

| Scenario | Expected | Actual |
|---|---|---|
| First start with no account | Not usable, no device proof | `sign_in_required`, not usable |
| 15 feature commands (verify, session, scans, hooks, engine setup) | None runs | no session, scan or verification started; no Git hook written; document unchanged |
| Open commands (account, licence check, clear findings, forget consent) | Work | worked; the licence did not become usable |
| Startup scan | Does not run | no scan after 5.5 s |
| Agent signal with auto-start on | No session | none started |
| Session restored after a restart | File watcher not attached; files not read | not attached; a new file was not tracked; no verification ran |
| Account confirmed again, then lost | Tracking resumes, then stops at once | resumed and caught up; watcher detached, later file not tracked |

Signing in and activating inside VS Code were not exercised: the extension only accepts licences signed with the
pinned production key. The confirmed and lost states were simulated through the call the extension itself makes.

### Simulated attacks (`scripts/security/licence_attacks.py`, against the local server)

| Attack | Attempts | Result | Logged |
|---|---|---|---|
| 1. Forge a licence without the private key | 7: edited payload with the old, the attacker's own, no and an all-zero signature; forged licence as an account token; asking for a licence with the attacker's key | none verifies; `401` each | `signature_rejected` for the request; the forged licences are rejected on the device and never reach the server; the `401`s are in the request log |
| 2. Reuse another user's device id | 7 | becomes a device of the attacker's own account only; `401 device_not_recognised` for the victim's account; `403` for server analysis; the victim is unaffected | `signature_rejected`, `server_call_refused` |
| 3. Replay captured requests | 6: status, refresh, release, a late request, an old and a future-dated device proof | `401 replayed_request`; `403 device_proof_expired` | `replay_rejected`, `server_call_refused` |
| 4. Removed, blocked or expired device | 12 | `403 device_deactivated`, `403 device_revoked`, `403 device_proof_required`; `401` for an expired or unsigned account token; `404` for another account's device | `status_refused`, `refresh_refused`, `server_call_refused`, `activation_refused` |
| 5. Enumerate user ids | 6 | identical answers for unknown and real accounts in all three operations; the same `403` and `404` for real and made-up ids | `signature_rejected` (without an account id for unknown devices) |
| 6. Hit the rate limits | 4: 20 status checks, 15 activations, 80 requests with made-up ids | 6 answered then `429`; 7 activations rate limited; 15 more answered then `429` (60 in total for the address) | request log only: a rate-limited request is answered before the licence code |

42 attempts in total: 23 confirmed in the licence history, 11 in the request log only, 4 rejected on the device,
4 controls or ordinary requests. The script refuses any address that is not this computer.

## Changes, file by file

| File | Change | Reason |
|---|---|---|
| `backend/migrations/versions/0007_licence_revocation.py` | `users.licence_rev`; `licence_devices.stops_by`, `stop_reason`, `ext_version`, `build_hash`, `last_seen_at` | Revocation version, stop times, integrity signals |
| `backend/app/models.py` | The same columns | — |
| `backend/app/config.py` | Status interval, device enforcement mode, known builds, three rate limits | Configurable without code changes; an invalid mode stops a production start |
| `backend/app/licensing/service.py` | `status`, `device_proof`, `bump_rev`, stop times, `note_build`; atomic replay counter; portable activation lock; exact-match ids | Shorter revocation delay; server analysis bound to a device; defects 3 and 6 |
| `backend/app/licensing/signing.py` | `usable_device_key`, `verify_with_keys` | Defect 2; key rotation checks |
| `backend/app/api/licence.py` | `POST /licence/status`; `rev` in answers; `stopping` filter and stop times for admins; rate limits keyed by address and device; policy change takes the account row first | New call; admins see when a device stops; defect 4 |
| `backend/app/deps.py` | `licensed_user`; revocation version on signed-in responses | Device proof; revocation on existing traffic |
| `backend/app/main.py` | `X-TrustCode-Licence-Rev` header; stable error codes for coded refusals | — |
| `backend/app/api/routes.py` | Server analysis uses `licensed_user`; deletion records stop times | — |
| `backend/app/api/saas.py` | Plan change and suspension bump the version; suspension returns stop times | — |
| `backend/app/billing/subscriptions.py` | Billing events bump the version; a billing event is never an admin grant | Defect 5 |
| `backend/tests/conftest.py` | Device enforcement `off` for the older API tests | They submit code without a device; enforcement is tested on its own |
| `backend/tests/licence_helpers.py`, `test_licensing_hardening.py`, `test_licence_http.py` | New | The tests above |
| `scripts/security/licence_attacks.py` | New | Simulated attacks |
| `extension/src/licence/manager.ts` | Status checks, revocation version, device proof, storage faults never throw, stored state sanitised on load, fallback for older servers | Shorter revocation delay; robustness |
| `extension/src/licence/state.ts` | Offline period checked before the paid period; `noticeDue` | Defect 1; one notification per state per day |
| `extension/src/licence/device.ts`, `token.ts`, `build.ts` | Device proof; request extras; `rev` and `check_after`; build hash | — |
| `extension/src/api.ts`, `extension.ts` | Hooks for the revocation version, the device proof and 401s; restored sessions follow the licence | — |
| `extension/src/session/controller.ts` | `setLicensed`: no watcher and no reading of files without a confirmed account | Background work stays blocked |
| `extension/scripts/build-hash.js`, `package.json` | `npm run build-hash` | Registering a release build |
| `extension/test/licence-fake.ts`, `licence-hardening.test.ts`, `measure-revocation.ts`, `integration/licence.ts`, `integration/suite.ts`; `scripts/e2e/run_vscode_integration.sh` | New tests; mode `licence` | — |
| `docs/LICENSING.md`, `docs/TRUSTCODE_TRUST_AND_PRIVACY.md` | Rewritten sections; the new traffic | — |

## Remaining limitations

The full list is in `docs/LICENSING.md` section 9. The ones that matter most:

1. A modified extension can skip every local check and then runs the free local analysis without an account. It
   gains nothing from the server.
2. Online, a stopped device keeps working for up to one hour (the status interval). Offline, until its `stops_by`.
3. The integrity signals are self-reported and can be forged. They detect careless modification only.
4. Rate limits are per server instance, and rate-limited requests are not in the licence history.
5. Not tested: Windows, Linux, a real billing provider, load, real-time (not simulated) intervals, activation
   inside VS Code against a live server, and the older VS Code integration modes after the account gate.
6. The website's admin pages do not show the stop times yet, and one sentence there still says devices pick up a
   plan "within about a day". The website is maintained separately and was not changed.
7. Deploying the server before the new extension is released needs `TRUSTCODE_LICENCE_DEVICE_ENFORCEMENT=log`,
   otherwise server analysis from 1.1.1 is refused (`docs/LICENSING.md` section 10).
