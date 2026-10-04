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

# In this WSL, `node`/`pnpm` are Windows executables: env vars reach them only when listed in
# WSLENV. Without this, DOCKER_TESTS/E2E_* are silently dropped and the gated suites skip.
with_env() {
  local names=()
  while [[ "$1" == *=* ]]; do export "$1"; names+=("${1%%=*}"); shift; done
  local joined; joined=$(IFS=:; echo "${names[*]}")
  WSLENV="${WSLENV:+$WSLENV:}$joined" "$@"
}

# Run a gated suite and FAIL it if vitest skipped the files it was meant to run: a suite that
# exits 0 because everything was skipped proved nothing.
run_gated() {
  local name="$1" pattern="$2"; shift 2
  run "$name" "$@"
  if grep -qE "↓.*($pattern)" "$OUT/$name.log"; then
    sed -i "\$d" "$OUT/summary.tsv"
    printf '%s\tFAIL\t0\t%s\n' "$name" "suite skipped: env var not forwarded to node?" >>"$OUT/summary.tsv"
    echo "[FAIL] $name — ran but the gated tests were skipped"
  fi
}

# Docker may only be reachable as Docker Desktop's docker.exe (WSL integration off).
DOCKER=$(command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 && echo docker || echo docker.exe)
if "$DOCKER" info >/dev/null 2>&1; then
  run_gated integration-tests 'integration\.test\.ts' with_env DOCKER_TESTS=1 pnpm test
else
  skip integration-tests "Docker unavailable (start Docker Desktop)"
fi

API_URL="${E2E_BASE_URL:-http://localhost:3000}"
if curl -fsS "$API_URL/health" >/dev/null 2>&1; then
  run_gated e2e 'e2e\.test\.ts' with_env E2E_BASE_URL="$API_URL" pnpm --filter @app/api test -- src/e2e.test.ts
else
  skip e2e "No stack answering at $API_URL/health (run: docker compose up --build)"
fi

WEB_URL="${E2E_WEB_URL:-http://localhost:8080}"
if curl -fsS "$WEB_URL/" >/dev/null 2>&1; then
  # Primera vez: `pnpm --filter @app/web exec playwright install chromium`.
  run e2e-web with_env E2E_WEB_URL="$WEB_URL" pnpm --filter @app/web test:e2e
else
  skip e2e-web "No web answering at $WEB_URL (run: docker compose up --build)"
fi

grep -q $'\tFAIL\t' "$OUT/summary.tsv" && exit 1 || exit 0
