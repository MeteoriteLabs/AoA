import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const heartbeatSource = readFileSync(
  fileURLToPath(new URL("../services/heartbeat.ts", import.meta.url)),
  "utf8",
);
const orgConcurrencySource = readFileSync(
  fileURLToPath(new URL("../services/org-concurrency.ts", import.meta.url)),
  "utf8",
);

describe("cloud org-concurrency claim wiring", () => {
  it("resolves Company -> Organization and uses the atomic helper only in cloud mode", () => {
    const singleAgentFunction = heartbeatSource.slice(
      heartbeatSource.indexOf("async function startQueuedRunsForSingleAgent"),
      heartbeatSource.indexOf("async function dispatchQueuedRunsAfterAgentSignal"),
    );
    const organizationFunction = heartbeatSource.slice(
      heartbeatSource.indexOf("async function dispatchQueuedRunsAfterAgentSignal"),
      heartbeatSource.indexOf("async function getLatestRunForSession"),
    );
    expect(singleAgentFunction).toContain("resolveCompanyOrganizationId(db, agent.companyId)");
    expect(singleAgentFunction).toContain("claimQueuedRunsWithOrgCapacity(db");
    expect(organizationFunction).toContain("if (!tenantIsolationEnforced())");
    expect(organizationFunction).toContain("dispatchQueuedAgentsForOrg(");
    expect(organizationFunction).toContain("startQueuedRunsForSingleAgent(candidateAgentId, organizationId)");
    expect(singleAgentFunction).not.toContain("agent as { organizationId?: string | null }");
  });

  it("takes the transaction-scoped org lock before counting and claiming", () => {
    const txIndex = orgConcurrencySource.indexOf("return db.transaction(async (tx)");
    const lockIndex = orgConcurrencySource.indexOf("pg_advisory_xact_lock");
    const agentCountIndex = orgConcurrencySource.indexOf("agentRunningRow");
    const claimIndex = orgConcurrencySource.indexOf(".update(heartbeatRuns)");
    expect(txIndex).toBeGreaterThan(-1);
    expect(lockIndex).toBeGreaterThan(txIndex);
    expect(agentCountIndex).toBeGreaterThan(lockIndex);
    expect(claimIndex).toBeGreaterThan(agentCountIndex);
  });

  it("runs failure-isolated claim mirrors only after the atomic helper resolves", () => {
    const claimIndex = heartbeatSource.indexOf("await claimQueuedRunsWithOrgCapacity(db");
    const publishIndex = heartbeatSource.indexOf("await runClaimMirrorsBestEffort(", claimIndex);
    expect(claimIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(claimIndex);
  });
});
