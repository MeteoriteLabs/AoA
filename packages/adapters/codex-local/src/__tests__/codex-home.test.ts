import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { writeApiKeyAuthJson, prepareManagedCodexHome } from "../server/codex-home.js";

describe("codex-home", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-codex-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writeApiKeyAuthJson writes JSON with mode 0o600", async () => {
    await writeApiKeyAuthJson(tmpDir, "sk-test-key-12345");
    const target = path.join(tmpDir, "auth.json");
    const content = await fs.readFile(target, "utf-8");
    expect(JSON.parse(content)).toEqual({ OPENAI_API_KEY: "sk-test-key-12345" });
    const stat = await fs.stat(target);
    if (process.platform !== "win32") {
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });

  it("writeApiKeyAuthJson overwrites existing auth.json", async () => {
    await writeApiKeyAuthJson(tmpDir, "first-key");
    await writeApiKeyAuthJson(tmpDir, "second-key");
    const content = await fs.readFile(path.join(tmpDir, "auth.json"), "utf-8");
    expect(JSON.parse(content)).toEqual({ OPENAI_API_KEY: "second-key" });
  });

  it("prepareManagedCodexHome with apiKey writes auth.json into the managed home", async () => {
    const logs: string[] = [];
    const home = await prepareManagedCodexHome(
      { CODEX_HOME: tmpDir },
      (msg) => logs.push(msg),
      "company_test",
      { apiKey: "sk-test" },
    );
    expect(home).toContain("company_test");
    const content = await fs.readFile(path.join(home, "auth.json"), "utf-8");
    expect(JSON.parse(content)).toEqual({ OPENAI_API_KEY: "sk-test" });
  });
});
