/**
 * image-deps-stage.mjs — pure logic for the split-image deps-stage parity check
 * (DEP-001). No filesystem I/O: the CLI wrapper
 * `scripts/check-image-deps-stages.mjs` supplies the Dockerfile text and the
 * parsed workspace manifests; this module decides parity.
 *
 * ★ THE EQUIVALENCE IS NARROWER THAN IT LOOKS. This module's `computeRuntimeClosure` walks
 * `.dependencies` ONLY (see `indexPackages`), which is what makes it byte-equal to pnpm's
 * `--filter-prod "X..."` selection — the property the Dockerfiles rely on. But `--filter-prod`
 * ALSO traverses `optionalDependencies`, which `indexPackages` ignores entirely. Zero workspace
 * manifests declare one today, so the two agree; the FIRST one to do so would silently re-open
 * the gap this guard closes, with the guard still green. If you add an `optionalDependencies`
 * block to any workspace package, teach `indexPackages` about it in the same commit.
 *
 * Least-privilege invariant: each split image's `deps` stage must `COPY`
 * EXACTLY the set of workspace-package manifests in its own runtime dependency
 * closure — no fewer (or the install is incomplete) and NO MORE (or the image
 * drags in code it must not contain, e.g. the worker pulling server/db). This is
 * the machine-checkable form of "each image's deps stage copies exactly its
 * dependency closure and no more" (plan §2.2), and for the worker it enforces
 * the worker's own closure. That closure was E4-D01's fixed two packages until Blocker B
 * gave `worker-networked-host` (DEP-011 Slice 2b's container boot root) an image home; it is
 * now seven, and `IMAGES[].entryPackages` in the CLI wrapper is the single place that says so.
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
    const devDeps = manifest.devDependencies ?? {};
    const runtimeWorkspaceDeps = Object.keys(deps).filter((k) => known.has(k));
    // E6-F012: recorded but NOT mixed into `runtimeWorkspaceDeps`. The runtime walk
    // must stay `.dependencies`-only (it mirrors `--filter-prod`); the dev edges are
    // a second, separately-reported set consumed by `computeBuildClosure`.
    const devWorkspaceDeps = Object.keys(devDeps).filter((k) => known.has(k));
    map.set(manifest.name, {
      dir: path.posix.normalize(dir.replaceAll("\\", "/")),
      runtimeWorkspaceDeps,
      devWorkspaceDeps,
    });
  }
  return map;
}

// ===========================================================================
// E6-F012 — THE BUILD SELECTION IS A DIFFERENT SET FROM THE INSTALLED SET.
//
// Everything above answers "what does the deps stage INSTALL?", and it answers it
// against `.dependencies` alone so that it is byte-equal to `--filter-prod "X..."`.
// The build stage asks a different question. `pnpm --filter "X..." build` traverses
// `devDependencies` TOO, so the set it compiles is the DEV closure — which at
// DEP-011 Slice 1 (`c3d26657d`) grew past the prod closure for the first time and
// killed the control-plane image build, while this guard stayed green and correct.
//
// ★ THE ASSERTABLE INVARIANT IS NOT "the deps stage must COPY the dev closure".
// That would destroy the least-privilege property the whole file exists to enforce:
// the deps stage's install is what reaches `pnpm deploy --prod`, and widening it
// puts the fake provider and the worker daemon into the control-plane image. The
// invariant is CONDITIONAL and it lives one stage later:
//
//     IF the build closure is strictly larger than the runtime closure,
//     THEN the build stage MUST absorb the difference —
//       (a) by re-installing (`RUN pnpm install`, NOT `--prod`/`--filter-prod`,
//           or the install re-selects the prod set and absorbs nothing), and
//       (b) with the divergent packages' manifests actually PRESENT in that
//           stage, or the re-install has nothing to resolve.
//
// (a) is the mechanism WRK-017 used for the control-plane, and the one the worker
// image had already used for its "8th manifest". (b) is what makes the rule BITE:
// the worker build stage deliberately does NOT `COPY . .` (a whole-tree copy would
// make every `dockerfile-static` exclusion grep vacuous), so for THAT image a new
// workspace devDependency is still a real break — and (a) alone would not see it.
//
// Both clauses are decided from text this module already parses. Nothing here
// executes docker, and nothing here substitutes for actually building the images;
// see E6-F013 / DEP-013 for the lane that does.
// ===========================================================================

/**
 * Transitive workspace closure over `dependencies` ∪ `devDependencies` — the set
 * `pnpm --filter "<entry>..." build` selects. Deliberately a SEPARATE function
 * from `computeRuntimeClosure`: that one's `.dependencies`-only walk is a
 * load-bearing mirror of `--filter-prod` and must not grow a mode flag.
 *
 * @param {string[]} entryNames
 * @param {Map<string,{dir:string, runtimeWorkspaceDeps:string[], devWorkspaceDeps?:string[]}>} packagesByName
 * @returns {{names:Set<string>, dirs:Set<string>, missing:string[]}}
 */
export function computeBuildClosure(entryNames, packagesByName) {
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
    for (const dep of [...info.runtimeWorkspaceDeps, ...(info.devWorkspaceDeps ?? [])]) {
      if (!names.has(dep)) stack.push(dep);
    }
  }
  return { names, dirs, missing };
}

/**
 * Join Dockerfile backslash continuations into logical lines, so a multi-line
 * `RUN pnpm install --frozen-lockfile \` + `  --filter-prod "x..."` is read as the
 * ONE command it is. Reading it as two would let a `--filter-prod` sitting on a
 * continuation line hide from the absorption check below.
 * @param {string} stageText
 * @returns {string[]}
 */
export function logicalLines(stageText) {
  const out = [];
  let acc = null;
  for (const raw of String(stageText).split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    const continues = /\\$/.test(line);
    const body = continues ? line.slice(0, -1) : line;
    acc = acc === null ? body : acc + " " + body.trim();
    if (!continues) {
      out.push(acc.trim());
      acc = null;
    }
  }
  if (acc !== null) out.push(acc.trim());
  return out;
}

/** The base image or parent stage of `FROM <base> AS <stageName>`; null if absent. */
export function stageParent(dockerfileText, stageName) {
  const re = new RegExp("^\\s*FROM\\s+(\\S+)\\s+AS\\s+" + escapeRegExp(stageName) + "\\s*$", "i");
  for (const line of String(dockerfileText).split(/\r?\n/)) {
    const m = re.exec(line);
    if (m) return m[1];
  }
  return null;
}

/**
 * The BUILD-CONTEXT source paths a stage COPYs (normalized, no trailing slash).
 *
 * `COPY --from=<stage> ...` lines are deliberately EXCLUDED: they move an already
 * built or installed tree between stages, not source manifests out of the build
 * context. `FROM <stage>` inheritance is followed separately by
 * `stageContextSources`, which is how the worker's `FROM deps AS build` gets credit
 * for the deps stage's COPYs. If a manifest ever starts arriving by an explicit
 * `--from=` copy, this function must learn about it — today none does.
 *
 * @param {string} stageText
 * @returns {string[]}
 */
export function copiedContextSources(stageText) {
  const sources = [];
  for (const line of logicalLines(stageText)) {
    if (!/^COPY\b/i.test(line)) continue;
    const rest = line.replace(/^COPY\b/i, "").trim();
    if (/(^|\s)--from=/i.test(rest)) continue;
    const tokens = rest.split(/\s+/).filter((t) => t.length > 0 && !t.startsWith("--"));
    if (tokens.length < 2) continue;
    for (const src of tokens.slice(0, -1)) {
      sources.push(src.replaceAll("\\", "/").replace(/\/+$/, "") || ".");
    }
  }
  return sources;
}

/**
 * Every build-context source visible to `stageName`, following `FROM <stage>`
 * inheritance inside the same Dockerfile (cycle-safe).
 * @param {string} dockerfileText
 * @param {string} stageName
 * @returns {string[]}
 */
export function stageContextSources(dockerfileText, stageName) {
  const sources = [];
  const seen = new Set();
  let cursor = stageName;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const body = extractStage(dockerfileText, cursor);
    if (body === null) break;
    sources.push(...copiedContextSources(body));
    cursor = stageParent(dockerfileText, cursor);
  }
  return sources;
}

/** Does any COPY source cover the workspace directory `dir` (whole-tree, prefix, or its manifest)? */
export function sourcesCoverDir(sources, dir) {
  const target = String(dir).replaceAll("\\", "/").replace(/\/+$/, "");
  for (const raw of sources) {
    const s = String(raw).replace(/^\.\//, "").replace(/\/+$/, "");
    if (s === "" || s === ".") return true; // COPY . .  — the whole tree
    if (s === target) return true;
    if (s === target + "/package.json") return true;
    if (target.startsWith(s + "/")) return true;
  }
  return false;
}

/**
 * The absorption verdict for ONE image. Empty ⇒ either there is no divergence to
 * absorb, or the build stage absorbs it.
 *
 * @param {{
 *   imageName: string,
 *   dockerfileText: string,
 *   entryPackages: string[],
 *   packagesByName: Map<string,{dir:string, runtimeWorkspaceDeps:string[], devWorkspaceDeps?:string[]}>,
 *   buildStageName?: string,
 * }} args
 * @returns {string[]}
 */
export function evaluateBuildStageAbsorption({
  imageName,
  dockerfileText,
  entryPackages,
  packagesByName,
  buildStageName = "build",
}) {
  const errors = [];
  const prod = computeRuntimeClosure(entryPackages, packagesByName);
  const build = computeBuildClosure(entryPackages, packagesByName);
  const divergent = [...build.names].filter((n) => !prod.names.has(n)).sort();
  // No divergence => the deps stage's install IS the build selection, and the build
  // stage needs no re-install. Asserting one unconditionally would make this guard
  // demand the very widening the least-privilege rule above forbids.
  if (divergent.length === 0) return errors;

  const listed = divergent.join(", ");
  const stage = extractStage(dockerfileText, buildStageName);
  if (stage === null) {
    errors.push(
      `${imageName}: the build closure exceeds the runtime closure by ${divergent.length} package(s) (${listed}) but there is no 'FROM ... AS ${buildStageName}' stage to absorb it — 'pnpm --filter "X..." build' would compile packages that nothing installed (E6-F012)`,
    );
    return errors;
  }

  const installs = logicalLines(stage).filter(
    (l) => /^RUN\b/i.test(l) && /\bpnpm\b.*\binstall\b/i.test(l),
  );
  const absorbing = installs.filter((l) => !/--(filter-)?prod\b/i.test(l));
  if (installs.length === 0) {
    errors.push(
      `${imageName}: the build closure exceeds the runtime closure by ${divergent.length} package(s) (${listed}) but the '${buildStageName}' stage has NO re-install — add 'RUN pnpm install --frozen-lockfile --filter "<entry>..."' there so the installed set is the set being built (E6-F012)`,
    );
  } else if (absorbing.length === 0) {
    errors.push(
      `${imageName}: the '${buildStageName}' stage re-installs, but every pnpm install there is --prod/--filter-prod, which re-selects the RUNTIME closure and absorbs nothing — the ${divergent.length} build-only package(s) (${listed}) stay uninstalled (E6-F012)`,
    );
  }

  // A re-install can only resolve a package whose manifest is present in the stage.
  const sources = stageContextSources(dockerfileText, buildStageName);
  for (const name of divergent) {
    const info = packagesByName.get(name);
    if (!info) continue; // already reported as `missing` by the deps-stage pass
    const dir = info.dir.replaceAll("\\", "/");
    if (!sourcesCoverDir(sources, dir)) {
      errors.push(
        `${imageName}: build-only closure package ${name} has no manifest in the '${buildStageName}' stage — add 'COPY ${dir}/package.json ${dir}/' THERE (never to deps: that stage's COPY set is the least-privilege runtime closure) (E6-F012)`,
      );
    }
  }
  return errors;
}
