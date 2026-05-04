import { describe, it, expect } from "vitest";
import {
  DISCUSSION_STATUSES,
  DISCUSSION_SCOPE_TYPES,
  DISCUSSION_ENTRY_INPUT_TYPES,
  EXTRACTION_STATUSES,
  EXTRACTION_ITEM_TYPES,
  EXTRACTION_ITEM_STATUSES,
  AGENT_CAPABILITIES,
  AGENT_EXECUTION_MODES,
  AGENT_PROVIDERS,
  TRIGGER_TYPES,
  TRIGGER_SOURCES,
  NOTIFICATION_TYPES,
  NOTIFICATION_PREFERENCES,
  IA_RUN_STATUSES,
  IA_MESSAGE_ROLES,
  IA_CONVERSATION_STATUSES,
  REMINDER_STATUSES,
  LIVE_EVENT_TYPES,
  BRIEF_ITEM_TYPES,
  createDiscussionSchema,
  createDiscussionEntrySchema,
  updateDiscussionSchema,
  approveItemsSchema,
  createAnnotationSchema,
  updateInternalAgentConfigSchema,
  chatMessageSchema,
  createWorkflowTemplateSchema,
  updateWorkflowTemplateSchema,
  workflowDependencySchema,
} from "@armyofagents/shared";

// ── Constants ────────────────────────────────────────────────────────────────

describe("v2.5 discussion constants", () => {
  it("DISCUSSION_STATUSES has 2 values", () => {
    expect(DISCUSSION_STATUSES).toEqual(["active", "archived"]);
  });

  it("DISCUSSION_SCOPE_TYPES has 3 values", () => {
    expect(DISCUSSION_SCOPE_TYPES).toEqual(["department", "project", "goal"]);
  });

  it("DISCUSSION_ENTRY_INPUT_TYPES has 4 values", () => {
    expect(DISCUSSION_ENTRY_INPUT_TYPES).toEqual(["paste", "write", "voice", "mcp"]);
  });

  it("EXTRACTION_STATUSES has 5 values", () => {
    expect(EXTRACTION_STATUSES).toEqual(["pending", "processing", "completed", "failed", "skipped"]);
  });

  it("EXTRACTION_ITEM_TYPES matches BRIEF_ITEM_TYPES", () => {
    expect([...EXTRACTION_ITEM_TYPES]).toEqual([...BRIEF_ITEM_TYPES]);
  });

  it("EXTRACTION_ITEM_STATUSES has 4 values", () => {
    expect(EXTRACTION_ITEM_STATUSES).toEqual(["pending", "approved", "rejected", "edited"]);
  });
});

describe("v2.5 internal agent constants", () => {
  it("AGENT_CAPABILITIES has 12 values", () => {
    expect(AGENT_CAPABILITIES).toHaveLength(12);
    expect(AGENT_CAPABILITIES).toContain("discussion_processing");
    expect(AGENT_CAPABILITIES).toContain("department_personas");
  });

  it("AGENT_EXECUTION_MODES has 2 values", () => {
    expect(AGENT_EXECUTION_MODES).toEqual(["api", "cli"]);
  });

  it("AGENT_PROVIDERS has 3 values", () => {
    expect(AGENT_PROVIDERS).toEqual(["anthropic", "openai", "google"]);
  });

  it("TRIGGER_TYPES has 4 values", () => {
    expect(TRIGGER_TYPES).toEqual(["conversation", "proactive", "event", "sub_agent"]);
  });

  it("TRIGGER_SOURCES has 6 values", () => {
    expect(TRIGGER_SOURCES).toHaveLength(6);
  });

  it("NOTIFICATION_TYPES has 11 values", () => {
    expect(NOTIFICATION_TYPES).toHaveLength(11);
  });

  it("IA_RUN_STATUSES has 3 values", () => {
    expect(IA_RUN_STATUSES).toEqual(["running", "completed", "failed"]);
  });

  it("IA_MESSAGE_ROLES has 5 values", () => {
    expect(IA_MESSAGE_ROLES).toEqual(["user", "assistant", "system", "tool_call", "tool_result"]);
  });

  it("IA_CONVERSATION_STATUSES has 2 values", () => {
    expect(IA_CONVERSATION_STATUSES).toEqual(["active", "archived"]);
  });

  it("REMINDER_STATUSES has 3 values", () => {
    expect(REMINDER_STATUSES).toEqual(["pending", "fired", "cancelled"]);
  });

  it("NOTIFICATION_PREFERENCES has 3 values", () => {
    expect(NOTIFICATION_PREFERENCES).toEqual(["silent", "digest", "realtime"]);
  });
});

describe("v2.5 live event types", () => {
  it("includes all 6 new event types", () => {
    const newTypes = [
      "discussion.entry.created",
      "discussion.extraction.completed",
      "discussion.extraction.failed",
      "internal_agent.greeting",
      "internal_agent.reminder",
      "internal_agent.notification",
    ];
    for (const t of newTypes) {
      expect(LIVE_EVENT_TYPES).toContain(t);
    }
  });

  it("still includes original event types", () => {
    expect(LIVE_EVENT_TYPES).toContain("heartbeat.run.queued");
    expect(LIVE_EVENT_TYPES).toContain("activity.logged");
  });
});

// ── Validators ───────────────────────────────────────────────────────────────

describe("createDiscussionSchema", () => {
  it("accepts valid input without entry", () => {
    const result = createDiscussionSchema.safeParse({
      title: "Test Discussion",
      scopeType: "department",
      scopeId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid input with entry", () => {
    const result = createDiscussionSchema.safeParse({
      title: "Test",
      entry: {
        inputType: "paste",
        rawContent: "Some content",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts minimal input (empty object)", () => {
    const result = createDiscussionSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects entry with empty rawContent", () => {
    const result = createDiscussionSchema.safeParse({
      entry: {
        inputType: "paste",
        rawContent: "",
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid scopeType", () => {
    const result = createDiscussionSchema.safeParse({
      scopeType: "invalid",
    });
    expect(result.success).toBe(false);
  });
});

describe("createDiscussionEntrySchema", () => {
  it("accepts valid input", () => {
    const result = createDiscussionEntrySchema.safeParse({
      inputType: "voice",
      rawContent: "Transcribed content",
      sourceInfo: { transcriptionModel: "whisper-1" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing inputType", () => {
    const result = createDiscussionEntrySchema.safeParse({
      rawContent: "Content",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid inputType", () => {
    const result = createDiscussionEntrySchema.safeParse({
      inputType: "email",
      rawContent: "Content",
    });
    expect(result.success).toBe(false);
  });
});

describe("updateDiscussionSchema", () => {
  it("accepts partial update", () => {
    const result = updateDiscussionSchema.safeParse({
      status: "archived",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = updateDiscussionSchema.safeParse({
      status: "deleted",
    });
    expect(result.success).toBe(false);
  });
});

describe("approveItemsSchema", () => {
  it("accepts valid approval", () => {
    const result = approveItemsSchema.safeParse({
      items: [
        {
          itemId: "550e8400-e29b-41d4-a716-446655440000",
          action: "approved",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts approval with edits", () => {
    const result = approveItemsSchema.safeParse({
      items: [
        {
          itemId: "550e8400-e29b-41d4-a716-446655440000",
          action: "edited",
          edits: {
            title: "Updated title",
            priority: "high",
          },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects action of pending", () => {
    const result = approveItemsSchema.safeParse({
      items: [
        {
          itemId: "550e8400-e29b-41d4-a716-446655440000",
          action: "pending",
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects self-dependency", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const result = approveItemsSchema.safeParse({
      items: [{ itemId: id, action: "approved" }],
      dependencies: [{ dependentItemId: id, dependencyItemId: id }],
    });
    expect(result.success).toBe(false);
  });
});

describe("createAnnotationSchema", () => {
  it("accepts content-only annotation", () => {
    const result = createAnnotationSchema.safeParse({
      content: "Important note",
    });
    expect(result.success).toBe(true);
  });

  it("accepts annotation with anchors", () => {
    const result = createAnnotationSchema.safeParse({
      content: "Highlight",
      anchorStart: 10,
      anchorEnd: 25,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty content", () => {
    const result = createAnnotationSchema.safeParse({
      content: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("chatMessageSchema", () => {
  it("accepts valid message", () => {
    const result = chatMessageSchema.safeParse({
      content: "Hello agent",
    });
    expect(result.success).toBe(true);
  });

  it("accepts message with context", () => {
    const result = chatMessageSchema.safeParse({
      content: "Help with tasks",
      pageContext: "/tasks",
      departmentContext: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(true);
  });

  it("enforces 10k char limit", () => {
    const result = chatMessageSchema.safeParse({
      content: "x".repeat(10001),
    });
    expect(result.success).toBe(false);
  });

  it("accepts exactly 10k chars", () => {
    const result = chatMessageSchema.safeParse({
      content: "x".repeat(10000),
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty content", () => {
    const result = chatMessageSchema.safeParse({
      content: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("updateInternalAgentConfigSchema", () => {
  it("accepts valid partial update", () => {
    const result = updateInternalAgentConfigSchema.safeParse({
      executionMode: "api",
      provider: "anthropic",
    });
    expect(result.success).toBe(true);
  });

  it("rejects autonomyLevel > 3", () => {
    const result = updateInternalAgentConfigSchema.safeParse({
      autonomyLevel: 4,
    });
    expect(result.success).toBe(false);
  });

  it("rejects autonomyLevel < 0", () => {
    const result = updateInternalAgentConfigSchema.safeParse({
      autonomyLevel: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid provider", () => {
    const result = updateInternalAgentConfigSchema.safeParse({
      provider: "azure",
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid capabilities array", () => {
    const result = updateInternalAgentConfigSchema.safeParse({
      enabledCapabilities: ["discussion_processing", "budget_awareness"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid capability", () => {
    const result = updateInternalAgentConfigSchema.safeParse({
      enabledCapabilities: ["not_a_capability"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects proactiveIntervalMinutes < 15", () => {
    const result = updateInternalAgentConfigSchema.safeParse({
      proactiveIntervalMinutes: 5,
    });
    expect(result.success).toBe(false);
  });
});

describe("createWorkflowTemplateSchema", () => {
  it("accepts valid template", () => {
    const result = createWorkflowTemplateSchema.safeParse({
      name: "Spec to Code",
      steps: [
        { order: 0, title: "Write spec" },
        { order: 1, title: "Implement" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("requires at least 1 step", () => {
    const result = createWorkflowTemplateSchema.safeParse({
      name: "Empty",
      steps: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing name", () => {
    const result = createWorkflowTemplateSchema.safeParse({
      steps: [{ order: 0, title: "Step" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("workflowDependencySchema", () => {
  it("rejects self-dependency (fromStep === toStep)", () => {
    const result = workflowDependencySchema.safeParse({
      fromStep: 1,
      toStep: 1,
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid dependency", () => {
    const result = workflowDependencySchema.safeParse({
      fromStep: 0,
      toStep: 1,
    });
    expect(result.success).toBe(true);
  });
});

describe("updateWorkflowTemplateSchema", () => {
  it("accepts partial update", () => {
    const result = updateWorkflowTemplateSchema.safeParse({
      name: "Renamed",
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty object", () => {
    const result = updateWorkflowTemplateSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});
