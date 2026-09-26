# Deployment Status (2026-11-03)

| Environment | Status | Evidence |
|---|---|---|
| Local development (API + separate worker + Docker sandbox, SQLite) | ✅ Verified | `scripts/e2e/run_e2e.sh`: 15/15 steps |
| Docker Compose (PostgreSQL + API + worker) | 🟡 **Partly verified** | API healthy; Alembic migration `0001` applied on PostgreSQL 16 (12 tables); registration and job processing by the worker container worked; code/tests purged (`t|t`); DB port not published. **Sandbox tests from the worker container failed** ("Tests could not be executed", reported honestly as check_failed) because Debian's Docker CLI 20.10 is too old for Docker 29 |
| Fix for the above | ⏳ Applied, **not re-verified** | `Dockerfile.worker` now copies the official Docker 27 CLI. Re-verification was blocked: Docker Desktop's storage began returning I/O errors (the disk had about 1 GB free). **Action: free disk space, restart Docker Desktop, then `docker compose up -d --build` and repeat the check in deployment/README.md §B** |
| Production cloud (Vercel + Neon Postgres) | ✅ **Live** at https://trustcode-api.vercel.app (2026-11-09) | Health OK with database; migration 0001 applied on Neon; live smoke test via the extension's API client: register → verify Python (pyflakes + Semgrep SQLi) and JavaScript (Semgrep eval) → explanations → account deletion. Unit-test execution disabled by design on Vercel |
| Extension distribution | ✅ Installable package | `extension/trustcode-0.1.0.vsix` (private distribution); not published to the Marketplace (needs a publisher account and a privacy review) |
| CI | ✅ Configured, ⏳ never run | `.github/workflows/ci.yml`; runs once the repository is pushed to GitHub |
