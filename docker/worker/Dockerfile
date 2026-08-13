# syntax=docker/dockerfile:1
#
# DEP-001 — Worker image (packages/worker-daemon ONLY).
#
# Least-privilege, signed, pinned-by-digest worker image. Per E4-D01 the worker
# image runtime closure is EXACTLY worker-daemon + worker-protocol + the `pino`
# runtime dep (zod transitive) and NOTHING ELSE:
#   * NO UI, NO @armyofagents/server
#   * NO DB / drizzle tooling
#   * NO @armyofagents/adapter-utils, shared, or any agent CLI
# It runs as a NON-ROOT user on a READ-ONLY root filesystem and exposes ONLY a
# loopback health/metrics surface (GET /healthz, GET /metrics on 127.0.0.1).
#
# ADDITIVE + default-off: the combined ./Dockerfile and docker.yml are untouched.
#
# Base pinned BY DIGEST (node:lts-trixie-slim multi-arch index digest, resolved
# from Docker Hub on 2026-08-13; re-verify/refresh at the first CI build).
FROM node:lts-trixie-slim@sha256:0711b541c1c33a8a530ac4f0d391baa9a15b3d804695b1b24a47daa5fb60e74d AS base
RUN corepack enable

# ---------------------------------------------------------------------------
# deps — install EXACTLY the worker runtime closure (E4-D01):
# worker-daemon + worker-protocol (+ pino, zod transitive). A `--prod` filtered
# install so NO devDependency (e.g. @armyofagents/shared, vitest) is resolved.
# Validated for exact parity by scripts/check-image-deps-stages.mjs — copying
# server/db/shared/adapter-utils here FAILS the deps-stage gate.
# ---------------------------------------------------------------------------
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/worker-daemon/package.json packages/worker-daemon/
COPY packages/worker-protocol/package.json packages/worker-protocol/
COPY patches/ patches/
# A --prod filtered install: devDependencies (@armyofagents/shared, vitest) are NOT
# resolved, so shared's manifest is deliberately absent here — keeping the deps stage
# EXACTLY the worker runtime closure that scripts/check-image-deps-stages.mjs enforces.
RUN pnpm install --frozen-lockfile --prod --filter "@armyofagents/worker-daemon..."

# ---------------------------------------------------------------------------
# build — compile worker-protocol then worker-daemon to dist. This fat stage is
# discarded; only the compiled dist + prod node_modules reach production. It is
# built FROM deps (so node_modules already links worker-protocol + pino) and adds
# ONLY a global TypeScript + @types/node for compilation. tsc excludes tests
# (tsconfig `exclude`), so the test-only @armyofagents/shared dep is never
# imported and — deliberately — its manifest is NEVER copied (E4-D01: the worker
# image must not copy shared/server/db/adapter-utils/drizzle).
#
# NOTE: the container BUILD is Linux/CI-only (deferred; CI currently
# billing-blocked). The exact tsc/pnpm-deploy invocation is finalized at the
# first CI build; the least-privilege closure is statically enforced by
# scripts/check-image-deps-stages.mjs and the deps stage above.
# ---------------------------------------------------------------------------
FROM deps AS build
WORKDIR /app
RUN npm install --global typescript@5.7.3 @types/node@24
COPY tsconfig.json ./
COPY packages/worker-protocol/ packages/worker-protocol/
COPY packages/worker-daemon/ packages/worker-daemon/
# Expose the global @types to tsc's default @types resolution without a dev
# workspace install (which would drag in worker-daemon's shared devDep).
RUN ln -s "$(npm root -g)/@types" node_modules/@types || true
RUN tsc -p packages/worker-protocol/tsconfig.json \
  && tsc -p packages/worker-daemon/tsconfig.json \
  && test -f packages/worker-daemon/dist/bin/worker-daemon.js \
    || (echo "ERROR: worker-daemon build output missing" && exit 1)
# Produce a self-contained, prod-only deployment of just the worker daemon
# (worker-daemon + worker-protocol + pino), nothing else. worker-daemon carries NO
# workspace devDependency, so `pnpm deploy --prod` resolves its graph without needing any
# other package's manifest present — the image references neither shared/server/db nor any
# non-closure workspace package (E4-D01, enforced by the split-Dockerfile static gate).
RUN pnpm --filter @armyofagents/worker-daemon deploy --prod /worker-app

# ---------------------------------------------------------------------------
# production — non-root, read-only-root runtime. Worker daemon only.
# ---------------------------------------------------------------------------
FROM base AS production
ARG AOA_IMAGE_REVISION=unknown

LABEL org.opencontainers.image.title="AoA Worker"
LABEL org.opencontainers.image.description="Army of Agents worker daemon — least-privilege split image (E4-D01 closure)"
LABEL org.opencontainers.image.source="https://github.com/meteoritelabs/aoa"
LABEL org.opencontainers.image.revision="${AOA_IMAGE_REVISION}"
LABEL org.opencontainers.image.version="${AOA_IMAGE_REVISION}"
LABEL org.armyofagents.image.rootfs="read-only"
LABEL org.armyofagents.image.role="worker"

WORKDIR /worker-app
COPY --chown=node:node --from=build /worker-app /worker-app
COPY --chown=node:node docker/worker/entrypoint.sh /usr/local/bin/worker-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/worker-entrypoint.sh \
  && chmod +x /usr/local/bin/worker-entrypoint.sh \
  && mkdir -p /worker \
  && chown node:node /worker

ENV NODE_ENV=production \
  HOME=/worker \
  TMPDIR=/worker/tmp \
  AOA_WORKER_HEALTH_HOST=127.0.0.1 \
  AOA_WORKER_HEALTH_PORT=9464

# Non-root fixed identity — the prerequisite for a read-only root filesystem.
USER node

VOLUME ["/worker"]
# Loopback-only health/metrics surface; the healthcheck runs inside the
# container's own network namespace. No curl in the image — Node's global fetch
# probes the local liveness endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node","-e","fetch('http://127.0.0.1:'+(process.env.AOA_WORKER_HEALTH_PORT||9464)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["worker-entrypoint.sh"]
CMD ["node", "dist/bin/worker-daemon.js"]
