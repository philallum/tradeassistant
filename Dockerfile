# Container image for the GCP-scheduled daily refresh (Requirement 16.7).
#
# Packages the DETERMINISTIC TypeScript daily-run entry point (src/scheduled-run
# → the shared `dailyRun`) as a run-to-completion batch image for a Cloud Run
# Job. Multi-stage so the runtime image carries only compiled JS + production
# dependencies, not the toolchain or sources.
#
# Version policy (Requirements 18.2, 18.3, 18.4): the base image is pinned to an
# EXACT, non-prerelease Node Active-LTS (22.x) patch release — no floating tag,
# no `latest`, no prerelease. Bump this pin deliberately via the version ledger.
# No secret is ever baked into the image; runtime secrets are injected by Cloud
# Run from Google Secret Manager (see .github/workflows/deploy.yml).

# --- Build stage: compile TypeScript to dist/ with the full toolchain ---------
FROM node:22.20.0-bookworm-slim AS build
WORKDIR /app

# Deterministic install from the committed lockfile (pinned dependencies).
COPY package.json package-lock.json ./
RUN npm ci

# Compile the deterministic core (tsc → dist/).
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

# Run to completion: the Cloud Run Job executes this once per scheduled trigger.
# This invokes the SAME deterministic `dailyRun` entry point as the local run.
CMD ["node", "dist/scheduled-run/main.js"]
