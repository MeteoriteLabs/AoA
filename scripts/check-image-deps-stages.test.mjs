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
//   adapter-manager            -> adapter-manager, provider-wire, sandbox-e2b-provider,
//                                 worker-daemon, worker-protocol, provider-capability,
//                                 sandbox-provider-contract (7). provider-capability is a
//                                 DEVdep of adapter-manager but a RUNTIME dep of provider-wire
//                                 (so it IS in the closure); sandbox-fake-provider is a devDep
//                                 of sandbox-provider-contract only (so it is NOT).
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
  // --- adapter-manager runtime closure (DEP-012 Slice 4+5) ---
  "packages/adapter-manager/package.json": {
    name: "@armyofagents/adapter-manager",
    dependencies: {
      "@armyofagents/provider-wire": "workspace:*",
      "@armyofagents/sandbox-e2b-provider": "workspace:*",
      "@armyofagents/worker-daemon": "workspace:*",
    },
    // provider-capability is a DEVdep here — reached at runtime ONLY via provider-wire.
    devDependencies: { "@armyofagents/provider-capability": "workspace:*" },
  },
  "packages/provider-wire/package.json": {
    name: "@armyofagents/provider-wire",
    dependencies: {
      "@armyofagents/provider-capability": "workspace:*",
      "@armyofagents/sandbox-e2b-provider": "workspace:*",
      "@armyofagents/worker-daemon": "workspace:*",
      "@armyofagents/worker-protocol": "workspace:*",
    },
  },
  "packages/sandbox-e2b-provider/package.json": {
    name: "@armyofagents/sandbox-e2b-provider",
    dependencies: {
      "@armyofagents/sandbox-provider-contract": "workspace:*",
      "@armyofagents/worker-daemon": "workspace:*",
      "@armyofagents/worker-protocol": "workspace:*",
      e2b: "^2.30.5",
      zod: "3.24.2",
    },
  },
  "packages/provider-capability/package.json": {
    name: "@armyofagents/provider-capability",
    dependencies: {},
    // worker-daemon here is a TYPE-only devDep — never pulled into the runtime closure.
    devDependencies: { "@armyofagents/worker-daemon": "workspace:*" },
  },
  "packages/sandbox-provider-contract/package.json": {
    name: "@armyofagents/sandbox-provider-contract",
    dependencies: { "@armyofagents/worker-protocol": "workspace:*", zod: "3.24.2" },
    // sandbox-fake-provider is a devDep only — deliberately OUT of the runtime closure.
    devDependencies: { "@armyofagents/sandbox-fake-provider": "workspace:*" },
  },
  "packages/sandbox-fake-provider/package.json": {
    name: "@armyofagents/sandbox-fake-provider",
    dependencies: { "@armyofagents/worker-protocol": "workspace:*" },
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
const ADAPTER_DEPS = [
  "COPY packages/adapter-manager/package.json packages/adapter-manager/",
  "COPY packages/provider-wire/package.json packages/provider-wire/",
  "COPY packages/sandbox-e2b-provider/package.json packages/sandbox-e2b-provider/",
  "COPY packages/worker-daemon/package.json packages/worker-daemon/",
  "COPY packages/worker-protocol/package.json packages/worker-protocol/",
  "COPY packages/provider-capability/package.json packages/provider-capability/",
  "COPY packages/sandbox-provider-contract/package.json packages/sandbox-provider-contract/",
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

function setup(
  t,
  {
    control = dockerfile(CONTROL_DEPS),
    worker = dockerfile(WORKER_DEPS),
    adapterManager = dockerfile(ADAPTER_DEPS),
  } = {},
) {
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
  write("docker/adapter-manager/Dockerfile", adapterManager);
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

test("DEP-012: adapter-manager exact 7-package closure passes clean", (t) => {
  // The default setup writes the AM Dockerfile with ADAPTER_DEPS (the exact closure).
  const root = setup(t);
  const { errors } = runDepsStageCheck(root);
  assert.deepEqual(errors, [], errors.join(" | "));
});

test("DEP-012: adapter-manager deps stage COPYing server (out-of-closure) FAILS", (t) => {
  const root = setup(t, {
    adapterManager: dockerfile([...ADAPTER_DEPS, "COPY server/package.json server/"]),
  });
  const { errors } = runDepsStageCheck(root);
  assert.ok(
    hasSubstr(errors, "adapter-manager: deps stage COPYs server/package.json which is OUTSIDE the image closure"),
    errors.join(" | "),
  );
});

test("DEP-012: adapter-manager deps stage COPYing sandbox-fake-provider (devDep, out-of-closure) FAILS", (t) => {
  const root = setup(t, {
    adapterManager: dockerfile([
      ...ADAPTER_DEPS,
      "COPY packages/sandbox-fake-provider/package.json packages/sandbox-fake-provider/",
    ]),
  });
  const { errors } = runDepsStageCheck(root);
  assert.ok(
    hasSubstr(
      errors,
      "adapter-manager: deps stage COPYs packages/sandbox-fake-provider/package.json which is OUTSIDE the image closure",
    ),
    errors.join(" | "),
  );
});

test("DEP-012: adapter-manager deps stage MISSING provider-capability (closure via provider-wire) FAILS", (t) => {
  const trimmed = ADAPTER_DEPS.filter((l) => !l.includes("packages/provider-capability/"));
  const root = setup(t, { adapterManager: dockerfile(trimmed) });
  const { errors } = runDepsStageCheck(root);
  assert.ok(
    hasSubstr(errors, "adapter-manager: deps stage is MISSING closure manifest: COPY packages/provider-capability/package.json"),
    errors.join(" | "),
  );
});

test("COPY with a --chown flag is still parsed for its workspace source", (t) => {
  const control = dockerfile(
    CONTROL_DEPS.map((l) => l.replace("COPY ", "COPY --chown=node:node ")),
  );
  const root = setup(t, { control });
  const { errors } = runDepsStageCheck(root);
  assert.deepEqual(errors, [], errors.join(" | "));
});
