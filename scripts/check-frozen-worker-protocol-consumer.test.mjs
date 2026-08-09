// Dependency-free `node:test` mutation corpus for the frozen worker-protocol v1
// consumer checker. It imports ONLY the pure checker functions and operates on an
// ISOLATED synthetic fixture built in a temp directory — it never reads, writes,
// or mutates the checked-in fixture. It proves the baseline verifier is a real
// tamper detector: a good synthetic fixture passes, and mutating any frozen byte,
// dependency record, source SHA, path order, or line ending fails.
//
// Run: node --test scripts/check-frozen-worker-protocol-consumer.test.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { BUNDLER_OPTIONS, recomputeManifestBytes, verifyFrozenConsumerStatic } from "./check-frozen-worker-protocol-consumer.mjs";

const SOURCE_SHA = "0123456789abcdef0123456789abcdef01234567";
const EXPECTED = {
  sourceSha: SOURCE_SHA,
  expectedZodVersion: "3.24.2",
  expectedEsbuildVersion: "0.28.1",
  expectedLockfileIntegrity: "l".repeat(64),
  expectedPackageIntegrity: "p".repeat(64),
};

/** Build a minimal, VALID synthetic frozen fixture (fully bundled, no runtime
 * dep, LF, correct manifest) into `dir`. */
function buildSynthetic(dir) {
  const distDir = path.join(dir, "dist");
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, "index.js"), "var ok = true;\nexport { ok };\n");
  fs.writeFileSync(path.join(distDir, "index.d.ts"), "export declare const ok: boolean;\n");
  const pkg = {
    name: "@armyofagents/worker-protocol-frozen-v1",
    version: "1.0.0",
    private: true,
    type: "module",
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
  };
  fs.writeFileSync(path.join(dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  const lock = {
    sourceSha: SOURCE_SHA,
    zodVersion: EXPECTED.expectedZodVersion,
    esbuildVersion: EXPECTED.expectedEsbuildVersion,
    lockfileIntegrity: EXPECTED.expectedLockfileIntegrity,
    packageIntegrity: EXPECTED.expectedPackageIntegrity,
    bundlerOptions: { ...BUNDLER_OPTIONS },
  };
  fs.writeFileSync(path.join(dir, "dependency-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, "manifest.sha256"), recomputeManifestBytes(dir));
}

/** Regenerate the manifest so it matches the current (possibly mutated) tree —
 * used to ISOLATE a non-manifest check (e.g. sourceSha / bundlerOptions / CR). */
function regenManifest(dir) {
  fs.writeFileSync(path.join(dir, "manifest.sha256"), recomputeManifestBytes(dir));
}

function withFixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frozen-wp-"));
  try {
    buildSynthetic(dir);
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const verify = (dir) => verifyFrozenConsumerStatic({ dir, repoRoot: process.cwd(), ...EXPECTED });

test("a good synthetic fixture passes", () => {
  withFixture((dir) => {
    assert.deepEqual(verify(dir).errors, []);
  });
});

test("mutating any frozen byte fails (manifest mismatch)", () => {
  withFixture((dir) => {
    const p = path.join(dir, "dist", "index.js");
    fs.writeFileSync(p, `${fs.readFileSync(p, "utf8")}// tamper\n`);
    const { errors } = verify(dir);
    assert.ok(errors.some((e) => e.includes("does not match the recomputed hash")), errors.join("; "));
  });
});

test("mutating the recorded source SHA fails (isolated: manifest regenerated)", () => {
  withFixture((dir) => {
    const lockPath = path.join(dir, "dependency-lock.json");
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    lock.sourceSha = "ffffffffffffffffffffffffffffffffffffffff";
    fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    regenManifest(dir);
    const { errors } = verify(dir);
    assert.ok(errors.some((e) => e.includes("recorded sourceSha")), errors.join("; "));
  });
});

test("mutating a dependency record (bundlerOptions) fails", () => {
  withFixture((dir) => {
    const lockPath = path.join(dir, "dependency-lock.json");
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    lock.bundlerOptions.target = "es2015";
    fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    regenManifest(dir);
    const { errors } = verify(dir);
    assert.ok(errors.some((e) => e.includes("bundlerOptions do not match")), errors.join("; "));
  });
});

test("mutating a recorded version (zod) fails", () => {
  withFixture((dir) => {
    const lockPath = path.join(dir, "dependency-lock.json");
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    lock.zodVersion = "9.9.9";
    fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    regenManifest(dir);
    const { errors } = verify(dir);
    assert.ok(errors.some((e) => e.includes("recorded zodVersion")), errors.join("; "));
  });
});

test("reordering the manifest lines (path order) fails", () => {
  withFixture((dir) => {
    const manifestPath = path.join(dir, "manifest.sha256");
    const lines = fs.readFileSync(manifestPath, "utf8").split("\n").filter((l) => l.length > 0);
    assert.ok(lines.length >= 2);
    fs.writeFileSync(manifestPath, `${[...lines].reverse().join("\n")}\n`);
    const { errors } = verify(dir);
    assert.ok(errors.some((e) => e.includes("does not match the recomputed hash")), errors.join("; "));
  });
});

test("flipping a line ending to CRLF fails (isolated: manifest regenerated)", () => {
  withFixture((dir) => {
    const p = path.join(dir, "dist", "index.d.ts");
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/\n/g, "\r\n"));
    regenManifest(dir);
    const { errors } = verify(dir);
    assert.ok(errors.some((e) => e.includes("CR byte")), errors.join("; "));
  });
});

test("a runtime dependency in the frozen package.json fails", () => {
  withFixture((dir) => {
    const pkgPath = path.join(dir, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    pkg.dependencies = { zod: "3.24.2" };
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    regenManifest(dir);
    const { errors } = verify(dir);
    assert.ok(errors.some((e) => e.includes("NO runtime dependency")), errors.join("; "));
  });
});

test("a current-source import in the frozen bundle fails", () => {
  withFixture((dir) => {
    const p = path.join(dir, "dist", "index.js");
    fs.writeFileSync(p, 'import { z } from "zod";\nexport const ok = z;\n');
    regenManifest(dir);
    const { errors } = verify(dir);
    assert.ok(errors.some((e) => e.includes("not fully bundled")), errors.join("; "));
  });
});

test("an absolute path embedded in the frozen bundle fails", () => {
  withFixture((dir) => {
    const p = path.join(dir, "dist", "index.js");
    fs.writeFileSync(p, 'export const p = "C:\\\\Users\\\\secret\\\\index.js";\n');
    regenManifest(dir);
    const { errors } = verify(dir);
    assert.ok(errors.some((e) => e.includes("absolute path")), errors.join("; "));
  });
});

test("a stray test file in the frozen tree fails", () => {
  withFixture((dir) => {
    fs.writeFileSync(path.join(dir, "dist", "leak.test.js"), "export const t = 1;\n");
    regenManifest(dir);
    const { errors } = verify(dir);
    assert.ok(errors.some((e) => e.includes("test file")), errors.join("; "));
  });
});

test("a declaration referencing current protocol source fails", () => {
  withFixture((dir) => {
    const p = path.join(dir, "dist", "index.d.ts");
    fs.writeFileSync(p, 'export * from "../../../../packages/worker-protocol/src/index.js";\n');
    regenManifest(dir);
    const { errors } = verify(dir);
    assert.ok(errors.some((e) => e.includes("references current protocol source")), errors.join("; "));
  });
});
