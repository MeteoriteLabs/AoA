import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  putFile: vi.fn(async (input: { originalFilename: string; contentType: string; body: Buffer }) => ({
    provider: "local",
    objectKey: `agent-outputs/${input.originalFilename}`,
    contentType: input.contentType,
    byteSize: input.body.length,
    sha256: "stored-sha",
    originalFilename: input.originalFilename,
  })),
}));

vi.mock("../storage/index.js", () => ({
  getStorageService: () => ({ putFile: mocks.putFile }),
}));

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]) {
  await execFileAsync("git", args, { cwd });
}

function buildDb() {
  return {
    insert: () => ({
      values: () => ({
        returning: async () => [{ id: "asset-1" }],
      }),
    }),
  };
}

describe("outputDetectionService", () => {
  it("captures untracked markdown files from a git workspace", async () => {
    const { outputDetectionService } = await import("../services/output-detection.js");
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-output-git-"));
    try {
      await git(cwd, ["init"]);
      await fs.writeFile(path.join(cwd, "README.md"), "base\n", "utf8");
      await git(cwd, ["add", "README.md"]);
      await git(cwd, ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "base"]);
      await fs.writeFile(path.join(cwd, "summary.md"), "# Summary\n", "utf8");

      const result = await outputDetectionService(buildDb() as never).detectAndCapture({
        runId: "run-1",
        companyId: "company-1",
        agentId: "agent-1",
        cwd,
        startedAt: new Date(Date.now() - 1000),
        adapterType: "codex_local",
        issueId: "issue-1",
      });

      expect(result).toEqual([
        expect.objectContaining({
          path: "summary.md",
          filename: "summary.md",
          contentType: "text/markdown",
          source: "diff",
          status: "pending",
        }),
      ]);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it("does not capture dirty git files that existed before the run started", async () => {
    const { outputDetectionService } = await import("../services/output-detection.js");
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-output-dirty-git-"));
    try {
      await git(cwd, ["init"]);
      await fs.writeFile(path.join(cwd, "README.md"), "base\n", "utf8");
      await git(cwd, ["add", "README.md"]);
      await git(cwd, ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "base"]);

      await fs.writeFile(path.join(cwd, "old-output.md"), "# Old\n", "utf8");
      const startedAt = new Date(Date.now() + 100);
      await new Promise((resolve) => setTimeout(resolve, 150));
      await fs.writeFile(path.join(cwd, "new-output.md"), "# New\n", "utf8");

      const result = await outputDetectionService(buildDb() as never).detectAndCapture({
        runId: "run-1",
        companyId: "company-1",
        agentId: "agent-1",
        cwd,
        startedAt,
        adapterType: "codex_local",
        issueId: "issue-1",
      });

      expect(result.map((item) => item.path)).toContain("new-output.md");
      expect(result.map((item) => item.path)).not.toContain("old-output.md");
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it("captures files by mtime in a non-git workspace", async () => {
    const { outputDetectionService } = await import("../services/output-detection.js");
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-output-nongit-"));
    try {
      const startedAt = new Date(Date.now() - 1000);
      await fs.writeFile(path.join(cwd, "report.html"), "<h1>Report</h1>", "utf8");

      const result = await outputDetectionService(buildDb() as never).detectAndCapture({
        runId: "run-1",
        companyId: "company-1",
        agentId: "agent-1",
        cwd,
        startedAt,
        adapterType: "process",
        issueId: "issue-1",
      });

      expect(result[0]).toEqual(
        expect.objectContaining({
          path: "report.html",
          filename: "report.html",
          contentType: "text/html",
          status: "pending",
        }),
      );
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it("does not capture logs, lockfiles, or node_modules outputs", async () => {
    const { outputDetectionService } = await import("../services/output-detection.js");
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-output-noise-"));
    try {
      await fs.mkdir(path.join(cwd, "node_modules"), { recursive: true });
      await fs.writeFile(path.join(cwd, "debug.log"), "noise", "utf8");
      await fs.writeFile(path.join(cwd, "pnpm-lock.yaml"), "noise", "utf8");
      await fs.writeFile(path.join(cwd, "node_modules", "x.md"), "noise", "utf8");

      const result = await outputDetectionService(buildDb() as never).detectAndCapture({
        runId: "run-1",
        companyId: "company-1",
        agentId: "agent-1",
        cwd,
        startedAt: new Date(Date.now() - 1000),
        adapterType: "codex_local",
        issueId: "issue-1",
      });

      expect(result).toEqual([]);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});
