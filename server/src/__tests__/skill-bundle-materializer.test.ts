import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { MarketplaceSkillBundle } from "@armyofagents/shared";
import { materializeSkillBundle } from "../services/marketplace-install/skill-bundle-materializer.js";

const execFileAsync = promisify(execFile);

describe("materializeSkillBundle", () => {
  it("copies a full skill bundle and classifies its inventory", async () => {
    const { repo, commitSha } = await createRepo({
      "skills/research/SKILL.md": "# Research\n",
      "skills/research/references/guide.md": "guide",
      "skills/research/scripts/run.js": "console.log('run')",
      "skills/research/assets/logo.png": "png",
    });
    const destination = path.join(await tempDir("bundle-dest-"), "out");

    const result = await materializeSkillBundle(makeBundle({ commitSha, path: "skills/research" }), {
      destination,
      repoUrl: repo,
    });

    expect(normalizeNewlines(result.markdown)).toBe("# Research\n");
    expect(await readFile(path.join(destination, "references", "guide.md"), "utf8")).toBe("guide");
    expect(result.fileInventory).toEqual([
      { path: "SKILL.md", kind: "skill" },
      { path: "assets/logo.png", kind: "asset" },
      { path: "references/guide.md", kind: "reference" },
      { path: "scripts/run.js", kind: "script" },
    ]);
    expect(result.fileCount).toBe(4);
    expect(result.byteCount).toBeGreaterThan(0);
  });

  it("supports repo-root bundle path", async () => {
    const { repo, commitSha } = await createRepo({
      "SKILL.md": "# Root Skill\n",
      "references/root.md": "root",
    });
    const destination = path.join(await tempDir("bundle-root-"), "out");

    const result = await materializeSkillBundle(makeBundle({ commitSha, path: "." }), {
      destination,
      repoUrl: repo,
    });

    expect(normalizeNewlines(result.markdown)).toBe("# Root Skill\n");
    expect(await readFile(path.join(destination, "references", "root.md"), "utf8")).toBe("root");
  });

  it.each(["../evil", "/absolute", "C:/absolute", "skills//bad", "skills/\0bad"])(
    "rejects unsafe bundle path %s",
    async (bundlePath) => {
      await expect(
        materializeSkillBundle(makeBundle({ path: bundlePath }), {
          destination: path.join(await tempDir("bundle-unsafe-"), "out"),
          repoUrl: "unused",
        }),
      ).rejects.toThrow(/unsafe bundle path/i);
    },
  );

  it("refuses to overwrite an existing destination unless requested", async () => {
    const { repo, commitSha } = await createRepo({ "SKILL.md": "# Skill\n" });
    const destination = await tempDir("bundle-overwrite-");
    await writeFile(path.join(destination, "old.txt"), "old");

    await expect(
      materializeSkillBundle(makeBundle({ commitSha, path: "." }), { destination, repoUrl: repo }),
    ).rejects.toThrow(/already exists/i);

    await materializeSkillBundle(makeBundle({ commitSha, path: "." }), {
      destination,
      repoUrl: repo,
      overwrite: true,
    });
    expect(existsSync(path.join(destination, "old.txt"))).toBe(false);
  });

  it("skips symlinks while copying", async () => {
    const repo = await tempDir("bundle-symlink-repo-");
    await writeFile(path.join(repo, "SKILL.md"), "# Skill\n");
    try {
      await symlink(path.join(repo, "SKILL.md"), path.join(repo, "linked.md"));
    } catch (error: any) {
      if (error?.code === "EPERM") return;
      throw error;
    }
    await git(repo, "init");
    await git(repo, "config", "user.email", "test@example.com");
    await git(repo, "config", "user.name", "Test User");
    await git(repo, "add", ".");
    await git(repo, "commit", "-m", "init");
    const commitSha = (await git(repo, "rev-parse", "HEAD")).stdout.trim();
    const destination = path.join(await tempDir("bundle-symlink-dest-"), "out");

    const result = await materializeSkillBundle(makeBundle({ commitSha, path: "." }), {
      destination,
      repoUrl: repo,
    });

    expect(result.fileInventory).toEqual([{ path: "SKILL.md", kind: "skill" }]);
    expect(existsSync(path.join(destination, "linked.md"))).toBe(false);
  });
});

function makeBundle(overrides: Partial<MarketplaceSkillBundle> = {}): MarketplaceSkillBundle {
  return {
    type: "github-directory",
    repo: "owner/repo",
    commitSha: "HEAD",
    path: "skills/research",
    treeUrl: "https://github.com/owner/repo/tree/HEAD/skills/research",
    ...overrides,
  };
}

async function createRepo(files: Record<string, string>) {
  const repo = await tempDir("bundle-repo-");
  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = path.join(repo, relativePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
  }
  await git(repo, "init");
  await git(repo, "config", "user.email", "test@example.com");
  await git(repo, "config", "user.name", "Test User");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "init");
  const commitSha = (await git(repo, "rev-parse", "HEAD")).stdout.trim();
  return { repo, commitSha };
}

function tempDir(prefix: string) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

function git(cwd: string, ...args: string[]) {
  return execFileAsync("git", args, { cwd });
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}
