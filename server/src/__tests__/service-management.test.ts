// -----------------------------------------------------------------------------
// SVC-007 (Unit A) — the create-definition boundary and the desired-state control, purely.
//
// EVERY CASE NAMES THE MUTANT THAT MUST RE-RED IT, and `SVC-007a-result.md` records which
// did. This programme's recurring defect is a test that was green before the change and
// nobody checked.
//
// ★ WHY THE TRANSITION CASES WALK THE WHOLE 4x4 TABLE RATHER THAN A FEW EXAMPLES. E9-F004 is
// exactly this mistake one lifecycle over: SVC-003a proved its instance-transition predicate
// over the transitions its suite happened to exercise, the one terminal it drove was the one
// reachable from everywhere, and a predicate that refused EVERY NORMAL SERVICE STOP survived
// a named positive control and thirteen killed mutants. A lifecycle table proven over a
// sample is not proven over the table.
// -----------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  SERVICE_DESIRED_STATES,
  canTransitionServiceDesiredState,
  serviceWorkloadV1Schema,
  type ServiceDesiredState,
} from "@armyofagents/worker-protocol";
import { SERVICE_INGRESS_DENY_KEYS } from "../services/service-job-config.js";
import { decideServiceProjection } from "../services/service-health-projection.js";

const runInTenant = vi.fn();
const runInTenantReadOnly = vi.fn();
vi.mock("../db/tenant-context.js", () => ({
  runInTenant: (...args: unknown[]) => runInTenant(...args),
  runInTenantReadOnly: (...args: unknown[]) => runInTenantReadOnly(...args),
}));

const {
  CONTROLLABLE_DESIRED_STATES,
  CREATABLE_DESIRED_STATES,
  SERVICE_CONTROL_PLANE_OWNED_WORKLOAD_FIELDS,
  SERVICE_DEFINITION_FIELDS,
  normalizeServiceDefinition,
  setServiceDesiredState,
  setServiceDesiredStateWithinTenant,
} = await import("../services/service-management.js");

const ORG = "b1000000-0000-4000-8000-000000000001";
const COMPANY = "b1000000-0000-4000-8000-000000000002";
const SERVICE = "b1000000-0000-4000-8000-000000000003";
const VALID = { command: "node", args: ["queue-worker.js"], gracefulStopSeconds: 30 };

describe("SVC-007 — the create definition boundary", () => {
  // MUTANT: delete the `.strict()` on `serviceDefinitionSchema`.
  it("P1 — a definition carrying exactly the three frozen non-identity fields is accepted", () => {
    const result = normalizeServiceDefinition({ ...VALID });
    expect(result.ok, "the positive branch must actually accept").toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(VALID);
    expect(Object.keys(result.value).sort()).toEqual([...SERVICE_DEFINITION_FIELDS].sort());
  });

  // MUTANT: drop the ingress loop, or replace SERVICE_INGRESS_DENY_KEYS with a local list.
  //
  // Driven over the SHIPPED deny-set rather than a copied literal: SVC-001 owns that list,
  // and a key added there must be refused here without anyone editing this file.
  it("P2 — every key in the shipped ingress deny-set is refused, with the reason that names the policy", () => {
    expect(SERVICE_INGRESS_DENY_KEYS.length, "the deny-set must not be empty").toBeGreaterThan(0);
    for (const key of SERVICE_INGRESS_DENY_KEYS) {
      const result = normalizeServiceDefinition({ ...VALID, [key]: 8080 });
      expect(result.ok, `${key} must be refused`).toBe(false);
      if (result.ok) continue;
      expect(result.reason, key).toBe("ingress_configuration_rejected");
    }
  });

  // MUTANT: delete the control-plane-owned loop — `serviceInstanceId` then falls through to
  // `unknown_field`, which still refuses, so this case pins the REASON as well as the refusal.
  // Collapsing the two reasons would let the loop be deleted with nothing going red.
  it("P3 — every control-plane-owned workload field is refused by its own reason", () => {
    expect(SERVICE_CONTROL_PLANE_OWNED_WORKLOAD_FIELDS).toContain("serviceInstanceId");
    for (const key of SERVICE_CONTROL_PLANE_OWNED_WORKLOAD_FIELDS) {
      const result = normalizeServiceDefinition({ ...VALID, [key]: "b1000000-0000-4000-8000-00000000000f" });
      expect(result.ok, `${key} must be refused`).toBe(false);
      if (result.ok) continue;
      expect(result.reason, key).toBe("control_plane_owned_field");
    }
  });

  // MUTANT: accept unknown fields (drop the SERVICE_DEFINITION_FIELDS membership loop).
  it("P4 — an unrecognised field is refused, and a non-object is refused before anything else", () => {
    expect(normalizeServiceDefinition({ ...VALID, retries: 3 })).toEqual({
      ok: false,
      reason: "unknown_field",
    });
    for (const raw of [null, undefined, 7, "node", ["node"]]) {
      expect(normalizeServiceDefinition(raw)).toEqual({ ok: false, reason: "not_an_object" });
    }
  });

  // MUTANT: relax the pick to a hand-written z.object without the frozen bounds.
  it("P5 — the FROZEN bounds are the authority, not a local re-statement", () => {
    const rejected = [
      { ...VALID, command: "" },
      { ...VALID, command: "x".repeat(257) },
      { ...VALID, args: "not-an-array" },
      { ...VALID, args: [1, 2] },
      { ...VALID, gracefulStopSeconds: 0 },
      { ...VALID, gracefulStopSeconds: 301 },
      { ...VALID, gracefulStopSeconds: 1.5 },
      { command: "node", args: [] },
    ];
    for (const raw of rejected) {
      const result = normalizeServiceDefinition(raw);
      expect(result.ok, JSON.stringify(raw).slice(0, 60)).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe("frozen_schema_rejected");
    }
    // …and the bounds' own edges are accepted, so the case is not vacuously refusing.
    expect(normalizeServiceDefinition({ ...VALID, gracefulStopSeconds: 1 }).ok).toBe(true);
    expect(normalizeServiceDefinition({ ...VALID, gracefulStopSeconds: 300 }).ok).toBe(true);
    expect(normalizeServiceDefinition({ ...VALID, args: [] }).ok).toBe(true);
  });

  // MUTANT: add a field to SERVICE_DEFINITION_FIELDS that the frozen schema does not have,
  // or drop one of the four control-plane-owned names. Both make the module throw at load —
  // which is the intended outcome, and this case states the property independently so a
  // future edit to the guard cannot quietly weaken it.
  it("P6 — the partition of the frozen workload is EXHAUSTIVE and DISJOINT", () => {
    const frozen = Object.keys(serviceWorkloadV1Schema.shape).sort();
    const declared = [
      ...SERVICE_DEFINITION_FIELDS,
      ...SERVICE_CONTROL_PLANE_OWNED_WORKLOAD_FIELDS,
    ].sort();
    expect(declared).toEqual(frozen);
    expect(new Set(declared).size).toBe(declared.length);
  });

  // MUTANT: add "deleted" to either list.
  it("P7 — both state lists are subsets of the frozen authority, and neither admits `deleted`", () => {
    for (const state of [...CREATABLE_DESIRED_STATES, ...CONTROLLABLE_DESIRED_STATES]) {
      expect(SERVICE_DESIRED_STATES).toContain(state);
    }
    expect(CREATABLE_DESIRED_STATES).not.toContain("deleted");
    expect(CONTROLLABLE_DESIRED_STATES).not.toContain("deleted");
    // `stopped` is controllable but not creatable: a service created stopped never ran.
    expect(CONTROLLABLE_DESIRED_STATES).toContain("stopped");
    expect(CREATABLE_DESIRED_STATES).not.toContain("stopped");
  });
});

// ── The desired-state control, over a repository stub ─────────────────────────────────────

function stubRepos(input: {
  service: { desiredState: string; generation: number } | null;
  updateReturns?: { desiredState: string; generation: number } | null;
}) {
  const updates: unknown[] = [];
  const repos = {
    jobControl: {
      async lockServiceForReconcile() {
        return input.service;
      },
      async updateServiceDesiredState(values: unknown) {
        updates.push(values);
        return input.updateReturns === undefined
          ? { desiredState: (values as { desiredState: string }).desiredState, generation: input.service?.generation ?? 1 }
          : input.updateReturns;
      },
    },
  };
  return { repos, updates };
}

describe("SVC-007 — the desired-state control is fenced by the FROZEN transition table", () => {
  // MUTANT: return `absent` as a thrown 500, or resolve a missing service to a default state.
  it("P8a — an absent service is a definite `absent`, and nothing is written", async () => {
    const { repos, updates } = stubRepos({ service: null });
    const verdict = await setServiceDesiredStateWithinTenant(repos as never, {
      organizationId: ORG, companyId: COMPANY, serviceId: SERVICE, desiredState: "stopped",
    });
    expect(verdict).toEqual({ outcome: "absent" });
    expect(updates).toEqual([]);
  });

  // MUTANT: delete the same-state short-circuit. The FROZEN table has NO self-edges, so
  // running->running would then answer `illegal` — a satisfiable request refused, and the
  // retry path in `setServiceDesiredState` (which re-issues the graceful stop) unreachable.
  it("P8b — re-issuing the current state is `unchanged` and writes nothing", async () => {
    const { repos, updates } = stubRepos({ service: { desiredState: "stopped", generation: 4 } });
    const verdict = await setServiceDesiredStateWithinTenant(repos as never, {
      organizationId: ORG, companyId: COMPANY, serviceId: SERVICE, desiredState: "stopped",
    });
    expect(verdict).toEqual({ outcome: "unchanged", state: "stopped", generation: 4 });
    expect(updates).toEqual([]);
  });

  // MUTANT: drop the compare-and-set predicate's failure branch (treat `null` as success).
  it("P8c — a compare-and-set that matched no row is a reported `conflict`, never a silent success", async () => {
    const { repos } = stubRepos({
      service: { desiredState: "running", generation: 1 },
      updateReturns: null,
    });
    const verdict = await setServiceDesiredStateWithinTenant(repos as never, {
      organizationId: ORG, companyId: COMPANY, serviceId: SERVICE, desiredState: "stopped",
    });
    expect(verdict).toEqual({ outcome: "conflict", from: "running", to: "stopped" });
  });

  // MUTANT: pass an unrecognised stored state straight to the frozen predicate as a cast.
  it("P8d — a stored desired_state outside the frozen list has NO legal move", async () => {
    const { repos, updates } = stubRepos({ service: { desiredState: "zombie", generation: 1 } });
    const verdict = await setServiceDesiredStateWithinTenant(repos as never, {
      organizationId: ORG, companyId: COMPANY, serviceId: SERVICE, desiredState: "running",
    });
    expect(verdict).toEqual({ outcome: "illegal", from: "zombie", to: "running" });
    expect(updates).toEqual([]);
  });

  // ★ MUTANT: replace `canTransitionServiceDesiredState` with `() => true`, or with a
  // hand-written edge list. This case walks EVERY (from, to) pair the control can be asked
  // for — 4 stored states x 3 controllable targets — and demands the verdict agree with the
  // frozen predicate on each. E9-F004's lesson, applied to the other lifecycle.
  it("★ P9 — the WHOLE 4x3 table agrees with the frozen predicate, edge for edge", async () => {
    const seen: string[] = [];
    for (const from of SERVICE_DESIRED_STATES) {
      for (const to of CONTROLLABLE_DESIRED_STATES) {
        const { repos, updates } = stubRepos({ service: { desiredState: from, generation: 2 } });
        const verdict = await setServiceDesiredStateWithinTenant(repos as never, {
          organizationId: ORG, companyId: COMPANY, serviceId: SERVICE, desiredState: to,
        });
        seen.push(`${from}->${to}:${verdict.outcome}`);
        if (from === to) {
          expect(verdict.outcome, `${from}->${to}`).toBe("unchanged");
          expect(updates, `${from}->${to}`).toEqual([]);
          continue;
        }
        const legal = canTransitionServiceDesiredState(from as ServiceDesiredState, to);
        expect(verdict.outcome, `${from}->${to} (frozen says ${legal})`)
          .toBe(legal ? "updated" : "illegal");
        expect(updates.length, `${from}->${to} writes`).toBe(legal ? 1 : 0);
      }
    }
    // Anti-vacuity: the table must contain BOTH answers, or a predicate stuck on one of them
    // would pass every assertion above.
    expect(seen.filter((row) => row.endsWith(":updated")).length).toBeGreaterThan(0);
    expect(seen.filter((row) => row.endsWith(":illegal")).length).toBeGreaterThan(0);
    expect(seen).toContain("deleted->running:illegal");
    expect(seen).toContain("stopped->paused:illegal");
    expect(seen).toContain("stopped->running:updated");
  });
});

// ── The composition: desired state, THEN the graceful stop ────────────────────────────────

describe("SVC-007 — the stop control reaches the shipped cancellation channel", () => {
  beforeEach(() => {
    runInTenant.mockReset();
    runInTenantReadOnly.mockReset();
  });

  function arrange(input: {
    verdict: unknown;
    instance?: { serviceInstanceId: string; jobId: string | null } | null;
    stopThrows?: boolean;
    terminalize?: unknown;
  }) {
    // `runInTenant` is used TWICE by the composition — once for the desired-state verdict and
    // once for the control-plane attempt-terminal backstop — so the stub answers by call
    // ordinal rather than returning one value for both. A single-value stub would have made
    // the backstop's return indistinguishable from the verdict's.
    const terminalizeCalls: unknown[] = [];
    let tenantCalls = 0;
    runInTenant.mockImplementation(async (_db: unknown, _org: unknown, fn: unknown) => {
      tenantCalls += 1;
      if (tenantCalls === 1) return input.verdict;
      const repos = {
        jobControl: {
          async terminalizeServiceInstanceForCancelledAttempt(values: unknown) {
            terminalizeCalls.push(values);
            return input.terminalize ?? { outcome: "applied" };
          },
        },
      };
      return (fn as (r: unknown) => Promise<unknown>)(repos);
    });
    runInTenantReadOnly.mockImplementation(async () => input.instance ?? null);
    const calls: unknown[] = [];
    const requestGracefulStop = async (stop: unknown) => {
      calls.push(stop);
      if (input.stopThrows) throw new Error("cancellation channel unavailable");
      return { status: "cancel_requested" };
    };
    return { calls, terminalizeCalls, deps: { appDb: {} as never, requestGracefulStop } };
  }

  // ★ MUTANT: delete the `requestGracefulStop` call. The desired-state column still moves,
  // every verdict assertion above stays green, and `stop` becomes a button that does nothing.
  it("P10a — stopping a service with a live instance asks THAT instance's job to stop", async () => {
    const { calls, deps } = arrange({
      verdict: { outcome: "updated", from: "running", to: "stopped", generation: 1 },
      instance: { serviceInstanceId: "inst-1", jobId: "job-1" },
    });
    const result = await setServiceDesiredState(deps, {
      organizationId: ORG, companyId: COMPANY, serviceId: SERVICE,
      desiredState: "stopped", reason: "budget",
    });
    expect(calls).toEqual([{ organizationId: ORG, companyId: COMPANY, jobId: "job-1", reason: "budget" }]);
    expect(result.stop).toEqual({
      status: "requested", serviceInstanceId: "inst-1", jobId: "job-1",
      cancellation: "cancel_requested", instance: "applied",
    });
  });

  // ★★★ MUTANT: delete the `terminalizeServiceInstanceForCancelledAttempt` call. Every
  // assertion about the desired-state column and the cancellation stays green, and the
  // instance is stranded non-terminal inside `service_instances_live_service_uq` forever —
  // so a later resume converges NOTHING on every tick. That wedge is invisible from any test
  // that stops at "the stop request was made".
  it("★ P10a2 — the stop ALSO drives the control-plane attempt-terminal backstop, with the frozen mapping", async () => {
    const { terminalizeCalls, deps } = arrange({
      verdict: { outcome: "updated", from: "running", to: "stopped", generation: 1 },
      instance: { serviceInstanceId: "inst-1", jobId: "job-1" },
    });
    await setServiceDesiredState(deps, {
      organizationId: ORG, companyId: COMPANY, serviceId: SERVICE,
      desiredState: "stopped", reason: "budget",
    });
    expect(terminalizeCalls).toHaveLength(1);
    const call = terminalizeCalls[0] as { toStatus: string; allowedFromStatuses: string[]; jobId: string };
    expect(call.jobId).toBe("job-1");
    // The mapping is READ from the worker path's own decider, so it must equal what that
    // decider answers for the same attempt status — not a value restated here.
    const fromDecider = decideServiceProjection({ eventType: "terminal", payload: { status: "cancelled" } });
    expect(fromDecider, "the decider must project something for a cancelled attempt").not.toBeNull();
    expect(call.toStatus).toBe(fromDecider!.toStatus);
    expect(call.allowedFromStatuses).toEqual(fromDecider!.allowedFromStatuses);
    expect(call.allowedFromStatuses.length).toBeGreaterThan(0);
  });

  // ★ MUTANT: short-circuit the cancellation on `unchanged`. This is the RETRY property: the
  // two writes are in separate transactions, so a stop whose cancellation half failed leaves
  // desired_state already `stopped`. Without this arm the operator can never reach the
  // cancellation again and the button reports success while doing nothing, permanently.
  it("★ P10b — re-issuing a stop that changed nothing STILL re-requests the cancellation", async () => {
    const { calls, deps } = arrange({
      verdict: { outcome: "unchanged", state: "stopped", generation: 1 },
      instance: { serviceInstanceId: "inst-1", jobId: "job-1" },
    });
    const result = await setServiceDesiredState(deps, {
      organizationId: ORG, companyId: COMPANY, serviceId: SERVICE,
      desiredState: "stopped", reason: "retry",
    });
    expect(calls).toHaveLength(1);
    expect(result.stop?.status).toBe("requested");
  });

  // MUTANT: run the cancellation for every target state.
  it("P10c — resuming never cancels anything, and an illegal or absent verdict never does either", async () => {
    for (const verdict of [
      { outcome: "updated", from: "stopped", to: "running", generation: 1 },
      { outcome: "unchanged", state: "running", generation: 1 },
    ]) {
      const { calls, deps } = arrange({ verdict, instance: { serviceInstanceId: "i", jobId: "j" } });
      const result = await setServiceDesiredState(deps, {
        organizationId: ORG, companyId: COMPANY, serviceId: SERVICE,
        desiredState: "running", reason: "resume",
      });
      expect(calls).toEqual([]);
      expect(result.stop).toBeNull();
    }
    for (const verdict of [
      { outcome: "illegal", from: "deleted", to: "stopped" },
      { outcome: "absent" },
      { outcome: "conflict", from: "running", to: "stopped" },
    ]) {
      const { calls, deps } = arrange({ verdict, instance: { serviceInstanceId: "i", jobId: "j" } });
      const result = await setServiceDesiredState(deps, {
        organizationId: ORG, companyId: COMPANY, serviceId: SERVICE,
        desiredState: "stopped", reason: "x",
      });
      expect(calls).toEqual([]);
      expect(result.stop).toBeNull();
    }
  });

  // MUTANT: let the cancellation error propagate. The desired-state write is already
  // committed, so a 5xx would tell the operator the whole request failed while half of it
  // succeeded — and they would have no way to know which half.
  it("P10d — a failing cancellation is REPORTED, not thrown, and not disguised as success", async () => {
    const { deps } = arrange({
      verdict: { outcome: "updated", from: "running", to: "stopped", generation: 1 },
      instance: { serviceInstanceId: "inst-1", jobId: "job-1" },
      stopThrows: true,
    });
    const result = await setServiceDesiredState(deps, {
      organizationId: ORG, companyId: COMPANY, serviceId: SERVICE,
      desiredState: "stopped", reason: "x",
    });
    expect(result.verdict).toMatchObject({ outcome: "updated" });
    expect(result.stop).toEqual({ status: "failed", serviceInstanceId: "inst-1", jobId: "job-1" });
  });

  // MUTANT: treat a missing `job_id` as "already stopped". An instance whose attribution
  // write has not committed yet has no job to cancel, and saying so is the honest answer.
  it("P10e — no live instance, and an instance with no job, are distinct reported answers", async () => {
    const none = arrange({
      verdict: { outcome: "updated", from: "running", to: "stopped", generation: 1 },
      instance: null,
    });
    expect((await setServiceDesiredState(none.deps, {
      organizationId: ORG, companyId: COMPANY, serviceId: SERVICE, desiredState: "stopped", reason: "x",
    })).stop).toEqual({ status: "no_instance" });
    expect(none.calls).toEqual([]);

    const unattributed = arrange({
      verdict: { outcome: "updated", from: "running", to: "stopped", generation: 1 },
      instance: { serviceInstanceId: "inst-9", jobId: null },
    });
    expect((await setServiceDesiredState(unattributed.deps, {
      organizationId: ORG, companyId: COMPANY, serviceId: SERVICE, desiredState: "stopped", reason: "x",
    })).stop).toEqual({ status: "no_job", serviceInstanceId: "inst-9" });
    expect(unattributed.calls).toEqual([]);
  });
});
