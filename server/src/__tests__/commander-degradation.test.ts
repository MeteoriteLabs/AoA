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

// Mock conversation — track summarizeIfNeeded calls
const summarizeIfNeededMock = vi.fn(async () => {
  throw new Error("sum fail");
});

vi.mock("../services/internal-agent/conversation.js", () => ({
  conversationService: () => ({
    getOrCreateActive: async () => ({
      id: "c",
      summarizedContext: null,
      summarizedUpToMessageId: null,
    }),
    appendMessage: async () => ({ id: "m" }),
    getMessagesSince: async () => [],
    summarizeIfNeeded: summarizeIfNeededMock,
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

// Mock commander-skills — removed so real buildSkillsSection runs and
// its try-catch swallows the companySkillService throw
// vi.mock("../services/internal-agent/commander-skills.js", () => ({
//   buildSkillsSection: async () => "",
// }));

// Mock cli-summarizer
vi.mock("../services/internal-agent/cli-summarizer.js", () => ({
  summarizeViaCli: async () => "summary",
}));

import { agentLoopService } from "../services/internal-agent/agent-loop.js";

describe("commander graceful degradation", () => {
  it("missing bundle + no memory key + skill fail + summarize throw → still replies", async () => {
    // Reset the mock before the test
    summarizeIfNeededMock.mockClear();

    // Mock DB with config and agent rows using a call counter
    let selectCallCount = 0;
    const db: any = {
      select: () => ({
        from: (table: any) => ({
          where: (condition: any) => ({
            then: (callback: (rows: any[]) => any) => {
              // First select (index 0) = config
              // Second select (index 1) = agent row
              const callIndex = selectCallCount++;

              if (callIndex === 0) {
                // Return config row
                return Promise.resolve(
                  callback([{ cliTool: "claude_cli", contextTokenBudget: 4000 }])
                );
              } else if (callIndex === 1) {
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
              // Fallback (should not happen)
              return Promise.resolve(callback([]));
            },
          }),
        }),
      }),
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

    // Verify summarizeIfNeeded was called (proving the post-turn compaction path was reached)
    expect(summarizeIfNeededMock).toHaveBeenCalled();
  });
});
