import { describe, expect, it } from "vitest";
import { threadAgentActions } from "@armyofagents/db";

function columnNames(table: Record<string, unknown>) {
  return new Set(Object.keys(table));
}

describe("thread agent actions schema contract", () => {
  it("exports action gate columns", () => {
    const cols = columnNames(threadAgentActions as unknown as Record<string, unknown>);

    for (const name of [
      "id",
      "companyId",
      "threadId",
      "runId",
      "agentId",
      "actionType",
      "status",
      "payload",
      "idempotencyKey",
      "freshness",
      "attemptCount",
      "maxAttempts",
      "blockedReason",
      "committedEntryId",
      "committedScopeVersionId",
      "committedScopeItemId",
      "createdAt",
      "committedAt",
      "updatedAt",
    ]) {
      expect(cols.has(name)).toBe(true);
    }
  });
});
