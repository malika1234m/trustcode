#!/usr/bin/env bash
# Runs the extension inside a real VS Code against a temporary local backend + worker:
#   1. the single-selection journey (no workspace folder)
#   2. session tracking scenarios in a Git workspace
#   3. session tracking scenarios in a large workspace without Git
#   4. the local project security scanner (mode: security)
# Needs: VSCODE_EXECUTABLE (path to the VS Code binary), the Python venv, and ~/.trustcode/local-secret
# (created by starting the backend once in local mode). Usage: scripts/e2e/run_vscode_integration.sh [default|session-git|session-nogit ...]
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PY="${PYTHON:-$ROOT/.venv/bin/python}"
: "${VSCODE_EXECUTABLE:?set VSCODE_EXECUTABLE to the VS Code binary}"
TMP="$(mktemp -d)"
export TRUSTCODE_ENV=development TRUSTCODE_DATABASE_URL="sqlite:///$TMP/it.db" TRUSTCODE_WORKER_MODE=queue \
       TRUSTCODE_LOCAL_MODE=true TRUSTCODE_JWT_SECRET="it-$(openssl rand -hex 24)" \
       TRUSTCODE_BENCHMARK_DIR="$ROOT/datasets/benchmark" TRUSTCODE_VERIFY_RATE_LIMIT_PER_MINUTE=300
cd "$ROOT/backend"
"$PY" -m uvicorn app.main:app --host 127.0.0.1 --port 8765 --log-level warning > "$TMP/api.log" 2>&1 & API=$!
"$PY" -m app.worker_main > "$TMP/worker.log" 2>&1 & WORKER=$!
trap 'kill $API $WORKER 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do curl -sf http://127.0.0.1:8765/api/v1/health >/dev/null && break; sleep 0.5; done

make_workspace() {  # $1 = dir, $2 = git|nogit
  local W="$1"; mkdir -p "$W/app" "$W/web" "$W/config" "$W/dist" "$W/node_modules/left-pad" "$W/tests"
  : > "$W/app/__init__.py"
  printf 'class User:\n    def __init__(self, name):\n        self.name = name\n' > "$W/app/models.py"
  printf 'from .models import User\n\ndef login(name):\n    return User(name)\n' > "$W/app/auth.py"
  printf 'def make_token(user_id):\n    return "t-" + str(user_id)\n\ndef check_token(token):\n    return token.startswith("t-")\n' > "$W/app/tokens.py"
  printf 'from .tokens import make_token, check_token\n\ndef issue(user_id):\n    return make_token(user_id), check_token\n' > "$W/app/routes.py"
  printf 'def old():\n    return 1\n' > "$W/app/legacy.py"
  printf "export function login(a: string, b: string) { return a + b; }\n" > "$W/web/api.ts"
  printf "export function legacyHelper() { return 1; }\n" > "$W/web/legacy.ts"
  printf "import { legacyHelper } from './legacy';\nimport { login } from './api';\nexport const page = () => legacyHelper() && login('a', 'b');\n" > "$W/web/page.tsx"
  printf '{ "name": "demo", "dependencies": { "react": "18.0.0" } }\n' > "$W/package.json"
  printf 'requests==2.32.0\n' > "$W/requirements.txt"
  printf '{ "debug": false }\n' > "$W/config/settings.json"
  printf 'API_KEY=original\n' > "$W/.env"
  printf 'console.log(1)\n' > "$W/dist/bundle.js"
  printf 'module.exports = 1\n' > "$W/node_modules/left-pad/index.js"
  printf 'dist/\nnode_modules/\n.trustcode/\n' > "$W/.gitignore"
  if [ "$2" = git ]; then
    git -C "$W" init -q && git -C "$W" add -A && git -C "$W" -c user.email=t@example.com -c user.name=t commit -q -m initial
  else
    mkdir -p "$W/bulk"; for i in $(seq 1 3000); do printf 'N = %s\n' "$i" > "$W/bulk/f_$i.py"; done
  fi
  # the developer's own uncommitted edit, made BEFORE the session starts
  printf 'def old():\n    return 1\n\ndef risky(expr):\n    return eval(expr)\n' > "$W/app/legacy.py"
}

cd "$ROOT/extension" && npm run -s compile || exit 1
STATUS=0
for MODE in "${@:-default session-git session-nogit security}"; do for M in $MODE; do
  echo "=== $M"
  unset TRUSTCODE_TEST_WORKSPACE
  if [ "$M" = security ]; then make_workspace "$TMP/ws-sec" git; export TRUSTCODE_TEST_WORKSPACE="$TMP/ws-sec" TRUSTCODE_TEST_SCANNER="$ROOT/.venv/bin/trustcode-scan"; fi
  if [ "$M" = session-git ]; then make_workspace "$TMP/ws-git" git; export TRUSTCODE_TEST_WORKSPACE="$TMP/ws-git"; fi
  if [ "$M" = session-nogit ]; then make_workspace "$TMP/ws-plain" nogit; export TRUSTCODE_TEST_WORKSPACE="$TMP/ws-plain"; fi
  rm -rf "${TMPDIR:-/tmp}/trustcode-vscode-test-$M"
  TRUSTCODE_TEST_MODE="$M" TRUSTCODE_TEST_BACKEND=http://127.0.0.1:8765 node out/test/integration/run.js 2>&1 \
    | grep -E "^\s+(ok|FAIL)|activation|large workspace|final run|Integration tests failed|integration test\(s\) failed"
  [ "${PIPESTATUS[0]}" -eq 0 ] || STATUS=1
done; done
echo "exit=$STATUS"; echo "--- api log (errors)"; grep -E '"status": 5' "$TMP/api.log" | tail -5; echo "--- worker log"; tail -2 "$TMP/worker.log"
exit $STATUS
