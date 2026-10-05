# Container image for the dashboard-ui Read_Proxy (Cloud Run SERVICE).
#
# Standalone, read-only serving-layer deployable: a fixed endpoint allowlist in
# front of SELECT-only PostgREST reads. The HTTP layer uses the Node 22 built-in
# `http` module — there is deliberately NO web framework.
#
# Version policy (parent Requirements 18.2–18.4): the base image is pinned to an
# EXACT, non-prerelease Node Active-LTS (22.x) patch release — no floating tag,
# no `latest`, no prerelease. No secret is ever baked into the image; the Supabase
# read credential is injected at runtime by Cloud Run from Google Secret Manager.
#
# NOTE: the server entrypoint `dist/main.js` is produced from `src/main.ts`, which
# is implemented in task 4. This Dockerfile references it ahead of that task so the
# build target is fixed; it compiles whatever `src/**` exists at build time.

# --- Build stage: compile TypeScript to dist/ with the full toolchain ---------
FROM node:22.20.0-bookworm-slim AS build
WORKDIR /app

# Deterministic install from the committed lockfile (pinned dependencies).
COPY package.json package-lock.json ./
RUN npm ci

# Compile the service (tsc -> dist/).
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies so only production deps are copied to the runtime image.
RUN npm prune --omit=dev

# --- Runtime stage: minimal image with compiled JS + production deps ----------
FROM node:22.20.0-bookworm-slim AS runtime
WORKDIR /app

# Run as the unprivileged user shipped in the base image (least privilege).
ENV NODE_ENV=production
USER node

COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/package.json ./package.json

# Cloud Run provides $PORT; the server (task 4) binds to it. The service entry
# point is the only serving-side HTTP listener in the deployable.
CMD ["node", "dist/main.js"]
