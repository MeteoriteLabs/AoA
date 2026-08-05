import { afterEach, describe, expect, it } from "vitest";
import {
  appendStderrExcerpt,
  createPluginWorkerHandle,
  createPluginWorkerManager,
  formatWorkerFailureMessage,
} from "../services/plugin-worker-manager.js";
import { setDeploymentMode } from "../config/deployment-mode.js";
import { CloudPluginExecutionBlockedError } from "../services/cloud-plugin-execution.js";

const workerOptions = {
  entrypointPath: "does-not-exist.cjs",
  manifest: {
    id: "test.plugin",
    apiVersion: 1,
    entrypoints: { worker: "index.js" },
  },
  config: {},
  instanceInfo: { instanceId: "test", hostVersion: "test" },
  apiVersion: 1,
  hostHandlers: {},
  companyId: "company-a",
  activationSource: "direct" as const,
} as any;

afterEach(() => setDeploymentMode("local_trusted"));

describe("plugin-worker-manager stderr failure context", () => {
  it("appends worker stderr context to failure messages", () => {
    expect(
      formatWorkerFailureMessage(
        "Worker process exited (code=1, signal=null)",
        'TypeError: Unknown file extension ".ts"'
      )
    ).toBe(
      'Worker process exited (code=1, signal=null)\n\nWorker stderr:\nTypeError: Unknown file extension ".ts"'
    );
  });

  it("does not duplicate stderr that is already present", () => {
    const message = [
      "Worker process exited (code=1, signal=null)",
      "",
      "Worker stderr:",
      'TypeError: Unknown file extension ".ts"',
    ].join("\n");

    expect(
      formatWorkerFailureMessage(
        message,
        'TypeError: Unknown file extension ".ts"'
      )
    ).toBe(message);
  });

  it("keeps only the latest stderr excerpt", () => {
    let excerpt = "";
    excerpt = appendStderrExcerpt(excerpt, "first line");
    excerpt = appendStderrExcerpt(excerpt, "second line");

    expect(excerpt).toContain("first line");
    expect(excerpt).toContain("second line");

    excerpt = appendStderrExcerpt(excerpt, "x".repeat(9_000));

    expect(excerpt).not.toContain("first line");
    expect(excerpt).not.toContain("second line");
    expect(excerpt.length).toBeLessThanOrEqual(8_000);
  });
});

describe("cloud plugin worker final sinks", () => {
  it("rejects before worker handle registration", async () => {
    setDeploymentMode("cloud_auth");
    const manager = createPluginWorkerManager();

    await expect(
      manager.startWorker("plugin-a", workerOptions)
    ).rejects.toBeInstanceOf(CloudPluginExecutionBlockedError);
    expect(manager.getWorker("plugin-a")).toBeUndefined();
  });

  it("rejects a direct handle immediately before fork", async () => {
    setDeploymentMode("cloud_auth");
    const handle = createPluginWorkerHandle("plugin-a", workerOptions);

    await expect(handle.start()).rejects.toBeInstanceOf(
      CloudPluginExecutionBlockedError
    );
    expect(handle.status).not.toBe("running");
  });
});
