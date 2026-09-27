# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Learning project building an **async image-processing service**: upload an image → a worker
generates a thumbnail + watermark asynchronously → download the result. It is built in phases,
100% local with Docker first (Phases 0–3), then moved to AWS (Phases 4–6). The full phased plan
lives at `~/.claude/plans/federated-drifting-teacup.md` — read it before extending scope.

**Current state:** Phase 0 (monorepo + shared types) and Phase 1 (API + Postgres + Docker) are
done. `worker/`, `web/`, and `infra/` do not exist yet — they arrive in Phases 2/3/6.

## Commands

Run from the repo root (pnpm workspaces):

```bash
pnpm install
pnpm check          # gate: build + lint + test — run this before considering work done
pnpm build          # tsc across all packages (@app/types MUST build before api compiles)
pnpm lint           # eslint (flat config; web/ is ignored)
pnpm typecheck      # tsc --noEmit per package
pnpm test           # vitest run (all workspaces)
pnpm format         # prettier --write

# single package / single test
pnpm --filter @app/api test
pnpm --filter @app/api test -- src/routes/jobs.test.ts
pnpm --filter @app/api dev      # tsx watch (needs DATABASE_URL)

# integration tests (spin up real Postgres via Testcontainers — requires Docker running)
DOCKER_TESTS=1 pnpm --filter @app/api test

# full stack
docker compose up --build       # api on :3000, postgres on :5432
```

## Environment gotchas

- **`@app/types` must be built before `api` typechecks or tests.** Its `package.json` `types`/`main`
  point at `dist/`, so a fresh clone fails `typecheck`/`test` until `pnpm build` runs. This is why
  `check` runs `build` first — keep that ordering.
- **This WSL distro's `node` is a symlink to Windows `node.exe`**, so `corepack` does not execute.
  Install pnpm via `npm install -g pnpm` instead.
- **Docker may be unavailable** in WSL until Docker Desktop → Settings → Resources → WSL Integration
  is enabled. Integration tests and `docker compose` depend on it; unit tests do not.

## Architecture

**Monorepo layout:** `packages/types/` (shared), `api/` (Fastify), `migrations/` (SQL), plus
`worker/`/`web/`/`infra/` in later phases.

**`@app/types` is the contract.** The `JobStatus` enum, the `Job` DTO, and the zod schemas
(`jobSchema`, `listJobsQuerySchema`, `jobMessageSchema`, etc.) in `packages/types/src/index.ts` are
the single source of truth shared by api, worker, and web. Types are inferred from zod schemas
(`z.infer`), so change the schema and the type follows. Add new cross-service shapes here, not locally.

**API request flow** (`api/src/`):
- `server.ts` loads config + pg pool, calls `buildApp`, listens on `0.0.0.0`.
- `app.ts` (`buildApp`) wires CORS, the `/health` check (runs `SELECT 1`), and routes. It accepts an
  optional `repo` — this is the seam for testing routes without a database.
- `routes/jobs.ts` validates input with zod schemas from `@app/types` (`.safeParse` → 400 on failure)
  and delegates to a `JobsRepository`.
- `repositories/jobs.ts` defines the `JobsRepository` **interface** and `PgJobsRepository`. Row
  mapping (snake_case DB columns → camelCase DTO) happens here in `rowToJob`. `create()` generates the
  UUID app-side so the S3 key (`originals/${id}`) is stable and known before upload.

**Key convention — the repository interface is the test seam.** Unit tests inject an in-memory
`JobsRepository` and drive routes via `app.inject()` (no DB). Integration tests use the real
`PgJobsRepository` against a Testcontainers Postgres. When adding endpoints, extend the interface,
implement in `PgJobsRepository`, and add an in-memory equivalent in tests.

**Migrations** are plain SQL in `migrations/` (node-pg-migrate, `-- Up Migration` / `-- Down Migration`
sections). They run automatically at container start via `api/docker-entrypoint.sh` before the server
boots. The `jobs` table has a CHECK constraint on `status` that must stay in sync with the `JobStatus`
enum, and an `updated_at` trigger.

**Docker build** (`api/Dockerfile`) is multi-stage with **build context = repo root** (set in
`docker-compose.yml`) so it can see the lockfile and `packages/types`. It builds types + api, then
`pnpm deploy --prod` produces a self-contained runner image. `.dockerignore` at the root is the one
that applies.

## Module system

ESM throughout (`"type": "module"`, TS `NodeNext` + `verbatimModuleSyntax`). Relative imports need
explicit `.js` extensions (e.g. `import { buildApp } from "./app.js"`); `@app/types` is imported bare.
