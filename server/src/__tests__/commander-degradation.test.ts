import { describe, expect, it, vi } from "vitest";

// Mock drizzle-orm operators
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ __drizzle: "eq", col, val })),
  and: vi.fn((...conditions) => ({ __drizzle: "and", conditions })),
}));

// Mock database tables
vi.mock("@armyofagents/db", () => ({
  internalAgentConfig: { companyId: "companyId" },
  agents: { id: "id", companyId: "companyId", name: "name", adapterConfig: "adapterConfig" },
}));

// Mock services — all degradation paths enabled
vi.mock("../services/internal-agent/cli-mode.js", () => ({
  cliModeService: () => ({
    chat: async function* () {
      yield { type: "text", delta: "reply" };
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
    summarizeIfNeeded: async () => {
      throw new Error("sum fail");
    },
  }),
}));

// Mock commander-context — missing bundle
vi.mock("../services/internal-agent/commander-context.js", () => ({
  loadCommanderPersona: async () => null,
}));

// Mock memory service — no embedding key
vi.mock("../services/memory.js", () => ({
  memoryService: () => ({
    searchSemantic: async () => {
      throw new Error("no key");
    },
  }),
}));

// Mock company-skills — skill loading fail
vi.mock("../services/company-skills.js", () => ({
  companySkillService: () => ({
    listRuntimeSkillEntries: async () => {
      throw new Error("skill fail");
    },
  }),
}));

// Mock ensure-commander — returns a valid id
vi.mock("../services/internal-agent/aoa-agents/ensure-commander.js", () => ({
  ensureCommanderAgent: async () => "agent-123",
}));

// Mock context-assembly
vi.mock("../services/internal-agent/context-assembly.js", () => ({
  contextAssemblyService: () => ({
    assembleContext: async () => ({
      systemPrompt: "system",
    }),
  }),
}));

// Mock agent-instructions
vi.mock("../services/agent-instructions.js", () => ({
  agentInstructionsService: () => ({}),
}));

// Mock commander-skills
vi.mock("../services/internal-agent/commander-skills.js", () => ({
  buildSkillsSection: async () => "",
}));

// Mock cli-summarizer
vi.mock("../services/internal-agent/cli-summarizer.js", () => ({
  summarizeViaCli: async () => "summary",
}));

import { agentLoopService } from "../services/internal-agent/agent-loop.js";

describe("commander graceful degradation", () => {
  it("missing bundle + no memory key + skill fail + summarize throw → still replies", async () => {
    // Mock DB with config and agent rows
    const db: any = {
      select: () => ({
        from: (table: any) => ({
          where: (condition: any) => ({
            then: (callback: (rows: any[]) => any) => {
              // Check if this is config select or agent select based on what was called
              // First call should be for config, second for agent
              const isConfigSelect = !db._agentSelectCalled;
              db._agentSelectCalled = true;

              if (isConfigSelect) {
                // Return config row
                return Promise.resolve(
                  callback([{ cliTool: "claude_cli", contextTokenBudget: 4000 }])
                );
              } else {
                // Return agent row
                return Promise.resolve(
                  callback([
                    {
                      id: "agent-123",
                      companyId: "c1",
                      name: "Commander",
                      adapterConfig: null,
                    },
                  ])
                );
              }
            },
          }),
        }),
      }),
      _agentSelectCalled: false,
    };

    const chunks: any[] = [];
    for await (const c of agentLoopService(db).chat({
      companyId: "c1",
      userId: "u1",
      userRole: "founder",
      enabledCapabilities: [],
      content: "q",
    })) {
      chunks.push(c);
    }

    // Should have received the reply despite all failures
    expect(chunks.some((c) => c.type === "text" && c.delta === "reply")).toBe(true);

    // Should NOT have an error chunk (degradation swallowed all failures)
    expect(chunks.some((c) => c.type === "error")).toBe(false);
  });
});
