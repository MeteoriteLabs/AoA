import { describe, it, expect } from "vitest";
import { hubItems, notifications } from "../schema/notifications.js";
import { hubPreferences } from "../schema/hub_preferences.js";
import { hubCounterSnapshots } from "../schema/hub_counter_snapshots.js";

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

  it("hubPreferences exposes per-user company-scoped settings columns", () => {
    for (const col of [
      "userId",
      "companyId",
      "defaultLanding",
      "visibleLanes",
      "groupMode",
      "density",
      "showAutopilotEntry",
      "updatedAt",
    ]) {
      expect(hubPreferences, col).toHaveProperty(col);
    }
  });

  it("hubCounterSnapshots exposes bounded per-user counter columns", () => {
    for (const col of [
      "userId",
      "companyId",
      "openCount",
      "unreadCount",
      "invalidatedAt",
      "computedAt",
      "updatedAt",
    ]) {
      expect(hubCounterSnapshots, col).toHaveProperty(col);
    }
  });
});
