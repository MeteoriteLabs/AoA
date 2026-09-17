import { describe, expect, it } from "vitest";
import {
  draftDestinationSchema,
  draftPatchSchema,
  UNIVERSE_DRAFT_MAX_ATTACHMENTS,
  UNIVERSE_DRAFT_MAX_TEXT,
} from "../validators/universe-draft.js";

describe("universe draft validators", () => {
  it("accepts a well-formed destination and patch", () => {
    expect(
      draftDestinationSchema.safeParse({ kind: "task", id: "t1" }).success,
    ).toBe(true);
    expect(
      draftPatchSchema.safeParse({
        schemaVersion: 1,
        expectedRevision: 0,
        text: "hello",
        attachmentAssetIds: ["a1"],
      }).success,
    ).toBe(true);
  });

  it("rejects unknown destination kinds and extra keys", () => {
    expect(
      draftDestinationSchema.safeParse({ kind: "evil", id: "x" }).success,
    ).toBe(false);
    expect(
      draftDestinationSchema.safeParse({ kind: "task", id: "t1", userId: "u" })
        .success,
    ).toBe(false);
  });

  it("rejects oversized text, too many attachments and a wrong schemaVersion", () => {
    const base = { schemaVersion: 1, expectedRevision: 0, attachmentAssetIds: [] };
    expect(
      draftPatchSchema.safeParse({
        ...base,
        text: "x".repeat(UNIVERSE_DRAFT_MAX_TEXT + 1),
      }).success,
    ).toBe(false);
    expect(
      draftPatchSchema.safeParse({
        ...base,
        text: "ok",
        attachmentAssetIds: Array.from(
          { length: UNIVERSE_DRAFT_MAX_ATTACHMENTS + 1 },
          (_, i) => `a${i}`,
        ),
      }).success,
    ).toBe(false);
    expect(
      draftPatchSchema.safeParse({ ...base, schemaVersion: 2, text: "ok" })
        .success,
    ).toBe(false);
  });
});
