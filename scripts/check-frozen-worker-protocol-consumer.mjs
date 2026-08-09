#!/usr/bin/env node
/**
 * check-frozen-worker-protocol-consumer.mjs
 *
 * Independently re-verify the frozen, hash-pinned worker-protocol v1 consumer
 * baseline (`tests/fixtures/worker-protocol-consumers/v1/`). It NEVER trusts the
 * freeze script's output — it recomputes every hash, checks the recorded source
 * SHA / Zod + esbuild versions / lockfile + package integrity / bundler config,
 * and rejects any runtime dependency, current-protocol-source import, absolute
 * path, embedded build path/timestamp, or test file. The CLI additionally imports
 * the frozen root in isolated "server" and "worker" smoke child processes.
 *
 * The pure helpers (`recomputeManifestBytes`, `verifyFrozenConsumerStatic`,
 * `listFrozenFiles`, `BUNDLER_OPTIONS`) are exported for the dependency-free
 * `node:test` mutation corpus, which operates on an isolated temp copy and never
 * mutates the checked-in fixture.
 *
 * Usage:
 *   node scripts/check-frozen-worker-protocol-consumer.mjs --source-sha <40-hex>
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/** The frozen fixture location, relative to the repo root, as POSIX segments. */
export const FIXTURE_SEGMENTS = ["tests", "fixtures", "worker-protocol-consumers", "v1"];
export const MANIFEST_NAME = "manifest.sha256";
export const LOCK_NAME = "dependency-lock.json";
export const PACKAGE_NAME = "package.json";

/** The FIXED, deterministic esbuild bundler options the freeze uses and the lock
 * records. Any drift here changes the frozen bytes and must mint a new fixture. */
export const BUNDLER_OPTIONS = Object.freeze({
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  sourcemap: false,
  legalComments: "none",
  minify: false,
});

/** The only top-level entries a frozen fixture may contain. */
const ALLOWED_TOP_LEVEL = new Set([PACKAGE_NAME, LOCK_NAME, MANIFEST_NAME, "dist"]);

// --- Filesystem helpers ------------------------------------------------------

function walkPosix(dir, base, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const abs = path.join(dir, entry.name);
    const rel = base === "" ? entry.name : `${base}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      out.push({ rel, symlink: true });
      continue;
    }
    if (entry.isDirectory()) {
      walkPosix(abs, rel, out);
      continue;
    }
    out.push({ rel, symlink: false });
  }
  return out;
}

/** Every file under `dir` as sorted POSIX-relative paths, EXCLUDING the manifest
 * (a manifest never hashes itself). Symlinks are surfaced (and rejected). */
export function listFrozenFiles(dir) {
  return walkPosix(dir, "", []).filter((f) => f.rel !== MANIFEST_NAME);
}

/** Recompute the manifest bytes: sorted `<sha256>  <posix>\n` over every frozen
 * file except the manifest, UTF-8/LF with a final LF. Deterministic. */
export function recomputeManifestBytes(dir) {
  const files = listFrozenFiles(dir);
  const lines = [];
  for (const { rel, symlink } of files) {
    if (symlink) throw new Error(`frozen fixture contains a symlink: ${rel}`);
    const digest = createHash("sha256").update(fs.readFileSync(path.join(dir, rel))).digest("hex");
    lines.push(`${digest}  ${rel}`);
  }
  lines.sort((a, b) => a.slice(66).localeCompare(b.slice(66), "en"));
  return Buffer.from(`${lines.join("\n")}\n`, "utf8");
}

// --- Static verification (pure; no import/exec) ------------------------------

function findModuleSpecifiers(source) {
  const values = [];
  const patterns = [
    /(?:^|[;\n])\s*(?:import|export)\s+(?:[^"'()]*?\s+from\s*)?["']([^"']+)["']/gm,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) for (const m of source.matchAll(pattern)) values.push(m[1]);
  return values;
}

const DRIVE_PATH = /(?<![A-Za-z0-9])[A-Za-z]:[\\/]/;

function absolutePathHits(text, repoRoot) {
  const hits = [];
  if (/\bfile:\/\//i.test(text)) hits.push("file:// URL");
  if (DRIVE_PATH.test(text)) hits.push("windows drive path");
  if (/(?<![A-Za-z0-9])\/(?:Users|home|root)\//.test(text)) hits.push("unix home path");
  if (repoRoot && text.includes(repoRoot)) hits.push("absolute repo root path");
  return hits;
}

/**
 * Statically verify a frozen fixture directory. Pure: reads bytes only, never
 * imports or execs. Returns `{ errors: string[] }`. Every provided `expected*`
 * value that is non-undefined is asserted against the recorded lock value.
 */
export function verifyFrozenConsumerStatic({
  dir,
  sourceSha,
  expectedZodVersion,
  expectedEsbuildVersion,
  expectedLockfileIntegrity,
  expectedPackageIntegrity,
  repoRoot,
} = {}) {
  const errors = [];
  const fail = (m) => errors.push(m);

  if (!dir || !fs.existsSync(dir)) {
    return { errors: [`frozen fixture directory is missing: ${dir}`] };
  }

  // 1. Only allowed top-level entries.
  for (const entry of fs.readdirSync(dir)) {
    if (!ALLOWED_TOP_LEVEL.has(entry)) fail(`unexpected top-level entry in frozen fixture: ${entry}`);
  }

  // 2. Manifest recompute + byte match.
  let recomputed;
  try {
    recomputed = recomputeManifestBytes(dir);
  } catch (err) {
    fail(`manifest recompute failed: ${err.message}`);
  }
  const manifestPath = path.join(dir, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) {
    fail(`missing ${MANIFEST_NAME}`);
  } else if (recomputed && Buffer.compare(fs.readFileSync(manifestPath), recomputed) !== 0) {
    fail(`${MANIFEST_NAME} does not match the recomputed hash of the frozen bytes`);
  }

  // 3. dependency-lock.json.
  const lockPath = path.join(dir, LOCK_NAME);
  let lock;
  if (!fs.existsSync(lockPath)) {
    fail(`missing ${LOCK_NAME}`);
  } else {
    try {
      lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    } catch (err) {
      fail(`${LOCK_NAME} is not valid JSON: ${err.message}`);
    }
  }
  if (lock) {
    if (!/^[0-9a-f]{40}$/.test(String(lock.sourceSha))) fail(`${LOCK_NAME}: sourceSha is not a 40-hex commit`);
    if (sourceSha !== undefined && String(lock.sourceSha) !== String(sourceSha)) {
      fail(`${LOCK_NAME}: recorded sourceSha ${lock.sourceSha} != expected ${sourceSha}`);
    }
    if (JSON.stringify(lock.bundlerOptions) !== JSON.stringify(BUNDLER_OPTIONS)) {
      fail(`${LOCK_NAME}: bundlerOptions do not match the fixed deterministic configuration`);
    }
    for (const key of ["zodVersion", "esbuildVersion", "lockfileIntegrity", "packageIntegrity"]) {
      if (typeof lock[key] !== "string" || lock[key].length === 0) fail(`${LOCK_NAME}: missing ${key}`);
    }
    if (expectedZodVersion !== undefined && lock.zodVersion !== expectedZodVersion) {
      fail(`${LOCK_NAME}: recorded zodVersion ${lock.zodVersion} != installed ${expectedZodVersion}`);
    }
    if (expectedEsbuildVersion !== undefined && lock.esbuildVersion !== expectedEsbuildVersion) {
      fail(`${LOCK_NAME}: recorded esbuildVersion ${lock.esbuildVersion} != installed ${expectedEsbuildVersion}`);
    }
    if (expectedLockfileIntegrity !== undefined && lock.lockfileIntegrity !== expectedLockfileIntegrity) {
      fail(`${LOCK_NAME}: recorded lockfileIntegrity does not match the current pnpm-lock.yaml`);
    }
    if (expectedPackageIntegrity !== undefined && lock.packageIntegrity !== expectedPackageIntegrity) {
      fail(`${LOCK_NAME}: recorded packageIntegrity does not match the current package.json`);
    }
  }

  // 4. package.json — no runtime dependency; minimal metadata.
  const pkgPath = path.join(dir, PACKAGE_NAME);
  if (!fs.existsSync(pkgPath)) {
    fail(`missing ${PACKAGE_NAME}`);
  } else {
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    } catch (err) {
      fail(`${PACKAGE_NAME} is not valid JSON: ${err.message}`);
    }
    if (pkg) {
      for (const depKey of ["dependencies", "peerDependencies", "optionalDependencies"]) {
        if (pkg[depKey] && Object.keys(pkg[depKey]).length > 0) fail(`frozen ${PACKAGE_NAME} declares ${depKey} — the baseline must have NO runtime dependency`);
      }
      if (pkg.type !== "module") fail(`frozen ${PACKAGE_NAME} must be an ES module`);
      if (pkg.main !== "./dist/index.js") fail(`frozen ${PACKAGE_NAME} main must be ./dist/index.js`);
    }
  }

  // 5. Per-file content checks.
  let files = [];
  try {
    files = listFrozenFiles(dir);
  } catch (err) {
    fail(err.message);
  }
  let sawBundle = false;
  for (const { rel, symlink } of files) {
    if (symlink) {
      fail(`frozen fixture contains a symlink: ${rel}`);
      continue;
    }
    if (/\.test\./.test(rel) || rel.endsWith(".test.js") || rel.endsWith(".test.ts")) {
      fail(`frozen fixture contains a test file: ${rel}`);
    }
    const bytes = fs.readFileSync(path.join(dir, rel));
    if (bytes.includes(0x0d)) fail(`frozen file has a CR byte (must be LF): ${rel}`);
    const text = bytes.toString("utf8");
    if (rel === "dist/index.js") {
      sawBundle = true;
      const specifiers = findModuleSpecifiers(text);
      if (specifiers.length > 0) {
        fail(`frozen dist/index.js is not fully bundled — it imports/requires: ${[...new Set(specifiers)].join(", ")}`);
      }
      if (/\/\/#\s*sourceMappingURL=/.test(text)) fail("frozen dist/index.js embeds a sourceMappingURL (build path/timestamp leak)");
      for (const hit of absolutePathHits(text, repoRoot)) fail(`frozen dist/index.js embeds an absolute path (${hit})`);
    } else if (rel.endsWith(".d.ts")) {
      if (/packages[\\/]worker-protocol[\\/]src/.test(text)) fail(`frozen declaration ${rel} references current protocol source`);
      if (/\/\/#\s*sourceMappingURL=/.test(text)) fail(`frozen declaration ${rel} embeds a sourceMappingURL`);
      for (const hit of absolutePathHits(text, repoRoot)) fail(`frozen declaration ${rel} embeds an absolute path (${hit})`);
    }
  }
  if (!sawBundle) fail("frozen fixture is missing dist/index.js");

  return { errors };
}

// --- Isolated smoke import (CLI only) ----------------------------------------

function smokeImport(role, indexUrl) {
  const code = `
    import * as m from ${JSON.stringify(indexUrl)};
    const required = ["jobEnvelopeV1Schema", "enrollmentRequestV1Schema", "controlCommandV1Schema", "protocolErrorV1Schema", "PROTOCOL_VERSION"];
    for (const name of required) {
      if (!(name in m)) { console.error("[${role}] missing export " + name); process.exit(2); }
    }
    const parsed = m.protocolErrorCodeSchema.safeParse("stale_fence");
    if (!parsed.success) { console.error("[${role}] frozen zod runtime failed to parse"); process.exit(3); }
    if (m.PROTOCOL_VERSION !== 1) { console.error("[${role}] unexpected PROTOCOL_VERSION"); process.exit(4); }
  `;
  const res = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" });
  if (res.status !== 0) {
    return `[${role}] frozen-root smoke import failed (exit ${res.status}): ${(res.stderr || res.stdout || "").trim()}`;
  }
  return null;
}

// --- CLI ---------------------------------------------------------------------

function parseArgs(argv) {
  const i = argv.indexOf("--source-sha");
  const sourceSha = i !== -1 ? argv[i + 1] : undefined;
  return { sourceSha };
}

async function main() {
  const repoRoot = process.cwd();
  const { sourceSha } = parseArgs(process.argv.slice(2));
  if (!sourceSha || !/^[0-9a-f]{40}$/.test(sourceSha)) {
    console.error("usage: node scripts/check-frozen-worker-protocol-consumer.mjs --source-sha <40-hex>");
    process.exit(1);
  }
  const dir = path.join(repoRoot, ...FIXTURE_SEGMENTS);

  const require = createRequire(path.join(repoRoot, "packages", "worker-protocol", PACKAGE_NAME));
  const rootRequire = createRequire(path.join(repoRoot, PACKAGE_NAME));
  const expectedZodVersion = JSON.parse(fs.readFileSync(require.resolve("zod/package.json"), "utf8")).version;
  const expectedEsbuildVersion = JSON.parse(fs.readFileSync(rootRequire.resolve("esbuild/package.json"), "utf8")).version;
  const expectedLockfileIntegrity = createHash("sha256").update(fs.readFileSync(path.join(repoRoot, "pnpm-lock.yaml"))).digest("hex");
  const expectedPackageIntegrity = createHash("sha256")
    .update(fs.readFileSync(path.join(repoRoot, "packages", "worker-protocol", PACKAGE_NAME)))
    .digest("hex");

  const { errors } = verifyFrozenConsumerStatic({
    dir,
    sourceSha,
    expectedZodVersion,
    expectedEsbuildVersion,
    expectedLockfileIntegrity,
    expectedPackageIntegrity,
    repoRoot,
  });

  const indexUrl = pathToFileURL(path.join(dir, "dist", "index.js")).href;
  for (const role of ["server", "worker"]) {
    const err = smokeImport(role, indexUrl);
    if (err) errors.push(err);
  }

  if (errors.length > 0) {
    console.error("frozen worker-protocol v1 consumer verification FAILED:");
    for (const line of errors) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log(`frozen worker-protocol v1 consumer: OK (sourceSha ${sourceSha}, zod ${expectedZodVersion}, esbuild ${expectedEsbuildVersion})`);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}
