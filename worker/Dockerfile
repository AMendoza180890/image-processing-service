# syntax=docker/dockerfile:1
# Build multi-stage para el worker. Contexto de build = RAÍZ del monorepo
# (ver docker-compose.yml) para acceder al lockfile y a packages/types.

# ---------- Stage 1: build (todas las dependencias) ----------
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo

# Manifests primero para aprovechar la caché de capas.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/types/package.json packages/types/
COPY worker/package.json worker/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Código fuente y build. sharp instala el binario nativo de linux en esta etapa.
COPY tsconfig.base.json ./
COPY packages/types packages/types
COPY worker worker
RUN pnpm --filter @app/types build \
 && pnpm --filter @app/worker build

# Paquete autocontenido de producción en /app.
RUN pnpm --filter @app/worker deploy --prod /app

# ---------- Stage 2: runner (imagen chica, solo prod) ----------
FROM node:22-slim AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app ./

# Usuario no-root (la imagen node ya trae el usuario `node`).
USER node
CMD ["node", "dist/main.js"]
