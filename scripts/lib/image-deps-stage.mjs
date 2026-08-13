/**
 * image-deps-stage.mjs — pure logic for the split-image deps-stage parity check
 * (DEP-001). No filesystem I/O: the CLI wrapper
 * `scripts/check-image-deps-stages.mjs` supplies the Dockerfile text and the
 * parsed workspace manifests; this module decides parity.
 *
 * Least-privilege invariant: each split image's `deps` stage must `COPY`
 * EXACTLY the set of workspace-package manifests in its own runtime dependency
 * closure — no fewer (or the install is incomplete) and NO MORE (or the image
 * drags in code it must not contain, e.g. the worker pulling server/db). This is
 * the machine-checkable form of "each image's deps stage copies exactly its
 * dependency closure and no more" (plan §2.2), and for the worker it enforces
 * E4-D01's fixed closure of worker-daemon + worker-protocol.
 *
 * Dependencies: `node:path` only, for pure path arithmetic (no reads).
 */

import path from "node:path";

/**
 * Extract the body lines of a named Dockerfile build stage
 * (`FROM ... AS <stage>` up to the next `FROM`). Returns null if not found.
 * @param {string} dockerfileText
 * @param {string} stageName
 * @returns {string|null}
 */
export function extractStage(dockerfileText, stageName) {
  const lines = String(dockerfileText).split(/\r?\n/);
  const fromRe = /^\s*FROM\s+/i;
  const asRe = new RegExp(`^\\s*FROM\\s+.+\\s+AS\\s+${escapeRegExp(stageName)}\\s*$`, "i");
  let inStage = false;
  const body = [];
  for (const line of lines) {
    if (asRe.test(line)) {
      inStage = true;
      continue;
    }
    if (inStage && fromRe.test(line)) break;
    if (inStage) body.push(line);
  }
  return inStage ? body.join("\n") : null;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Given the lines of a stage, return the set of workspace directories whose
 * `package.json` is COPYed (e.g. `COPY server/package.json server/` →
 * `server`; `COPY packages/db/package.json packages/db/` → `packages/db`).
 *
 * Only `<dir>/package.json` sources with a directory prefix count as workspace
 * manifests; the root `COPY package.json pnpm-workspace.yaml ...` (no slash) and
 * `COPY patches/ patches/` are infrastructure and ignored.
 *
 * @param {string} stageText
 * @returns {string[]} sorted, de-duplicated workspace dirs (posix separators)
 */
export function copiedWorkspaceDirs(stageText) {
  const dirs = new Set();
  const lines = String(stageText).split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!/^COPY\b/i.test(line)) continue;
    // strip a leading `COPY` and any `--flag=...` options, then take tokens
    const rest = line.replace(/^COPY\b/i, "").trim();
    const tokens = rest.split(/\s+/).filter((t) => !t.startsWith("--"));
    // last token is the destination; the rest are sources
    const sources = tokens.slice(0, -1);
    for (const src of sources) {
      const normalized = src.replaceAll("\\", "/");
      if (!normalized.includes("/")) continue; // root package.json etc.
      if (!/\/package\.json$/.test(normalized)) continue;
      dirs.add(normalized.replace(/\/package\.json$/, ""));
    }
  }
  return [...dirs].sort();
}

/**
 * Compute the transitive runtime workspace closure of a set of entry packages.
 *
 * @param {string[]} entryNames package names (e.g. `@armyofagents/server`)
 * @param {Map<string,{dir:string, runtimeWorkspaceDeps:string[]}>} packagesByName
 * @returns {{names:Set<string>, dirs:Set<string>, missing:string[]}}
 *   `missing` = entry/dep names not present in the manifest map.
 */
export function computeRuntimeClosure(entryNames, packagesByName) {
  const names = new Set();
  const dirs = new Set();
  const missing = [];
  const stack = [...entryNames];
  while (stack.length > 0) {
    const name = stack.pop();
    if (names.has(name)) continue;
    const info = packagesByName.get(name);
    if (!info) {
      missing.push(name);
      continue;
    }
    names.add(name);
    dirs.add(info.dir.replaceAll("\\", "/"));
    for (const dep of info.runtimeWorkspaceDeps) {
      if (!names.has(dep)) stack.push(dep);
    }
  }
  return { names, dirs, missing };
}

/**
 * Evaluate a single split image's deps-stage parity.
 *
 * @param {{
 *   imageName: string,
 *   dockerfileText: string,
 *   entryPackages: string[],
 *   packagesByName: Map<string,{dir:string, runtimeWorkspaceDeps:string[]}>,
 *   stageName?: string,
 * }} args
 * @returns {string[]} policy-violation messages (empty ⇒ parity holds)
 */
export function evaluateImageDepsStage({
  imageName,
  dockerfileText,
  entryPackages,
  packagesByName,
  stageName = "deps",
}) {
  const errors = [];
  const stage = extractStage(dockerfileText, stageName);
  if (stage === null) {
    errors.push(`${imageName}: could not find a 'FROM ... AS ${stageName}' stage`);
    return errors;
  }

  const { dirs: expectedDirs, missing } = computeRuntimeClosure(entryPackages, packagesByName);
  for (const name of missing) {
    errors.push(`${imageName}: entry/dependency package not found in workspace: ${name}`);
  }

  const copied = new Set(copiedWorkspaceDirs(stage));
  const expected = new Set([...expectedDirs].map((d) => d.replaceAll("\\", "/")));

  for (const dir of [...expected].sort()) {
    if (!copied.has(dir)) {
      errors.push(`${imageName}: deps stage is MISSING closure manifest: COPY ${dir}/package.json ${dir}/`);
    }
  }
  for (const dir of [...copied].sort()) {
    if (!expected.has(dir)) {
      errors.push(
        `${imageName}: deps stage COPYs ${dir}/package.json which is OUTSIDE the image closure (least-privilege violation)`,
      );
    }
  }
  return errors;
}

/**
 * Build a `packagesByName` map from raw manifest records.
 * @param {Array<{dir:string, manifest:object}>} records
 * @returns {Map<string,{dir:string, runtimeWorkspaceDeps:string[]}>}
 */
export function indexPackages(records) {
  const known = new Set(records.map((r) => r.manifest?.name).filter(Boolean));
  const map = new Map();
  for (const { dir, manifest } of records) {
    if (!manifest || typeof manifest.name !== "string") continue;
    const deps = manifest.dependencies ?? {};
    const runtimeWorkspaceDeps = Object.keys(deps).filter((k) => known.has(k));
    map.set(manifest.name, {
      dir: path.posix.normalize(dir.replaceAll("\\", "/")),
      runtimeWorkspaceDeps,
    });
  }
  return map;
}
