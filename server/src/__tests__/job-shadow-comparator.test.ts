import { describe, expect, it, vi } from "vitest";
import {
  createJobShadowComparator,
  type LegacyRunExecutionSnapshot,
  type ShadowComparisonResult,
} from "../services/job-shadow-comparator.js";
import { decideJobPlacement } from "../services/job-placement.js";

const SNAPSHOT: LegacyRunExecutionSnapshot = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  runId: "33333333-3333-4333-8333-333333333333",
  issueId: "44444444-4444-4444-8444-444444444444",
  assigneeAgentId: "55555555-5555-4555-8555-555555555555",
  workloadType: "batch",
  routing: { executionTargetType: "e2b" },
  provenance: { executionPrincipalKind: "agent", credentialKind: "company_api_key" },
  policy: {
    model: "claude-sonnet",
    budgetPolicyId: "66666666-6666-4666-8666-666666666666",
    effectiveCompletionPolicy: "review_required",
  },
  workloadCharacterization: {
    command: "claude",
    args: ["--print", "do the thing"],
    maxRuntimeSeconds: 600,
    stdinArtifactId: null,
  },
};

function collectingSink() {
  const records: ShadowComparisonResult[] = [];
  return { records, record: (r: ShadowComparisonResult) => records.push(r) };
}

describe("CLI-005 shadow comparator (effect-free routing/provenance/policy diff)", () => {
  it("produces a diff-clean match for a faithful (identity) mapping", () => {
    const sink = collectingSink();
    const comparator = createJobShadowComparator({ sink });
    const result = comparator.compare(SNAPSHOT, { admissible: true });

    expect(result.match).toBe(true);
    expect(result.mismatchedFields).toEqual([]);
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]).toBe(result);
  });

  it("derives the would-be task_run source + batch workload envelope from the run", () => {
    const comparator = createJobShadowComparator({ sink: collectingSink() });
    const result = comparator.compare(SNAPSHOT);

    expect(result.wouldBeSource).toEqual({
      kind: "task_run",
      runId: SNAPSHOT.runId,
      issueId: SNAPSHOT.issueId,
      assigneeAgentId: SNAPSHOT.assigneeAgentId,
    });
    expect(result.workloadValid).toBe(true);
    expect(result.wouldBeWorkload).toEqual({
      command: "claude",
      args: ["--print", "do the thing"],
      stdinArtifactId: null,
      maxRuntimeSeconds: 600,
    });
  });

  it("is NON-LEASABLE by construction (shadow placement lease-eligibility is false)", () => {
    const comparator = createJobShadowComparator({ sink: collectingSink() });
    const result = comparator.compare(SNAPSHOT);
    expect(result.placementLeaseEligible).toBe(false);

    // Tie the property to the REAL pure primitive: any shadow-mode decision is
    // non-leasable regardless of candidates/inputs (leaseEligible = mode === "active").
    const decision = decideJobPlacement({
      sourceKind: "task_run",
      rollout: { enabled: true, mode: "shadow", reason: "enabled" },
      requirements: {},
      providerDemand: {},
      credentialOwnerPrincipalId: null,
      now: new Date(),
      maxHeartbeatAgeMs: 30_000,
      inputDigest: "0".repeat(64),
      policyDigest: "0".repeat(64),
      candidates: [],
    } as never);
    expect(decision.leaseEligible).toBe(false);
  });

  it("flags mismatched fields when the derived intent diverges from the run's actuals", () => {
    const sink = collectingSink();
    const comparator = createJobShadowComparator({
      sink,
      // Inject a faulty mapping that changes routing + model to prove detection.
      deriveDistributedIntent: (snapshot) => ({
        routing: { executionTargetType: "local" }, // diverges from "e2b"
        provenance: { ...snapshot.provenance },
        policy: { ...snapshot.policy, model: "gpt-4" }, // diverges from "claude-sonnet"
      }),
    });
    const result = comparator.compare(SNAPSHOT);

    expect(result.match).toBe(false);
    expect(result.mismatchedFields).toContain("routing.executionTargetType");
    expect(result.mismatchedFields).toContain("policy.model");
    expect(result.mismatchedFields).not.toContain("provenance.credentialKind");
  });

  it("never throws into the legacy run and still records an errored result", () => {
    const sink = collectingSink();
    const comparator = createJobShadowComparator({
      sink,
      deriveDistributedIntent: () => {
        throw new Error("mapping blew up");
      },
    });
    // Must not throw.
    const result = comparator.compare(SNAPSHOT);
    expect(result.errored).toBe(true);
    expect(sink.records).toHaveLength(1);
  });

  it("records an invalid workload characterization without throwing", () => {
    const comparator = createJobShadowComparator({ sink: collectingSink() });
    const result = comparator.compare({
      ...SNAPSHOT,
      workloadCharacterization: { command: "", args: [], maxRuntimeSeconds: 0, stdinArtifactId: null },
    });
    expect(result.workloadValid).toBe(false);
    expect(result.wouldBeWorkload).toBeNull();
  });

  it("a sink failure never propagates into the run", () => {
    const throwingSink = {
      record: vi.fn(() => {
        throw new Error("sink down");
      }),
    };
    const comparator = createJobShadowComparator({ sink: throwingSink });
    expect(() => comparator.compare(SNAPSHOT)).not.toThrow();
    expect(throwingSink.record).toHaveBeenCalledTimes(1);
  });
});
