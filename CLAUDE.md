# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Learning project building an **async image-processing service**: upload an image → a worker
generates a thumbnail + watermark asynchronously → download the result. It is built in phases,
100% local with Docker first (Phases 0–3), then moved to AWS (Phases 4–6). The full phased plan
lives at `~/.claude/plans/federated-drifting-teacup.md` — read it before extending scope.

**Current state:** Phases 0–2 are implemented — monorepo + shared types (0), API + Postgres + Docker
(1), and the async pipeline (2): multipart upload to S3, SQS enqueue, and a separate `worker/` that
processes images with `sharp`. Phase 3 (`web/`, React + Vite served by Nginx) is implemented but
not yet validated against Docker. `infra/` arrives in Phase 6.
S3/SQS run locally via **LocalStack** (see `docker-compose.yml` + `docker/localstack/init-aws.sh`).

## Commands

Run from the repo root (pnpm workspaces):

```bash
pnpm install
pnpm check          # gate: build + lint + test — run this before considering work done
pnpm build          # tsc across all packages (@app/types MUST build before api compiles)
pnpm lint           # eslint (flat config; web/src also gets browser globals + react-hooks rules)
pnpm typecheck      # tsc --noEmit per package
pnpm test           # vitest run (all workspaces)
pnpm format         # prettier --write

# single package / single test
pnpm --filter @app/api test
pnpm --filter @app/api test -- src/routes/jobs.test.ts
pnpm --filter @app/api dev      # tsx watch (needs DATABASE_URL)

# integration tests (spin up real Postgres + LocalStack via Testcontainers — requires Docker)
DOCKER_TESTS=1 pnpm --filter @app/api test
DOCKER_TESTS=1 pnpm --filter @app/worker test

# e2e against a running `docker compose up` stack (upload → poll until done → download presigned URL)
E2E_BASE_URL=http://localhost:3000 pnpm --filter @app/api test -- src/e2e.test.ts
pnpm --filter @app/web exec playwright install chromium   # once
pnpm --filter @app/web test:e2e                           # browser e2e against web :8080

pnpm --filter @app/web dev      # Vite on :5173, proxies /api → localhost:3000

# full stack (web :8080, api :3000, postgres :5432, localstack :4566, worker)
docker compose up --build
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

**Monorepo layout:** `packages/types/` (shared), `api/` (Fastify), `worker/` (sharp), `web/`
(React + Vite), `migrations/` (SQL), plus `infra/` in Phase 6.

**`@app/types` is the contract.** The `JobStatus` enum, the `Job` DTO, and the zod schemas
(`jobSchema`, `listJobsQuerySchema`, `jobMessageSchema`, etc.) in `packages/types/src/index.ts` are
the single source of truth shared by api, worker, and web. Types are inferred from zod schemas
(`z.infer`), so change the schema and the type follows. Add new cross-service shapes here, not locally.

**Web** (`web/src/`): `api.ts` is the typed client (`createApiClient`), which validates every
response with the `@app/types` zod schemas and maps HTTP errors to `ApiError` messages. `useJobs`
polls `GET /jobs` only while some job is `pending`/`processing`. `App` takes the `ApiClient` (and a
`navigate` fn for downloads) as props, which are the seams for tests. Tests inject `FakeApiClient`
from `test-helpers.ts`, never mock `fetch` globally. The browser always calls a relative `/api`
base: Nginx (`web/nginx/default.conf.template`) proxies it to `api:3000` in compose, and Vite's dev proxy
does the same, so there's no CORS in the normal path. `web/` is the one package that uses
`moduleResolution: Bundler`, so **relative imports there have no `.js` extension**. Download links
are presigned with `Content-Disposition: attachment` so they download instead of navigating away.
Playwright specs live in `web/e2e/` (run against the compose stack; not part of `pnpm test`).

**API request flow** (`api/src/`):

- `server.ts` loads config + pg pool, builds the S3/SQS clients (`aws.ts`) and their wrappers,
  calls `buildApp`, listens on `0.0.0.0`.
- `app.ts` (`buildApp`) wires CORS, `@fastify/multipart`, the `/health` check (runs `SELECT 1`),
  and routes. It takes injectable `repo`, `storage`, and `queue` — the seams for testing without
  real infra.
- `routes/jobs.ts`: `POST /jobs` is **multipart** — validate the file's MIME against
  `ACCEPTED_IMAGE_MIME_TYPES` (415) and size (413), `repo.create()` a `pending` row, upload the
  buffer to S3 under `job.s3KeyOriginal`, then `queue.publishJob({ jobId })`. `GET /jobs/:id/download`
  returns a presigned URL only when the job is `done` (else 409). The URL is signed with a separate
  S3 client on `S3_PUBLIC_ENDPOINT_URL` (SigV4 covers the host, so it must be the host-visible
  `localhost:4566`, not compose's `localstack:4566`).
- `repositories/jobs.ts` / `storage.ts` / `queue.ts` define the `JobsRepository`, `ObjectStorage`,
  and `JobQueue` **interfaces** (+ Pg/S3/SQS impls). `create()` generates the UUID app-side so the
  S3 key (`originals/${id}`) is stable and known before upload.

**Worker** (`worker/src/`) is a separate service/deploy unit (own Dockerfile, own `node_modules`),
so it owns its data access rather than importing from `api/`: `PgWorkerJobsRepository` (find +
status transitions), `S3ObjectStorage` (get/put), `SqsJobQueue` (receive/delete). `main.ts` wires a
long-poll loop (`worker.ts`) → `handler.ts` (`handleJob`, **idempotent**: skips jobs already `done`,
marks `error` on failure so poison messages don't loop) → `processor.ts` (`processImage`, the pure
`sharp` thumbnail+watermark step). `processImage` and `handleJob` are unit-tested with fakes;
`integration.test.ts` runs the real pipeline against Postgres + LocalStack.

**Key convention — interfaces are the test seams.** Unit tests inject in-memory/fake
repo/storage/queue and drive routes via `app.inject()` (no infra). Integration tests use the real
impls against Testcontainers (Postgres, and LocalStack for the worker). When adding behavior,
extend the interface, implement the real version, and add a fake equivalent in tests.

**Migrations** are plain SQL in `migrations/` (node-pg-migrate, `-- Up Migration` / `-- Down Migration`
sections). They run automatically at container start via `api/docker-entrypoint.sh` before the server
boots. The `jobs` table has a CHECK constraint on `status` that must stay in sync with the `JobStatus`
enum, and an `updated_at` trigger.

**Docker builds** (`api/Dockerfile`, `worker/Dockerfile`, `web/Dockerfile`) are multi-stage with **build context =
repo root** (set in `docker-compose.yml`) so they can see the lockfile and `packages/types`. Each
builds types + its own package, then `pnpm deploy --prod` produces a self-contained runner image.
The worker's build stage runs on linux, so `sharp` pulls the correct native binary there (locally,
this WSL uses Windows `node.exe`, so `pnpm install` fetches the win32 sharp binary — `sharp: true`
is required in `pnpm-workspace.yaml` `allowBuilds`). `.dockerignore` at the root is the one that
applies. Each Dockerfile must `COPY tsconfig.base.json`, because every package's tsconfig extends it.
`web` ends on `nginx-unprivileged` (non-root, port 8080). `MAX_UPLOAD_MB` flows from compose to all
three upload limits: the API env, the Vite build arg `VITE_MAX_UPLOAD_MB` (browser check), and the
Nginx `client_max_body_size` (templated from `web/nginx/default.conf.template` via envsubst at start). **LocalStack** creates the bucket + queue on startup via the init script mounted at
`/etc/localstack/init/ready.d/`; its healthcheck waits for the queue to exist.

## Module system

ESM throughout (`"type": "module"`, TS `NodeNext` + `verbatimModuleSyntax`). Relative imports need
explicit `.js` extensions (e.g. `import { buildApp } from "./app.js"`); `@app/types` is imported bare.
