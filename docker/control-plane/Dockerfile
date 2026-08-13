# syntax=docker/dockerfile:1
#
# DEP-001 — Control-plane image (server + UI ONLY).
#
# Least-privilege, signed, pinned-by-digest control-plane image. Contains the
# AoA server and the built UI static assets and NOTHING ELSE:
#   * NO docker-cli            (the control plane never drives Docker)
#   * NO worker daemon         (packages/worker-daemon is not in this closure)
#   * NO agent CLIs            (no @anthropic-ai/claude-code, @openai/codex, …)
# It runs as a NON-ROOT user on a READ-ONLY root filesystem (all writable state
# is externalized to the /aoa volume; run with `--read-only` + a tmpfs-backed
# /aoa, see docker/control-plane/entrypoint.sh).
#
# This file is ADDITIVE and default-off: the combined ./Dockerfile and docker.yml
# remain the shipping images until REL-004 cuts the release over.
#
# Base is pinned BY DIGEST. Resolved from Docker Hub library/node
# `lts-trixie-slim` on 2026-08-13 (multi-arch index digest, last pushed
# 2026-08-05); re-verify/refresh at the first CI build.
FROM node:lts-trixie-slim@sha256:0711b541c1c33a8a530ac4f0d391baa9a15b3d804695b1b24a47daa5fb60e74d AS base
# Minimal runtime tooling: CA certs + curl (HEALTHCHECK only). Deliberately NO
# docker-cli, git, gh, gosu, or agent CLIs.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

# ---------------------------------------------------------------------------
# deps — install EXACTLY the control-plane runtime workspace closure:
# transitive runtime deps of @armyofagents/server + @armyofagents/ui.
# (Validated for exact parity by scripts/check-image-deps-stages.mjs — any
# missing OR extra workspace manifest here fails the deps-stage gate.)
# ---------------------------------------------------------------------------
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY server/package.json server/
COPY ui/package.json ui/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/adapter-utils/package.json packages/adapter-utils/
COPY packages/worker-protocol/package.json packages/worker-protocol/
COPY packages/plugins/sdk/package.json packages/plugins/sdk/
COPY packages/adapters/acpx-local/package.json packages/adapters/acpx-local/
COPY packages/adapters/claude-local/package.json packages/adapters/claude-local/
COPY packages/adapters/codex-local/package.json packages/adapters/codex-local/
COPY packages/adapters/cursor-cloud/package.json packages/adapters/cursor-cloud/
COPY packages/adapters/cursor-local/package.json packages/adapters/cursor-local/
COPY packages/adapters/gemini-local/package.json packages/adapters/gemini-local/
COPY packages/adapters/grok-local/package.json packages/adapters/grok-local/
COPY packages/adapters/openclaw/package.json packages/adapters/openclaw/
COPY packages/adapters/openclaw-gateway/package.json packages/adapters/openclaw-gateway/
COPY packages/adapters/opencode-local/package.json packages/adapters/opencode-local/
COPY packages/adapters/pi-local/package.json packages/adapters/pi-local/
COPY patches/ patches/
# Install only the control-plane closure. The lockfile stays frozen; the filter
# restricts the install to server+ui and their transitive workspace deps so the
# image never resolves cli/worker-daemon/create-paperclip-plugin.
RUN pnpm install --frozen-lockfile --filter "@armyofagents/server..." --filter "@armyofagents/ui..."

# ---------------------------------------------------------------------------
# build — compile the ENTIRE control-plane closure to dist: server + UI + every
# transitive workspace dep (shared / db / adapter-utils / worker-protocol /
# plugin-sdk / packages/adapters/*). Building the WHOLE closure is what lets the
# production stage ship the PRUNED `pnpm deploy` output instead of the whole
# source tree — the deployed workspace packages resolve to their built `dist`
# via `publishConfig`, so the runtime needs NO tsx (plain `node dist/index.js`,
# exactly like the worker image). The `...` suffix selects each entry package AND
# its transitive workspace deps, built in topological order — the same closure
# the deps stage installed.
# ---------------------------------------------------------------------------
FROM base AS build
WORKDIR /app
COPY --from=deps /app /app
COPY . .
RUN pnpm --filter "@armyofagents/server..." --filter "@armyofagents/ui..." build
RUN test -f server/dist/index.js || (echo "ERROR: server build output missing" && exit 1)
# Self-contained, PROD-only deployment of JUST the server closure: server dist +
# a pruned production node_modules with the workspace deps injected as built dist.
# No devDependencies (tsx / vite / vitest), no cli, no worker-daemon, no source
# tree of packages/adapters/*. This is the ONLY artifact copied into production.
RUN pnpm --filter @armyofagents/server deploy --prod /cp-app
# pnpm 9 `deploy` does NOT apply publishConfig, so the deployed @armyofagents/*
# manifests keep their dev ./src exports (not shipped; files:["dist"], no tsx here).
# Promote each package's publishConfig -> manifest so plain-node resolves the built
# ./dist (fixes ERR_MODULE_NOT_FOUND on @armyofagents/db/migrate-job and the app).
RUN node docker/apply-workspace-publish-config.mjs /cp-app/node_modules
RUN test -f /cp-app/dist/index.js || (echo "ERROR: control-plane deploy output missing" && exit 1)

# ---------------------------------------------------------------------------
# production — non-root, read-only-root-capable runtime. No agent CLIs.
# ---------------------------------------------------------------------------
FROM base AS production
ARG AOA_IMAGE_REVISION=unknown

LABEL org.opencontainers.image.title="AoA Control Plane"
LABEL org.opencontainers.image.description="Army of Agents control plane (server + UI) — least-privilege split image"
LABEL org.opencontainers.image.source="https://github.com/meteoritelabs/aoa"
LABEL org.opencontainers.image.revision="${AOA_IMAGE_REVISION}"
LABEL org.opencontainers.image.version="${AOA_IMAGE_REVISION}"
# Declares intended runtime posture; enforced by DEP-002 compose + the CI
# image-startup-smoke test (`docker run --read-only`).
LABEL org.armyofagents.image.rootfs="read-only"
LABEL org.armyofagents.image.role="control-plane"

WORKDIR /cp-app
# Ship ONLY the least-privilege runtime artifacts — NOT the whole /app source
# tree (the previous `COPY --from=build /app /app` shipped packages/worker-daemon,
# cli, and every packages/adapters/* SOURCE, contradicting "server + UI only").
#   1. the PRUNED server deploy closure: server dist + a production-only
#      node_modules whose workspace deps are the built dist, nothing else;
#   2. the built UI static assets at ./ui-dist, where the server's SPA static
#      handler looks FIRST (server/src/app.ts `uiDistCandidates` → `../ui-dist`),
#      so the control plane still serves the UI.
# No worker daemon, no cli, no agent CLIs, no adapter source — none are in the
# server deploy closure.
COPY --chown=node:node --from=build /cp-app /cp-app
COPY --chown=node:node --from=build /app/ui/dist /cp-app/ui-dist
COPY --chown=node:node docker/control-plane/entrypoint.sh /usr/local/bin/control-plane-entrypoint.sh
# DEP-003: the PRIVILEGED migration-job command body. Consumed ONLY by the `migrate`
# service in docker-compose.d1.yml (which overrides the entrypoint to run it) — the
# app runtime never invokes it (application startup runs NO migrations). Ships with
# the same non-root / read-only-root posture as the app entrypoint.
COPY --chown=node:node docker/control-plane/migrate-entrypoint.sh /usr/local/bin/migrate-entrypoint.sh
# DEP-002/003 D1 harness ONLY: the serving-role login provisioner invoked by
# migrate-entrypoint.sh under AOA_D1_PROVISION_SERVING_ROLES=1. Placed in /cp-app so
# `node /cp-app/provision-d1-serving-roles.mjs` resolves the deployed `postgres`
# driver from /cp-app/node_modules. Inert on any non-D1 deploy path.
COPY --chown=node:node docker/control-plane/provision-d1-serving-roles.mjs /cp-app/provision-d1-serving-roles.mjs
RUN sed -i 's/\r$//' /usr/local/bin/control-plane-entrypoint.sh /usr/local/bin/migrate-entrypoint.sh \
  && chmod +x /usr/local/bin/control-plane-entrypoint.sh /usr/local/bin/migrate-entrypoint.sh \
  && mkdir -p /aoa \
  && chown node:node /aoa

ENV NODE_ENV=production \
  HOME=/aoa \
  HOST=0.0.0.0 \
  PORT=3100 \
  SERVE_UI=true \
  TMPDIR=/aoa/tmp \
  AOA_HOME=/aoa \
  AOA_INSTANCE_ID=default \
  AOA_CONFIG=/aoa/instances/default/config.json \
  AOA_DEPLOYMENT_MODE=authenticated \
  AOA_DEPLOYMENT_EXPOSURE=private

# Non-root: the stock node user (uid 1000). No gosu/usermod at runtime — the
# fixed identity is what makes `--read-only` root viable.
USER node

VOLUME ["/aoa"]
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-3100}/api/health" >/dev/null || exit 1

ENTRYPOINT ["control-plane-entrypoint.sh"]
# Plain node from the deploy root (WORKDIR /cp-app): the deployed workspace deps
# resolve to built dist via publishConfig, so no tsx loader is needed (and the
# PROD deploy pruned tsx anyway). Mirrors the worker image's plain-node CMD.
CMD ["node", "dist/index.js"]
