import { describe, expect, it } from "vitest";
import { aoaAgentTriggers } from "@armyofagents/db";
describe("aoa_agent_triggers schema", () => {
  it("has the expected columns", () => {
    const cols = Object.keys(aoaAgentTriggers);
    for (const c of ["id","companyId","agentId","kind","enabled","config","createdAt","updatedAt"]) expect(cols).toContain(c);
  });
});
