// CLI-006 (D3) — `resolveRunExecutionOwner`, the SINGLE ownership decision.
//
// Invariant 1: for any run, `adapter.execute` runs XOR a leasable distributed
// attempt exists — and the decision is computed ONCE, at one point, so the two
// consumers (placement and the legacy-suppression guard at heartbeat.ts:5147)
// can never disagree. Double-execution is meant to be structurally hard here,
// not merely tested against.
//
// Invariant 2: the fail-safe direction is ALWAYS legacy. Every short-circuit and
// every throw resolves to `{owner:"legacy"}` — never to "neither" (a silently
// dropped run) and never to "both".
//
// Ordering matters and is asserted: placement is the LAST step, so nothing that
// can fail runs after an attempt has become leasable. A failure after a
// successful convert but before/at placement leaves exactly CLI-005's proven
// inert state — a durable non-leasable job with the legacy adapter executing.

import { describe, expect, it, vi } from "vitest";
import {
  createRunExecutionOwnerResolver,
  toRunExecutionPlacement,
  DEFAULT_PLACEMENT_MAX_HEARTBEAT_AGE_MS,
  type RunExecutionOwnerDeps,
} from "../services/run-execution-owner.js";

const ORG = "66666666-6666-4666-8666-666666666666";
const RUN = "77777777-7777-4777-8777-777777777777";
const ISSUE = "88888888-8888-4888-8888-888888888888";
const AGENT = "99999999-9999-4999-8999-999999999999";
const COMPANY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const JOB = "10b10b10-10b1-4b10-8b10-10b10b10b10b";
const ATTEMPT = "a77e3907-a77e-4a77-8a77-a77ea77ea77e";

const input = {
  source: { kind: "task_run", runId: RUN, issueId: ISSUE, assigneeAgentId: AGENT } as const,
  actor: { kind: "agent", id: AGENT, companyId: COMPANY } as const,
  organizationId: ORG,
  workloadType: "batch",
  idempotencyKey: RUN,
};

function deps(overrides: Partial<RunExecutionOwnerDeps> = {}): RunExecutionOwnerDeps {
  return {
    resolveRunRolloutState: () => "canary",
    preflight: { check: async () => ({ ok: true, companyIds: [COMPANY], credentialAuthority: "company_api_key" }) },
    convert: {
      convertRunToJob: async () => ({
        converted: true,
        reason: "submitted",
        response: { jobId: JOB, attemptId: ATTEMPT, replayed: false } as never,
      }),
    },
    placement: {
      place: async () => ({ disposition: "selected", leaseEligible: true }) as never,
    },
    ...overrides,
  };
}

describe("CLI-006 D3 — resolveRunExecutionOwner (one decision, fail-safe to legacy)", () => {
  it("transfers ownership when canary + preflight + convert + leasable placement all succeed", async () => {
    const result = await createRunExecutionOwnerResolver(deps()).resolve(input);
    expect(result.owner).toBe("distributed");
    if (result.owner !== "distributed") throw new Error("unreachable");
    expect(result.jobId).toBe(JOB);
    expect(result.attemptId).toBe(ATTEMPT);
  });

  // CLI-007 (E7-F001): the preflight-established Company mint authority is THREADED to
  // placement out of band, so the DAT-008 mint can issue a Company provider_key handle
  // for the canary. It is never derived here and never touches the placement digest.
  it("threads the preflight's credentialAuthority to placement as mintCredentialAuthority", async () => {
    const place = vi.fn(async () => ({ disposition: "selected", leaseEligible: true }));
    const result = await createRunExecutionOwnerResolver(
      deps({ placement: { place } }),
    ).resolve(input);
    expect(result.owner).toBe("distributed");
    expect(place.mock.calls[0][0]).toMatchObject({ mintCredentialAuthority: "company_api_key" });
  });

  // Fail-closed / non-canary isolation: a refused preflight never places, so no mint
  // authority is ever threaded behind a gate that did not open.
  it("threads NO mint authority when the preflight refuses (nothing places)", async () => {
    const place = vi.fn();
    await createRunExecutionOwnerResolver(
      deps({
        preflight: {
          check: async () => ({
            ok: false,
            reason: "credential_authority_not_moved",
            companyId: COMPANY,
            detail: "no key generation",
          }),
        },
        placement: { place },
      }),
    ).resolve(input);
    expect(place).not.toHaveBeenCalled();
  });

  it.each([
    ["off", "rollout_not_canary"],
    ["shadow", "rollout_not_canary"],
    ["active", "rollout_not_canary"],
  ] as const)("leaves rollout state `%s` on the legacy path", async (state, reason) => {
    const result = await createRunExecutionOwnerResolver(
      deps({ resolveRunRolloutState: () => state }),
    ).resolve(input);
    expect(result.owner).toBe("legacy");
    if (result.owner !== "legacy") throw new Error("unreachable");
    expect(result.reason).toBe(reason);
  });

  // A non-canary run must not even consult the gate — Invariant 4 (non-canary
  // isolation) means no extra query, not just no behavior change.
  it("does NOT run the preflight, convert, or placement for a non-canary run", async () => {
    const check = vi.fn();
    const convertRunToJob = vi.fn();
    const place = vi.fn();
    await createRunExecutionOwnerResolver(
      deps({
        resolveRunRolloutState: () => "off",
        preflight: { check },
        convert: { convertRunToJob },
        placement: { place },
      }),
    ).resolve(input);
    expect(check).not.toHaveBeenCalled();
    expect(convertRunToJob).not.toHaveBeenCalled();
    expect(place).not.toHaveBeenCalled();
  });

  it("falls back to legacy when the MIG-008 preflight refuses", async () => {
    const place = vi.fn();
    const result = await createRunExecutionOwnerResolver(
      deps({
        preflight: {
          check: async () => ({
            ok: false,
            reason: "reconciliation_incomplete",
            companyId: COMPANY,
            detail: "not closed",
          }),
        },
        placement: { place },
      }),
    ).resolve(input);
    expect(result.owner).toBe("legacy");
    if (result.owner !== "legacy") throw new Error("unreachable");
    expect(result.reason).toBe("preflight_refused");
    // Nothing may become leasable behind a refused gate.
    expect(place).not.toHaveBeenCalled();
  });

  it("falls back to legacy when the convert does not produce a job", async () => {
    const place = vi.fn();
    const result = await createRunExecutionOwnerResolver(
      deps({
        convert: { convertRunToJob: async () => ({ converted: false, reason: "submit_failed" }) },
        placement: { place },
      }),
    ).resolve(input);
    expect(result.owner).toBe("legacy");
    if (result.owner !== "legacy") throw new Error("unreachable");
    expect(result.reason).toBe("convert_failed");
    expect(place).not.toHaveBeenCalled();
  });

  // The CLI-005 inert state: a durable job exists but never became leasable, so
  // the legacy adapter is still the one executor. Safe, and explicitly named.
  it("falls back to legacy when placement yields a NON-leasable attempt", async () => {
    const result = await createRunExecutionOwnerResolver(
      deps({
        placement: {
          place: async () => ({ disposition: "selected", leaseEligible: false }) as never,
        },
      }),
    ).resolve(input);
    expect(result.owner).toBe("legacy");
    if (result.owner !== "legacy") throw new Error("unreachable");
    expect(result.reason).toBe("placement_not_leasable");
  });

  it("falls back to legacy when placement does not select a target", async () => {
    const result = await createRunExecutionOwnerResolver(
      deps({
        placement: {
          place: async () => ({ disposition: "failed", leaseEligible: false }) as never,
        },
      }),
    ).resolve(input);
    expect(result.owner).toBe("legacy");
    if (result.owner !== "legacy") throw new Error("unreachable");
    expect(result.reason).toBe("placement_not_leasable");
  });

  it.each([
    [
      "preflight",
      { preflight: { check: async () => { throw new Error("boom"); } } },
    ],
    [
      "convert",
      { convert: { convertRunToJob: async () => { throw new Error("boom"); } } },
    ],
    [
      "placement",
      { placement: { place: async () => { throw new Error("boom"); } } },
    ],
  ])("falls back to legacy (never throws) when %s throws", async (_name, override) => {
    const result = await createRunExecutionOwnerResolver(
      deps(override as Partial<RunExecutionOwnerDeps>),
    ).resolve(input);
    expect(result.owner).toBe("legacy");
    if (result.owner !== "legacy") throw new Error("unreachable");
    expect(result.reason).toBe("transfer_error");
  });

  it("never resolves to neither executor — every path names an owner", async () => {
    const overrides: Partial<RunExecutionOwnerDeps>[] = [
      { resolveRunRolloutState: () => "off" },
      { preflight: { check: async () => ({ ok: false, reason: "preflight_error", companyId: null, detail: "x" }) } },
      { convert: { convertRunToJob: async () => ({ converted: false, reason: "disabled" }) } },
      { placement: { place: async () => ({ disposition: "failed", leaseEligible: false }) as never } },
      { placement: { place: async () => { throw new Error("boom"); } } },
      {},
    ];
    for (const override of overrides) {
      const result = await createRunExecutionOwnerResolver(deps(override)).resolve(input);
      expect(["legacy", "distributed"]).toContain(result.owner);
    }
  });

  // Ordering: placement is LAST. Nothing that can fail into legacy may run after
  // an attempt has become leasable, or the run would double-execute.
  it("places only after the preflight and convert have both succeeded", async () => {
    const order: string[] = [];
    await createRunExecutionOwnerResolver(
      deps({
        preflight: {
          check: async () => {
            order.push("preflight");
            return { ok: true, companyIds: [COMPANY], credentialAuthority: "company_api_key" };
          },
        },
        convert: {
          convertRunToJob: async () => {
            order.push("convert");
            return {
              converted: true,
              reason: "submitted",
              response: { jobId: JOB, attemptId: ATTEMPT, replayed: false } as never,
            };
          },
        },
        placement: {
          place: async () => {
            order.push("place");
            return { disposition: "selected", leaseEligible: true } as never;
          },
        },
      }),
    ).resolve(input);
    expect(order).toEqual(["preflight", "convert", "place"]);
  });

  // A replayed convert (idempotent redelivery) is still a real durable job and
  // must be placeable — otherwise a retried wake would silently drop to legacy
  // while an earlier attempt is already live.
  it("treats a REPLAYED convert as a valid job to place", async () => {
    const result = await createRunExecutionOwnerResolver(
      deps({
        convert: {
          convertRunToJob: async () => ({
            converted: true,
            reason: "replayed",
            response: { jobId: JOB, attemptId: ATTEMPT, replayed: true } as never,
          }),
        },
      }),
    ).resolve(input);
    expect(result.owner).toBe("distributed");
  });

  // The heartbeat seam resolves the rollout state once (to choose between
  // CLI-005's inert convert and the canary transfer) and hands it in, so the
  // predicate is derived exactly once per run and cannot drift mid-decision.
  it("honors a caller-supplied rollout state instead of re-deriving it", async () => {
    const resolveRunRolloutState = vi.fn(() => "canary" as const);
    const result = await createRunExecutionOwnerResolver(
      deps({ resolveRunRolloutState }),
    ).resolve({ ...input, rolloutState: "canary" });
    expect(result.owner).toBe("distributed");
    expect(resolveRunRolloutState).not.toHaveBeenCalled();
  });

  it("stays legacy when the caller supplies a non-canary state, whatever the source says", async () => {
    const result = await createRunExecutionOwnerResolver(
      // A source that would say `canary` must not override the caller's resolution.
      deps({ resolveRunRolloutState: () => "canary" }),
    ).resolve({ ...input, rolloutState: "active" });
    expect(result.owner).toBe("legacy");
    if (result.owner !== "legacy") throw new Error("unreachable");
    expect(result.reason).toBe("rollout_not_canary");
  });

  it("falls back to legacy when the convert reports success without a job identity", async () => {
    const result = await createRunExecutionOwnerResolver(
      deps({
        convert: {
          convertRunToJob: async () => ({ converted: true, reason: "submitted", response: undefined }),
        },
      }),
    ).resolve(input);
    expect(result.owner).toBe("legacy");
    if (result.owner !== "legacy") throw new Error("unreachable");
    expect(result.reason).toBe("convert_failed");
  });
});

// ── The placement adapter (CLI-006 Task 2) ──────────────────────────────────
//
// `JobPlacementServiceInput` requires `now` and `maxHeartbeatAgeMs`, which
// `RunExecutionPlacement.place` does not supply. Because `place` is declared with
// method-shorthand syntax, TypeScript's parameter bivariance lets a DIRECT
// assignment compile with NO error — verified against the real composition root —
// and then hands `decideJobPlacement` `now: undefined`, which fails its
// `input.now instanceof Date` validation and returns `invalid_placement_input`.
// Every canary transfer would silently fall back to legacy, with no type error.
//
// So the adapter cannot be guarded by the compiler; it is guarded here.
describe("CLI-006 — toRunExecutionPlacement", () => {
  it("supplies `now` as a Date — the field bivariance lets a direct assignment omit", async () => {
    const place = vi.fn(async () => ({ disposition: "selected", leaseEligible: true }));
    await toRunExecutionPlacement({ place }).place({
      jobId: JOB,
      attemptId: ATTEMPT,
      organizationId: ORG,
      companyId: COMPANY,
    });
    expect(place.mock.calls[0][0].now).toBeInstanceOf(Date);
  });

  it("supplies the sibling-default maxHeartbeatAgeMs", async () => {
    const place = vi.fn(async () => ({ disposition: "selected", leaseEligible: true }));
    await toRunExecutionPlacement({ place }).place({
      jobId: JOB,
      attemptId: ATTEMPT,
      organizationId: ORG,
      companyId: COMPANY,
    });
    expect(place.mock.calls[0][0].maxHeartbeatAgeMs).toBe(DEFAULT_PLACEMENT_MAX_HEARTBEAT_AGE_MS);
    expect(DEFAULT_PLACEMENT_MAX_HEARTBEAT_AGE_MS).toBe(300_000);
  });

  it("passes the caller's placement identity through unchanged", async () => {
    const place = vi.fn(async () => ({ disposition: "selected", leaseEligible: true }));
    await toRunExecutionPlacement({ place }).place({
      jobId: JOB,
      attemptId: ATTEMPT,
      organizationId: ORG,
      companyId: COMPANY,
    });
    expect(place.mock.calls[0][0]).toMatchObject({
      jobId: JOB,
      attemptId: ATTEMPT,
      organizationId: ORG,
      companyId: COMPANY,
    });
  });

  it("returns the service's decision unchanged, so a non-leasable placement still reads as such", async () => {
    const place = vi.fn(async () => ({ disposition: "selected", leaseEligible: false }));
    const decision = await toRunExecutionPlacement({ place }).place({
      jobId: JOB,
      attemptId: ATTEMPT,
      organizationId: ORG,
      companyId: COMPANY,
    });
    expect(decision).toEqual({ disposition: "selected", leaseEligible: false });
  });
});
