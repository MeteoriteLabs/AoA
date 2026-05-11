/**
 * Tests for the consolidated git service (server/src/services/git.ts).
 *
 * Uses real temp git repos — no mocking of git CLI. This validates actual
 * git behavior and ensures the parsing logic handles real git output.
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runGit,
  resolveGitRoot,
  getStatus,
  getLog,
  getRemoteInfo,
  commit,
  push,
  getCachedStatus,
  setCachedStatus,
  invalidateStatusCache,
  gitErrorIncludes,
} from "../services/git.ts";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function git(cwd: string, args: string[]) {
  await execFileAsync("git", args, { cwd });
}

async function createTempRepo(): Promise<string> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-git-service-test-"));
  await git(repoRoot, ["init"]);
  await git(repoRoot, ["config", "user.email", "test@aoa.dev"]);
  await git(repoRoot, ["config", "user.name", "AoA Test"]);
  await fs.writeFile(path.join(repoRoot, "README.md"), "hello\n", "utf8");
  await git(repoRoot, ["add", "README.md"]);
  await git(repoRoot, ["commit", "-m", "Initial commit"]);
  await git(repoRoot, ["checkout", "-B", "main"]);
  return repoRoot;
}

/** Create a bare remote and link it as origin to a local repo. */
async function createBareRemote(localRepo: string): Promise<string> {
  const bareRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-git-bare-"));
  await git(bareRoot, ["init", "--bare"]);
  await git(localRepo, ["remote", "add", "origin", bareRoot]);
  await git(localRepo, ["push", "-u", "origin", "main"]);
  return bareRoot;
}

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  }
  tempDirs.length = 0;
});

async function setup() {
  const repo = await createTempRepo();
  tempDirs.push(repo);
  return repo;
}

async function setupWithRemote() {
  const repo = await createTempRepo();
  tempDirs.push(repo);
  const bare = await createBareRemote(repo);
  tempDirs.push(bare);
  return { repo, bare };
}

// ---------------------------------------------------------------------------
// runGit
// ---------------------------------------------------------------------------

describe("runGit", () => {
  it("returns trimmed stdout for a successful command", async () => {
    const repo = await setup();
    const result = await runGit(["rev-parse", "--show-toplevel"], repo);
    expect(result).toBeTruthy();
    expect(result.endsWith("\n")).toBe(false);
  });

  it("throws on non-zero exit code", async () => {
    const repo = await setup();
    await expect(runGit(["log", "--oneline", "nonexistent-ref-12345"], repo)).rejects.toThrow();
  });

  it("respects per-call timeout", async () => {
    const repo = await setup();
    // A very short timeout should still succeed for a trivial command
    const result = await runGit(["branch", "--show-current"], repo, { timeout: 5_000 });
    expect(result).toBe("main");
  });
});

// ---------------------------------------------------------------------------
// gitErrorIncludes
// ---------------------------------------------------------------------------

describe("gitErrorIncludes", () => {
  it("matches case-insensitively", () => {
    expect(gitErrorIncludes(new Error("Detached HEAD state"), "detached head")).toBe(true);
  });

  it("returns false for non-matching", () => {
    expect(gitErrorIncludes(new Error("Something else"), "detached head")).toBe(false);
  });

  it("handles non-Error values", () => {
    expect(gitErrorIncludes("some string error", "string")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveGitRoot
// ---------------------------------------------------------------------------

describe("resolveGitRoot", () => {
  it("returns the git root for a valid repo", async () => {
    const repo = await setup();
    const root = await resolveGitRoot(repo);
    expect(root).toBeTruthy();
    // Normalize for Windows
    expect(path.resolve(root!)).toBe(path.resolve(repo));
  });

  it("returns null for a non-repo directory", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-no-git-"));
    tempDirs.push(dir);
    const root = await resolveGitRoot(dir);
    expect(root).toBeNull();
  });

  it("returns null for a non-existent directory", async () => {
    const root = await resolveGitRoot("/tmp/does-not-exist-12345");
    expect(root).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getStatus
// ---------------------------------------------------------------------------

describe("getStatus", () => {
  it("reports clean working tree", async () => {
    const repo = await setup();
    const status = await getStatus(repo);
    expect(status.branch).toBe("main");
    expect(status.detachedHead).toBe(false);
    expect(status.clean).toBe(true);
    expect(status.files).toHaveLength(0);
  });

  it("reports modified files", async () => {
    const repo = await setup();
    await fs.writeFile(path.join(repo, "README.md"), "changed\n", "utf8");
    const status = await getStatus(repo);
    expect(status.clean).toBe(false);
    expect(status.files.length).toBeGreaterThan(0);
    const readme = status.files.find((f) => f.path === "README.md");
    expect(readme).toBeDefined();
    expect(readme!.status).toBe("modified");
  });

  it("reports untracked files", async () => {
    const repo = await setup();
    await fs.writeFile(path.join(repo, "new-file.txt"), "new\n", "utf8");
    const status = await getStatus(repo);
    expect(status.clean).toBe(false);
    const newFile = status.files.find((f) => f.path === "new-file.txt");
    expect(newFile).toBeDefined();
    expect(newFile!.status).toBe("untracked");
    expect(newFile!.staged).toBe(false);
  });

  it("detects detached HEAD state", async () => {
    const repo = await setup();
    const hash = await runGit(["rev-parse", "HEAD"], repo);
    await git(repo, ["checkout", hash]);
    const status = await getStatus(repo);
    expect(status.detachedHead).toBe(true);
    expect(status.branch).toBeNull();
  });

  it("reports ahead/behind when remote exists", async () => {
    const { repo } = await setupWithRemote();
    // Create a local commit to be ahead by 1
    await fs.writeFile(path.join(repo, "extra.txt"), "data\n", "utf8");
    await git(repo, ["add", "extra.txt"]);
    await git(repo, ["commit", "-m", "local commit"]);
    const status = await getStatus(repo);
    expect(status.ahead).toBe(1);
    expect(status.behind).toBe(0);
  });

  it("returns null ahead/behind when no remote", async () => {
    const repo = await setup();
    const status = await getStatus(repo);
    // No remote configured
    expect(status.remote).toBeNull();
    expect(status.ahead).toBeNull();
    expect(status.behind).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getRemoteInfo
// ---------------------------------------------------------------------------

describe("getRemoteInfo", () => {
  it("returns null when no remote configured", async () => {
    const repo = await setup();
    const info = await getRemoteInfo(repo);
    expect(info).toBeNull();
  });

  it("returns remote info when origin is configured", async () => {
    const { repo } = await setupWithRemote();
    const info = await getRemoteInfo(repo);
    expect(info).not.toBeNull();
    expect(info!.name).toBe("origin");
    expect(info!.fetchUrl).toBeTruthy();
    expect(info!.pushUrl).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// getLog
// ---------------------------------------------------------------------------

describe("getLog", () => {
  it("returns recent commits", async () => {
    const repo = await setup();
    const entries = await getLog(repo, 5);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].message).toBe("Initial commit");
    expect(entries[0].hash).toBeTruthy();
    expect(entries[0].shortHash).toBeTruthy();
    expect(entries[0].author).toBe("AoA Test");
  });

  it("respects limit parameter", async () => {
    const repo = await setup();
    // Add a second commit
    await fs.writeFile(path.join(repo, "file2.txt"), "data\n", "utf8");
    await git(repo, ["add", "file2.txt"]);
    await git(repo, ["commit", "-m", "Second commit"]);
    const one = await getLog(repo, 1);
    expect(one).toHaveLength(1);
    expect(one[0].message).toBe("Second commit");
  });
});

// ---------------------------------------------------------------------------
// commit
// ---------------------------------------------------------------------------

describe("commit", () => {
  it("commits specified files and returns result", async () => {
    const repo = await setup();
    await fs.writeFile(path.join(repo, "test.txt"), "content\n", "utf8");
    const result = await commit(repo, "Add test file", ["test.txt"]);
    expect(result.hash).toBeTruthy();
    expect(result.message).toBe("Add test file");
    expect(result.filesCommitted).toContain("test.txt");
    expect(result.skippedFiles).toHaveLength(0);
  });

  it("skips denied files (.env)", async () => {
    const repo = await setup();
    await fs.writeFile(path.join(repo, ".env"), "SECRET=bad\n", "utf8");
    await fs.writeFile(path.join(repo, "safe.txt"), "ok\n", "utf8");
    const result = await commit(repo, "Mixed commit", [".env", "safe.txt"]);
    expect(result.filesCommitted).toContain("safe.txt");
    expect(result.skippedFiles).toContain(".env");
    expect(result.filesCommitted).not.toContain(".env");
  });

  it("skips .env.local but allows .env.example", async () => {
    const repo = await setup();
    await fs.writeFile(path.join(repo, ".env.local"), "SECRET=bad\n", "utf8");
    await fs.writeFile(path.join(repo, ".env.example"), "KEY=placeholder\n", "utf8");
    const result = await commit(repo, "Env files", [".env.local", ".env.example"]);
    expect(result.skippedFiles).toContain(".env.local");
    expect(result.filesCommitted).toContain(".env.example");
  });

  it("skips *.key and *.pem files", async () => {
    const repo = await setup();
    await fs.writeFile(path.join(repo, "cert.pem"), "data\n", "utf8");
    await fs.writeFile(path.join(repo, "private.key"), "data\n", "utf8");
    await fs.writeFile(path.join(repo, "code.ts"), "code\n", "utf8");
    const result = await commit(repo, "Mixed", ["cert.pem", "private.key", "code.ts"]);
    expect(result.skippedFiles).toContain("cert.pem");
    expect(result.skippedFiles).toContain("private.key");
    expect(result.filesCommitted).toContain("code.ts");
  });

  it("throws when all files are denied", async () => {
    const repo = await setup();
    await fs.writeFile(path.join(repo, ".env"), "SECRET=bad\n", "utf8");
    await expect(commit(repo, "Only bad files", [".env"])).rejects.toThrow("deny-list");
  });

  it("throws on empty message", async () => {
    const repo = await setup();
    await fs.writeFile(path.join(repo, "file.txt"), "ok\n", "utf8");
    await expect(commit(repo, "", ["file.txt"])).rejects.toThrow("empty");
  });

  it("throws on empty files array", async () => {
    const repo = await setup();
    await expect(commit(repo, "msg", [])).rejects.toThrow("No files");
  });

  it("rejects path traversal attempts", async () => {
    const repo = await setup();
    await expect(commit(repo, "traversal", ["../../../etc/passwd"])).rejects.toThrow("escapes");
  });

  it("throws in detached HEAD state", async () => {
    const repo = await setup();
    const hash = await runGit(["rev-parse", "HEAD"], repo);
    await git(repo, ["checkout", hash]);
    await fs.writeFile(path.join(repo, "test.txt"), "content\n", "utf8");
    await expect(commit(repo, "commit in detached", ["test.txt"])).rejects.toThrow("detached HEAD");
  });
});

// ---------------------------------------------------------------------------
// push
// ---------------------------------------------------------------------------

describe("push", () => {
  it("pushes to origin successfully", async () => {
    const { repo } = await setupWithRemote();
    // Create a local commit
    await fs.writeFile(path.join(repo, "pushed.txt"), "data\n", "utf8");
    await git(repo, ["add", "pushed.txt"]);
    await git(repo, ["commit", "-m", "Push test"]);
    const result = await push(repo);
    expect(result.pushed).toBe(true);
    expect(result.remote).toBe("origin");
    expect(result.branch).toBe("main");
  });

  it("throws when no remote configured", async () => {
    const repo = await setup();
    await expect(push(repo)).rejects.toThrow("No remote configured");
  });

  it("throws in detached HEAD state", async () => {
    const { repo } = await setupWithRemote();
    const hash = await runGit(["rev-parse", "HEAD"], repo);
    await git(repo, ["checkout", hash]);
    await expect(push(repo)).rejects.toThrow("detached HEAD");
  });
});

// ---------------------------------------------------------------------------
// Status cache
// ---------------------------------------------------------------------------

describe("status cache", () => {
  it("returns null for uncached workspace", () => {
    expect(getCachedStatus("not-cached")).toBeNull();
  });

  it("stores and retrieves cached status", () => {
    const mockStatus = {
      branch: "main",
      detachedHead: false,
      remote: null,
      ahead: null,
      behind: null,
      files: [],
      clean: true,
    };
    setCachedStatus("ws-1", mockStatus);
    const cached = getCachedStatus("ws-1");
    expect(cached).toEqual(mockStatus);
  });

  it("invalidates cache", () => {
    const mockStatus = {
      branch: "main",
      detachedHead: false,
      remote: null,
      ahead: null,
      behind: null,
      files: [],
      clean: true,
    };
    setCachedStatus("ws-2", mockStatus);
    invalidateStatusCache("ws-2");
    expect(getCachedStatus("ws-2")).toBeNull();
  });
});
