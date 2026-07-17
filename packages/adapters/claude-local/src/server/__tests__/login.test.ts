import { EventEmitter } from "node:events";
import path from "node:path";
import os from "node:os";
import { describe, it, expect, vi } from "vitest";
import type { SpawnTrackedChildOptions, TrackedChildHandle } from "@armyofagents/adapter-utils/server-utils";
import { runClaudeLoginStreaming, resolveClaudeConfigHome } from "../login.js";

function fakeSpawn() {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const handle: TrackedChildHandle = { child: child as never, pid: 1, pgid: 1, startedAt: new Date(0), terminate: vi.fn() };
  const calls: Array<{ command: string; argv: string[]; opts: SpawnTrackedChildOptions }> = [];
  const spawn = (_runId: string, command: string, argv: string[], opts: SpawnTrackedChildOptions) => {
    calls.push({ command, argv, opts });
    return handle;
  };
  return { spawn, calls, child };
}

describe("resolveClaudeConfigHome (Plan 3 T3)", () => {
  it("honours CLAUDE_CONFIG_DIR, else defaults to ~/.claude", () => {
    expect(resolveClaudeConfigHome({ CLAUDE_CONFIG_DIR: "/x/.claude" } as never)).toBe("/x/.claude");
    expect(resolveClaudeConfigHome({} as never)).toBe(path.join(os.homedir(), ".claude"));
  });
});

describe("runClaudeLoginStreaming (Plan 3 T3)", () => {
  it("spawns `claude login`, sets CLAUDE_CONFIG_DIR to the config home, streams the URL", async () => {
    const f = fakeSpawn();
    const res = runClaudeLoginStreaming({ runId: "l1", env: { CLAUDE_CONFIG_DIR: "/x/.claude" }, spawn: f.spawn });
    expect(f.calls[0].command).toBe("claude");
    expect(f.calls[0].argv).toEqual(["auth", "login"]);
    expect(f.calls[0].opts.env.CLAUDE_CONFIG_DIR).toBe("/x/.claude");
    expect(res.authHome).toBe("/x/.claude");
    f.child.stderr.emit("data", "Sign in: https://claude.ai/oauth?code=z9\n");
    await expect(res.urlPromise).resolves.toBe("https://claude.ai/oauth?code=z9");
  });

  it("respects a config-provided command override", () => {
    const f = fakeSpawn();
    runClaudeLoginStreaming({ runId: "l2", command: "claude-code", env: {} as never, spawn: f.spawn });
    expect(f.calls[0].command).toBe("claude-code");
  });
});
