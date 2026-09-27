# syntax=docker/dockerfile:1
# Build multi-stage para la API. El contexto de build es la RAÍZ del monorepo
# (ver docker-compose.yml) para poder acceder al lockfile y a packages/types.

# ---------- Stage 1: build (con todas las dependencias) ----------
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo

# Copiamos primero los manifests para aprovechar la caché de capas de Docker:
# si no cambian, no se reinstala.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/types/package.json packages/types/
COPY api/package.json api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Código fuente y build.
COPY packages/types packages/types
COPY api api
RUN pnpm --filter @app/types build \
 && pnpm --filter @app/api build

# Genera un paquete autocontenido de producción en /app (dist + node_modules prod).
RUN pnpm --filter @app/api deploy --prod /app

# ---------- Stage 2: runner (imagen chica, solo prod) ----------
FROM node:22-slim AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app ./
# Las migraciones se ejecutan en el arranque del contenedor.
COPY --from=build /repo/migrations ./migrations
COPY api/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Usuario no-root (la imagen node ya trae el usuario `node`).
USER node
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
