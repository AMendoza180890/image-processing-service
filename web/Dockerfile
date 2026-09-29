# syntax=docker/dockerfile:1
# Build multi-stage del front. Contexto = raíz del monorepo (ver docker-compose.yml).

# ---------- Stage 1: build (Vite) ----------
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/types/package.json packages/types/
COPY web/package.json web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @app/web...

COPY tsconfig.base.json ./
COPY packages/types packages/types
COPY web web
# Límite de subida del navegador: se fija en el bundle al compilar (= MAX_UPLOAD_MB de la API).
ARG VITE_MAX_UPLOAD_MB=10
ENV VITE_MAX_UPLOAD_MB=${VITE_MAX_UPLOAD_MB}
RUN pnpm --filter @app/types build \
 && pnpm --filter @app/web build

# ---------- Stage 2: Nginx sirviendo estáticos (no-root, puerto 8080) ----------
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runner
# La imagen de Nginx pasa /etc/nginx/templates/*.template por envsubst al arrancar
# (solo variables definidas, así que $host/$uri quedan intactas) → conf.d/default.conf.
ENV MAX_UPLOAD_MB=10
COPY web/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
