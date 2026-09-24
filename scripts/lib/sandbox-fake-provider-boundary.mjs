/**
 * sandbox-fake-provider-boundary.mjs — pure, (almost) dependency-free boundary
 * logic for the DEP-000 leaf packages `@armyofagents/sandbox-fake-provider` and
 * `@armyofagents/sandbox-provider-contract`.
 *
 * Mirrors `scripts/lib/worker-daemon-boundary.mjs`, but enforces the DEP-000
 * dependency policy shared by BOTH new packages:
 *
 *   - The manifest may declare EXACTLY the runtime dependencies
 *     `@armyofagents/worker-protocol` + `zod` (nothing more, nothing less).
 *   - Runtime source may import ONLY: `@armyofagents/worker-protocol`, `zod`
 *     (and `zod/*` subpaths), any Node built-in (`node:*` or a bare builtin
 *     name), or a relative path that normalizes INSIDE the package `src`
 *     directory. Everything else — most importantly `@armyofagents/db`,
 *     `@armyofagents/server`, `@armyofagents/shared`, `@armyofagents/adapters`,
 *     `@armyofagents/worker-daemon`, the SIBLING sandbox package, `drizzle-orm`,
 *     `pg`, `pino`, Express, and any other bare package — is rejected. This is
 *     the machine-checkable "no tenant/server/db code on the host worker".
 *
 * Like the worker daemon (a real runtime program with a loopback HTTP server),
 * this checker does NOT forbid Node/runtime globals (`process`, `Buffer`, `URL`);
 * it DOES forbid the CommonJS `require(...)` bridge and `node:module`
 * (`createRequire` escapes the static import allowlist at runtime).
 *
 * The lexical scanner is the ONE canonical implementation shared with the
 * worker-protocol boundary — imported here, not duplicated.
 */

import path from "node:path";
import { builtinModules } from "node:module";

import {
  classifyRuntimeSourceFileName,
  extractModuleSpecifiers,
  findForbiddenGlobals,
} from "./worker-protocol-boundary.mjs";

export { classifyRuntimeSourceFileName };

/**
 * Runtime dependencies EITHER new package's manifest may declare — EXACTLY these
 * two, pre-sorted so a `.sort()`ed manifest key list compares by value. Any
 * addition/removal is a STOP for controller approval.
 */
export const REQUIRED_RUNTIME_DEPENDENCIES = ["@armyofagents/worker-protocol", "zod"];

const NODE_BUILTINS = new Set(builtinModules);
const TEST_SPECIFIER_RE = /\.test(?:\.[cm]?[jt]s)?$/;

/** `node:module`/`module` expose `createRequire`, which resolves ANY package
 * from the hoisted monorepo node_modules at runtime — forbidden even as a Node
 * builtin. */
const FORBIDDEN_BRIDGE_BUILTINS = new Set(["module", "node:module"]);

function isNodeBuiltin(specifier) {
  if (specifier.startsWith("node:")) return true;
  if (NODE_BUILTINS.has(specifier)) return true;
  const root = specifier.split("/")[0];
  return NODE_BUILTINS.has(root);
}

/** True for a bare (non-relative) specifier either package may import. */
function isAllowedBareImport(specifier) {
  if (specifier === "@armyofagents/worker-protocol") return true;
  if (specifier === "zod") return true;
  // Allow zod subpaths but never a traversal specifier that escapes via `..`.
  if (specifier.startsWith("zod/") && !specifier.split("/").includes("..")) return true;
  if (FORBIDDEN_BRIDGE_BUILTINS.has(specifier)) return false;
  return isNodeBuiltin(specifier);
}

/**
 * Validate the imports of a single runtime source file.
 * @param {{relPath:string, absPath:string, sourceRoot:string, source:string}} args
 * @returns {string[]} policy-violation messages (empty ⇒ clean)
 */
export function evaluateRuntimeSourceImports({ relPath, absPath, sourceRoot, source }) {
  const errors = [];
  for (const spec of extractModuleSpecifiers(source)) {
    if (spec.nonLiteral || spec.value == null) {
      errors.push(`${relPath}: non-literal ${spec.kind} import is forbidden in runtime source`);
      continue;
    }
    const value = spec.value;
    if (value.startsWith("./") || value.startsWith("../")) {
      if (TEST_SPECIFIER_RE.test(value)) {
        errors.push(`${relPath}: runtime import of test source is forbidden: ${JSON.stringify(value)}`);
        continue;
      }
      const resolved = path.resolve(path.dirname(absPath), value);
      if (resolved === sourceRoot || resolved.startsWith(`${sourceRoot}${path.sep}`)) continue;
      errors.push(`${relPath}: relative import escapes package src: ${JSON.stringify(value)}`);
      continue;
    }
    if (isAllowedBareImport(value)) continue;
    errors.push(`${relPath}: forbidden runtime import ${JSON.stringify(value)}`);
  }
  // Node/runtime globals are allowed; the CommonJS require() bridge is not.
  for (const forbidden of findForbiddenGlobals(source)) {
    if (forbidden === "require(") {
      errors.push(`${relPath}: CommonJS require() is forbidden in runtime source`);
    }
  }
  return errors;
}

/**
 * Validate the boundary-relevant fields of a package manifest.
 * @param {unknown} manifest a parsed package.json object
 * @param {{ manifestRel:string, expectedName:string }} pkg
 * @returns {string[]} policy-violation messages (empty ⇒ clean)
 */
export function evaluateManifest(manifest, pkg) {
  const errors = [];
  if (manifest == null || typeof manifest !== "object") {
    errors.push(`${pkg.manifestRel}: not an object`);
    return errors;
  }
  // Union EVERY runtime-effective dependency field — a forbidden dep hidden under
  // optional/peer/bundled is equally resolvable at runtime and must fail.
  const runtimeDependencies = [
    ...new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...(Array.isArray(manifest.bundledDependencies) ? manifest.bundledDependencies : []),
      ...(Array.isArray(manifest.bundleDependencies) ? manifest.bundleDependencies : []),
    ]),
  ].sort();
  if (JSON.stringify(runtimeDependencies) !== JSON.stringify(REQUIRED_RUNTIME_DEPENDENCIES)) {
    errors.push(
      `${pkg.manifestRel}: runtime dependencies must equal ${JSON.stringify(
        REQUIRED_RUNTIME_DEPENDENCIES,
      )}, got ${JSON.stringify(runtimeDependencies)}`,
    );
  }
  if (manifest.name !== pkg.expectedName) {
    errors.push(`${pkg.manifestRel}: unexpected package name ${JSON.stringify(manifest.name)}`);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// THE INBOUND ARM (DEP-021). Everything above this line is OUTBOUND: it decides
// what the two leaf packages may IMPORT. That direction says nothing at all about
// WHO MAY IMPORT THEM — and for `@armyofagents/sandbox-fake-provider` that is the
// direction that decides whether a FABRICATING provider, and every scripting flag
// it carries, is reachable from a production build.
//
// ★★★ WHY IT IS ADDED, stated as a measurement rather than a worry. At `eb8458bb3`
// the property ALREADY HELD: no workspace package declares a runtime dependency on
// the fake provider, and the only manifest that names it at all is
// `packages/sandbox-provider-contract`, in `devDependencies`. So this arm changes no
// behaviour today. It exists because NOTHING ENFORCED IT: the property held by
// accident, and a one-line `dependencies` edit in any of the 34 workspace manifests
// would have made a fabricating provider production-reachable with every guard still
// green. That is the "a check that nothing runs" class, sitting on the package whose
// whole purpose is to fabricate provider results.
//
// ★ WHAT ALREADY EXISTED, so this arm is not over-claimed. `docker/worker/Dockerfile`
// copies the package into its BUILD stage (the 8th manifest — `sandbox-provider-contract`'s
// tsconfig lists its conformance suite in `files:`) and `pnpm deploy --prod` prunes it back
// out; `docker/images/__tests__/image-contents.test.mjs` asserts an UNSCOPED
// anti-fake-provider `find` over `/worker-app` and `/worker-net-app`. That control is real,
// and it is a DIFFERENT control: it needs the images BUILT (not pure node, not in `policy`),
// and it covers those two image trees only — the control-plane and adapter-manager images
// carry no such assertion. This arm is the DEPENDENCY-GRAPH half: pure node, locally
// runnable, over every workspace package. Neither subsumes the other.
// ---------------------------------------------------------------------------

/** The package nothing in production may depend on or import. */
export const FAKE_PROVIDER_PACKAGE = "@armyofagents/sandbox-fake-provider";

/**
 * The COMPLETE set of workspace packages permitted to name {@link FAKE_PROVIDER_PACKAGE},
 * and the single field each may name it in. Anything absent from this map may not name it
 * at all, in any field, in any source file.
 *
 * `self` means the package IS the fake provider: its own sources import its own modules
 * relatively, and the outbound arm above already governs them.
 *
 * `sandbox-provider-contract` is the conformance harness. It is allowed the edge in
 * `devDependencies` ONLY — a `dependencies` edge there would drag the fake into the
 * production closure of everything that depends on the contract package, and
 * `sandbox-e2b-provider` depends on it in `dependencies` (measured at `eb8458bb3`), which
 * is exactly how one field change would reach a shipped image.
 */
export const FAKE_PROVIDER_INBOUND_ALLOWANCES = Object.freeze({
  "@armyofagents/sandbox-fake-provider": "self",
  "@armyofagents/sandbox-provider-contract": "devDependencies",
});

/** Dependency fields that put a package in a RUNTIME closure. `devDependencies` is
 * deliberately NOT here: it is handled separately, because it is allowed for one package. */
const RUNTIME_DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"];

/** Source extensions the inbound scan reads. DELIBERATELY WIDER than
 * `classifyRuntimeSourceFileName`, which admits only `.ts`: `ui` is `.tsx` and several
 * packages ship `.mjs`, and a scan that could not see them would be a check that passes by
 * not looking. */
const INBOUND_SOURCE_EXT_RE = /\.(?:m|c)?[jt]sx?$/;

/** True when this path is TEST source rather than shipped source. Both spellings the repo
 * uses: a `.test.` / `.spec.` infix, and any `__tests__` / `tests` path segment. */
export function isInboundTestSourcePath(relPath) {
  const normalized = String(relPath).replaceAll("\\", "/");
  if (/\.(?:test|spec)\./.test(normalized)) return true;
  return normalized.split("/").some((segment) => segment === "__tests__" || segment === "tests");
}

/** True when the inbound scan should read this file at all. */
export function isInboundSourceFileName(name) {
  return INBOUND_SOURCE_EXT_RE.test(String(name));
}

/**
 * Validate ONE workspace manifest against the inbound policy.
 *
 * @param {unknown} manifest parsed package.json
 * @param {{ manifestRel:string }} ctx
 * @returns {string[]} violations (empty ⇒ clean)
 */
export function evaluateInboundManifest(manifest, { manifestRel }) {
  const errors = [];
  if (manifest == null || typeof manifest !== "object") return errors; // shape is the outbound arm's
  const name = typeof manifest.name === "string" ? manifest.name : "";
  const allowance = Object.prototype.hasOwnProperty.call(FAKE_PROVIDER_INBOUND_ALLOWANCES, name)
    ? FAKE_PROVIDER_INBOUND_ALLOWANCES[name]
    : undefined;
  if (allowance === "self") return errors;

  // 1. A runtime-effective edge is forbidden EVERYWHERE, including for the allowlisted
  //    conformance harness: its allowance is devDependencies, not "any field".
  for (const field of RUNTIME_DEPENDENCY_FIELDS) {
    const deps = manifest[field];
    if (
      deps != null &&
      typeof deps === "object" &&
      Object.prototype.hasOwnProperty.call(deps, FAKE_PROVIDER_PACKAGE)
    ) {
      errors.push(
        `${manifestRel}: ${field} must not contain ${FAKE_PROVIDER_PACKAGE} — a runtime edge makes a FABRICATING provider production-reachable`,
      );
    }
  }
  for (const field of ["bundledDependencies", "bundleDependencies"]) {
    const bundled = manifest[field];
    if (Array.isArray(bundled) && bundled.includes(FAKE_PROVIDER_PACKAGE)) {
      errors.push(
        `${manifestRel}: ${field} must not contain ${FAKE_PROVIDER_PACKAGE} — a bundled edge makes a FABRICATING provider production-reachable`,
      );
    }
  }
  // 2. A dev edge is forbidden except for the one allowlisted package.
  const dev = manifest.devDependencies;
  if (dev != null && typeof dev === "object" && Object.prototype.hasOwnProperty.call(dev, FAKE_PROVIDER_PACKAGE)) {
    if (allowance !== "devDependencies") {
      const permitted = Object.keys(FAKE_PROVIDER_INBOUND_ALLOWANCES)
        .filter((key) => FAKE_PROVIDER_INBOUND_ALLOWANCES[key] === "devDependencies")
        .join(", ");
      errors.push(
        `${manifestRel}: devDependencies must not contain ${FAKE_PROVIDER_PACKAGE} — only ${permitted} may declare it, and only there`,
      );
    }
  }
  return errors;
}

/**
 * Validate ONE source file against the inbound policy.
 *
 * Shipped source may never import the fake provider. TEST source may, but only inside a
 * package the allowance map names — a test in an arbitrary production package that imports
 * the fake would put that package's own `devDependencies` (or a hoisted resolution) on the
 * path, and is refused.
 *
 * @param {{ relPath:string, packageName:string, source:string }} args
 * @returns {string[]} violations (empty ⇒ clean)
 */
export function evaluateInboundSourceImports({ relPath, packageName, source }) {
  const allowance = Object.prototype.hasOwnProperty.call(FAKE_PROVIDER_INBOUND_ALLOWANCES, packageName)
    ? FAKE_PROVIDER_INBOUND_ALLOWANCES[packageName]
    : undefined;
  if (allowance === "self") return [];
  const errors = [];
  const isTest = isInboundTestSourcePath(relPath);
  for (const spec of extractModuleSpecifiers(source)) {
    if (spec.nonLiteral || spec.value == null) continue; // non-literal specifiers are the outbound arm's
    const value = spec.value;
    if (value !== FAKE_PROVIDER_PACKAGE && !value.startsWith(`${FAKE_PROVIDER_PACKAGE}/`)) continue;
    if (isTest && allowance !== undefined) continue; // an allowlisted package's TEST source may
    errors.push(
      isTest
        ? `${relPath}: test source in ${packageName || "<unnamed package>"} must not import ${FAKE_PROVIDER_PACKAGE} — only the conformance harness may`
        : `${relPath}: shipped source must not import ${FAKE_PROVIDER_PACKAGE} — a FABRICATING provider must not be production-reachable`,
    );
  }
  return errors;
}

/**
 * Parse the workspace package globs out of `pnpm-workspace.yaml`.
 *
 * DERIVED, never hard-coded. A constant list of workspace roots would silently stop covering
 * a root somebody adds later and the guard would go on passing over a whole tree — the
 * precise shape of the defect this arm exists to close. Zero entries is a REFUSAL, not an
 * empty pass.
 *
 * @param {string} text the file's contents
 * @returns {{ globs:string[], errors:string[] }}
 */
export function parseWorkspaceGlobs(text) {
  const globs = [];
  let inPackages = false;
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "");
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const item = /^\s+-\s+(.+?)\s*$/.exec(line);
    if (item) {
      globs.push(item[1].replace(/^["']|["']$/g, ""));
      continue;
    }
    if (line.trim() === "") continue;
    break; // a new top-level key ends the list
  }
  const errors = [];
  if (globs.length === 0) {
    errors.push("pnpm-workspace.yaml: no `packages:` entries could be parsed — refusing to scan zero packages");
  }
  return { globs, errors };
}
