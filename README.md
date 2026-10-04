# Servicio de Procesamiento de Imágenes (Docker → AWS)

Proyecto de aprendizaje: subís una imagen → se genera thumbnail + marca de agua de forma
**asíncrona** → descargás el resultado. Se construye primero 100% local con Docker (Fases 0–3)
y luego se lleva a AWS (Fases 4–6). El plan completo está en
`~/.claude/plans/federated-drifting-teacup.md`.

## Estado actual

- ✅ **Fase 0** — Monorepo (pnpm workspaces), `@app/types` (enum + DTOs + zod), tooling
  (TypeScript, ESLint, Prettier, Vitest).
- ✅ **Fase 1** — API Fastify (`POST /jobs`, `GET /jobs`, `GET /jobs/:id`, `GET /health`),
  migración inicial (`node-pg-migrate`), Dockerfile multi-stage, `docker-compose.yml` (api + postgres).
- ✅ **Fase 2** — Pipeline asíncrono: subida multipart a S3, encolado en SQS (vía **LocalStack**),
  `worker/` que procesa con `sharp` (thumbnail + marca de agua) de forma idempotente, y
  `GET /jobs/:id/download` con URL prefirmada.
- 🚧 **Fase 3** — Front React + Vite (`web/`): subida, lista con polling de estado y descarga;
  servido por Nginx (proxy `/api` → API) en `docker compose`. Falta validarlo con Docker.
- ⏳ Fases 4–6: pendientes.

## Requisitos

- Node 22+ y pnpm (`npm install -g pnpm`).
- Docker Desktop con **integración WSL habilitada** (Settings → Resources → WSL Integration).
  > En este entorno `docker` aún **no está disponible**; hay que activarlo antes de las partes
  > de contenedores. Verificá con `docker version` y `docker compose version`.

## Estructura

```
api/            API Fastify + Dockerfile multi-stage
worker/         Consumidor SQS + procesado sharp + Dockerfile multi-stage
migrations/     Migraciones SQL (node-pg-migrate)
packages/types/ Tipos/DTOs compartidos (enum JobStatus, zod)
docker/         Script de init de LocalStack (bucket + cola)
web/            Front React + Vite, servido por Nginx (Dockerfile multi-stage)
infra/          (Fase 6, Terraform)
```

## Desarrollo local (sin Docker)

```bash
pnpm install
pnpm check          # build + lint + test (gate de calidad)
```

Scripts útiles: `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format`.

## Levantar con Docker

```bash
cp .env.example .env
docker compose up --build
# App web: http://localhost:8080  (Nginx; /api se reenvía a la API)
# API:     http://localhost:3000  (corre migraciones al arrancar)
```

Front en modo desarrollo (hot reload) contra la API del compose:

```bash
pnpm --filter @app/web dev   # http://localhost:5173 ; /api → http://localhost:3000
```

Validaciones manuales (Fase 2, flujo asíncrono):

```bash
curl -s localhost:3000/health
# Subir una imagen (multipart). Devuelve el job en estado pending.
curl -s -X POST localhost:3000/jobs -F 'file=@./foto.png'
# Poll del estado hasta `done` (el worker procesa en segundo plano; ver `docker compose logs worker`).
curl -s localhost:3000/jobs/<id>
# Obtener la URL prefirmada del resultado y descargar.
curl -s localhost:3000/jobs/<id>/download
# Escalar el worker reparte los mensajes: docker compose up --scale worker=2
# Persistencia del volumen: docker compose down && up y verificar que los jobs siguen.
```

## Tests

- **Unit** (siempre): `pnpm test`. Cubre DTOs/zod, rutas de la API (repo/S3/SQS en memoria),
  el worker (sharp + fakes) y los componentes del front (Testing Library).
- **Integración** (requiere Docker): usan Testcontainers para levantar Postgres real.

  ```bash
  DOCKER_TESTS=1 WSLENV=DOCKER_TESTS pnpm --filter @app/api test
  ```

- **e2e** (requiere `docker compose up --build`):

  ```bash
  E2E_BASE_URL=http://localhost:3000 WSLENV=E2E_BASE_URL pnpm --filter @app/api test -- src/e2e.test.ts
  pnpm --filter @app/web exec playwright install chromium   # solo la primera vez
  pnpm --filter @app/web test:e2e                           # navegador contra :8080
  ```
