import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { SpawnTrackedChildOptions, TrackedChildHandle } from "@armyofagents/adapter-utils/server-utils";
import { runCodexLogin } from "../login.js";

function fakeSpawn() {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const handle: TrackedChildHandle = { child: child as never, pid: 1, pgid: 1, startedAt: new Date(0), terminate: vi.fn() };
  const calls: Array<{ runId: string; command: string; argv: string[]; opts: SpawnTrackedChildOptions }> = [];
  const spawn = (runId: string, command: string, argv: string[], opts: SpawnTrackedChildOptions) => {
    calls.push({ runId, command, argv, opts });
    return handle;
  };
  return { spawn, calls, child };
}

describe("runCodexLogin (Plan 3 T3)", () => {
  let scopedHome: string;

  beforeEach(() => {
    scopedHome = fs.mkdtempSync(path.join(os.tmpdir(), "aoa-codex-login-"));
  });

  afterEach(() => {
    fs.rmSync(scopedHome, { recursive: true, force: true });
  });

  it("spawns remote-safe Codex device auth and returns URL plus user code", async () => {
    const f = fakeSpawn();
    const codexHome = path.join(scopedHome, ".codex");
    const res = runCodexLogin({
      runId: "c1",
      env: { HOME: scopedHome, CODEX_HOME: codexHome },
      spawn: f.spawn,
    });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].command).toBe("codex");
    expect(f.calls[0].argv).toEqual(["login", "--device-auth"]);
    expect(f.calls[0].opts.env.CODEX_HOME).toBe(codexHome);
    expect(f.calls[0].opts.env.HOME).toBe(scopedHome);
    expect(res.authHome).toBe(codexHome);
    f.child.stdout.emit("data", "open https://chatgpt.com/device?u=1\nenter ABCD-EFGH\n");
    await expect(res.urlPromise).resolves.toBe("https://chatgpt.com/device?u=1");
    await expect(res.userCodePromise).resolves.toBe("ABCD-EFGH");
  });

  it("bounds device-code discovery when the CLI prints a URL but no code", async () => {
    vi.useFakeTimers();
    try {
      const f = fakeSpawn();
      const codexHome = path.join(scopedHome, ".codex");
      const res = runCodexLogin({
        runId: "c2",
        env: { HOME: scopedHome, CODEX_HOME: codexHome },
        discoveryTimeoutMs: 250,
        spawn: f.spawn,
      });
      f.child.stdout.emit("data", "open https://chatgpt.com/device\n");
      const rejected = expect(res.userCodePromise).rejects.toThrow("device-code-timeout");
      await vi.advanceTimersByTimeAsync(250);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });
});
