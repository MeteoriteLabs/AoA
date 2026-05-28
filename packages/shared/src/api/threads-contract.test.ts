import { describe, it, expect } from "vitest";
import {
  DiscussionEntryV2Schema,
  ScopeProposalPayloadSchema,
  ThreadVisibilitySchema,
  CommanderAdapterConfigSchema,
  CrewAdapterConfigSchema,
  NewNotificationTypeSchema,
} from "./threads-contract.js";

describe("threads API contract", () => {
  describe("DiscussionEntryV2Schema", () => {
    it("defaults attachments to empty array when omitted", () => {
      const parsed = DiscussionEntryV2Schema.parse({
        id: "00000000-0000-0000-0000-000000000001",
        discussionId: "00000000-0000-0000-0000-000000000002",
        inputType: "write",
        rawContent: "hello",
        parentEntryId: null,
        authorAgentId: null,
        authorAgentName: null,
        authorAgentAvatar: null,
        createdAt: new Date().toISOString(),
        createdBy: "user-1",
      });
      expect(parsed.attachments).toEqual([]);
    });

    it("accepts scope_proposal as a valid inputType", () => {
      const parsed = DiscussionEntryV2Schema.parse({
        id: "00000000-0000-0000-0000-000000000001",
        discussionId: "00000000-0000-0000-0000-000000000002",
        inputType: "scope_proposal",
        rawContent: "{}",
        parentEntryId: null,
        authorAgentId: "00000000-0000-0000-0000-000000000003",
        authorAgentName: "Adjutant",
        authorAgentAvatar: null,
        createdAt: new Date().toISOString(),
        createdBy: "agent",
      });
      expect(parsed.inputType).toBe("scope_proposal");
    });

    it("accepts system as a valid inputType", () => {
      const parsed = DiscussionEntryV2Schema.parse({
        id: "00000000-0000-0000-0000-000000000001",
        discussionId: "00000000-0000-0000-0000-000000000002",
        inputType: "system",
        rawContent: "agent encountered an issue",
        parentEntryId: null,
        authorAgentId: null,
        authorAgentName: null,
        authorAgentAvatar: null,
        createdAt: new Date().toISOString(),
        createdBy: "system",
      });
      expect(parsed.inputType).toBe("system");
    });

    it("rejects unknown inputType", () => {
      expect(() =>
        DiscussionEntryV2Schema.parse({
          id: "00000000-0000-0000-0000-000000000001",
          discussionId: "00000000-0000-0000-0000-000000000002",
          inputType: "garbage",
          rawContent: "x",
          parentEntryId: null,
          authorAgentId: null,
          authorAgentName: null,
          authorAgentAvatar: null,
          createdAt: new Date().toISOString(),
          createdBy: "x",
        }),
      ).toThrow();
    });
  });

  describe("ScopeProposalPayloadSchema", () => {
    it("requires summary + at least one proposed task", () => {
      const valid = {
        summary: "Build feature X",
        proposedTasks: [
          {
            title: "Task A",
            description: null,
            suggestedAssigneeAgentId: null,
            suggestedDepartmentId: null,
          },
        ],
        autoAdvanceAt: null,
      };
      expect(() => ScopeProposalPayloadSchema.parse(valid)).not.toThrow();
    });

    it("rejects empty proposedTasks array", () => {
      expect(() =>
        ScopeProposalPayloadSchema.parse({
          summary: "x",
          proposedTasks: [],
          autoAdvanceAt: null,
        }),
      ).toThrow();
    });

    it("rejects missing summary", () => {
      expect(() =>
        ScopeProposalPayloadSchema.parse({
          summary: "",
          proposedTasks: [
            {
              title: "x",
              description: null,
              suggestedAssigneeAgentId: null,
              suggestedDepartmentId: null,
            },
          ],
          autoAdvanceAt: null,
        }),
      ).toThrow();
    });
  });

  describe("ThreadVisibilitySchema", () => {
    it("accepts private, department, company", () => {
      expect(ThreadVisibilitySchema.parse("private")).toBe("private");
      expect(ThreadVisibilitySchema.parse("department")).toBe("department");
      expect(ThreadVisibilitySchema.parse("company")).toBe("company");
    });

    it("rejects legacy 'open' value (migration target is 'company')", () => {
      expect(() => ThreadVisibilitySchema.parse("open")).toThrow();
    });
  });

  describe("CommanderAdapterConfigSchema", () => {
    it("requires both adapter and model", () => {
      expect(() =>
        CommanderAdapterConfigSchema.parse({ adapter: "claude_local", model: "claude-sonnet-4-6" }),
      ).not.toThrow();
      expect(() => CommanderAdapterConfigSchema.parse({ adapter: "", model: "x" })).toThrow();
      expect(() => CommanderAdapterConfigSchema.parse({ adapter: "x" })).toThrow();
    });
  });

  describe("CrewAdapterConfigSchema", () => {
    it("accepts default-only config", () => {
      expect(() =>
        CrewAdapterConfigSchema.parse({ default: { adapter: "codex_local", model: "gpt-5.3-codex" } }),
      ).not.toThrow();
    });

    it("accepts perAgent overrides", () => {
      expect(() =>
        CrewAdapterConfigSchema.parse({
          default: { adapter: "codex_local", model: "gpt-5.3-codex" },
          perAgent: { Adjutant: { adapter: "claude_local", model: "claude-sonnet-4-6" } },
        }),
      ).not.toThrow();
    });

    it("accepts empty object (no defaults set)", () => {
      expect(() => CrewAdapterConfigSchema.parse({})).not.toThrow();
    });
  });

  describe("NewNotificationTypeSchema", () => {
    it("accepts all 5 new thread notification types", () => {
      for (const t of [
        "thread.scope_proposal_posted",
        "thread.artifact_needs_review",
        "thread.crew_failed",
        "thread.spinoff_suggested",
        "thread.human_input_needed",
      ]) {
        expect(NewNotificationTypeSchema.parse(t)).toBe(t);
      }
    });
  });
});
