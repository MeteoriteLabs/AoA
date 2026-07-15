import { describe, it, expect } from "vitest";
import { createDiscussionEntrySchema } from "../validators/discussion.js";

describe("createDiscussionEntrySchema", () => {
  it("accepts and preserves parentEntryId and authorAgentId", () => {
    const parsed = createDiscussionEntrySchema.parse({
      inputType: "agent",
      rawContent: "hello",
      parentEntryId: "11111111-1111-1111-1111-111111111111",
      authorAgentId: "22222222-2222-2222-2222-222222222222",
    });
    expect(parsed.parentEntryId).toBe("11111111-1111-1111-1111-111111111111");
    expect(parsed.authorAgentId).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("accepts 'agent' as a valid inputType", () => {
    const parsed = createDiscussionEntrySchema.parse({
      inputType: "agent",
      rawContent: "hi",
    });
    expect(parsed.inputType).toBe("agent");
  });

  it("rejects a non-uuid parentEntryId", () => {
    expect(() =>
      createDiscussionEntrySchema.parse({
        inputType: "write",
        rawContent: "x",
        parentEntryId: "not-a-uuid",
      }),
    ).toThrow();
  });

  it("still parses a minimal human entry with neither field", () => {
    const parsed = createDiscussionEntrySchema.parse({
      inputType: "write",
      rawContent: "plain",
    });
    expect(parsed.parentEntryId ?? null).toBeNull();
    expect(parsed.authorAgentId ?? null).toBeNull();
  });

  it("accepts an attachment-only entry", () => {
    const parsed = createDiscussionEntrySchema.parse({
      inputType: "write",
      rawContent: "",
      attachments: [{ assetId: "11111111-1111-1111-1111-111111111111" }],
    });
    expect(parsed.rawContent).toBe("");
  });

  it("rejects an empty entry without attachments", () => {
    expect(() => createDiscussionEntrySchema.parse({ inputType: "write", rawContent: "  " })).toThrow(
      "rawContent is required unless the entry includes an attachment",
    );
  });
});
