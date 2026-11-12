# Known Issues / Open Items

| ID | Area | Issue | Impact | Owner | Next step |
|---|---|---|---|---|---|
| KI-001 | Literature | Annotations based on abstracts; full texts not read | Findings may lack nuance; gap could narrow | Student | Read the 12 ★ papers (`literature_review.md` §8) |
| KI-002 | Literature | `fan2026whenhelp` (CHI 2026) findings come only from a search snippet; ACM page returned 403 | Could weaken G3 | Student | Obtain the full text via the library |
| KI-003 | Literature | No direct Scopus/WoS/IEEE Xplore search (no institutional access in this environment) | Review not yet "systematic" | Student | Run the provided search string |
| KI-004 | Literature | 16 preprints cited; publication status may change | Citation accuracy | Both | Re-run `build_outputs.py` and recheck before submission |
| KI-005 | Literature | `sandoval2023lostatc` and `spracklen2024package` cited in arXiv form; published versions (USENIX Security) not yet confirmed | Citation should point to the peer-reviewed version | Claude | Confirm DOIs in Phase 2 |
| KI-006 | Tooling | OpenAlex free daily quota exhausted during the run; fallback to Crossref/arXiv | None (handled) | — | — |
| KI-007 | Process | University deadlines, ethics process, participant pool and citation style unknown | Timeline and design decisions | Student | Provide them before Phase 2 is finalised |
| KI-008 | Benchmark | Ground-truth labels author-defined (LLM-assisted); need independent review | Validity of the main outcome | Student + reviewer | Second rater; record agreement |
| KI-009 | Method | With 4 defective items per condition, H1 power is 0.55–0.94 depending on effect/N | Underpowered study risk | Student | Extend eval split to 32 items or recruit ≥40 |
| KI-010 | Deployment | Worker container sandbox fix (Docker CLI 27) not re-verified; Docker Desktop storage I/O errors (low disk) | Compose stack cannot run tests | Student | Free disk, restart Docker Desktop, re-run check |
| KI-011 | Security | No e-mail verification; in-memory rate limiter; worker holds Docker socket | See threat model T-6, T-8, T-9 | Claude/Student | Before public deployment |
| KI-012 | Product | No in-panel "request additional check" button (re-verification only) | FR-14 partial | Claude | Next iteration |
| KI-013 | Product | No screen-reader audit; JS/TS has 9 built-in static rules but no undefined-name check, no type checker and no coverage | Usability/accessibility | Claude | Next iteration |
| KI-014 | Process | LLM explanations never tested against the real Anthropic API (no key) | Fallback tested only | Student | Test with a key, or keep disabled |
| KI-015 | Repo | `extension/package.json` repository URL is a placeholder | Packaging metadata | Student | Set the real URL |
| KI-016 | Benchmark | Committed evidence snapshots record ruleset digest `abf99b7e4507`; the rules were changed afterwards (TypeScript support) and now hash to `fb963865f3e5`. Findings are identical (regression-tested), only the digest differs | Reproducibility claim of ADR-005 | Student | Decide whether to rebuild the snapshots (`build_benchmark.py`, now pinned to profile `study-v1`) before the study |
| KI-017 | Engine | Extended profile: no TypeScript/JavaScript type checker; mypy optional (absent on the serverless deployment -> "Not run"); no whole-project or data-flow analysis; workspace-wide verification not implemented | Coverage | Claude/Student | See `docs/project/technical_audit.md` |
| KI-018 | Evaluation | Engine accuracy set (89 cases) is author-labelled and was used during rule development | Numbers are a regression signal only | Student | Independent labelling / held-out set (`docs/testing/engine_accuracy.md`) |
| KI-019 | Deployment | Migration `0004` (feedback.rule) must be applied before deploying this backend: `alembic upgrade head`. Existing local SQLite files created by `create_all` need it too | Feedback endpoint fails without the column | Student | Run the migration |
| KI-020 | Environment | The `trustcode-sandbox:0.1` Docker image disappeared from the dev machine during the 2026-11-10 session (disk had 5 GB free) and was rebuilt | Tests report "check failed" until rebuilt | Student | Free disk space; rebuild with the command in the worker README |
| KI-021 | Product | Multi-file verification runs no project tests and has no API-contract or database-schema checks (listed as "not executed" in every report) | "Does the feature work" is not answered | Claude/Student | Needs a project-level sandbox design; see `docs/project/session_tracking_report.md` |
| KI-022 | Product | Agent completion is confirmed only via a user-installed hook (documented for Claude Code, not run inside Claude Code); Copilot and Cursor rely on the inactivity estimate | Auto-verify timing | Student | Try the hook in a real Claude Code session |
| KI-023 | Deployment | Extension 0.6.0 needs the new `/session-verifications` endpoint; the hosted server must be redeployed | Session verification fails against the old server | Student | Redeploy backend |
| KI-024 | Scanner | The Security tab needs the Python scanner installed locally (`trustcode-scan`); without it nothing is scanned (stated in the UI) | Extension users need Python | Student | Decide whether to ship a bundled binary |
| KI-025 | Scanner | Semgrep, Bandit (optional), the built-in rules and the opt-in OSV lookup are integrated. Gitleaks, TruffleHog, Trivy, pip-audit, npm audit, CodeQL, Checkov are not | Coverage | Claude/Student | Integrate and test one at a time |
| KI-026 | Scanner | Accuracy set (96 cases) was written together with the rules; perfect scores there are not real-world accuracy | Claims | Student | Evaluate on an external corpus (`docs/testing/security_scanner_accuracy.md`) |
| KI-027 | Scanner | Not detected: object-level authorization, rate limiting, input validation, cross-file data flow, most IaC rules; research rules TC-REG-001/003/005-009 not implemented | Coverage | Claude | See `docs/security_scanner.md` |
| KI-028 | Scanner | The OSV advisory lookup was verified once against the live service (2026-11-12); automated tests use a stub | Dependency check | — | — |
