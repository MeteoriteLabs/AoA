#!/usr/bin/env node
/**
 * Mutation / decoy / bypass corpus for the sandbox-fake-provider boundary gate
 * (DEP-000). It proves the machine-checkable "no tenant/server/db code on the
 * host worker" seam for BOTH new leaf packages.
 *
 * Run with:
 *   node --test scripts/check-sandbox-fake-provider-boundary.test.mjs
 *
 * Each case builds a minimal temporary package tree under an isolated root, runs
 * `runBoundaryCheck(root, { packages:[…] })` against a single synthetic package,
 * and asserts the exact import-policy violation or read/parse error. The corpus
 * proves:
 *   - rejection of forbidden server/db/shared/adapters/worker-daemon/contract/
 *     drizzle/pg/Express bare imports (the DEP-000 headline);
 *   - ACCEPTANCE of the allowed set: `@armyofagents/worker-protocol`, `zod`
 *     (+ `zod/*`), Node built-ins (`node:*` and bare), relative `src` imports;
 *   - rejection of the CommonJS require bridge + node:module;
 *   - rejection of every alternate runtime-source extension, `.test` imports,
 *     relative escapes, and runtime-source symlinks;
 *   - manifest policy: deps must equal EXACTLY {worker-protocol, zod}; the name
 *     must match; hidden optional/peer/bundled deps are caught;
 *   - that comment / string / template DECOYS never trip;
 *   - that a missing/unreadable manifest or src is a read error, not policy.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFile as realReadFile } from "node:fs/promises";

import { runBoundaryCheck } from "./check-sandbox-fake-provider-boundary.mjs";
import { FAKE_PROVIDER_PACKAGE } from "./lib/sandbox-fake-provider-boundary.mjs";

const PKG_REL = "packages/sandbox-fake-provider";
const PKG_NAME = "@armyofagents/sandbox-fake-provider";
const ONE_PACKAGE = [{ rel: PKG_REL, name: PKG_NAME }];

function defaultManifest() {
  return {
    name: PKG_NAME,
    version: "0.1.0",
    private: true,
    type: "module",
    dependencies: {
      "@armyofagents/worker-protocol": "workspace:*",
      zod: "3.24.2",
    },
  };
}

function setup(t, opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sfp-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pkgDir = path.join(root, ...PKG_REL.split("/"));
  const srcDir = path.join(pkgDir, "src");

  if (opts.manifestText !== null) {
    fs.mkdirSync(pkgDir, { recursive: true });
    const text = opts.manifestText ?? JSON.stringify(opts.manifestObject ?? defaultManifest(), null, 2);
    fs.writeFileSync(path.join(pkgDir, "package.json"), text);
  }
  if (opts.src !== null) {
    fs.mkdirSync(srcDir, { recursive: true });
    for (const [name, content] of Object.entries(opts.src ?? {})) {
      const abs = path.join(srcDir, name);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
  }
  return { root, pkgDir, srcDir };
}

const run = (root, deps = {}) => runBoundaryCheck(root, { packages: ONE_PACKAGE, ...deps });
const hasSubstr = (arr, sub) => arr.some((e) => e.includes(sub));

// --------------------------------------------------------------------------
// Valid baseline + decoys
// --------------------------------------------------------------------------

test("valid baseline: worker-protocol + zod + node builtins + relative imports pass clean", async (t) => {
  const index = [
    'import { PROVIDER_OPERATIONS } from "@armyofagents/worker-protocol";',
    'import { z } from "zod";',
    'import { createServer } from "node:http";',
    'import { createHash } from "node:crypto";',
    'import os from "node:os";',
    'import fsp from "node:fs/promises";',
    'import { ledger } from "./invocation-ledger.js";',
    'import { helper } from "./sub/helper.js";',
    '// import evil from "@armyofagents/db"',
    '/* import bad from "drizzle-orm"; export * from "@armyofagents/server"; */',
    'const decoy = "import x from \'@armyofagents/db\'; require(\'pg\')";',
    "const tmpl = `mentions @armyofagents/server and drizzle-orm ${PROVIDER_OPERATIONS.length}`;",
    "export const value = z && os && createServer && createHash && fsp && ledger && helper && tmpl;",
    "",
  ].join("\n");
  const { root } = setup(t, {
    src: {
      "index.ts": index,
      "invocation-ledger.ts": "export const ledger = 1;\n",
      "sub/helper.ts": "export const helper = 1;\n",
    },
  });
  const { policyErrors, readErrors } = await run(root);
  assert.deepEqual(policyErrors, [], `unexpected policy errors: ${policyErrors.join(" | ")}`);
  assert.deepEqual(readErrors, [], `unexpected read errors: ${readErrors.join(" | ")}`);
});

test("process/Buffer/URL globals are ALLOWED (the fake is a runtime program)", async (t) => {
  const { root } = setup(t, {
    src: {
      "index.ts":
        "export const a = process.env.PORT;\n" +
        'export const b = new URL("http://127.0.0.1");\n' +
        'export const c = Buffer.from("x");\n',
    },
  });
  const { policyErrors } = await run(root);
  assert.deepEqual(policyErrors, [], `globals must not be flagged: ${policyErrors.join(" | ")}`);
});

test("zod subpath imports are allowed", async (t) => {
  const { root } = setup(t, { src: { "index.ts": 'import { z } from "zod/lib";\nexport const a = z;\n' } });
  const { policyErrors } = await run(root);
  assert.deepEqual(policyErrors, [], policyErrors.join(" | "));
});

// --------------------------------------------------------------------------
// Forbidden bare imports — the DEP-000 headline
// --------------------------------------------------------------------------

const FORBIDDEN_IMPORTS = {
  "@armyofagents/db": 'import { db } from "@armyofagents/db";\n',
  "@armyofagents/server": 'import { app } from "@armyofagents/server";\n',
  "@armyofagents/shared": 'import { x } from "@armyofagents/shared";\n',
  "@armyofagents/adapters": 'import { r } from "@armyofagents/adapters";\n',
  "@armyofagents/worker-daemon": 'import { d } from "@armyofagents/worker-daemon";\n',
  "@armyofagents/sandbox-provider-contract": 'import { c } from "@armyofagents/sandbox-provider-contract";\n',
  "drizzle-orm": 'import { sql } from "drizzle-orm";\n',
  pg: 'import { Pool } from "pg";\n',
  express: 'import express from "express";\n',
  pino: 'import pino from "pino";\n',
  lodash: 'import _ from "lodash";\n',
};
for (const [spec, src] of Object.entries(FORBIDDEN_IMPORTS)) {
  test(`rejects forbidden runtime import ${spec}`, async (t) => {
    const { root } = setup(t, { src: { "index.ts": src } });
    const { policyErrors } = await run(root);
    assert.ok(
      hasSubstr(policyErrors, `forbidden runtime import ${JSON.stringify(spec)}`),
      `expected ${spec} rejection, got: ${policyErrors.join(" | ")}`,
    );
  });
}

test("rejects db + server + drizzle together (non-empty violations)", async (t) => {
  const src = [
    'import { db } from "@armyofagents/db";',
    'import { app } from "@armyofagents/server";',
    'import { sql } from "drizzle-orm";',
    "export const x = db && app && sql;",
    "",
  ].join("\n");
  const { root } = setup(t, { src: { "index.ts": src } });
  const { policyErrors } = await run(root);
  assert.ok(policyErrors.length >= 3, `expected >=3 violations, got: ${policyErrors.join(" | ")}`);
  assert.ok(hasSubstr(policyErrors, '"@armyofagents/db"'), policyErrors.join(" | "));
  assert.ok(hasSubstr(policyErrors, '"@armyofagents/server"'), policyErrors.join(" | "));
  assert.ok(hasSubstr(policyErrors, '"drizzle-orm"'), policyErrors.join(" | "));
});

const BYPASSES = {
  "side-effect": { src: 'import "@armyofagents/db";\n', needle: 'forbidden runtime import "@armyofagents/db"' },
  static: { src: 'import { db } from "@armyofagents/db";\n', needle: 'forbidden runtime import "@armyofagents/db"' },
  "export-from": { src: 'export * from "drizzle-orm";\n', needle: 'forbidden runtime import "drizzle-orm"' },
  dynamic: { src: 'export async function f() { return import("pg"); }\n', needle: 'forbidden runtime import "pg"' },
};
for (const [label, { src, needle }] of Object.entries(BYPASSES)) {
  test(`real ${label} import of a forbidden module is caught`, async (t) => {
    const { root } = setup(t, { src: { "index.ts": src } });
    const { policyErrors } = await run(root);
    assert.ok(hasSubstr(policyErrors, needle), `expected ${needle}, got: ${policyErrors.join(" | ")}`);
  });
}

// --------------------------------------------------------------------------
// CommonJS bridge + alternate extensions + test imports + escapes + symlink
// --------------------------------------------------------------------------

test("CommonJS require() is rejected (bypasses the static import allowlist)", async (t) => {
  const { root } = setup(t, { src: { "index.ts": 'export const pool = require("pg");\n' } });
  const { policyErrors } = await run(root);
  assert.ok(hasSubstr(policyErrors, "CommonJS require() is forbidden"), policyErrors.join(" | "));
});

test("node:module (createRequire bridge) is rejected even though it is a Node builtin", async (t) => {
  const { root } = setup(t, {
    src: { "index.ts": 'import { createRequire } from "node:module";\nexport const r = createRequire;\n' },
  });
  const { policyErrors } = await run(root);
  assert.ok(hasSubstr(policyErrors, 'forbidden runtime import "node:module"'), policyErrors.join(" | "));
});

for (const ext of ["d.ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]) {
  test(`rejects alternate runtime-source extension .${ext}`, async (t) => {
    const { root } = setup(t, {
      src: { "index.ts": 'import { z } from "zod";\nexport const a = z;\n', [`extra.${ext}`]: "export {};\n" },
    });
    const { policyErrors } = await run(root);
    assert.ok(
      hasSubstr(policyErrors, `extra.${ext}: alternate runtime-source extensions are forbidden`),
      `expected alternate-extension rejection for .${ext}, got: ${policyErrors.join(" | ")}`,
    );
  });
}

for (const spec of ["./thing.test.js", "./thing.test", "./thing.test.ts"]) {
  test(`rejects runtime import of test source ${spec}`, async (t) => {
    const { root } = setup(t, { src: { "index.ts": `import { x } from "${spec}";\n` } });
    const { policyErrors } = await run(root);
    assert.ok(hasSubstr(policyErrors, "runtime import of test source is forbidden"), policyErrors.join(" | "));
  });
}

const ESCAPES = {
  "static import": 'import { x } from "../../../server/x.js";\n',
  "side-effect import": 'import "../../server/y.js";\n',
  "export ... from": 'export { z } from "../../../server/z.js";\n',
  "dynamic import": 'export async function f() { return import("../../../server/w.js"); }\n',
};
for (const [label, src] of Object.entries(ESCAPES)) {
  test(`rejects relative escape via ${label}`, async (t) => {
    const { root } = setup(t, { src: { "index.ts": src } });
    const { policyErrors } = await run(root);
    assert.ok(hasSubstr(policyErrors, "relative import escapes package src"), policyErrors.join(" | "));
  });
}

test("rejects a runtime-source symlink under src", async (t) => {
  const { root, srcDir } = setup(t, { src: { "index.ts": 'import { z } from "zod";\nexport const a = z;\n' } });
  const syntheticDirent = { name: "linked.ts", isSymbolicLink: () => true, isDirectory: () => false, isFile: () => false };
  const readdir = async (dir, options) => {
    const real = await fs.promises.readdir(dir, options);
    if (path.resolve(dir) === path.resolve(srcDir)) return [...real, syntheticDirent];
    return real;
  };
  const { policyErrors, readErrors } = await run(root, { readdir });
  assert.ok(hasSubstr(policyErrors, "linked.ts: runtime-source symlinks are forbidden"), policyErrors.join(" | "));
  assert.deepEqual(readErrors, []);
});

// --------------------------------------------------------------------------
// Manifest content policy
// --------------------------------------------------------------------------

test("rejects an extra runtime dependency", async (t) => {
  const manifest = defaultManifest();
  manifest.dependencies = { ...manifest.dependencies, pino: "^9.0.0" };
  const { root } = setup(t, { manifestObject: manifest, src: { "index.ts": "export const a = 1;\n" } });
  const { policyErrors } = await run(root);
  assert.ok(hasSubstr(policyErrors, "runtime dependencies must equal"), policyErrors.join(" | "));
});

test("rejects a missing runtime dependency (worker-protocol only, no zod)", async (t) => {
  const manifest = defaultManifest();
  manifest.dependencies = { "@armyofagents/worker-protocol": "workspace:*" };
  const { root } = setup(t, { manifestObject: manifest, src: { "index.ts": "export const a = 1;\n" } });
  const { policyErrors } = await run(root);
  assert.ok(hasSubstr(policyErrors, "runtime dependencies must equal"), policyErrors.join(" | "));
});

for (const field of ["optionalDependencies", "peerDependencies"]) {
  test(`a forbidden dep hidden in ${field} is rejected`, async (t) => {
    const manifest = defaultManifest();
    manifest[field] = { "drizzle-orm": "*" };
    const { root } = setup(t, { manifestObject: manifest, src: { "index.ts": "export const x = 1;\n" } });
    const { policyErrors } = await run(root);
    assert.ok(hasSubstr(policyErrors, "runtime dependencies must equal"), policyErrors.join(" | "));
  });
}

test("a forbidden dep in bundledDependencies is rejected", async (t) => {
  const manifest = defaultManifest();
  manifest.bundledDependencies = ["pg"];
  const { root } = setup(t, { manifestObject: manifest, src: { "index.ts": "export const x = 1;\n" } });
  const { policyErrors } = await run(root);
  assert.ok(hasSubstr(policyErrors, "runtime dependencies must equal"), policyErrors.join(" | "));
});

test("rejects a wrong package name", async (t) => {
  const manifest = defaultManifest();
  manifest.name = "@armyofagents/not-the-fake";
  const { root } = setup(t, { manifestObject: manifest, src: { "index.ts": "export const a = 1;\n" } });
  const { policyErrors } = await run(root);
  assert.ok(hasSubstr(policyErrors, "unexpected package name"), policyErrors.join(" | "));
});

// --------------------------------------------------------------------------
// Read/parse errors separated from policy
// --------------------------------------------------------------------------

test("missing package reports missing manifest AND missing src (read errors, not policy)", async (t) => {
  const { root } = setup(t, { manifestText: null, src: null });
  const { policyErrors, readErrors } = await run(root);
  assert.ok(hasSubstr(readErrors, `${PKG_REL}/package.json: missing or unreadable`), readErrors.join(" | "));
  assert.ok(hasSubstr(readErrors, `${PKG_REL}/src: missing`), readErrors.join(" | "));
  assert.deepEqual(policyErrors, []);
});

test("invalid manifest JSON is a read/parse error", async (t) => {
  const { root } = setup(t, { manifestText: "{ not json ", src: { "index.ts": "export const a = 1;\n" } });
  const { readErrors } = await run(root);
  assert.ok(hasSubstr(readErrors, "package.json: invalid JSON"), readErrors.join(" | "));
});

test("an unreadable source file is a read error, not a policy result", async (t) => {
  const { root, srcDir } = setup(t, { src: { "index.ts": 'import { z } from "zod";\nexport const a = z;\n' } });
  const target = path.join(srcDir, "index.ts");
  const readFile = async (p, enc) => {
    if (path.resolve(p) === path.resolve(target)) {
      const err = new Error("permission denied");
      err.code = "EACCES";
      throw err;
    }
    return realReadFile(p, enc);
  };
  const { policyErrors, readErrors } = await run(root, { readFile });
  assert.ok(hasSubstr(readErrors, "index.ts: unreadable source (EACCES)"), readErrors.join(" | "));
  assert.deepEqual(policyErrors, [], policyErrors.join(" | "));
});

// --------------------------------------------------------------------------
// Both real packages are covered by the default package list
// --------------------------------------------------------------------------

test("the default package list covers BOTH sandbox packages", async (t) => {
  const { runBoundaryCheck: real, SANDBOX_BOUNDARY_PACKAGES } = await import("./check-sandbox-fake-provider-boundary.mjs");
  assert.ok(Array.isArray(SANDBOX_BOUNDARY_PACKAGES), "SANDBOX_BOUNDARY_PACKAGES should be exported");
  const names = SANDBOX_BOUNDARY_PACKAGES.map((p) => p.name).sort();
  assert.deepEqual(names, ["@armyofagents/sandbox-fake-provider", "@armyofagents/sandbox-provider-contract"]);
  assert.equal(typeof real, "function");
});

// ==========================================================================
// THE INBOUND ARM (DEP-021) — who may depend on / import the fake provider.
//
// The corpus above is OUTBOUND: what the two leaf packages may import. These cases are the
// other direction, which is the one that decides whether a FABRICATING provider (and every
// `--aoa-fake-*` scripting flag it carries) is reachable from a production build.
//
// ★ EVERY CASE HERE IS A POSITIVE CONTROL. At `eb8458bb3` the real tree already satisfied the
// inbound policy, so an arm with no reds would be indistinguishable from an arm that
// evaluates nothing. Each case therefore MUTATES a synthetic workspace and asserts the exact
// violation string, and the last two assert the fail-closed refusals on an empty scan.
// ==========================================================================

const WORKSPACE_YAML = ["packages:", "  - packages/*", "  - server", ""].join("\n");

/** Build a synthetic workspace root: `pnpm-workspace.yaml` plus the packages described. */
function inboundSetup(t, packages) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sfp-in-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"), WORKSPACE_YAML);
  for (const pkg of packages) {
    const dir = path.join(root, ...pkg.rel.split("/"));
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg.manifest, null, 2));
    for (const [name, source] of Object.entries(pkg.sources ?? { "src/index.ts": "export const ok = 1;\n" })) {
      const target = path.join(dir, ...name.split("/"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, source);
    }
  }
  return root;
}

/** The minimal clean workspace: one production package and the fake provider itself. */
function cleanPackages(overrides = {}) {
  return [
    {
      rel: "server",
      manifest: { name: "@armyofagents/server", dependencies: { zod: "3.24.2" }, ...(overrides.server ?? {}) },
      sources: overrides.serverSources,
    },
    {
      rel: "packages/sandbox-fake-provider",
      manifest: {
        name: FAKE_PROVIDER_PACKAGE,
        dependencies: { "@armyofagents/worker-protocol": "workspace:*", zod: "3.24.2" },
      },
      // The fake's OWN source names itself in a string; `self` must not trip on it.
      sources: { "src/index.ts": `export const me = "${FAKE_PROVIDER_PACKAGE}";\n` },
    },
  ];
}

async function runInbound(root, opts) {
  const { runInboundCheck } = await import("./check-sandbox-fake-provider-boundary.mjs");
  return runInboundCheck(root, opts);
}

test("inbound: the clean workspace passes, and the scan is NON-VACUOUS", async (t) => {
  const root = inboundSetup(t, cleanPackages());
  const { policyErrors, readErrors, scanned } = await runInbound(root);
  assert.deepEqual(policyErrors, [], policyErrors.join(" | "));
  assert.deepEqual(readErrors, [], readErrors.join(" | "));
  // The counts are the non-vacuity assertion: a walk that found nothing would otherwise be a
  // pass. Asserted BEFORE any red below is trusted.
  assert.equal(scanned.packages, 2);
  assert.ok(scanned.sources >= 2, `expected >= 2 sources, got ${scanned.sources}`);
});

test("inbound RED: a production manifest given a runtime dependency on the fake", async (t) => {
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    const root = inboundSetup(t, cleanPackages({ server: { [field]: { [FAKE_PROVIDER_PACKAGE]: "workspace:*" } } }));
    const { policyErrors } = await runInbound(root);
    assert.ok(
      hasSubstr(policyErrors, `server/package.json: ${field} must not contain ${FAKE_PROVIDER_PACKAGE}`),
      `${field}: ${policyErrors.join(" | ")}`,
    );
    assert.ok(hasSubstr(policyErrors, "a runtime edge makes a FABRICATING provider production-reachable"));
  }
});

test("inbound RED: a bundled dependency on the fake, under either spelling", async (t) => {
  for (const field of ["bundledDependencies", "bundleDependencies"]) {
    const root = inboundSetup(t, cleanPackages({ server: { [field]: [FAKE_PROVIDER_PACKAGE] } }));
    const { policyErrors } = await runInbound(root);
    assert.ok(
      hasSubstr(policyErrors, `server/package.json: ${field} must not contain ${FAKE_PROVIDER_PACKAGE}`),
      `${field}: ${policyErrors.join(" | ")}`,
    );
  }
});

test("inbound RED: a devDependency on the fake in a package that is not the conformance harness", async (t) => {
  const root = inboundSetup(t, cleanPackages({ server: { devDependencies: { [FAKE_PROVIDER_PACKAGE]: "workspace:*" } } }));
  const { policyErrors } = await runInbound(root);
  assert.ok(
    hasSubstr(policyErrors, `server/package.json: devDependencies must not contain ${FAKE_PROVIDER_PACKAGE}`),
    policyErrors.join(" | "),
  );
});

test("inbound: the conformance harness MAY dev-depend on the fake — but NOT at runtime", async (t) => {
  const harness = {
    rel: "packages/sandbox-provider-contract",
    manifest: {
      name: "@armyofagents/sandbox-provider-contract",
      dependencies: { zod: "3.24.2" },
      devDependencies: { [FAKE_PROVIDER_PACKAGE]: "workspace:*" },
    },
    sources: {
      // Its TEST source may import the fake; its shipped source may not.
      "src/__tests__/contract.test.ts": `import { f } from "${FAKE_PROVIDER_PACKAGE}";\nconsole.log(f);\n`,
      "src/index.ts": "export const ok = 1;\n",
    },
  };
  const allowed = inboundSetup(t, [...cleanPackages(), harness]);
  const clean = await runInbound(allowed);
  assert.deepEqual(clean.policyErrors, [], clean.policyErrors.join(" | "));

  // ★ THE SAME PACKAGE, ONE FIELD MOVED. This is the edge that would reach a shipped image:
  // `sandbox-e2b-provider` depends on the contract package in `dependencies`, so a runtime
  // edge here is transitive into every closure that carries it.
  const promoted = inboundSetup(t, [
    ...cleanPackages(),
    {
      ...harness,
      manifest: {
        name: "@armyofagents/sandbox-provider-contract",
        dependencies: { zod: "3.24.2", [FAKE_PROVIDER_PACKAGE]: "workspace:*" },
      },
    },
  ]);
  const red = await runInbound(promoted);
  assert.ok(
    hasSubstr(
      red.policyErrors,
      `packages/sandbox-provider-contract/package.json: dependencies must not contain ${FAKE_PROVIDER_PACKAGE}`,
    ),
    red.policyErrors.join(" | "),
  );
});

test("inbound RED: SHIPPED source importing the fake, in every extension the scan admits", async (t) => {
  for (const file of ["src/index.ts", "src/page.tsx", "src/tool.mjs", "src/legacy.js", "src/mod.cts"]) {
    const root = inboundSetup(
      t,
      cleanPackages({ serverSources: { [file]: `import { f } from "${FAKE_PROVIDER_PACKAGE}";\nexport default f;\n` } }),
    );
    const { policyErrors } = await runInbound(root);
    assert.ok(
      hasSubstr(policyErrors, `server/${file}: shipped source must not import ${FAKE_PROVIDER_PACKAGE}`),
      `${file}: ${policyErrors.join(" | ")}`,
    );
  }
});

test("inbound RED: a SUBPATH import of the fake is caught, not only the bare specifier", async (t) => {
  const root = inboundSetup(
    t,
    cleanPackages({
      serverSources: { "src/index.ts": `import { f } from "${FAKE_PROVIDER_PACKAGE}/dist/hostile-driver.js";\nexport default f;\n` },
    }),
  );
  const { policyErrors } = await runInbound(root);
  assert.ok(hasSubstr(policyErrors, "shipped source must not import"), policyErrors.join(" | "));
});

test("inbound RED: TEST source importing the fake in a non-allowlisted package, in both test spellings", async (t) => {
  for (const file of ["src/thing.test.ts", "src/__tests__/thing.ts", "tests/thing.ts"]) {
    const root = inboundSetup(
      t,
      cleanPackages({ serverSources: { [file]: `import { f } from "${FAKE_PROVIDER_PACKAGE}";\nconsole.log(f);\n` } }),
    );
    const { policyErrors } = await runInbound(root);
    assert.ok(
      hasSubstr(policyErrors, `server/${file}: test source in @armyofagents/server must not import`),
      `${file}: ${policyErrors.join(" | ")}`,
    );
  }
});

test("inbound: the fake's OWN sources and manifest never trip the arm", async (t) => {
  const root = inboundSetup(t, [
    ...cleanPackages(),
    {
      rel: "packages/sandbox-fake-provider-extra",
      manifest: { name: FAKE_PROVIDER_PACKAGE, dependencies: { [FAKE_PROVIDER_PACKAGE]: "workspace:*" } },
      sources: { "src/a.ts": `import { f } from "${FAKE_PROVIDER_PACKAGE}";\nexport default f;\n` },
    },
  ]);
  const { policyErrors } = await runInbound(root);
  assert.deepEqual(policyErrors, [], policyErrors.join(" | "));
});

test("inbound: a DECOY mention in a comment or string never trips the arm", async (t) => {
  const root = inboundSetup(
    t,
    cleanPackages({
      serverSources: {
        "src/index.ts": [
          `// a future ${FAKE_PROVIDER_PACKAGE} could implement SandboxProvider`,
          `const name = "${FAKE_PROVIDER_PACKAGE}";`,
          "export default name;",
          "",
        ].join("\n"),
      },
    }),
  );
  const { policyErrors } = await runInbound(root);
  assert.deepEqual(policyErrors, [], policyErrors.join(" | "));
});

// --- the fail-closed refusals -------------------------------------------------------------

test("inbound FAIL-CLOSED: an unparseable or empty `packages:` list is a REFUSAL", async (t) => {
  const { parseWorkspaceGlobs } = await import("./lib/sandbox-fake-provider-boundary.mjs");
  for (const text of ["", "name: nothing\n", "packages:\n"]) {
    const { globs, errors } = parseWorkspaceGlobs(text);
    assert.deepEqual(globs, []);
    assert.ok(errors.some((e) => e.includes("refusing to scan zero packages")), errors.join(" | "));
  }
  // …and the real file still parses, so the refusal above is not the everyday path.
  const real = parseWorkspaceGlobs(await realReadFile(path.join(process.cwd(), "pnpm-workspace.yaml"), "utf8"));
  assert.deepEqual(real.errors, []);
  assert.ok(real.globs.includes("packages/*"), real.globs.join(","));
});

test("inbound FAIL-CLOSED: zero manifests and zero sources are each a refusal, never a pass", async (t) => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "sfp-in-bare-"));
  t.after(() => fs.rmSync(bare, { recursive: true, force: true }));
  fs.writeFileSync(path.join(bare, "pnpm-workspace.yaml"), WORKSPACE_YAML);
  fs.mkdirSync(path.join(bare, "packages"), { recursive: true });
  const noPackages = await runInbound(bare);
  assert.ok(
    noPackages.readErrors.some((e) => e.includes("zero workspace manifests were scanned")),
    noPackages.readErrors.join(" | "),
  );

  // A manifest but no source files at all.
  const srcless = fs.mkdtempSync(path.join(os.tmpdir(), "sfp-in-srcless-"));
  t.after(() => fs.rmSync(srcless, { recursive: true, force: true }));
  fs.writeFileSync(path.join(srcless, "pnpm-workspace.yaml"), WORKSPACE_YAML);
  fs.mkdirSync(path.join(srcless, "packages"), { recursive: true });
  fs.mkdirSync(path.join(srcless, "server"), { recursive: true });
  fs.writeFileSync(path.join(srcless, "server", "package.json"), JSON.stringify({ name: "@armyofagents/server" }));
  const noSources = await runInbound(srcless);
  assert.ok(
    noSources.readErrors.some((e) => e.includes("zero source files were scanned")),
    noSources.readErrors.join(" | "),
  );
});

test("inbound FAIL-CLOSED: a missing workspace file and an unsupported glob are refusals", async (t) => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "sfp-in-nows-"));
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  const missing = await runInbound(empty);
  assert.ok(missing.readErrors.some((e) => e.includes("pnpm-workspace.yaml: missing or unreadable")), missing.readErrors.join(" | "));

  const weird = fs.mkdtempSync(path.join(os.tmpdir(), "sfp-in-glob-"));
  t.after(() => fs.rmSync(weird, { recursive: true, force: true }));
  fs.writeFileSync(path.join(weird, "pnpm-workspace.yaml"), ["packages:", "  - packages/**/deep", ""].join("\n"));
  const unsupported = await runInbound(weird);
  assert.ok(
    unsupported.readErrors.some((e) => e.includes("unsupported package glob")),
    unsupported.readErrors.join(" | "),
  );
});

test("inbound: an unreadable source file is a READ error, never a silent skip", async (t) => {
  const root = inboundSetup(t, cleanPackages());
  const target = path.join(root, "server", "src", "index.ts");
  const readFile = async (p, enc) => {
    if (path.resolve(p) === path.resolve(target)) {
      const err = new Error("permission denied");
      err.code = "EACCES";
      throw err;
    }
    return realReadFile(p, enc);
  };
  const { readErrors, policyErrors } = await runInbound(root, { readFile });
  assert.ok(hasSubstr(readErrors, "index.ts: unreadable source (EACCES)"), readErrors.join(" | "));
  assert.deepEqual(policyErrors, [], policyErrors.join(" | "));
});

test("inbound: the allowance map is CLOSED and is the whole policy surface", async (t) => {
  const { FAKE_PROVIDER_INBOUND_ALLOWANCES } = await import("./lib/sandbox-fake-provider-boundary.mjs");
  // A widening of this map is a deliberate act, so it is pinned: two entries, one `self` and
  // one `devDependencies`. A third appearing without a matching decision reds here.
  assert.deepEqual(Object.keys(FAKE_PROVIDER_INBOUND_ALLOWANCES).sort(), [
    "@armyofagents/sandbox-fake-provider",
    "@armyofagents/sandbox-provider-contract",
  ]);
  assert.equal(FAKE_PROVIDER_INBOUND_ALLOWANCES["@armyofagents/sandbox-fake-provider"], "self");
  assert.equal(FAKE_PROVIDER_INBOUND_ALLOWANCES["@armyofagents/sandbox-provider-contract"], "devDependencies");
});

// --- Codex P2s: the two holes the inbound arm had, each with the branch EXECUTED ------------

test("inbound RED: a CommonJS require() of the fake is caught, in every extension the scan admits", async (t) => {
  // ★ `extractModuleSpecifiers` is ESM-only and returns [] for `require("…")` — measured. The scan
  // admits .js/.cjs/.mjs, so without the require arm a CommonJS load passed the check entirely.
  for (const file of ["src/index.js", "src/legacy.cjs", "src/tool.mjs", "src/mod.ts"]) {
    for (const src of [
      `const x = require("${FAKE_PROVIDER_PACKAGE}");\nmodule.exports = x;\n`,
      `const { f } = require('${FAKE_PROVIDER_PACKAGE}/dist/hostile-driver.js');\nmodule.exports = f;\n`,
    ]) {
      const root = inboundSetup(t, cleanPackages({ serverSources: { [file]: src } }));
      const { policyErrors } = await runInbound(root);
      assert.ok(
        hasSubstr(policyErrors, `server/${file}: shipped source must not import ${FAKE_PROVIDER_PACKAGE}`),
        `${file}: ${policyErrors.join(" | ")}`,
      );
    }
  }
});

test("inbound: a require() DECOY in a comment or a string never trips the arm", async (t) => {
  // The require scan is built on `tokenizeSource`, not a regex, so comment and string bodies are
  // consumed rather than matched. Without that, every one of these would be a false red.
  const decoys = [
    `// const x = require("${FAKE_PROVIDER_PACKAGE}");\nexport const ok = 1;\n`,
    `/* require("${FAKE_PROVIDER_PACKAGE}") */\nexport const ok = 1;\n`,
    `export const doc = 'call require("${FAKE_PROVIDER_PACKAGE}") to load it';\n`,
    `export const doc = \`require("${FAKE_PROVIDER_PACKAGE}")\`;\n`,
  ];
  for (const src of decoys) {
    const root = inboundSetup(t, cleanPackages({ serverSources: { "src/index.ts": src } }));
    const { policyErrors } = await runInbound(root);
    assert.deepEqual(policyErrors, [], `decoy tripped: ${policyErrors.join(" | ")}`);
  }
  // …and the extractor itself, directly: the real call is seen, the decoys are not.
  const { extractRequireSpecifiers } = await import("./lib/sandbox-fake-provider-boundary.mjs");
  assert.deepEqual(extractRequireSpecifiers('const a = require("pkg-a");'), ["pkg-a"]);
  assert.deepEqual(extractRequireSpecifiers('// require("pkg-a")'), []);
  assert.deepEqual(extractRequireSpecifiers('const s = "require(\\"pkg-a\\")";'), []);
});

test("inbound RED: a workspace-source SYMLINK is REFUSED, not skipped — the branch is executed", async (t) => {
  // ★ This host cannot create symlinks without elevation, so the branch is driven through the
  // runner's injectable `readdir` instead. That is not a weaker control: it executes the exact
  // line, and it does so on every platform rather than only where symlinks are permitted.
  //
  // It also caught a real defect in the fix itself — the first version pushed onto the CALLER's
  // `policyErrors`, which is not in scope inside the walker, so it would have thrown
  // `ReferenceError` on the one path it was written for. The guard still said PASS because the
  // branch was never taken. An untaken branch is not a control.
  const root = inboundSetup(t, cleanPackages());
  const target = path.join(root, "server", "src");
  const readdir = async (p, opts) => {
    const entries = await fs.promises.readdir(p, opts);
    if (path.resolve(p) !== path.resolve(target)) return entries;
    return [
      ...entries,
      {
        name: "linked.ts",
        isSymbolicLink: () => true,
        isDirectory: () => false,
        isFile: () => false,
      },
    ];
  };
  const { policyErrors, readErrors } = await runInbound(root, { readdir });
  assert.ok(
    hasSubstr(policyErrors, "server/src/linked.ts: workspace-source symlinks are forbidden"),
    `policyErrors: ${policyErrors.join(" | ")} readErrors: ${readErrors.join(" | ")}`,
  );
  // And a symlinked DIRECTORY is refused the same way rather than walked.
  const readdirDir = async (p, opts) => {
    const entries = await fs.promises.readdir(p, opts);
    if (path.resolve(p) !== path.resolve(target)) return entries;
    return [
      ...entries,
      { name: "linked-dir", isSymbolicLink: () => true, isDirectory: () => true, isFile: () => false },
    ];
  };
  const dir = await runInbound(root, { readdir: readdirDir });
  assert.ok(
    hasSubstr(dir.policyErrors, "server/src/linked-dir: workspace-source symlinks are forbidden"),
    dir.policyErrors.join(" | "),
  );
});

test("inbound: the REAL repository satisfies the inbound policy", async () => {
  const { runInboundCheck } = await import("./check-sandbox-fake-provider-boundary.mjs");
  const { policyErrors, readErrors, scanned } = await runInboundCheck(process.cwd());
  assert.deepEqual(policyErrors, [], policyErrors.join(" | "));
  assert.deepEqual(readErrors, [], readErrors.join(" | "));
  // ★ The non-vacuity floor for the REAL run. Without it, a walk broken by a path or pruning
  // bug would report this repository clean by scanning nothing — which is the defect class
  // this whole arm was added to close, reappearing inside its own proof (E.1a).
  assert.ok(scanned.packages >= 30, `expected >= 30 workspace manifests, scanned ${scanned.packages}`);
  assert.ok(scanned.sources >= 1000, `expected >= 1000 source files, scanned ${scanned.sources}`);
});
