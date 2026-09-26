# Architecture Decision Records

| ADR | Decision | Rationale | Consequences |
|---|---|---|---|
| ADR-001 | Monorepo: `extension/`, `backend/`, `verification-worker/`, `datasets/`, `research/` | One versioned artefact for the dissertation; shared evidence model | Python packages installed editable in dev |
| ADR-002 | Evidence model has per-check status and scope; **no aggregate score** | Literature: confidence scores/explanations alone mis-calibrate (RD-002) | UI must teach users to read scoped evidence |
| ADR-003 | Tests execute only in an ephemeral Docker sandbox started by a separate worker; input via stdin; tests as a different uid | Brief's security rules; security review findings S-1..S-2 | Worker needs Docker access (T-9); PaaS hosting needs a VM for the worker |
| ADR-004 | Invoke Semgrep via `pysemgrep` with the current interpreter | pip launcher shebang breaks on paths with spaces | `TRUSTCODE_SEMGREP_CMD` override available |
| ADR-005 | Frozen local Semgrep ruleset (21 rules) versioned in repo, digest recorded with each result | Experimental reproducibility; offline operation | Narrower coverage than registry rules (disclosed in scope text) |
| ADR-006 | Database table as job queue (no Redis/Celery) | Small scale; fewer moving parts; `SKIP LOCKED` on PostgreSQL | Polling latency ~1 s |
| ADR-007 | Deterministic template explanations are primary; LLM optional and validated | Explanations raise over-reliance (Bansal 2021; Kim 2025); reproducibility; cost/privacy | LLM wording is a product feature, not used in the experiment |
| ADR-008 | Experiment shows frozen evidence snapshots; both conditions get the same assistant explanation | Isolates the evidence layer as the manipulated variable | Live verification is not part of the main study |
| ADR-009 | Extension has zero runtime dependencies; strict-CSP webview | Supply-chain risk; Marketplace review | Hand-written HTML renderers (unit-tested escaping) |
| ADR-010 | Python 3.12 slim base shared by sandbox/API/worker images | Disk and pull time | Runtime differs from dev venv (3.14) — CI uses 3.12 |
| ADR-011 | In-memory rate limiter | Single-instance deployment | Must move to shared store before horizontal scaling |
