# syntax=docker/dockerfile:1
#
# DEP-002 — fake-provider service image (harness only).
#
# Runs the deterministic fixture-driven fake sandbox provider
# (packages/sandbox-fake-provider, DEP-000) behind docker/d1/fake-provider-entry.mjs.
# Least-privilege: non-root, no server/db. The container BUILD is Linux/CI-only.
#
# ★ Amended by DEP-019. This line used to read "closure limited to sandbox-fake-provider
# + worker-protocol (+ zod)" and that is no longer true: the image now also carries a SECOND,
# separate tree, `/wire-app`, holding the adapter-manager's seven-package closure so the reference
# provider can serve the per-op wire a DEPLOYED worker speaks. See the DEP-019 block below for why
# it is here rather than in the shipped adapter-manager, and for the cost that buys.
#
# Base pinned BY DIGEST — same node:lts-trixie-slim index digest as the DEP-001
# split images (docker/control-plane/Dockerfile, docker/worker/Dockerfile).
FROM node:lts-trixie-slim@sha256:0711b541c1c33a8a530ac4f0d391baa9a15b3d804695b1b24a47daa5fb60e74d AS base
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/sandbox-fake-provider/package.json packages/sandbox-fake-provider/
COPY packages/worker-protocol/package.json packages/worker-protocol/
COPY patches/ patches/
RUN pnpm install --frozen-lockfile --prod --filter "@armyofagents/sandbox-fake-provider..."

FROM deps AS build
WORKDIR /app
RUN npm install --global typescript@5.7.3 @types/node@24
COPY tsconfig.json ./
COPY packages/worker-protocol/ packages/worker-protocol/
COPY packages/sandbox-fake-provider/ packages/sandbox-fake-provider/
RUN ln -s "$(npm root -g)/@types" node_modules/@types || true
RUN tsc -p packages/worker-protocol/tsconfig.json \
  && tsc -p packages/sandbox-fake-provider/tsconfig.json \
  && test -f packages/sandbox-fake-provider/dist/index.js \
    || (echo "ERROR: sandbox-fake-provider build output missing" && exit 1)
RUN pnpm --filter @armyofagents/sandbox-fake-provider deploy --prod /fake-app

# --- DEP-019: the provider WIRE tree -----------------------------------------
# The m1-spine journey is driven by the DEPLOYED worker, which reaches a provider over the
# adapter-manager WIRE (`POST /op/<op>` with `{args, ctx, capability}`) — not over this service's
# `/invoke` API. Serving that wire needs `createProviderServer`, so `/wire-app` is a SEPARATE
# `pnpm deploy` of `@armyofagents/adapter-manager`, built the way docker/adapter-manager builds it
# and for the reasons recorded there: a plain `--filter` (never `--filter-prod`, whose prod graph
# compiles provider-capability before worker-daemon's declarations exist), then a PROD-only
# deploy, then the publishConfig promotion pnpm 9's `deploy` does not do.
#
# ★ WHY NOT THE SHIPPED adapter-manager BIN. Teaching `bin/adapter-manager.ts` a `fake` provider
# arm was rejected: that bin is the only thing standing between a DEPLOYED provider host and an
# ungated, isolation-free boot, and a test convenience there is a fail-open. The harness hosts the
# wire instead; the shipped composition root stays `e2b`-only.
#
# ★ THE COST, STATED. This image's closure grows from sandbox-fake-provider + worker-protocol
# (+ zod) to that plus the adapter-manager's seven-package closure, which includes
# `sandbox-e2b-provider` and therefore the `e2b` SDK. No provider key is ever injected here — the
# D1 compose gives this service none — and `scripts/check-image-deps-stages.mjs` does not cover
# this Dockerfile, which is exactly why the growth is written down rather than left to be found.
# ★ ITS OWN deps + build STAGES, from `base` — not layered on the fake's `deps`. Measured: layering
# them failed with `packages/worker-daemon build: tsc exit 2` and pnpm's
# "Local package.json exists, but node_modules missing", because the fake's deps stage installs
# `--prod` (it needs no compiler) while the adapter-manager closure must be built, and the
# docker/adapter-manager recipe deliberately installs NON-prod for exactly that reason. Rather than
# reconcile two install postures in one tree, the wire tree is built the way its own image builds
# it, byte-for-byte.
FROM base AS wire-deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/adapter-manager/package.json packages/adapter-manager/
COPY packages/provider-wire/package.json packages/provider-wire/
COPY packages/sandbox-e2b-provider/package.json packages/sandbox-e2b-provider/
COPY packages/worker-daemon/package.json packages/worker-daemon/
COPY packages/worker-protocol/package.json packages/worker-protocol/
COPY packages/provider-capability/package.json packages/provider-capability/
COPY packages/sandbox-provider-contract/package.json packages/sandbox-provider-contract/
COPY patches/ patches/
RUN pnpm install --frozen-lockfile --filter "@armyofagents/adapter-manager..."

FROM wire-deps AS wire-build
WORKDIR /app
COPY . .
# Plain `--filter`, NEVER `--filter-prod` — docker/adapter-manager records why: under the prod
# graph provider-capability is a leaf and compiles before worker-daemon's declarations exist.
RUN pnpm install --frozen-lockfile --filter "@armyofagents/adapter-manager..."
RUN pnpm --filter "@armyofagents/adapter-manager..." build
RUN pnpm --filter @armyofagents/adapter-manager deploy --prod /wire-app
RUN node docker/apply-workspace-publish-config.mjs /wire-app/node_modules
# The two files the entry imports by ABSOLUTE PATH: the wire server, and the daemon's own
# ENV_PROBE_SCRIPT, which the probe-script digest pin is built from. A missing one is a BUILD
# failure here rather than an ERR_MODULE_NOT_FOUND on a lane that has already spent twenty
# minutes bringing a stack up.
RUN test -f /wire-app/dist/server.js \
  || (echo "ERROR: adapter-manager wire server build output missing" && exit 1)
RUN test -f /wire-app/node_modules/@armyofagents/worker-daemon/dist/supervisor/env-probe.js \
  || (echo "ERROR: worker-daemon env-probe build output missing in the wire tree" && exit 1)

FROM base AS production
LABEL org.opencontainers.image.title="AoA D1 Fake Sandbox Provider"
LABEL org.opencontainers.image.description="Deterministic fixture-driven fake sandbox provider (DEP-000) for the D1 harness"
LABEL org.armyofagents.image.role="fake-provider"

WORKDIR /fake-app
COPY --chown=node:node --from=build /fake-app /fake-app
COPY --chown=node:node --from=wire-build /wire-app /wire-app
COPY --chown=node:node docker/d1/fake-provider-entry.mjs /fake-app/fake-provider-entry.mjs
COPY --chown=node:node docker/d1/ctl-allowlist.mjs /fake-app/ctl-allowlist.mjs

# DEP-019 — the provider WIRE is OFF unless a port is configured. The base D1 train never sets
# it, so `bounded`/`foundation` see this image exactly as before; only the m1-spine override arms
# it, and arming it without the control-plane PUBLIC key is a refusal to boot, never an UNGATED
# server (the fail-open `createProviderServer` leaves open when its key is undefined).
ENV NODE_ENV=production \
  AOA_FAKE_PROVIDER_API_PORT=8080 \
  AOA_FAKE_PROVIDER_CTL_PORT=8081 \
  AOA_FAKE_PROVIDER_WIRE_APP_DIR=/wire-app \
  AOA_FAKE_PROVIDER_FIXTURES_DIR=/fixtures

USER node
EXPOSE 8080 8081 8082
HEALTHCHECK --interval=5s --timeout=5s --start-period=10s --retries=5 \
  CMD ["node","-e","fetch('http://127.0.0.1:'+(process.env.AOA_FAKE_PROVIDER_API_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "fake-provider-entry.mjs"]
