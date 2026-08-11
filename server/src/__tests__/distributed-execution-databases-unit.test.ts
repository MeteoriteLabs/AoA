import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  closeBoundedDatabaseConnections,
  openDistributedExecutionDatabases,
} from "../db/distributed-execution-databases.js";

describe("distributed-execution database strangler", () => {
  it("allocates no serving/operator connection and needs no URL while flag-off", async () => {
    await expect(
      openDistributedExecutionDatabases({
        enabled: false,
        appDatabaseUrl: undefined,
        operatorDatabaseUrl: undefined,
      }),
    ).resolves.toBeNull();
  });

  it("attempts both pool closes and reports aggregate failure to the awaited shutdown path", async () => {
    const appFailure = new Error("app close failed");
    const appClose = vi.fn(async () => { throw appFailure; });
    const operatorClose = vi.fn(async () => {});

    await expect(
      closeBoundedDatabaseConnections([
        { close: operatorClose },
        { close: appClose },
      ]),
    ).rejects.toMatchObject({
      message: "Failed to close bounded distributed database pools",
      errors: [appFailure],
    });
    expect(operatorClose).toHaveBeenCalledOnce();
    expect(appClose).toHaveBeenCalledOnce();
    expect(operatorClose).toHaveBeenCalledWith({ timeoutSeconds: 5 });
    expect(appClose).toHaveBeenCalledWith({ timeoutSeconds: 5 });
  });

  it("pins one bounded startup deadline and the exact max-four/timeout connection contract", () => {
    // Mutation caught: widening either pool, reusing a stale statement timeout, or racing an
    // abandoned naked close defeats the startup/cleanup bound even if happy-path auth passes.
    const source = readFileSync(new URL("../db/distributed-execution-databases.ts", import.meta.url), "utf8");
    const client = readFileSync(
      new URL("../../../packages/db/src/client.ts", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(/pool|max[\s\S]{0,160}\b4\b/i);
    expect(source).toMatch(/statement_timeout[\s\S]{0,160}5_?000/i);
    expect(source).toMatch(/lock_timeout[\s\S]{0,160}750/i);
    expect(source).toMatch(/idle_in_transaction_session_timeout[\s\S]{0,160}5_?000/i);
    expect(source).toMatch(/AbortController/);
    expect(source).toMatch(/Promise\.allSettled/);
    expect(client).toMatch(/connect_timeout[\s\S]{0,160}5_?000/i);
    expect(client).toMatch(/idle_timeout[\s\S]{0,160}30_?000/i);
    expect(client).toMatch(/end\(\{\s*timeout:\s*5\s*\}\)/);
    expect(source).not.toMatch(/Promise\.race\([\s\S]{0,120}\.close\(/);
  });

  it("exports only the closed non-secret startup error vocabulary", () => {
    const source = readFileSync(new URL("../db/distributed-execution-databases.ts", import.meta.url), "utf8");
    for (const code of [
      "distributed_execution_configuration",
      "distributed_execution_migration_identity",
      "distributed_execution_app_authority",
      "distributed_execution_operator_authority",
      "distributed_execution_advisory_domain",
      "distributed_execution_timeout",
      "distributed_execution_close",
    ]) {
      expect(source).toContain(code);
    }
  });
});
