import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDistributedExecutionDatabases } from "../db/distributed-execution-databases.js";

type FinalStartupInput = {
  enabled: boolean;
  ownerDb: unknown;
  requiredMigrationIdentity: { orderedHashes: readonly string[]; ledgerSha256: string };
  appDatabaseUrl: string | undefined;
  operatorDatabaseUrl: string | undefined;
};

const openFinalStartup = openDistributedExecutionDatabases as unknown as (
  input: FinalStartupInput,
) => ReturnType<typeof openDistributedExecutionDatabases>;

function startupInput(input: Pick<FinalStartupInput, "enabled" | "appDatabaseUrl" | "operatorDatabaseUrl">) {
  return {
    ...input,
    ownerDb: {} as unknown,
    requiredMigrationIdentity: { orderedHashes: [], ledgerSha256: "0".repeat(64) },
  };
}

describe("JOB-001 non-owner startup composition", () => {
  it("opens no E3 pool and requires no URL while the flag is off", async () => {
    await expect(openFinalStartup(startupInput({
      enabled: false,
      appDatabaseUrl: undefined,
      operatorDatabaseUrl: undefined,
    }))).resolves.toBeNull();
  });

  it.each([undefined, "", "   "])("fails flag-on boot for a blank aoa_app URL (%s)", async (appDatabaseUrl) => {
    await expect(openFinalStartup(startupInput({
      enabled: true,
      appDatabaseUrl,
      operatorDatabaseUrl: "postgres://aoa_operator:test@127.0.0.1/aoa",
    }))).rejects.toThrow(/aoa_app|non-owner|explicit/i);
  });

  it("passes only the verified aoa_app handle and flag into createApp", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../index.ts", import.meta.url)),
      "utf8",
    );
    expect(source).toMatch(/distributedExecutionEnabled:\s*config\.distributedExecutionEnabled/);
    expect(source).toMatch(/tenantAppDb:\s*distributedExecutionDatabases\?\.appDb/);
    expect(source).toMatch(/operatorDb:\s*distributedExecutionDatabases\?\.operatorDb/);
    expect(source).toMatch(/workerSessionSigningKey:\s*process\.env\.AOA_WORKER_SESSION_SIGNING_KEY/);
    expect(source).not.toMatch(/tenantAppDb:\s*db\b/);
    expect(source).toMatch(/ownerDb:\s*db\b/);
    expect(source).toMatch(/requiredMigrationIdentity/);
    expect(source).toMatch(/loadRequiredMigrationIdentity/);
  });

  it("keeps worker-control, leasing, metrics, scheduler, and outbox outside the flag-off import graph", () => {
    // Mutation caught: restoring any eager import makes flag-off allocate/probe the E3 runtime.
    const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
    const appSource = readFileSync(new URL("../app.ts", import.meta.url), "utf8");
    expect(indexSource).not.toMatch(/^import .*job-control-metrics/m);
    expect(indexSource).not.toMatch(/^import .*job-ready-scheduler/m);
    expect(indexSource).not.toMatch(/^import .*job-outbox-worker/m);
    expect(appSource).not.toMatch(/^import .*worker-control/m);
    expect(appSource).not.toMatch(/^import .*job-leasing/m);
    expect(appSource).not.toMatch(/^import .*job-control-metrics/m);
    expect(appSource).toMatch(/distributedExecutionEnabled[\s\S]*await import\([^)]*worker-control/);
  });
});
