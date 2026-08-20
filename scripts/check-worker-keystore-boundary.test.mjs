#!/usr/bin/env node
/**
 * Mutation / decoy / bypass corpus for the worker-keystore boundary gate
 * (DSK-001 D2 / I23). Run with:
 *   node --test scripts/check-worker-keystore-boundary.test.mjs
 *
 * A checker nobody has tried to defeat is not a guard. This proves, against
 * synthetic package trees, that the gate REJECTS each way the confinement could
 * be lost, and ACCEPTS the legitimate shape — plus that the real package on disk
 * passes clean.
 *
 * The confinement matters because a private device key crosses a process
 * boundary on stdin. Every decision about how that happens is pure and OS-free so
 * it can be proven on the ubuntu-only REQUIRED lane; that only means something if
 * the dangerous capability genuinely stays in one file.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runBoundaryCheck, WORKER_KEYSTORE_BOUNDARY_PACKAGES } from "./check-worker-keystore-boundary.mjs";

const PKG_REL = "packages/worker-keystore";
const PKG_NAME = "@armyofagents/worker-keystore";
const ONE_PACKAGE = [{ rel: PKG_REL, name: PKG_NAME }];
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = "/synthetic";

function manifest(over = {}) {
  return {
    name: PKG_NAME,
    version: "0.1.0",
    private: true,
    type: "module",
    dependencies: {
      "@armyofagents/worker-daemon": "workspace:*",
      "@armyofagents/worker-protocol": "workspace:*",
    },
    devDependencies: { typescript: "^5.7.3", vitest: "^3.2.6" },
    ...over,
  };
}

/** Build an in-memory package tree and run the real checker against it. */
function checkTree({ files, pkg = manifest() }) {
  const srcRel = `${PKG_REL}/src`;
  const readFile = async (absolute) => {
    const rel = path.relative(ROOT, absolute).replaceAll("\\", "/");
    if (rel === `${PKG_REL}/package.json`) return JSON.stringify(pkg);
    const name = rel.slice(srcRel.length + 1);
    if (Object.hasOwn(files, name)) return files[name];
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  };
  const readdir = async (absolute) => {
    const rel = path.relative(ROOT, absolute).replaceAll("\\", "/");
    if (rel !== srcRel) return [];
    return Object.keys(files).map((name) => ({
      name,
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
    }));
  };
  return runBoundaryCheck(ROOT, { readFile, readdir, packages: ONE_PACKAGE });
}

const clean = { "command-runner.ts": 'import { execFileSync } from "node:child_process";\n' };

test("accepts the legitimate shape", async () => {
  const { policyErrors, readErrors } = await checkTree({ files: clean });
  assert.deepEqual(policyErrors, []);
  assert.deepEqual(readErrors, []);
});

test("accepts child_process imported from the confinement host", async () => {
  const { policyErrors } = await checkTree({
    files: { "command-runner.ts": 'import cp from "child_process";\nimport { existsSync } from "node:fs";\n' },
  });
  assert.deepEqual(policyErrors, []);
});

test("REJECTS child_process imported from any other runtime file", async () => {
  for (const name of ["outcome.ts", "identity-store.ts", "index.ts", "sneaky-runner.ts"]) {
    const { policyErrors } = await checkTree({
      files: { ...clean, [name]: 'import { execFileSync } from "node:child_process";\n' },
    });
    assert.equal(policyErrors.length, 1, `${name} should be rejected`);
    assert.match(policyErrors[0], /may be imported ONLY from src\/command-runner\.ts/);
  }
});

test("REJECTS a SAME-NAMED file in a subdirectory — the confinement is a PATH, not a basename", async () => {
  // This passed before the fix: the check keyed on `path.basename`, so anyone who
  // created `src/anything/command-runner.ts` inherited spawn permission. Verified
  // live against the real tree before and after.
  const { policyErrors } = await checkTree({
    files: { ...clean, "sneaky/command-runner.ts": 'import { execFileSync } from "node:child_process";\n' },
  });
  assert.equal(policyErrors.length, 1);
  assert.match(policyErrors[0], /ONE PATH/);
});

test("REJECTS the bare `child_process` specifier too, not just the node: form", async () => {
  const { policyErrors } = await checkTree({
    files: { ...clean, "outcome.ts": 'import { execFileSync } from "child_process";\n' },
  });
  assert.equal(policyErrors.length, 1);
});

test("REJECTS a native keychain binding added as a runtime dependency", async () => {
  // The package is injected INTO the daemon's process; keytar arriving here by
  // accident is precisely what the daemon's own two-dependency pin forbids.
  for (const dep of ["keytar", "@napi-rs/keyring", "electron"]) {
    const { policyErrors } = await checkTree({
      files: clean,
      pkg: manifest({
        dependencies: {
          "@armyofagents/worker-daemon": "workspace:*",
          "@armyofagents/worker-protocol": "workspace:*",
          [dep]: "^1.0.0",
        },
      }),
    });
    assert.equal(policyErrors.length, 1, `${dep} should be rejected`);
    assert.match(policyErrors[0], /runtime dependencies must equal/);
  }
});

test("REJECTS a dependency moved into peerDependencies to dodge the check", async () => {
  const { policyErrors } = await checkTree({
    files: clean,
    pkg: manifest({ peerDependencies: { keytar: "^7.9.0" } }),
  });
  assert.equal(policyErrors.length, 1);
});

test("REJECTS a non-literal import, which would defeat lexical confinement entirely", async () => {
  const { policyErrors } = await checkTree({
    files: { ...clean, "outcome.ts": "const m = await import(someName);\n" },
  });
  assert.equal(policyErrors.length, 1);
  assert.match(policyErrors[0], /non-literal/);
});

test("REJECTS the node:module createRequire bridge", async () => {
  // createRequire resolves ANY package from the hoisted monorepo node_modules at
  // runtime — a general-purpose escape from every rule above.
  for (const spec of ["node:module", "module"]) {
    const { policyErrors } = await checkTree({
      files: { ...clean, "outcome.ts": `import { createRequire } from "${spec}";\n` },
    });
    assert.equal(policyErrors.length, 1, spec);
  }
});

test("REJECTS a forbidden bare import into a package holding a private key", async () => {
  for (const spec of ["@armyofagents/db", "@armyofagents/server", "drizzle-orm", "pg", "express"]) {
    const { policyErrors } = await checkTree({
      files: { ...clean, "outcome.ts": `import x from "${spec}";\n` },
    });
    assert.equal(policyErrors.length, 1, spec);
  }
});

test("REJECTS a relative import that escapes the package src", async () => {
  const { policyErrors } = await checkTree({
    files: { ...clean, "outcome.ts": 'import x from "../../worker-daemon/src/secret.js";\n' },
  });
  assert.equal(policyErrors.length, 1);
  assert.match(policyErrors[0], /escapes package src/);
});

test("REJECTS a runtime import of test source", async () => {
  const { policyErrors } = await checkTree({
    files: { ...clean, "outcome.ts": 'import x from "./helper.test.js";\n' },
  });
  assert.equal(policyErrors.length, 1);
});

test("REJECTS a wrong package name", async () => {
  const { policyErrors } = await checkTree({ files: clean, pkg: manifest({ name: "@armyofagents/not-this" }) });
  assert.equal(policyErrors.length, 1);
});

test("the REAL package on disk passes clean", async () => {
  const { policyErrors, readErrors } = await runBoundaryCheck(REPO_ROOT, {
    packages: WORKER_KEYSTORE_BOUNDARY_PACKAGES,
  });
  assert.deepEqual(readErrors, []);
  assert.deepEqual(policyErrors, []);
});
