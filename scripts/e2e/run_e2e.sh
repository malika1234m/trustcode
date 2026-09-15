#!/usr/bin/env bash
# Starts API (queue mode, local mode) + separate worker process on a temp SQLite DB, runs e2e.mjs, stops both.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PY="${PYTHON:-$ROOT/.venv/bin/python}"
TMP="$(mktemp -d)"
export TRUSTCODE_ENV=development TRUSTCODE_DATABASE_URL="sqlite:///$TMP/e2e.db" TRUSTCODE_WORKER_MODE=queue \
       TRUSTCODE_LOCAL_MODE=true TRUSTCODE_LOCAL_SECRET_FILE="$TMP/local-secret" TRUSTCODE_JWT_SECRET="e2e-$(openssl rand -hex 24)" \
       TRUSTCODE_BENCHMARK_DIR="$ROOT/datasets/benchmark" TRUSTCODE_VERIFY_RATE_LIMIT_PER_MINUTE=100
cd "$ROOT/backend"
"$PY" -c "from app.local_secret import ensure_local_secret; ensure_local_secret()"
"$PY" -m uvicorn app.main:app --host 127.0.0.1 --port 8765 --log-level warning > "$TMP/api.log" 2>&1 & API=$!
"$PY" -m app.worker_main > "$TMP/worker.log" 2>&1 & WORKER=$!
trap 'kill $API $WORKER 2>/dev/null || true' EXIT
for i in $(seq 1 40); do curl -sf http://127.0.0.1:8765/api/v1/health >/dev/null && break; sleep 0.5; done
cd "$ROOT"
E2E_OUT="${E2E_OUT:-$ROOT/docs/testing/e2e-results.json}" node scripts/e2e/e2e.mjs http://127.0.0.1:8765 "$TMP/local-secret"
echo "worker log tail:"; tail -3 "$TMP/worker.log"
