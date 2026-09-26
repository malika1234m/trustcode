# Chapter 5 — Implementation

5.1 **Verification engine** (`verification-worker/`): language detection; syntax (Python `ast`, `node --check`); ruff (E9, F, B);
Semgrep with a frozen 21-rule ruleset carrying CWE/OWASP metadata and three-level explanation hints; dependency-existence check;
sandboxed test execution with coverage-derived "not verified" areas.
5.2 **Sandbox:** Docker, no network, read-only root FS, untrusted tests as uid 65534 in a killed process group, nonce-authenticated
results, 1 MB output cap. Hardened iteratively in response to automated security review (test report S-1…S-6) — a useful
illustration for the dissertation of designing for adversarial AI-generated code.
5.3 **Backend** (`backend/`): FastAPI, SQLAlchemy, Alembic; JWT with rotating refresh tokens; local mode with per-install secret;
DB-backed job queue; request ids; logs without code.
5.4 **Explanation and adaptation:** deterministic templates (7 fields × 3 levels); invariance enforced by tests; optional LLM
wording (`claude-opus-5-5`, structured output) accepted only for existing finding IDs and rejected if it claims safety/correctness.
5.5 **Extension** (`extension/`): zero runtime dependencies; consent modal; progress and cancellation; strict-CSP webview; study mode.
5.6 **Research mode:** counterbalancing, frozen evidence snapshots, event logging, pseudonymous export.
5.7 **Deployment:** `deployment/README.md`, `deployment/status.md`.
Code metrics and screenshots: **[to add]**.
