# Changelog

## [1.2.0] — 2026-11-14
### Security
- Licences: a removed, blocked, suspended or deleted account now stops the extension within an hour while online
  (was about a day), 15 seconds after a restart, and at once on any signed-in request. New device-signed
  `POST /licence/status`, a revocation version on signed-in responses (`X-TrustCode-Licence-Rev`), and stop times
  for administrators (migration `0007`).
- Server analysis requires proof of an active device of the account (`X-TrustCode-Device`;
  `TRUSTCODE_LICENCE_DEVICE_ENFORCEMENT` = require | log | off).
- Fixed: a device whose paid plan had ended stayed usable offline without limit; small-order device keys were
  accepted; identifiers accepted a trailing newline; concurrent policy changes could fail; the webview nonce used
  `Math.random()`.
- Integrity signals (extension version and build hash) are logged, never enforced.
### Changed
- Security scanner 1.1: ordinary project code is no longer reported (test-framework imports, `assert` in tests,
  `process.exit` in scripts, names that only mention a secret, rule definitions, ignored `.env` files, non-security
  randomness). On this repository: 991 findings before, 36 after; the labelled benchmark gained 22 cases
  (98/98 detected, 0 false positives on 62 safe files).
- Clicking a finding card opens the file at the reported line.

## [1.1.1] — 2026-11-13
### Fixed
- Extension Account tab and setting description still described the account as optional.

## [1.1.0] — 2026-11-13
### Changed
- A TrustCode account is required to use the extension (still free). Nothing runs without a valid licence.
### Added
- Offline licences: Ed25519-signed by the API, verified in the extension, refreshed in the background with
  device-signed requests; device management, admin licence policy and revocation, admin plan changes.
  Migration 0006. See `docs/LICENSING.md`.

## [1.0.0] — 2026-11-13
### Changed
- Verify and Session analysis moved from the server to a local engine (`trustcode_worker.local`), installed by the
  extension into a private environment after consent. The server is optional. See `docs/LOCAL_ENGINE_ARCHITECTURE.md`.
- Report wording and adaptation rules moved from the backend into the engine package (`trustcode_worker/present`)
  so both produce identical reports; the backend modules re-export them.
### Added
- Subscription lifecycle with signed, idempotent billing webhooks (no payment provider connected), entitlement
  endpoint, update checking with checksum-verified installation, Trust and privacy documentation.
### Not done
- Load test of the server; Windows/Linux installation test; pinned dependency hashes for the engine.

## [0.1.0] — 2026-11-03 (research prototype; not yet the frozen experiment version)
### Added
- Phase 1–2 research: verified literature review (84 references), gap analysis, RQs/hypotheses, novelty, feasibility, scope.
- Verification engine: syntax, ruff, Semgrep (21 frozen rules), dependency check, Docker sandbox with coverage gaps.
- Backend API: auth (JWT, rotating refresh, local mode), DB job queue + worker, explanations (3 levels, invariant evidence,
  optional validated LLM wording), adaptation, decisions, feedback, experiment mode, pseudonymous export, Alembic migrations.
- VS Code extension 0.1.0 (VSIX), benchmark v1 (20 items), Docker Compose, CI workflow, research protocol drafts,
  power simulation, analysis pipeline, dissertation draft, presentation materials.
### Security
- Hardened after automated review: separate uid + process-group kill + nonce for sandbox results; 1 MB output cap;
  no role at registration; admin-created researchers; local-mode secret + Host/Origin checks; strict auth rate limit.
### Fixed
- Rate-limit lockout during status polling (found by e2e); worker image Docker CLI too old for current daemons (fix not yet re-verified).
