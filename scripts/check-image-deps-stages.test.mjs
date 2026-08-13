#!/usr/bin/env node
/**
 * check-image-deps-stages.test.mjs — corpus for the split-image deps-stage
 * parity gate (DEP-001).
 *
 * Run with:
 *   node --test scripts/check-image-deps-stages.test.mjs
 *
 * Each case builds a minimal workspace (a few `@armyofagents/*` manifests) plus
 * the two split Dockerfiles under an isolated root, runs `runDepsStageCheck`,
 * and asserts parity holds or the exact violation. It proves:
 *   - the exact-closure baseline passes clean;
 *   - a worker deps stage that COPYs server/db FAILS (E4-D01 headline: no
 *     server/db in the worker image);
 *   - a control-plane deps stage MISSING a closure manifest FAILS;
 *   - a control-plane deps stage that COPYs an OUT-OF-CLOSURE manifest (cli)
 *     FAILS (least-privilege "no more");
 *   - a missing `deps` stage / missing Dockerfile is reported.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runDepsStageCheck } from "./check-image-deps-stages.mjs";

// A minimal workspace. Closures:
//   control-plane {server, ui} -> server, ui, packages/db, packages/shared, packages/worker-protocol
//   worker {worker-daemon}     -> packages/worker-daemon, packages/worker-protocol
const WORKSPACE = {
  "server/package.json": {
    name: "@armyofagents/server",
    dependencies: {
      "@armyofagents/db": "workspace:*",
      "@armyofagents/shared": "workspace:*",
      "@armyofagents/worker-protocol": "workspace:*",
    },
  },
  "ui/package.json": {
    name: "@armyofagents/ui",
    dependencies: { "@armyofagents/shared": "workspace:*" },
  },
  "cli/package.json": {
    name: "@armyofagents/cli",
    dependencies: { "@armyofagents/shared": "workspace:*" },
  },
  "packages/db/package.json": {
    name: "@armyofagents/db",
    dependencies: { "@armyofagents/shared": "workspace:*" },
  },
  "packages/shared/package.json": { name: "@armyofagents/shared", dependencies: {} },
  "packages/worker-protocol/package.json": {
    name: "@armyofagents/worker-protocol",
    dependencies: { zod: "3.24.2" },
  },
  "packages/worker-daemon/package.json": {
    name: "@armyofagents/worker-daemon",
    dependencies: { "@armyofagents/worker-protocol": "workspace:*", pino: "^9.6.0" },
    devDependencies: { "@armyofagents/shared": "workspace:*" },
  },
};

const CONTROL_DEPS = [
  "COPY server/package.json server/",
  "COPY ui/package.json ui/",
  "COPY packages/db/package.json packages/db/",
  "COPY packages/shared/package.json packages/shared/",
  "COPY packages/worker-protocol/package.json packages/worker-protocol/",
];
const WORKER_DEPS = [
  "COPY packages/worker-daemon/package.json packages/worker-daemon/",
  "COPY packages/worker-protocol/package.json packages/worker-protocol/",
];

function dockerfile(depsCopies) {
  return [
    "FROM node@sha256:" + "0".repeat(64) + " AS base",
    "FROM base AS deps",
    "WORKDIR /app",
    "COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./",
    ...depsCopies,
    "COPY patches/ patches/",
    'RUN pnpm install --frozen-lockfile',
    "FROM base AS production",
    'CMD ["node","x.js"]',
    "",
  ].join("\n");
}

function setup(t, { control = dockerfile(CONTROL_DEPS), worker = dockerfile(WORKER_DEPS) } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ideps-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [rel, obj] of Object.entries(WORKSPACE)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(obj, null, 2));
  }
  const write = (rel, text) => {
    if (text === null) return;
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  };
  write("docker/control-plane/Dockerfile", control);
  write("docker/worker/Dockerfile", worker);
  return root;
}

const hasSubstr = (arr, sub) => arr.some((e) => e.includes(sub));

test("exact-closure baseline passes clean", (t) => {
  const root = setup(t);
  const { errors } = runDepsStageCheck(root);
  assert.deepEqual(errors, [], errors.join(" | "));
});

test("E4-D01: worker deps stage that COPYs server FAILS (out-of-closure)", (t) => {
  const root = setup(t, {
    worker: dockerfile([...WORKER_DEPS, "COPY server/package.json server/"]),
  });
  const { errors } = runDepsStageCheck(root);
  assert.ok(
    hasSubstr(errors, "worker: deps stage COPYs server/package.json which is OUTSIDE the image closure"),
    errors.join(" | "),
  );
});

test("E4-D01: worker deps stage that COPYs packages/db FAILS (out-of-closure)", (t) => {
  const root = setup(t, {
    worker: dockerfile([...WORKER_DEPS, "COPY packages/db/package.json packages/db/"]),
  });
  const { errors } = runDepsStageCheck(root);
  assert.ok(
    hasSubstr(errors, "worker: deps stage COPYs packages/db/package.json which is OUTSIDE the image closure"),
    errors.join(" | "),
  );
});

test("control-plane deps stage MISSING a closure manifest (packages/db) FAILS", (t) => {
  const trimmed = CONTROL_DEPS.filter((l) => !l.includes("packages/db/"));
  const root = setup(t, { control: dockerfile(trimmed) });
  const { errors } = runDepsStageCheck(root);
  assert.ok(
    hasSubstr(errors, "control-plane: deps stage is MISSING closure manifest: COPY packages/db/package.json"),
    errors.join(" | "),
  );
});

test("control-plane deps stage COPYing cli (out-of-closure) FAILS least-privilege", (t) => {
  const root = setup(t, {
    control: dockerfile([...CONTROL_DEPS, "COPY cli/package.json cli/"]),
  });
  const { errors } = runDepsStageCheck(root);
  assert.ok(
    hasSubstr(errors, "control-plane: deps stage COPYs cli/package.json which is OUTSIDE the image closure"),
    errors.join(" | "),
  );
});

test("a Dockerfile with no 'AS deps' stage is reported", (t) => {
  const noDeps = ["FROM node@sha256:" + "0".repeat(64) + " AS base", "FROM base AS production", ""].join("\n");
  const root = setup(t, { worker: noDeps });
  const { errors } = runDepsStageCheck(root);
  assert.ok(hasSubstr(errors, "worker: could not find a 'FROM ... AS deps' stage"), errors.join(" | "));
});

test("a missing Dockerfile is reported", (t) => {
  const root = setup(t);
  fs.rmSync(path.join(root, "docker/worker/Dockerfile"));
  const { errors } = runDepsStageCheck(root);
  assert.ok(hasSubstr(errors, "worker: Dockerfile not found"), errors.join(" | "));
});

test("COPY with a --chown flag is still parsed for its workspace source", (t) => {
  const control = dockerfile(
    CONTROL_DEPS.map((l) => l.replace("COPY ", "COPY --chown=node:node ")),
  );
  const root = setup(t, { control });
  const { errors } = runDepsStageCheck(root);
  assert.deepEqual(errors, [], errors.join(" | "));
});
