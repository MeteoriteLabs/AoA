import { EventEmitter } from "node:events";
import { describe, it, expect, vi } from "vitest";
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
  it("spawns `codex login` against the shared codex home and returns authHome", async () => {
    const f = fakeSpawn();
    const res = runCodexLogin({ runId: "c1", env: { CODEX_HOME: "/custom/.codex" }, spawn: f.spawn });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].command).toBe("codex");
    expect(f.calls[0].argv).toEqual(["login"]);
    expect(f.calls[0].opts.env.CODEX_HOME).toBe("/custom/.codex");
    expect(res.authHome).toBe("/custom/.codex");
    f.child.stdout.emit("data", "open https://chatgpt.com/device?u=1\n");
    await expect(res.urlPromise).resolves.toBe("https://chatgpt.com/device?u=1");
  });
});
