import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  cp,
  lstat,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  CompanySkillFileInventoryEntry,
  MarketplaceSkillBundle,
} from "@armyofagents/shared";
import { isMarketplaceGitHubRepo } from "@armyofagents/shared/marketplace";

const execFileAsync = promisify(execFile);

export interface MaterializeSkillBundleOptions {
  destination: string;
  repoUrl?: string;
  unsafeTestRepoUrl?: string;
  unsafeTestCheckoutRef?: string;
  overwrite?: boolean;
  /**
   * Optional caller deadline. Passed to every `git` subprocess, which is killed
   * when it aborts. Without it a clone is bounded only by git's own network
   * timeouts, which is minutes — too long for a caller running inside an
   * interactive request (the company-create crew bootstrap).
   */
  signal?: AbortSignal;
}

export interface MaterializeSkillBundleResult {
  destination: string;
  markdown: string;
  fileInventory: CompanySkillFileInventoryEntry[];
  fileCount: number;
  byteCount: number;
}

export async function materializeSkillBundle(
  bundle: MarketplaceSkillBundle,
  options: MaterializeSkillBundleOptions,
): Promise<MaterializeSkillBundleResult> {
  const destination = path.resolve(options.destination);
  validateDestination(destination);
  const bundlePath = validateBundlePath(bundle.path);
  const repoUrl = repoUrlForBundle(bundle, options);
  const checkoutRef = unsafeTestValue(options.unsafeTestCheckoutRef, "unsafeTestCheckoutRef") ?? bundle.commitSha;
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aoa-skill-bundle-"));
  const checkoutDir = path.join(tempRoot, "repo");

  try {
    await prepareDestination(destination, options.overwrite ?? false);
    await gitClone(repoUrl, checkoutDir, options.signal);
    await git(checkoutDir, options.signal, "checkout", "--detach", checkoutRef);
    await assertCheckedOutCommit(checkoutDir, bundle.commitSha, options.signal);

    const sourceDir = path.resolve(checkoutDir, bundlePath);
    assertWithin(checkoutDir, sourceDir, `Unsafe bundle path "${bundle.path}"`);
    await assertFile(path.join(sourceDir, "SKILL.md"), "Bundle is missing SKILL.md");

    await copyDirectorySkippingSymlinks(sourceDir, destination);
    const markdown = await readFile(path.join(destination, "SKILL.md"), "utf8");
    const fileInventory = await collectInventory(destination);
    const byteCount = await sumBytes(destination, fileInventory.map((entry) => entry.path));

    return {
      destination,
      markdown,
      fileInventory,
      fileCount: fileInventory.length,
      byteCount,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export function deriveBundleTrustLevel(
  fileInventory: CompanySkillFileInventoryEntry[],
): "markdown_only" | "assets" | "scripts_executables" {
  if (fileInventory.some((entry) => entry.kind === "script")) return "scripts_executables";
  if (fileInventory.some((entry) => entry.kind === "asset")) return "assets";
  return "markdown_only";
}

export function managedCatalogSkillDir(companyId: string, catalogItemId: string, version: string): string {
  return path.join(
    process.cwd(),
    ".aoa",
    "marketplace-skills",
    safeCatalogSkillId(companyId),
    safeCatalogSkillId(catalogItemId),
    safeCatalogSkillId(version),
  );
}

export function safeCatalogSkillId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function repoUrlForBundle(
  bundle: MarketplaceSkillBundle,
  options: Pick<MaterializeSkillBundleOptions, "repoUrl" | "unsafeTestRepoUrl"> = {},
): string {
  const unsafeRepoUrl = unsafeTestValue(options.unsafeTestRepoUrl, "unsafeTestRepoUrl");
  if (unsafeRepoUrl) return unsafeRepoUrl;
  return marketplaceGitHubRepoUrl(options.repoUrl ?? bundle.repo);
}

function marketplaceGitHubRepoUrl(repo: string): string {
  if (!isMarketplaceGitHubRepo(repo)) {
    throw new Error(`Unsafe marketplace skill bundle GitHub repo "${repo}"`);
  }
  if (/^https:\/\//i.test(repo)) {
    const url = new URL(repo);
    const [owner, repoNameWithSuffix] = url.pathname.split("/").filter(Boolean);
    const repoName = repoNameWithSuffix.endsWith(".git")
      ? repoNameWithSuffix.slice(0, -".git".length)
      : repoNameWithSuffix;
    return `https://github.com/${owner}/${repoName}.git`;
  }
  return `https://github.com/${repo}.git`;
}

function unsafeTestValue(value: string | undefined, optionName: string): string | undefined {
  if (!value) return undefined;
  if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
    throw new Error(`${optionName} is only available in tests`);
  }
  return value;
}

function validateBundlePath(rawPath: string): string {
  if (!rawPath || rawPath.includes("\0")) throw new Error(`Unsafe bundle path "${rawPath}"`);
  if (path.isAbsolute(rawPath) || /^[A-Za-z]:[\\/]/.test(rawPath)) {
    throw new Error(`Unsafe bundle path "${rawPath}"`);
  }
  const normalized = rawPath.replace(/\\/g, "/");
  if (normalized.split("/").some((segment) => segment === "" || segment === "..")) {
    throw new Error(`Unsafe bundle path "${rawPath}"`);
  }
  return normalized === "." ? "." : normalized;
}

function validateDestination(destination: string) {
  const parsed = path.parse(destination);
  if (destination === parsed.root) {
    throw new Error("Refusing to materialize bundle into filesystem root");
  }
}

async function prepareDestination(destination: string, overwrite: boolean) {
  const exists = await pathExists(destination);
  if (exists && !overwrite) {
    throw new Error(`Destination already exists: ${destination}`);
  }
  if (exists) {
    await rm(destination, { recursive: true, force: true });
  }
}

async function gitClone(repoUrl: string, checkoutDir: string, signal?: AbortSignal) {
  await execFileAsync("git", ["clone", "--no-checkout", repoUrl, checkoutDir], {
    windowsHide: true,
    signal,
  });
}

async function git(cwd: string, signal: AbortSignal | undefined, ...args: string[]) {
  await execFileAsync("git", args, { cwd, windowsHide: true, signal });
}

async function assertCheckedOutCommit(
  checkoutDir: string,
  expectedSha: string,
  signal?: AbortSignal,
) {
  const actualSha = (await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: checkoutDir,
    windowsHide: true,
    signal,
  })).stdout.trim();
  if (actualSha.toLowerCase() !== expectedSha.toLowerCase()) {
    throw new Error(`Checked out commit SHA ${actualSha} did not match expected ${expectedSha}`);
  }
}

async function assertFile(filePath: string, message: string) {
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) throw new Error(message);
}

function assertWithin(root: string, candidate: string, message: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(message);
}

async function copyDirectorySkippingSymlinks(sourceDir: string, destination: string) {
  await cp(sourceDir, destination, {
    recursive: true,
    dereference: false,
    filter: async (source) => {
      // Exclude a nested .git (e.g. a repo-root bundle clone) at any depth.
      if (path.basename(source) === ".git") return false;
      const info = await lstat(source);
      return !info.isSymbolicLink();
    },
  });
}

async function collectInventory(dir: string): Promise<CompanySkillFileInventoryEntry[]> {
  const files = await walkFiles(dir);
  return files
    .map((filePath) => ({ path: filePath, kind: classifyInventoryKind(filePath) }))
    .sort((a, b) => {
      if (a.path === "SKILL.md") return -1;
      if (b.path === "SKILL.md") return 1;
      return a.path.localeCompare(b.path);
    });
}

async function walkFiles(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(path.join(dir, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.name === ".git") continue;
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await walkFiles(dir, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

function classifyInventoryKind(filePath: string): CompanySkillFileInventoryEntry["kind"] {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const basename = path.posix.basename(normalized);
  if (basename === "skill.md") return "skill";
  if (normalized.startsWith("references/")) return "reference";
  if (normalized.startsWith("scripts/")) return "script";
  if (normalized.startsWith("assets/")) return "asset";
  if (normalized.endsWith(".md")) return "markdown";
  const ext = path.posix.extname(normalized);
  if ([".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd", ".py", ".rb", ".js", ".ts", ".mjs", ".cjs"].includes(ext)) {
    return "script";
  }
  if ([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".pdf"].includes(ext)) {
    return "asset";
  }
  if ([".txt", ".json", ".yaml", ".yml", ".toml"].includes(ext)) {
    return "reference";
  }
  return "other";
}

async function sumBytes(dir: string, files: string[]): Promise<number> {
  let total = 0;
  for (const file of files) {
    total += (await stat(path.join(dir, file))).size;
  }
  return total;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
