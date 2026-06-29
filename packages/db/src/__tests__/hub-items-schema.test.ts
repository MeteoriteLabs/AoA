import { describe, it, expect } from "vitest";
import { hubItems, notifications } from "../schema/notifications.js";

describe("hubItems schema", () => {
  it("hubItems aliases the notifications table and exposes hub columns", () => {
    expect(hubItems).toBe(notifications);
    for (const col of [
      "semanticType",
      "status",
      "sourceUniqueKey",
      "summary",
      "version",
      "ownerUserId",
      "claimedByUserId",
      "claimedAt",
    ]) {
      expect(hubItems, col).toHaveProperty(col);
    }
  });
});
