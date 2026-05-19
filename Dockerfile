# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Orbit backend + frontend bundle. Multi-stage build:
#
#   1. frontend-builder — runs `vite build` to produce frontend/dist
#   2. backend-builder  — runs `tsc` + `prisma generate`
#   3. runtime          — prod-only node_modules + dist + frontend bundle
#
# The runtime image is a single container that serves /api from Express and
# everything else from the frontend's static bundle (see backend/src/index.ts
# — gated on the STATIC_DIR env var, which this image sets).
# ---------------------------------------------------------------------------

# ============================================================
# Stage 1: Frontend builder
# ============================================================
FROM node:20-alpine AS frontend-builder
WORKDIR /app

# Workspace package manifests first so `npm ci` is cached when only source
# files change.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci

COPY frontend/ ./frontend/

# Empty VITE_API_URL = relative /api/* paths (same origin as backend).
ENV VITE_API_URL=""
RUN npm --workspace=frontend run build

# ============================================================
# Stage 2: Backend builder
# ============================================================
FROM node:20-alpine AS backend-builder
WORKDIR /app

# openssl 3.x runtime is required for Prisma's libssl detection — without
# it Prisma defaults to a 1.1.x engine that won't run on the alpine 3.20+
# runtime stage.
RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci

COPY backend/ ./backend/

# Generate the Prisma client BEFORE compiling TS — the schema produces the
# `Prisma.*WhereInput` types and tx-callback types that backend routes
# import. Native binaryTarget on alpine = linux-musl.
RUN npm --workspace=backend exec -- prisma generate
RUN npm --workspace=backend run build

# ============================================================
# Stage 3: Runtime
# ============================================================
FROM node:20-alpine AS runtime
WORKDIR /app

# Prisma's query engine on alpine needs the openssl runtime.
RUN apk add --no-cache openssl

# Backend prod deps (still hoisted to /app/node_modules under workspaces).
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
RUN npm ci --omit=dev --workspace=backend && npm cache clean --force

# Backend build output + Prisma assets needed at runtime.
COPY --from=backend-builder /app/backend/dist ./backend/dist
COPY --from=backend-builder /app/backend/prisma ./backend/prisma
COPY --from=backend-builder /app/backend/scripts ./backend/scripts
COPY --from=backend-builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=backend-builder /app/node_modules/@prisma ./node_modules/@prisma

# Frontend static bundle for the Express static handler.
COPY --from=frontend-builder /app/frontend/dist ./public

# Entrypoint runs migrations then starts the server.
COPY docker/backend-entrypoint.sh /usr/local/bin/orbit-entrypoint
RUN chmod +x /usr/local/bin/orbit-entrypoint

ENV NODE_ENV=production
ENV STATIC_DIR=/app/public
ENV BACKEND_PORT=4000
EXPOSE 4000

# Drop to a non-root user (node:alpine ships with one).
USER node

# The entrypoint runs `node scripts/prisma-shim.cjs migrate deploy` then
# `node dist/index.js` from /app/backend so relative paths in package.json
# scripts resolve correctly.
WORKDIR /app/backend
ENTRYPOINT ["/usr/local/bin/orbit-entrypoint"]
