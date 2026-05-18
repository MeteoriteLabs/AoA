import { describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn() }));
vi.mock("@armyofagents/db", () => ({ internalAgentConfig: {}, agents: {} }));

const cliCalls: any[] = [];
vi.mock("../services/internal-agent/cli-mode.js", () => ({
  cliModeService: () => ({
    chat: async function* (p: any) {
      cliCalls.push(p);
      yield { type: "text", delta: "x" };
    },
  }),
}));

vi.mock("../services/internal-agent/conversation.js", () => ({
  conversationService: () => ({
    getOrCreateActive: async () => ({
      id: "c",
      summarizedContext: null,
      summarizedUpToMessageId: null,
    }),
    appendMessage: async () => ({ id: "m" }),
    getMessagesSince: async () => [],
    summarizeIfNeeded: async () => {},
  }),
}));

vi.mock("../services/internal-agent/commander-context.js", () => ({
  loadCommanderPersona: async () => "P",
}));

vi.mock("../services/internal-agent/aoa-agents/ensure-commander.js", () => ({
  ensureCommanderAgent: async () => "cmd-id",
}));

vi.mock("../agent-instructions.js", () => ({
  agentInstructionsService: () => ({}),
}));

const searchSemantic = vi.fn(async () => [
  { title: "T", content: "C", layer: "domain" },
]);
vi.mock("../services/memory.js", () => ({
  memoryService: () => ({ searchSemantic }),
}));

vi.mock("../services/internal-agent/context-assembly.js", () => ({
  contextAssemblyService: () => ({
    assembleContext: async (_cid: string, opts: any) => {
      let prompt = "ASSEMBLED";
      if (opts.memorySearch && opts.relevanceQuery) {
        const items = await opts.memorySearch(opts.relevanceQuery);
        const scoped = items.filter((m: any) => m.layer === "identity" || m.layer === "domain");
        if (scoped.length > 0) {
          const memory = scoped.map((m: any) => `${m.title ?? "Memory"}: ${m.content ?? ""}`).join("\n");
          prompt = `ASSEMBLED\n\n## Relevant Company Memory\n${memory}`;
        }
      }
      return { systemPrompt: prompt, estimatedTokens: 100 };
    },
  }),
}));

import { agentLoopService } from "../services/internal-agent/agent-loop.js";

describe("agent-loop memory wiring", () => {
  it("passes the user's message as the relevance query and injects results", async () => {
    const db: any = {
      select: () => ({
        from: () => ({
          where: () => ({
            then: (r: any) =>
              Promise.resolve([{ cliTool: "claude_cli" }]).then(r),
          }),
        }),
      }),
    };

    for await (const _ of agentLoopService(db).chat({
      companyId: "c1",
      userId: "u1",
      userRole: "founder",
      enabledCapabilities: [],
      content: "refund question",
    })) {
    }

    expect(searchSemantic).toHaveBeenCalled();
    expect(cliCalls[0].content).toContain("T");
  });
});
