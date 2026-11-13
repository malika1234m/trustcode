# Changelog

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
