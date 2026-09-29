#!/usr/bin/env bash
# Runs every quality gate independently (one failure does not hide the others) and
# writes a machine-readable summary + one log per gate.
#
# Usage: run-gates.sh <out_dir>
# Output: <out_dir>/summary.tsv  (gate<TAB>PASS|FAIL|SKIP<TAB>seconds<TAB>note)
#         <out_dir>/<gate>.log
set -uo pipefail

OUT="${1:?usage: run-gates.sh <out_dir>}"
ROOT="$(git rev-parse --show-toplevel)"
mkdir -p "$OUT"
: >"$OUT/summary.tsv"
cd "$ROOT" || exit 2

run() {
  local name="$1"; shift
  local start; start=$(date +%s)
  if "$@" >"$OUT/$name.log" 2>&1; then status=PASS; else status=FAIL; fi
  printf '%s\t%s\t%s\t\n' "$name" "$status" "$(( $(date +%s) - start ))" >>"$OUT/summary.tsv"
  echo "[$status] $name ($(( $(date +%s) - start ))s)"
}

skip() {
  printf '%s\tSKIP\t0\t%s\n' "$1" "$2" >>"$OUT/summary.tsv"
  echo "[SKIP] $1 — $2"
}

# Build must run first: @app/types dist/ is needed by every other package.
run build pnpm build
run typecheck pnpm typecheck
run lint pnpm lint
run format pnpm format:check
run unit-tests pnpm test

if docker info >/dev/null 2>&1; then
  run integration-tests env DOCKER_TESTS=1 pnpm test
else
  skip integration-tests "Docker unavailable (enable Docker Desktop WSL integration)"
fi

API_URL="${E2E_BASE_URL:-http://localhost:3000}"
if curl -fsS "$API_URL/health" >/dev/null 2>&1; then
  run e2e env E2E_BASE_URL="$API_URL" pnpm --filter @app/api test -- src/e2e.test.ts
else
  skip e2e "No stack answering at $API_URL/health (run: docker compose up --build)"
fi

WEB_URL="${E2E_WEB_URL:-http://localhost:8080}"
if curl -fsS "$WEB_URL/" >/dev/null 2>&1; then
  # Primera vez: `pnpm --filter @app/web exec playwright install chromium`.
  run e2e-web env E2E_WEB_URL="$WEB_URL" pnpm --filter @app/web test:e2e
else
  skip e2e-web "No web answering at $WEB_URL (run: docker compose up --build)"
fi

grep -q $'\tFAIL\t' "$OUT/summary.tsv" && exit 1 || exit 0
