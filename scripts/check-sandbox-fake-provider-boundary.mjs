#!/usr/bin/env node
/**
 * check-sandbox-fake-provider-boundary.mjs
 *
 * Always-on `policy`-job guard for the DEP-000 leaf packages
 * `@armyofagents/sandbox-fake-provider` and
 * `@armyofagents/sandbox-provider-contract`. It enforces that BOTH packages
 * declare EXACTLY the runtime dependencies `@armyofagents/worker-protocol` +
 * `zod`, and that their runtime source imports ONLY the worker protocol, `zod`,
 * Node built-ins, or relative modules inside the package `src` directory — no
 * `@armyofagents/db`, `@armyofagents/server`, `@armyofagents/shared`,
 * `@armyofagents/adapters`, `@armyofagents/worker-daemon`, the sibling sandbox
 * package, `drizzle-orm`, `pg`, Express, or any other bare package. This is the
 * machine-checkable form of "no tenant/server/db code on the host worker".
 *
 * This file is the filesystem/command layer only: it reads bytes and directory
 * listings and delegates every parsing/validation decision to the pure
 * `scripts/lib/sandbox-fake-provider-boundary.mjs`. Filesystem read/parse errors
 * are reported SEPARATELY from import-policy violations.
 *
 * Usage:
 *   node scripts/check-sandbox-fake-provider-boundary.mjs
 *   node scripts/check-sandbox-fake-provider-boundary.mjs --root <fixture-dir>
 */

import { readFile as fsReadFile, readdir as fsReaddir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  classifyRuntimeSourceFileName,
  evaluateInboundManifest,
  evaluateInboundSourceImports,
  evaluateManifest,
  evaluateRuntimeSourceImports,
  isInboundSourceFileName,
  parseWorkspaceGlobs,
} from "./lib/sandbox-fake-provider-boundary.mjs";

/** The two DEP-000 leaf packages this gate covers. */
export const SANDBOX_BOUNDARY_PACKAGES = [
  { rel: "packages/sandbox-fake-provider", name: "@armyofagents/sandbox-fake-provider" },
  { rel: "packages/sandbox-provider-contract", name: "@armyofagents/sandbox-provider-contract" },
];

function toRel(root, absolute) {
  return path.relative(root, absolute).replaceAll("\\", "/");
}

function describeError(err) {
  if (err && typeof err === "object" && "code" in err && err.code) return String(err.code);
  return err && err.message ? err.message : String(err);
}

/**
 * Run the boundary check for a single package under `root`.
 * @returns {Promise<{policyErrors:string[], readErrors:string[]}>}
 */
async function checkPackage(root, pkg, readFile, readdir) {
  const policyErrors = [];
  const readErrors = [];
  const manifestRel = `${pkg.rel}/package.json`;
  const srcRel = `${pkg.rel}/src`;
  const packageRoot = path.join(root, ...pkg.rel.split("/"));
  const sourceRoot = path.join(packageRoot, "src");

  let manifestText;
  try {
    manifestText = await readFile(path.join(packageRoot, "package.json"), "utf8");
  } catch (err) {
    readErrors.push(`${manifestRel}: missing or unreadable (${describeError(err)})`);
  }
  if (manifestText !== undefined) {
    let manifest;
    try {
      manifest = JSON.parse(manifestText);
    } catch (err) {
      readErrors.push(`${manifestRel}: invalid JSON (${describeError(err)})`);
    }
    if (manifest !== undefined) {
      policyErrors.push(...evaluateManifest(manifest, { manifestRel, expectedName: pkg.name }));
    }
  }

  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (err) {
      if (directory === sourceRoot) {
        readErrors.push(`${srcRel}: missing (${describeError(err)})`);
      } else {
        readErrors.push(`${toRel(root, directory)}: unreadable directory (${describeError(err)})`);
      }
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const rel = toRel(root, absolute);
      if (entry.isSymbolicLink()) {
        policyErrors.push(`${rel}: runtime-source symlinks are forbidden`);
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      const kind = classifyRuntimeSourceFileName(entry.name);
      if (kind === "alternate-extension") {
        policyErrors.push(`${rel}: alternate runtime-source extensions are forbidden; use .ts`);
        continue;
      }
      if (kind !== "runtime") continue; // test source + non-source files skipped
      let source;
      try {
        source = await readFile(absolute, "utf8");
      } catch (err) {
        readErrors.push(`${rel}: unreadable source (${describeError(err)})`);
        continue;
      }
      policyErrors.push(...evaluateRuntimeSourceImports({ relPath: rel, absPath: absolute, sourceRoot, source }));
    }
  }

  await walk(sourceRoot);
  return { policyErrors, readErrors };
}

/**
 * Run the boundary check across the configured packages.
 * @param {string} root repository root (defaults to cwd)
 * @param {{packages?:Array<{rel,name}>, readFile?:Function, readdir?:Function}} [opts]
 * @returns {Promise<{policyErrors:string[], readErrors:string[]}>}
 */
export async function runBoundaryCheck(root, opts = {}) {
  const readFile = opts.readFile ?? fsReadFile;
  const readdir = opts.readdir ?? fsReaddir;
  const packages = opts.packages ?? SANDBOX_BOUNDARY_PACKAGES;
  const policyErrors = [];
  const readErrors = [];
  for (const pkg of packages) {
    const result = await checkPackage(root, pkg, readFile, readdir);
    policyErrors.push(...result.policyErrors);
    readErrors.push(...result.readErrors);
  }
  return { policyErrors, readErrors };
}

/**
 * THE INBOUND ARM's filesystem layer (DEP-021). Enumerates every workspace package from
 * `pnpm-workspace.yaml`'s own globs and applies the inbound policy to each manifest and each
 * source file. Pure node; every parsing decision is delegated to the pure lib.
 *
 * ★ IT SCANS THE WHOLE PACKAGE, not just `src`. The outbound arm walks `<pkg>/src` because
 * that is the leaf packages' only shipped tree. Inbound cannot make that assumption: a
 * production package can reach the fake provider from `bin/`, `scripts/`, a vite config or a
 * test helper, and a scan that only read `src` would pass by not looking. `node_modules`,
 * `dist` and `.git` are pruned — they are installed or generated, not authored.
 */

/** Directories never authored, so never scanned. */
const INBOUND_PRUNED_DIRS = new Set(["node_modules", "dist", "build", ".git", ".turbo", "coverage", ".next"]);

/**
 * Expand one `pnpm-workspace.yaml` glob into package directories (relative, forward slashes).
 * Only the two shapes the file uses are supported: a literal path, and a single trailing `/*`.
 * Any other shape is a REFUSAL rather than a silent skip.
 */
async function expandWorkspaceGlob(root, glob, readdir) {
  const errors = [];
  const dirs = [];
  if (glob.includes("*")) {
    if (!glob.endsWith("/*") || glob.slice(0, -2).includes("*")) {
      errors.push(`pnpm-workspace.yaml: unsupported package glob ${JSON.stringify(glob)} — refusing to guess its expansion`);
      return { dirs, errors };
    }
    const parent = glob.slice(0, -2);
    let entries;
    try {
      entries = await readdir(path.join(root, ...parent.split("/")), { withFileTypes: true });
    } catch (err) {
      errors.push(`${parent}: unreadable workspace root (${describeError(err)})`);
      return { dirs, errors };
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || INBOUND_PRUNED_DIRS.has(entry.name)) continue;
      dirs.push(`${parent}/${entry.name}`);
    }
    return { dirs, errors };
  }
  dirs.push(glob);
  return { dirs, errors };
}

/** Every authored source file under `packageRoot`, relative to `root`. */
async function listPackageSources(root, packageRel, readdir) {
  const found = [];
  const readErrors = [];
  async function walk(relDir) {
    let entries;
    try {
      entries = await readdir(path.join(root, ...relDir.split("/")), { withFileTypes: true });
    } catch (err) {
      readErrors.push(`${relDir}: unreadable directory (${describeError(err)})`);
      return;
    }
    for (const entry of entries) {
      if (INBOUND_PRUNED_DIRS.has(entry.name)) continue;
      const rel = `${relDir}/${entry.name}`;
      if (entry.isSymbolicLink()) continue; // the outbound arm refuses symlinks in the leaf src
      if (entry.isDirectory()) {
        await walk(rel);
        continue;
      }
      if (isInboundSourceFileName(entry.name)) found.push(rel);
    }
  }
  await walk(packageRel);
  return { found, readErrors };
}

/**
 * Run the INBOUND check: no production package may depend on or import the fake provider.
 *
 * @param {string} root repository root
 * @param {{readFile?:Function, readdir?:Function}} [opts]
 * @returns {Promise<{policyErrors:string[], readErrors:string[], scanned:{packages:number, sources:number}}>}
 */
export async function runInboundCheck(root, opts = {}) {
  const readFile = opts.readFile ?? fsReadFile;
  const readdir = opts.readdir ?? fsReaddir;
  const policyErrors = [];
  const readErrors = [];

  let workspaceText;
  try {
    workspaceText = await readFile(path.join(root, "pnpm-workspace.yaml"), "utf8");
  } catch (err) {
    readErrors.push(`pnpm-workspace.yaml: missing or unreadable (${describeError(err)})`);
    return { policyErrors, readErrors, scanned: { packages: 0, sources: 0 } };
  }
  const { globs, errors: globErrors } = parseWorkspaceGlobs(workspaceText);
  readErrors.push(...globErrors);

  const packageDirs = [];
  for (const glob of globs) {
    const expanded = await expandWorkspaceGlob(root, glob, readdir);
    readErrors.push(...expanded.errors);
    packageDirs.push(...expanded.dirs);
  }

  let sources = 0;
  let packages = 0;
  for (const packageRel of packageDirs) {
    const manifestRel = `${packageRel}/package.json`;
    let manifest;
    try {
      manifest = JSON.parse(await readFile(path.join(root, ...manifestRel.split("/")), "utf8"));
    } catch (err) {
      // A workspace glob can expand onto a directory with no manifest (a stray folder). That is
      // not this arm's business to police; the outbound arm reports the two packages it owns.
      if (err && typeof err === "object" && err.code === "ENOENT") continue;
      readErrors.push(`${manifestRel}: unreadable or invalid JSON (${describeError(err)})`);
      continue;
    }
    packages += 1;
    policyErrors.push(...evaluateInboundManifest(manifest, { manifestRel }));
    const packageName = manifest && typeof manifest.name === "string" ? manifest.name : "";

    const listed = await listPackageSources(root, packageRel, readdir);
    readErrors.push(...listed.readErrors);
    for (const relPath of listed.found) {
      let source;
      try {
        source = await readFile(path.join(root, ...relPath.split("/")), "utf8");
      } catch (err) {
        readErrors.push(`${relPath}: unreadable source (${describeError(err)})`);
        continue;
      }
      sources += 1;
      policyErrors.push(...evaluateInboundSourceImports({ relPath, packageName, source }));
    }
  }

  // ★ FAIL CLOSED ON AN EMPTY SCAN. Zero packages or zero sources means the walk found
  // nothing, which a naive implementation reports as PASS — the exact vacuity this arm was
  // added to close. A guard that proves nothing must say so.
  if (packages === 0) {
    readErrors.push("inbound: zero workspace manifests were scanned — refusing to report a pass on an empty scan");
  } else if (sources === 0) {
    readErrors.push("inbound: zero source files were scanned — refusing to report a pass on an empty scan");
  }
  return { policyErrors, readErrors, scanned: { packages, sources } };
}

export function resolveRoot(argv) {
  const i = argv.indexOf("--root");
  if (i !== -1 && argv[i + 1]) return path.resolve(argv[i + 1]);
  return process.cwd();
}

async function main() {
  const root = resolveRoot(process.argv.slice(2));
  const outbound = await runBoundaryCheck(root);
  // ★ BOTH DIRECTIONS, and both reported. Outbound decides what the leaf packages may import;
  // inbound decides who may import THEM, which is the direction that makes a fabricating
  // provider production-reachable. Running only one is how the inbound property came to hold
  // by accident with every guard green.
  const inbound = await runInboundCheck(root);
  const policyErrors = [...outbound.policyErrors, ...inbound.policyErrors];
  const readErrors = [...outbound.readErrors, ...inbound.readErrors];
  if (readErrors.length > 0) {
    console.error("filesystem read/parse errors:");
    for (const line of readErrors) console.error(`  ${line}`);
  }
  if (policyErrors.length > 0) {
    console.error("import-policy violations:");
    for (const line of policyErrors) console.error(`  ${line}`);
  }
  if (readErrors.length > 0 || policyErrors.length > 0) {
    process.exit(1);
  }
  console.log(
    "sandbox fake provider boundary: PASS " +
      `(outbound: ${SANDBOX_BOUNDARY_PACKAGES.length} leaf packages; ` +
      `inbound: ${inbound.scanned.packages} workspace manifests, ${inbound.scanned.sources} source files)`,
  );
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}
