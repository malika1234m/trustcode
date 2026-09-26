# Deployment

## A. Local development (verified 2026-11-03)
```bash
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements-dev.txt -e verification-worker
docker build -t trustcode-sandbox:0.1 verification-worker/trustcode_worker/sandbox/image
cd backend && TRUSTCODE_LOCAL_MODE=true ../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
# separate terminal (production-like): TRUSTCODE_WORKER_MODE=queue ../.venv/bin/python -m app.worker_main
```
Install the extension: `code --install-extension extension/trustcode-0.1.0.vsix`. Local mode reads `~/.trustcode/local-secret`.

## B. Single host / VM with Docker Compose (staging and production for the study)
```bash
cp .env.example .env    # set POSTGRES_PASSWORD, TRUSTCODE_JWT_SECRET (openssl rand -hex 32)
docker compose --profile build build sandbox-image
docker compose up -d --build
docker compose exec api python -m app.admin create-researcher you@uni.example
```
Put a TLS reverse proxy (Caddy or nginx) in front of `127.0.0.1:8000`; it must **overwrite** (not append) `X-Forwarded-For`.
Set `TRUSTCODE_TRUSTED_PROXIES` to the proxy's address as seen inside the api container (for a host proxy: the bridge gateway,
`docker network inspect trustcode_default -f '{{(index .IPAM.Config 0).Gateway}}'`). The API refuses to start in production with an
empty, `*` or loopback value. The database is not published.
**Recommended host:** a university VM or small cloud VM (2 vCPU, 4 GB RAM). The worker needs the Docker socket (threat T-9):
use a dedicated VM and ideally rootless Docker.

## C. Vercel (live: https://trustcode-api.vercel.app)
Serverless deployment of the API with Neon Postgres (Vercel Marketplace). Entry point `api/index.py`, config `vercel.json`,
runtime deps `requirements.txt`, uploads limited by `.vercelignore`.
```bash
vercel link --project trustcode
vercel integration add neon --name trustcode-db        # provides DATABASE_URL (accept Neon terms once in the browser)
openssl rand -hex 32 | vercel env add TRUSTCODE_JWT_SECRET production
printf production | vercel env add TRUSTCODE_ENV production
printf sync  | vercel env add TRUSTCODE_WORKER_MODE production   # analyse inside the request (no background worker)
printf false | vercel env add TRUSTCODE_RUN_TESTS production     # never execute untrusted code on Vercel
vercel env pull /tmp/prod.env --environment=production   # then: alembic upgrade head with DATABASE_URL_UNPOOLED; delete the file
vercel deploy --prod
```
Do **not** add a catch-all rewrite: Vercel routes all paths to the FastAPI app, and a rewrite to `/api/index` breaks routing.
Behaviour differences on Vercel: unit tests are **not run** (no sandbox — a Vercel Sandbox integration is future work);
JavaScript syntax check reports *check failed* (no Node in the Python runtime) while Semgrep still scans; lint uses the
pyflakes fallback (ruff's native binary is not bundled); rate limits are per function instance.
Researchers: run `python -m app.admin create-researcher EMAIL` locally with `TRUSTCODE_DATABASE_URL` set to the Neon URL.

## D. Other PaaS (e.g. Railway) — API + managed PostgreSQL only
Deploy `deployment/docker/Dockerfile.api` with `TRUSTCODE_DATABASE_URL` set to the managed database and `TRUSTCODE_ENV=production`.
PaaS containers cannot launch the Docker sandbox, so either run the worker on a VM pointing at the same database, or set
`TRUSTCODE_RUN_TESTS=false` (the UI then honestly shows "Not tested"). **Requires your account and credentials — not done here.**

## Migrations, backup, recovery, rollback
- Migrations: run automatically at API start (`alembic upgrade head`); manual rollback `alembic downgrade -1`.
- Backup: `docker compose exec db pg_dump -U trustcode trustcode | gzip > backup-$(date +%F).sql.gz` (cron daily; keep 14 days; encrypt off-site).
- Restore: `gunzip -c backup.sql.gz | docker compose exec -T db psql -U trustcode trustcode`.
- Rollback a release: `git checkout <previous tag> && docker compose up -d --build` (then downgrade migrations if the schema changed).
- **Experiment freeze:** tag `experiment-v1`; do not change rules, items or explanation templates during data collection.

## Monitoring
`/api/v1/health` (container healthcheck); JSON request logs with request ids (`docker compose logs api`); worker logs.
Error tracking/uptime monitoring (e.g. Sentry, UptimeRobot) are not configured yet — add when deploying for participants.
