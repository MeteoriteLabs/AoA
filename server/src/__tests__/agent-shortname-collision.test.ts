import { describe, expect, it, vi } from "vitest";

vi.mock("@paperclipai/db", () => {
  const makeTable = () =>
    new Proxy({}, { get: (_target, prop) => (prop === "$inferSelect" || prop === "$inferInsert" ? {} : Symbol(String(prop))) });
  return {
    agents: makeTable(),
    agentConfigRevisions: makeTable(),
    agentApiKeys: makeTable(),
    agentRuntimeState: makeTable(),
    agentTaskSessions: makeTable(),
    agentWakeupRequests: makeTable(),
    heartbeatRunEvents: makeTable(),
    heartbeatRuns: makeTable(),
  };
});

vi.mock("drizzle-orm", () => ({
  and: (..._args: unknown[]) => "and",
  desc: (..._args: unknown[]) => "desc",
  eq: (..._args: unknown[]) => "eq",
  inArray: (..._args: unknown[]) => "inArray",
  ne: (..._args: unknown[]) => "ne",
}));

import { hasAgentShortnameCollision, deduplicateAgentName } from "../services/agents.ts";

describe("hasAgentShortnameCollision", () => {
  it("detects collisions by normalized shortname", () => {
    const collision = hasAgentShortnameCollision("Codex Coder", [
      { id: "a1", name: "codex-coder", status: "idle" },
    ]);
    expect(collision).toBe(true);
  });

  it("ignores terminated agents", () => {
    const collision = hasAgentShortnameCollision("Codex Coder", [
      { id: "a1", name: "codex-coder", status: "terminated" },
    ]);
    expect(collision).toBe(false);
  });

  it("ignores the excluded agent id", () => {
    const collision = hasAgentShortnameCollision(
      "Codex Coder",
      [
        { id: "a1", name: "codex-coder", status: "idle" },
        { id: "a2", name: "other-agent", status: "idle" },
      ],
      { excludeAgentId: "a1" },
    );
    expect(collision).toBe(false);
  });

  it("does not collide when candidate has no shortname", () => {
    const collision = hasAgentShortnameCollision("!!!", [
      { id: "a1", name: "codex-coder", status: "idle" },
    ]);
    expect(collision).toBe(false);
  });
});

describe("deduplicateAgentName", () => {
  it("returns original name when no collision", () => {
    const name = deduplicateAgentName("OpenClaw", [
      { id: "a1", name: "other-agent", status: "idle" },
    ]);
    expect(name).toBe("OpenClaw");
  });

  it("appends suffix when name collides", () => {
    const name = deduplicateAgentName("OpenClaw", [
      { id: "a1", name: "openclaw", status: "idle" },
    ]);
    expect(name).toBe("OpenClaw 2");
  });

  it("increments suffix until unique", () => {
    const name = deduplicateAgentName("OpenClaw", [
      { id: "a1", name: "openclaw", status: "idle" },
      { id: "a2", name: "openclaw-2", status: "idle" },
      { id: "a3", name: "openclaw-3", status: "idle" },
    ]);
    expect(name).toBe("OpenClaw 4");
  });

  it("ignores terminated agents for collision", () => {
    const name = deduplicateAgentName("OpenClaw", [
      { id: "a1", name: "openclaw", status: "terminated" },
    ]);
    expect(name).toBe("OpenClaw");
  });
});
