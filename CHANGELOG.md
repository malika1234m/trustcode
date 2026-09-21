# Changelog

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
