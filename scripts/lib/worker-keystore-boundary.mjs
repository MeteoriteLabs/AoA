/**
 * worker-keystore-boundary.mjs — pure boundary logic for the DSK-001 leaf package
 * `@armyofagents/worker-keystore`.
 *
 * Forked in STRUCTURE from `scripts/lib/sandbox-e2b-provider-boundary.mjs`, but
 * the confined capability is different. The e2b leaf confines a CREDENTIAL to one
 * file; this leaf confines SUBPROCESS EXECUTION to one file.
 *
 * WHY THIS CHECKER EXISTS. The whole point of the package is that a private
 * device key crosses a process boundary on stdin. Everything that decides HOW
 * that happens — the planner, the outcome classifier, the envelope codec, the
 * store — is pure and OS-free so it is provable on the ubuntu-only REQUIRED CI
 * lane. That decomposition is only meaningful if the dangerous capability
 * actually stays in one place. Review cannot guarantee that; a mechanical
 * PATH confinement can. (The e2b leaf's CREDENTIAL_HOST_BASENAME is the same idea
 * keyed on a basename — which is weaker, and was the bug here: a same-named file
 * in a subdirectory inherited the permission.)
 *
 * Policy:
 *   - The manifest declares EXACTLY `@armyofagents/worker-daemon` and
 *     `@armyofagents/worker-protocol`. Adding anything is a STOP for controller
 *     approval — a native keychain binding (keytar, @napi-rs/keyring) must never
 *     arrive here by accident, because this package is injected INTO the daemon's
 *     process.
 *   - `node:child_process` (and the bare `child_process`) may be imported from
 *     EXACTLY ONE runtime source PATH, `src/command-runner.ts`.
 *   - Non-literal imports and the `node:module` createRequire bridge are rejected,
 *     because either would let arbitrary code reach the process holding the key.
 *
 * The lexical scanner is the ONE canonical implementation shared with the
 * worker-protocol boundary — imported, never duplicated.
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
 * Runtime dependencies this leaf may declare — EXACTLY these two, pre-sorted so a
 * `.sort()`ed manifest key list compares by value.
 *
 * The dependency arrow points keystore → daemon and never the reverse: the
 * daemon's own manifest is pinned to `["@armyofagents/worker-protocol","pino"]`
 * and `scripts/check-worker-daemon-boundary.mjs` rejects a bare specifier the
 * moment a file under `packages/worker-daemon/src` names it. So the host composes
 * this package in; the daemon never imports it.
 */
export const REQUIRED_RUNTIME_DEPENDENCIES = [
  "@armyofagents/worker-daemon",
  "@armyofagents/worker-protocol",
];

/**
 * The single runtime source file permitted to spawn a subprocess, as a full
 * package-relative path.
 *
 * It was a BASENAME, and that was a real hole: a file at
 * `src/anything/command-runner.ts` inherited spawn permission simply by being
 * named the same. Demonstrated live — the checker passed such a file — so the
 * confinement was bypassable by anyone who created a subdirectory. "One
 * dangerous capability, one file" has to mean one PATH.
 */
export const SUBPROCESS_HOST_PATH = "src/command-runner.ts";

/** Specifiers that grant subprocess execution. */
const SUBPROCESS_SPECIFIERS = new Set(["child_process", "node:child_process"]);

const NODE_BUILTINS = new Set(builtinModules);
const ALLOWED_BARE = new Set([
  "@armyofagents/worker-daemon",
  "@armyofagents/worker-protocol",
]);

/** `node:module`/`module` expose `createRequire`, which resolves ANY package from
 * the hoisted monorepo node_modules at runtime — forbidden even as a builtin. */
const FORBIDDEN_BRIDGE_BUILTINS = new Set(["module", "node:module"]);

function isNodeBuiltin(specifier) {
  if (specifier.startsWith("node:")) return true;
  if (NODE_BUILTINS.has(specifier)) return true;
  const root = specifier.split("/")[0];
  return NODE_BUILTINS.has(root);
}

function isAllowedBareImport(specifier) {
  if (ALLOWED_BARE.has(specifier)) return true;
  if (FORBIDDEN_BRIDGE_BUILTINS.has(specifier)) return false;
  return isNodeBuiltin(specifier);
}

const TEST_SPECIFIER_RE = /\.test(?:\.[cm]?[jt]s)?$/;

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
    // Subprocess confinement: ONLY `command-runner.ts` may spawn.
    // The confinement keys on the FULL package-relative path. A basename check
    // let `src/anything/command-runner.ts` inherit spawn permission.
    const packageRelative = relPath.slice(relPath.indexOf("/src/") + 1);
    if (SUBPROCESS_SPECIFIERS.has(value) && packageRelative !== SUBPROCESS_HOST_PATH) {
      errors.push(
        `${relPath}: ${JSON.stringify(value)} may be imported ONLY from ${SUBPROCESS_HOST_PATH} — ` +
          "subprocess execution is confined to ONE PATH so the pure decision logic stays OS-free",
      );
      continue;
    }
    if (isAllowedBareImport(value)) continue;
    errors.push(`${relPath}: forbidden runtime import ${JSON.stringify(value)}`);
  }
  for (const forbidden of findForbiddenGlobals(source)) {
    if (forbidden === "require(") {
      errors.push(`${relPath}: CommonJS require() is forbidden in runtime source`);
    }
  }
  return errors;
}

/**
 * Validate the boundary-relevant fields of the package manifest.
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
