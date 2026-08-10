import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDistributedExecutionDatabases } from "../db/distributed-execution-databases.js";

describe("JOB-001 non-owner startup composition", () => {
  it("opens no E3 pool and requires no URL while the flag is off", async () => {
    await expect(openDistributedExecutionDatabases({
      enabled: false,
      appDatabaseUrl: undefined,
      operatorDatabaseUrl: undefined,
    })).resolves.toBeNull();
  });

  it.each([undefined, "", "   "])("fails flag-on boot for a blank aoa_app URL (%s)", async (appDatabaseUrl) => {
    await expect(openDistributedExecutionDatabases({
      enabled: true,
      appDatabaseUrl,
      operatorDatabaseUrl: "postgres://aoa_operator:test@127.0.0.1/aoa",
    })).rejects.toThrow(/aoa_app|non-owner|explicit/i);
  });

  it("passes only the verified aoa_app handle and flag into createApp", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../index.ts", import.meta.url)),
      "utf8",
    );
    expect(source).toMatch(/distributedExecutionEnabled:\s*config\.distributedExecutionEnabled/);
    expect(source).toMatch(/tenantAppDb:\s*distributedExecutionDatabases\?\.appDb/);
    expect(source).not.toMatch(/tenantAppDb:\s*db\b/);
  });
});
