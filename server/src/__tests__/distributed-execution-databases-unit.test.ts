import { describe, expect, it, vi } from "vitest";
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
  });
});
