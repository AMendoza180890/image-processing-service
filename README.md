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
- ⏳ Fases 2–6: pendientes.

## Requisitos

- Node 22+ y pnpm (`npm install -g pnpm`).
- Docker Desktop con **integración WSL habilitada** (Settings → Resources → WSL Integration).
  > En este entorno `docker` aún **no está disponible**; hay que activarlo antes de las partes
  > de contenedores. Verificá con `docker version` y `docker compose version`.

## Estructura

```
api/            API Fastify + Dockerfile multi-stage
migrations/     Migraciones SQL (node-pg-migrate)
packages/types/ Tipos/DTOs compartidos (enum JobStatus, zod)
worker/  web/   (Fases 2 y 3)
infra/          (Fase 6, Terraform)
```

## Desarrollo local (sin Docker)

```bash
pnpm install
pnpm check          # build + lint + test (gate de calidad)
```

Scripts útiles: `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format`.

## Levantar con Docker (Fase 1)

```bash
cp .env.example .env
docker compose up --build
# La API queda en http://localhost:3000 ; corre migraciones al arrancar.
```

Validaciones manuales:

```bash
curl -s localhost:3000/health
curl -s -X POST localhost:3000/jobs -H 'content-type: application/json' \
  -d '{"originalFilename":"foto.png"}'
curl -s localhost:3000/jobs
# Persistencia del volumen: docker compose down && up y verificar que los jobs siguen.
```

## Tests

- **Unit** (siempre): `pnpm test`. Cubre DTOs/zod y rutas de la API (con repo en memoria).
- **Integración** (requiere Docker): usan Testcontainers para levantar Postgres real.

  ```bash
  DOCKER_TESTS=1 pnpm --filter @app/api test
  ```
