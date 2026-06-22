import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock threads.js before importing the tool so the mock is in place
vi.mock("../services/threads.js", () => ({
  parseMentions: vi.fn((text: string) => {
    // Mirror the real implementation: extract @word patterns preceded by start or whitespace
    return [...text.matchAll(/(?:^|\s)@(\w+)/g)].map((m) => ({ raw: `@${m[1]}`, name: m[1] }));
  }),
  processMentions: vi.fn().mockResolvedValue(undefined),
}));

import { createPostEntryTool } from "../services/internal-agent/tools/post-entry-tool.js";
import { processMentions } from "../services/threads.js";
import type { ToolContext } from "../services/internal-agent/types.js";

describe("post_entry tool (P2.2)", () => {
  const mockEntry = { id: "entry-abc-123" };

  function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
    return {
      companyId: "co-1",
      userId: "user-1",
      userRole: "team_member",
      enabledCapabilities: ["system_actions"],
      agentId: "agent-42",
      db: {} as any,
      services: {
        discussions: {
          addEntry: vi.fn().mockResolvedValue(mockEntry),
        },
      } as any,
      ...overrides,
    } as ToolContext;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an entry with inputType='agent' and authorAgentId from ctx.agentId", async () => {
    const tool = createPostEntryTool();
    const ctx = makeCtx();

    const result = await tool.execute(
      { threadId: "thread-1", content: "Here is my update" },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ entryId: mockEntry.id });
    expect(result.summary).toBe("Posted entry to thread");

    const addEntry = ctx.services.discussions.addEntry as ReturnType<typeof vi.fn>;
    expect(addEntry).toHaveBeenCalledOnce();
    const [calledCompanyId, calledThreadId, calledData] = addEntry.mock.calls[0];
    expect(calledCompanyId).toBe("co-1");
    expect(calledThreadId).toBe("thread-1");
    expect(calledData.inputType).toBe("agent");
    expect(calledData.authorAgentId).toBe("agent-42");
    expect(calledData.rawContent).toBe("Here is my update");
  });

  it("passes actorId as ctx.agentId (not null)", async () => {
    const tool = createPostEntryTool();
    const ctx = makeCtx({ agentId: "agent-99" });

    await tool.execute({ threadId: "thread-1", content: "Delegating task" }, ctx);

    const addEntry = ctx.services.discussions.addEntry as ReturnType<typeof vi.fn>;
    const actorId = addEntry.mock.calls[0][3];
    expect(actorId).toBe("agent-99");
  });

  it("calls processMentions when content has @mentions with hopCount=1", async () => {
    const tool = createPostEntryTool();
    const ctx = makeCtx();

    await tool.execute(
      { threadId: "thread-1", content: "Hey @Planner please review this @Router" },
      ctx,
    );

    const processMentionsMock = processMentions as ReturnType<typeof vi.fn>;
    expect(processMentionsMock).toHaveBeenCalledOnce();

    const [calledDb, calledCompanyId, calledThreadId, calledEntryId, calledMentions, calledOpts] =
      processMentionsMock.mock.calls[0];

    expect(calledDb).toBe(ctx.db);
    expect(calledCompanyId).toBe("co-1");
    expect(calledThreadId).toBe("thread-1");
    expect(calledEntryId).toBe(mockEntry.id);
    expect(calledMentions).toEqual(
      expect.arrayContaining([
        { raw: "@Planner", name: "Planner" },
        { raw: "@Router", name: "Router" },
      ]),
    );
    expect(calledOpts).toEqual({ hopCount: 1 });
  });

  it("does NOT call processMentions when content has no @mentions", async () => {
    const tool = createPostEntryTool();
    const ctx = makeCtx();

    await tool.execute(
      { threadId: "thread-1", content: "No mentions here, just a plain message." },
      ctx,
    );

    const processMentionsMock = processMentions as ReturnType<typeof vi.fn>;
    expect(processMentionsMock).not.toHaveBeenCalled();
  });
});
