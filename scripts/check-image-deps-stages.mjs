#!/usr/bin/env node
/**
 * check-image-deps-stages.mjs — split-image deps-stage parity gate (DEP-001).
 *
 * Extends the `pr.yml` Dockerfile-deps validation to the two NEW split images:
 * each of `docker/control-plane/Dockerfile` and `docker/worker/Dockerfile` must
 * `COPY`, in its `deps` stage, EXACTLY the workspace-package manifests in its own
 * runtime dependency closure — no fewer, and NO MORE. The existing combined
 * `Dockerfile` "all packages present" awk check in `pr.yml` is left untouched and
 * keeps running alongside this one.
 *
 * The control-plane closure is the transitive runtime workspace closure of
 * `@armyofagents/server` + `@armyofagents/ui`. The worker closure is fixed by
 * E4-D01 to `@armyofagents/worker-daemon` + `@armyofagents/worker-protocol`
 * (a worker deps stage that would pull server/db/shared/adapter-utils FAILS).
 *
 * This file is the filesystem/command layer only; all parity logic lives in the
 * pure `scripts/lib/image-deps-stage.mjs`.
 *
 * Usage:
 *   node scripts/check-image-deps-stages.mjs
 *   node scripts/check-image-deps-stages.mjs --root <fixture-dir>
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { evaluateImageDepsStage, indexPackages } from "./lib/image-deps-stage.mjs";

/** Images validated by this gate and their build entry packages. */
export const IMAGES = [
  {
    imageName: "control-plane",
    dockerfile: "docker/control-plane/Dockerfile",
    entryPackages: ["@armyofagents/server", "@armyofagents/ui"],
  },
  {
    imageName: "worker",
    dockerfile: "docker/worker/Dockerfile",
    entryPackages: ["@armyofagents/worker-daemon"],
  },
];

/** Workspace manifest search roots (mirrors pnpm-workspace.yaml layout). */
const SINGLE_ROOTS = ["server", "ui", "cli"];
const GLOB_ROOTS = ["packages", "packages/adapters", "packages/plugins"];

function collectManifestRecords(root, deps = {}) {
  const readFile = deps.readFile ?? ((p) => readFileSync(p, "utf8"));
  const readdir = deps.readdir ?? ((p) => readdirSync(p, { withFileTypes: true }));
  const exists = deps.exists ?? ((p) => existsSync(p));
  const records = [];

  const addDir = (relDir) => {
    const manifestPath = path.join(root, relDir, "package.json");
    if (!exists(manifestPath)) return;
    let manifest;
    try {
      manifest = JSON.parse(readFile(manifestPath));
    } catch {
      return;
    }
    records.push({ dir: relDir.replaceAll("\\", "/"), manifest });
  };

  for (const r of SINGLE_ROOTS) addDir(r);
  for (const g of GLOB_ROOTS) {
    const base = path.join(root, g);
    if (!exists(base)) continue;
    let entries;
    try {
      entries = readdir(base);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      addDir(path.join(g, e.name));
    }
  }
  return records;
}

/**
 * Run the parity check against a repo root.
 * @returns {{errors:string[]}}
 */
export function runDepsStageCheck(root, deps = {}) {
  const readFile = deps.readFile ?? ((p) => readFileSync(p, "utf8"));
  const exists = deps.exists ?? ((p) => existsSync(p));
  const records = collectManifestRecords(root, deps);
  const packagesByName = indexPackages(records);
  const errors = [];
  for (const image of IMAGES) {
    const dockerfilePath = path.join(root, image.dockerfile);
    if (!exists(dockerfilePath)) {
      errors.push(`${image.imageName}: Dockerfile not found at ${image.dockerfile}`);
      continue;
    }
    let dockerfileText;
    try {
      dockerfileText = readFile(dockerfilePath);
    } catch (err) {
      errors.push(`${image.imageName}: could not read ${image.dockerfile} (${err.message})`);
      continue;
    }
    errors.push(
      ...evaluateImageDepsStage({
        imageName: image.imageName,
        dockerfileText,
        entryPackages: image.entryPackages,
        packagesByName,
      }),
    );
  }
  return { errors };
}

export function resolveRoot(argv) {
  const i = argv.indexOf("--root");
  if (i !== -1 && argv[i + 1]) return path.resolve(argv[i + 1]);
  return process.cwd();
}

function main() {
  const root = resolveRoot(process.argv.slice(2));
  const { errors } = runDepsStageCheck(root);
  if (errors.length > 0) {
    console.error("split-image deps-stage parity violations:");
    for (const line of errors) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log("split-image deps-stage parity: PASS");
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main();
}
