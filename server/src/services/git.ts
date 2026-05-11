/**
 * Consolidated git service for AoA workspace operations.
 *
 * Replaces the two separate runGit() implementations that existed in
 * workspace-runtime.ts (spawn-based) and execution-workspaces.ts (execFile with -C).
 *
 * Architecture:
 *
 *   UI (GitPanel)  <-->  Routes (workspace-git.ts)  <-->  gitService (this file)
 *                                                              |
 *                                                        runGit() + resolveGitRoot()
 *                                                              |
 *                                                   git CLI subprocess (execFile)
 *
 * Also used by:
 *   - workspace-runtime.ts (worktree operations, via re-export)
 *   - execution-workspaces.ts (inspectGitCloseReadiness, imports runGit + resolveGitRoot)
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitStatusResult {
  branch: string | null;
  detachedHead: boolean;
  remote: GitRemoteInfo | null;
  ahead: number | null;
  behind: number | null;
  files: GitFileEntry[];
  clean: boolean;
}

export interface GitFileEntry {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "copied" | "untracked" | "unknown";
  staged: boolean;
}

export interface GitRemoteInfo {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  timestamp: string;
}

export interface GitCommitResult {
  hash: string;
  message: string;
  filesCommitted: string[];
  skippedFiles: string[];
  activeRunWarning?: boolean;
}

export interface GitPushResult {
  pushed: boolean;
  remote: string;
  branch: string;
  activeRunWarning?: boolean;
}

// ---------------------------------------------------------------------------
// Deny-list for auto-staging (basename patterns)
// ---------------------------------------------------------------------------

const DENY_LIST_PATTERNS = [
  /^\.env$/,
  /^\.env\..+$/, // .env.local, .env.production — but NOT .env.example
  /\.secret$/,
  /\.key$/,
  /\.pem$/,
  /^credentials\..+$/,
  /^secrets\..+$/,
];

const DENY_LIST_EXCEPTIONS = [
  /^\.env\.example$/,
];

function isDeniedFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  if (DENY_LIST_EXCEPTIONS.some((pattern) => pattern.test(basename))) {
    return false;
  }
  return DENY_LIST_PATTERNS.some((pattern) => pattern.test(basename));
}

// ---------------------------------------------------------------------------
// Low-level git execution
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Run a git command and return trimmed stdout.
 * Throws on non-zero exit code.
 *
 * @param args - git subcommand and arguments (e.g., ["status", "--porcelain"])
 * @param cwd  - working directory (should be inside a git repo)
 * @param opts.timeout - per-call timeout in ms (default 30s, API endpoints use 10s)
 */
export async function runGit(
  args: string[],
  cwd: string,
  opts?: { timeout?: number; env?: NodeJS.ProcessEnv },
): Promise<string> {
  const timeout = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      env: opts?.env ?? process.env,
    });
    return stdout.replace(/\s+$/, "");
  } catch (error: unknown) {
    const err = error as { stderr?: string; stdout?: string; code?: number | string; killed?: boolean };
    if (err.killed) {
      throw new Error(`git ${args[0]} timed out after ${timeout}ms`);
    }
    const message = (err.stderr ?? err.stdout ?? "").trim();
    throw new Error(message || `git ${args.join(" ")} failed with exit code ${err.code ?? -1}`);
  }
}

/**
 * Case-insensitive substring match on git error messages.
 */
export function gitErrorIncludes(error: unknown, needle: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes(needle.toLowerCase());
}

// ---------------------------------------------------------------------------
// Git root resolution
// ---------------------------------------------------------------------------

/**
 * Find the git repository root for a given directory.
 * Returns null if the directory is not inside a git repo or doesn't exist.
 */
export async function resolveGitRoot(cwd: string): Promise<string | null> {
  try {
    return await runGit(["rev-parse", "--show-toplevel"], cwd, { timeout: 5_000 });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

const API_TIMEOUT = 10_000;

/**
 * Get comprehensive git status for a workspace.
 *
 *   git branch --show-current       -> branch name (empty = detached HEAD)
 *   git status --porcelain=v1       -> file list with status codes
 *   git remote -v                   -> remote info
 *   git rev-list --left-right       -> ahead/behind upstream
 */
export async function getStatus(gitRoot: string): Promise<GitStatusResult> {
  // 1. Branch
  let branch: string | null = null;
  let detachedHead = false;
  try {
    const branchOutput = await runGit(["branch", "--show-current"], gitRoot, { timeout: API_TIMEOUT });
    if (branchOutput) {
      branch = branchOutput;
    } else {
      detachedHead = true;
    }
  } catch {
    detachedHead = true;
  }

  // 2. File status
  const files: GitFileEntry[] = [];
  try {
    const statusOutput = await runGit(
      ["status", "--porcelain=v1", "--untracked-files=all"],
      gitRoot,
      { timeout: API_TIMEOUT },
    );
    if (statusOutput) {
      for (const line of statusOutput.split(/\r?\n/)) {
        if (!line || line.length < 4) continue;
        const indexStatus = line[0];
        const workTreeStatus = line[1];
        const filePath = line.slice(3);

        if (indexStatus === "?" && workTreeStatus === "?") {
          files.push({ path: filePath, status: "untracked", staged: false });
          continue;
        }

        const staged = indexStatus !== " " && indexStatus !== "?";
        let status: GitFileEntry["status"] = "unknown";
        const relevantCode = staged ? indexStatus : workTreeStatus;
        switch (relevantCode) {
          case "M": status = "modified"; break;
          case "A": status = "added"; break;
          case "D": status = "deleted"; break;
          case "R": status = "renamed"; break;
          case "C": status = "copied"; break;
          default: status = "unknown"; break;
        }

        files.push({ path: filePath, status, staged });
      }
    }
  } catch {
    // If status fails, return empty file list — panel can still show branch/remote
  }

  // 3. Remote info
  const remote = await getRemoteInfo(gitRoot);

  // 4. Ahead/behind upstream
  let ahead: number | null = null;
  let behind: number | null = null;
  if (branch && remote) {
    try {
      const counts = await runGit(
        ["rev-list", "--left-right", "--count", `${remote.name}/${branch}...HEAD`],
        gitRoot,
        { timeout: API_TIMEOUT },
      );
      const [behindRaw, aheadRaw] = counts.split(/\s+/);
      behind = behindRaw ? Number.parseInt(behindRaw, 10) : 0;
      ahead = aheadRaw ? Number.parseInt(aheadRaw, 10) : 0;
    } catch {
      // No upstream tracking — ahead/behind stays null
    }
  }

  return {
    branch,
    detachedHead,
    remote,
    ahead,
    behind,
    files,
    clean: files.length === 0,
  };
}

/**
 * Get recent git log entries.
 */
export async function getLog(gitRoot: string, limit = 5): Promise<GitLogEntry[]> {
  try {
    const SEP = "---GIT-LOG-SEP---";
    const format = `%H${SEP}%h${SEP}%s${SEP}%an${SEP}%aI`;
    const output = await runGit(
      ["log", `--format=${format}`, `-n`, String(limit)],
      gitRoot,
      { timeout: API_TIMEOUT },
    );
    if (!output) return [];

    return output.split(/\r?\n/).filter(Boolean).map((line) => {
      const [hash, shortHash, message, author, timestamp] = line.split(SEP);
      return { hash, shortHash, message, author, timestamp };
    });
  } catch {
    // No commits yet or other error — return empty
    return [];
  }
}

/**
 * Get remote info, preferring "origin" if multiple remotes exist.
 */
export async function getRemoteInfo(gitRoot: string): Promise<GitRemoteInfo | null> {
  try {
    const output = await runGit(["remote", "-v"], gitRoot, { timeout: API_TIMEOUT });
    if (!output) return null;

    const remotes = new Map<string, { fetchUrl: string; pushUrl: string }>();
    for (const line of output.split(/\r?\n/)) {
      const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
      if (!match) continue;
      const [, name, url, type] = match;
      const existing = remotes.get(name) ?? { fetchUrl: "", pushUrl: "" };
      if (type === "fetch") existing.fetchUrl = url;
      if (type === "push") existing.pushUrl = url;
      remotes.set(name, existing);
    }

    if (remotes.size === 0) return null;

    // Prefer "origin"
    if (remotes.has("origin")) {
      const origin = remotes.get("origin")!;
      return { name: "origin", ...origin };
    }

    // Fall back to first remote
    const [firstName, firstUrls] = [...remotes.entries()][0];
    return { name: firstName, ...firstUrls };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

/**
 * Stage specified files and commit.
 *
 * Security:
 * 1. Path traversal validation — all paths must resolve within gitRoot
 * 2. Deny-list filtering — .env, *.key, *.pem, etc. excluded
 * 3. Files array is REQUIRED (no "commit all" shortcut)
 *
 * @param gitRoot  - absolute path to git repo root
 * @param message  - commit message (must be non-empty)
 * @param files    - explicit file paths to stage (relative to gitRoot)
 */
export async function commit(
  gitRoot: string,
  message: string,
  files: string[],
): Promise<GitCommitResult> {
  if (!message.trim()) {
    throw new Error("Commit message cannot be empty");
  }

  if (files.length === 0) {
    throw new Error("No files specified for commit");
  }

  // Check for detached HEAD
  const branchOutput = await runGit(["branch", "--show-current"], gitRoot, { timeout: API_TIMEOUT });
  if (!branchOutput) {
    throw new Error("Cannot commit in detached HEAD state");
  }

  // Validate paths stay within gitRoot (path traversal prevention)
  const resolvedGitRoot = path.resolve(gitRoot);
  const validatedFiles: string[] = [];
  const skippedFiles: string[] = [];

  for (const file of files) {
    const resolved = path.resolve(resolvedGitRoot, file);
    if (!resolved.startsWith(resolvedGitRoot + path.sep) && resolved !== resolvedGitRoot) {
      throw new Error(`Invalid file path: "${file}" escapes the repository root`);
    }

    if (isDeniedFile(file)) {
      skippedFiles.push(file);
      continue;
    }

    validatedFiles.push(file);
  }

  if (validatedFiles.length === 0) {
    throw new Error(
      `All ${files.length} file(s) were excluded by the security deny-list. ` +
      `Skipped: ${skippedFiles.join(", ")}`,
    );
  }

  // Stage files
  await runGit(["add", "--", ...validatedFiles], gitRoot);

  // Commit
  const commitOutput = await runGit(["commit", "-m", message], gitRoot);

  // Extract hash from commit output
  let hash = "";
  const hashMatch = commitOutput.match(/\[[\w/.-]+\s+([a-f0-9]+)\]/);
  if (hashMatch) {
    hash = hashMatch[1];
  }

  return {
    hash,
    message: message.trim(),
    filesCommitted: validatedFiles,
    skippedFiles,
  };
}

/**
 * Push to remote.
 *
 * Authentication: if opts.pat is provided, uses GIT_ASKPASS env trick
 * to inject the token without interactive prompts.
 *
 * @param gitRoot - absolute path to git repo root
 * @param remote  - remote name (default: "origin")
 * @param branch  - branch name (default: current branch)
 * @param opts.pat - GitHub PAT for authentication via GIT_ASKPASS
 */
export async function push(
  gitRoot: string,
  remote?: string,
  branch?: string,
  opts?: { pat?: string },
): Promise<GitPushResult> {
  // Check for detached HEAD
  const branchOutput = await runGit(["branch", "--show-current"], gitRoot, { timeout: API_TIMEOUT });
  if (!branchOutput) {
    throw new Error("Cannot push in detached HEAD state");
  }

  const targetBranch = branch ?? branchOutput;
  const targetRemote = remote ?? "origin";

  // Check remote exists
  const remoteInfo = await getRemoteInfo(gitRoot);
  if (!remoteInfo) {
    throw new Error("No remote configured. Add a remote with `git remote add origin <url>`.");
  }

  // Authenticate push via http.extraheader for HTTPS remotes when PAT is available
  if (opts?.pat) {
    const pushUrl = remoteInfo.pushUrl || remoteInfo.fetchUrl;
    if (pushUrl.startsWith("https://")) {
      // Inject auth header via git -c. This avoids GIT_ASKPASS complexity
      // and doesn't require temp files or scripts.
      const authToken = Buffer.from(`x-access-token:${opts.pat}`).toString("base64");
      const authArgs = [
        "-c", `http.extraheader=Authorization: Basic ${authToken}`,
        "push", targetRemote, targetBranch,
      ];
      await runGit(authArgs, gitRoot, {
        timeout: DEFAULT_TIMEOUT_MS,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      return { pushed: true, remote: targetRemote, branch: targetBranch };
    }
    // SSH remotes don't need PAT injection (SSH key handles auth)
  }

  // Standard push: relies on local credential manager or SSH keys
  await runGit(["push", targetRemote, targetBranch], gitRoot, {
    timeout: DEFAULT_TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });

  return { pushed: true, remote: targetRemote, branch: targetBranch };
}

// ---------------------------------------------------------------------------
// Status cache (keyed by workspace ID, 5s TTL)
// ---------------------------------------------------------------------------

interface CacheEntry {
  data: GitStatusResult;
  expiresAt: number;
}

const statusCache = new Map<string, CacheEntry>();

const CACHE_TTL_MS = 5_000;

export function getCachedStatus(workspaceId: string): GitStatusResult | null {
  const entry = statusCache.get(workspaceId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    statusCache.delete(workspaceId);
    return null;
  }
  return entry.data;
}

export function setCachedStatus(workspaceId: string, data: GitStatusResult): void {
  statusCache.set(workspaceId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function invalidateStatusCache(workspaceId: string): void {
  statusCache.delete(workspaceId);
}
