// Dependency-free `node:test` mutation corpus for the frozen worker-protocol v1
// consumer checker. It imports ONLY the pure checker functions and operates on an
// ISOLATED synthetic fixture built in a temp directory — it never reads, writes,
// or mutates the checked-in fixture. It proves the baseline verifier is a real
// tamper detector: a good synthetic fixture passes, and mutating any frozen byte,
// dependency record, source SHA, path order, or line ending fails.
//
// Run: node --test scripts/check-frozen-worker-protocol-consumer.test.mjs

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { BUNDLER_OPTIONS, recomputeManifestBytes, verifyFrozenConsumerStatic } from "./check-frozen-worker-protocol-consumer.mjs";

const SOURCE_SHA = "0123456789abcdef0123456789abcdef01234567";
const CHECKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "check-frozen-worker-protocol-consumer.mjs");
const REAL_FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures", "worker-protocol-consumers", "v1");
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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function runGit(repoRoot, args, { expect = 0 } = {}) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  assert.equal(result.status, expect, `git ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function writeRepoFile(repoRoot, relativePath, bytes) {
  const absolutePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, bytes);
}

function sourcePackageBytes(zodVersion) {
  return Buffer.from(`${JSON.stringify({
    name: "@armyofagents/worker-protocol",
    version: "0.1.0",
    private: true,
    type: "module",
    dependencies: { zod: zodVersion },
  }, null, 2)}\n`);
}

function rootPackageBytes(esbuildVersion) {
  return Buffer.from(`${JSON.stringify({
    name: "frozen-checker-test-repo",
    private: true,
    devDependencies: { esbuild: `^${esbuildVersion}` },
  }, null, 2)}\n`);
}

function sourceLockBytes({ zodVersion, esbuildVersion, extraImporter = "" }) {
  return Buffer.from(`lockfileVersion: '9.0'

importers:

  .:
    devDependencies:
      esbuild:
        specifier: ^${esbuildVersion}
        version: ${esbuildVersion}

  packages/worker-protocol:
    dependencies:
      zod:
        specifier: ${zodVersion}
        version: ${zodVersion}
${extraImporter}`);
}

function initSourceRepo({ zodVersion = "3.24.2", esbuildVersion = "0.28.1", includeLock = true } = {}) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "frozen-wp-git-"));
  runGit(repoRoot, ["init", "--quiet"]);
  runGit(repoRoot, ["config", "user.email", "frozen-checker@example.invalid"]);
  runGit(repoRoot, ["config", "user.name", "Frozen Checker Test"]);

  const pkgBytes = sourcePackageBytes(zodVersion);
  const rootBytes = rootPackageBytes(esbuildVersion);
  const lockBytes = sourceLockBytes({ zodVersion, esbuildVersion });
  writeRepoFile(repoRoot, "package.json", rootBytes);
  writeRepoFile(repoRoot, ".gitattributes", "tests/fixtures/worker-protocol-consumers/v1/** text eol=lf\n");
  writeRepoFile(repoRoot, "packages/worker-protocol/package.json", pkgBytes);
  writeRepoFile(repoRoot, "packages/worker-protocol/src/index.ts", "export const frozen = true;\n");
  if (includeLock) writeRepoFile(repoRoot, "pnpm-lock.yaml", lockBytes);
  runGit(repoRoot, ["add", "."]);
  runGit(repoRoot, ["commit", "--quiet", "-m", "source snapshot"]);

  return {
    repoRoot,
    sourceSha: runGit(repoRoot, ["rev-parse", "HEAD"]),
    pkgBytes,
    lockBytes,
    zodVersion,
    esbuildVersion,
  };
}

function provisionInstalledVersions(repoRoot, { zodVersion = "3.24.2", esbuildVersion = "0.28.1" } = {}) {
  writeRepoFile(repoRoot, "packages/worker-protocol/node_modules/zod/package.json", `${JSON.stringify({ name: "zod", version: zodVersion })}\n`);
  writeRepoFile(repoRoot, "node_modules/esbuild/package.json", `${JSON.stringify({ name: "esbuild", version: esbuildVersion })}\n`);
}

function installRealFixture(repo, {
  sourceSha = repo.sourceSha,
  recordedZodVersion = "3.24.2",
  recordedEsbuildVersion = "0.28.1",
  packageBytes = repo.pkgBytes,
  lockBytes = repo.lockBytes,
} = {}) {
  const fixtureDir = path.join(repo.repoRoot, "tests", "fixtures", "worker-protocol-consumers", "v1");
  fs.mkdirSync(path.dirname(fixtureDir), { recursive: true });
  fs.cpSync(REAL_FIXTURE, fixtureDir, { recursive: true });
  const dependencyLockPath = path.join(fixtureDir, "dependency-lock.json");
  const dependencyLock = JSON.parse(fs.readFileSync(dependencyLockPath, "utf8"));
  Object.assign(dependencyLock, {
    sourceSha,
    zodVersion: recordedZodVersion,
    esbuildVersion: recordedEsbuildVersion,
    lockfileIntegrity: sha256(lockBytes),
    packageIntegrity: sha256(packageBytes),
  });
  fs.writeFileSync(dependencyLockPath, `${JSON.stringify(dependencyLock, null, 2)}\n`);
  regenManifest(fixtureDir);
  provisionInstalledVersions(repo.repoRoot, { zodVersion: recordedZodVersion, esbuildVersion: recordedEsbuildVersion });
  return fixtureDir;
}

function runChecker(repoRoot, sourceSha) {
  return spawnSync(process.execPath, [CHECKER_PATH, "--source-sha", sourceSha], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function withSourceRepo(options, fn) {
  const repo = initSourceRepo(options);
  try {
    fn(repo);
  } finally {
    fs.rmSync(repo.repoRoot, { recursive: true, force: true });
  }
}

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

test("a later consumer manifest and lockfile revision cannot invalidate immutable source evidence", () => {
  withSourceRepo({}, (repo) => {
    installRealFixture(repo);
    writeRepoFile(repo.repoRoot, "server/package.json", '{"dependencies":{"@armyofagents/worker-protocol":"workspace:*"}}\n');
    const laterLock = sourceLockBytes({
      zodVersion: repo.zodVersion,
      esbuildVersion: repo.esbuildVersion,
      extraImporter: `
  server:
    dependencies:
      '@armyofagents/worker-protocol':
        specifier: workspace:*
        version: link:../packages/worker-protocol
`,
    });
    writeRepoFile(repo.repoRoot, "pnpm-lock.yaml", laterLock);
    runGit(repo.repoRoot, ["add", "server/package.json", "pnpm-lock.yaml"]);
    runGit(repo.repoRoot, ["commit", "--quiet", "-m", "later consumer revision"]);
    provisionInstalledVersions(repo.repoRoot, { zodVersion: "9.9.9", esbuildVersion: "8.8.8" });

    const result = runChecker(repo.repoRoot, repo.sourceSha);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /zod 3\.24\.2, esbuild 0\.28\.1/);
  });
});

test("CRLF working-tree bytes cannot change Git-blob verification", () => {
  withSourceRepo({}, (repo) => {
    installRealFixture(repo);
    writeRepoFile(repo.repoRoot, "packages/worker-protocol/package.json", repo.pkgBytes.toString("utf8").replace(/\n/g, "\r\n"));
    writeRepoFile(repo.repoRoot, "pnpm-lock.yaml", repo.lockBytes.toString("utf8").replace(/\n/g, "\r\n"));

    const result = runChecker(repo.repoRoot, repo.sourceSha);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
});

test("an unavailable recorded source commit fails closed with an actionable error", () => {
  withSourceRepo({}, (repo) => {
    const missingSha = "f".repeat(40);
    installRealFixture(repo, { sourceSha: missingSha });

    const result = runChecker(repo.repoRoot, missingSha);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /recorded source commit .* is unavailable/);
  });
});

test("a missing recorded source blob fails closed with its path", () => {
  withSourceRepo({ includeLock: false }, (repo) => {
    writeRepoFile(repo.repoRoot, "pnpm-lock.yaml", repo.lockBytes);
    installRealFixture(repo);

    const result = runChecker(repo.repoRoot, repo.sourceSha);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /recorded source blob .*pnpm-lock\.yaml.* is unavailable/);
  });
});

for (const dependencyCase of [
  { name: "Zod", source: { zodVersion: "9.9.9" }, expected: /recorded zodVersion 3\.24\.2 != source snapshot 9\.9\.9/ },
  { name: "esbuild", source: { esbuildVersion: "8.8.8" }, expected: /recorded esbuildVersion 0\.28\.1 != source snapshot 8\.8\.8/ },
]) {
  test(`a ${dependencyCase.name} source-snapshot mutation fails`, () => {
    withSourceRepo(dependencyCase.source, (repo) => {
      installRealFixture(repo);

      const result = runChecker(repo.repoRoot, repo.sourceSha);
      assert.notEqual(result.status, 0, result.stdout);
      assert.match(result.stderr, dependencyCase.expected);
    });
  });
}

for (const integrityCase of [
  { field: "packageIntegrity", sourcePath: "packages/worker-protocol/package.json" },
  { field: "lockfileIntegrity", sourcePath: "pnpm-lock.yaml" },
]) {
  test(`a recorded ${integrityCase.field} mutation fails against the source blob`, () => {
    withSourceRepo({}, (repo) => {
      const fixtureDir = installRealFixture(repo);
      const lockPath = path.join(fixtureDir, "dependency-lock.json");
      const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      lock[integrityCase.field] = "0".repeat(64);
      fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
      regenManifest(fixtureDir);

      const result = runChecker(repo.repoRoot, repo.sourceSha);
      assert.notEqual(result.status, 0, result.stdout);
      assert.ok(
        result.stderr.includes(`recorded ${integrityCase.field} does not match source blob`) &&
          result.stderr.includes(integrityCase.sourcePath),
        result.stderr,
      );
    });
  });
}

test("the checker is deterministic in a clean clone with only the recorded Git object database", () => {
  withSourceRepo({}, (repo) => {
    installRealFixture(repo);
    runGit(repo.repoRoot, ["add", "tests/fixtures/worker-protocol-consumers/v1"]);
    runGit(repo.repoRoot, ["commit", "--quiet", "-m", "freeze fixture"]);
    const cloneRoot = fs.mkdtempSync(path.join(os.tmpdir(), "frozen-wp-clone-"));
    fs.rmSync(cloneRoot, { recursive: true, force: true });
    try {
      const clone = spawnSync("git", ["clone", "--quiet", "--no-local", repo.repoRoot, cloneRoot], { encoding: "utf8" });
      assert.equal(clone.status, 0, clone.stderr || clone.stdout);
      assert.equal(fs.existsSync(path.join(cloneRoot, "node_modules")), false);

      const first = runChecker(cloneRoot, repo.sourceSha);
      const second = runChecker(cloneRoot, repo.sourceSha);
      assert.equal(first.status, 0, first.stderr || first.stdout);
      assert.deepEqual({ status: first.status, stdout: first.stdout, stderr: first.stderr }, { status: second.status, stdout: second.stdout, stderr: second.stderr });
    } finally {
      fs.rmSync(cloneRoot, { recursive: true, force: true });
    }
  });
});
