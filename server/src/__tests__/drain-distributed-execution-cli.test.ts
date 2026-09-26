// MIG-009 (M1a) — the operator drain trigger: reachability, exit codes, the silent-cancel
// dead lever, the per-attempt atomic audit, and the per-Organization tenant scope.
//
// Everything here drives `runDrainDistributedExecutionCli` — the SAME function the
// `pnpm drain:distributed-execution` entrypoint calls — over fake-but-real-shaped deps. The
// embedded-PG arm (the real store, the real budget-cost bridge, the real requestCancellation
// and a real activity_log row) lives in job-distributed-drain.integration.test.ts.
//
// ★ `server/tsconfig.json` excludes src/__tests__, so these tests are NOT type-checked. Every
// RED here is behavioural (a wrong exit code, a missing call, a wrong row), never a compile error.
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { CancellationOutcome, CancellationStatus } from "@armyofagents/db";
import type { DistributedExecutionActiveAttempt } from "../services/job-distributed-drain.js";

// ── Reachability spy ──────────────────────────────────────────────────────────────────────────
// Wrap the REAL drain so every test still runs the shipped drainAll, and count the invocations.
// This is the assertion that separates an honest `wired` from a vacuous compose: a trigger that
// builds the drain and never calls drainAll would still satisfy the register's caller count.
const reach = vi.hoisted(() => ({ created: 0, drainAllCalls: [] as unknown[] }));
vi.mock("../services/job-distributed-drain.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../services/job-distributed-drain.js")>();
  return {
    ...mod,
    createDistributedExecutionDrain: (deps: Parameters<typeof mod.createDistributedExecutionDrain>[0]) => {
      reach.created += 1;
      const drain = mod.createDistributedExecutionDrain(deps);
      return {
        drainAll: async (options?: Parameters<typeof drain.drainAll>[0]) => {
          reach.drainAllCalls.push(options);
          return drain.drainAll(options);
        },
      };
    },
  };
});

const {
  deriveDrainCommandId,
  parseDrainOperator,
  runDrainDistributedExecutionCli,
  OPERATOR_DRAIN_REASON,
} = await import("../services/distributed-execution-drain-trigger.js");

const ORG_A = "aaaaaaaa-1111-4111-8111-111111111111";
const ORG_B = "bbbbbbbb-2222-4222-8222-222222222222";
const CO_A1 = "c1c1c1c1-1111-4111-8111-a11111111111";
const CO_A2 = "c2c2c2c2-2222-4222-8222-a22222222222";
const CO_B1 = "c3c3c3c3-3333-4333-8333-b11111111111";
const JOB_A1 = "0a000000-0000-4000-8000-0000000000a1";
const JOB_A2 = "0a000000-0000-4000-8000-0000000000a2";
const JOB_B1 = "0b000000-0000-4000-8000-0000000000b1";
const ARGV = ["node", "drain-distributed-execution", "--operator", "oncall-alice"];

type Attempt = DistributedExecutionActiveAttempt;

interface FakeRow {
  organizationId: string;
  companyId: string;
  jobId: string;
  status: string;
}

/**
 * A fake-but-real-shaped tenant database. `withTenant` opens a "transaction" bound to ONE
 * organization: cancel mutations and audit rows are buffered and COMMITTED only if the unit of
 * work resolves, and DISCARDED if it throws — the all-or-nothing contract of `runInTenant`. A
 * cancel for a job outside the bound organization reads nothing (`not_found`), which is what RLS
 * does to a mis-scoped read on the real path.
 */
function fakeFleet(opts: {
  orgs: string[];
  companies: Record<string, string[]>;
  attempts: Attempt[];
  cancelStatus?: (attempt: Attempt) => CancellationStatus;
  cancelThrows?: (attempt: { organizationId: string; jobId: string }) => boolean;
  auditThrows?: (jobId: string) => boolean;
  rollbackPending?: Set<string>;
}) {
  const jobs = new Map<string, FakeRow>(
    opts.attempts.map((a) => [a.jobId, { ...a, status: "running" }]),
  );
  const commands: Array<{ organizationId: string; jobId: string; commandId: string }> = [];
  const audit: Array<Record<string, unknown>> = [];
  const tenantCalls: Array<{ boundOrg: string; jobId: string }> = [];
  const listActiveAttemptsCalls: string[] = [];

  const withTenant = vi.fn(async <T,>(boundOrg: string, work: (scope: any) => Promise<T>): Promise<T> => {
    const pendingJobs = new Map<string, string>();
    const pendingCommands: typeof commands = [];
    const pendingAudit: typeof audit = [];
    const scope = {
      currentDatabaseTime: async () => new Date("2026-09-21T00:00:00.000Z"),
      requestCancellation: async (input: {
        organizationId: string; companyId: string; jobId: string; reason: string;
        graceful: boolean; commandId: string; now: Date;
      }): Promise<CancellationOutcome> => {
        tenantCalls.push({ boundOrg, jobId: input.jobId });
        const row = jobs.get(input.jobId);
        // RLS: a row of another organization is invisible under this tenant binding.
        if (!row || row.organizationId !== boundOrg) return { status: "not_found", command: null };
        if (opts.cancelThrows?.({ organizationId: boundOrg, jobId: input.jobId })) {
          throw Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
        }
        const status = opts.cancelStatus?.(row) ?? "queued";
        if (status === "queued") {
          pendingJobs.set(input.jobId, "cancel_requested");
          pendingCommands.push({ organizationId: boundOrg, jobId: input.jobId, commandId: input.commandId });
          return { status, command: { commandId: input.commandId } as never };
        }
        if (status === "cancelled") pendingJobs.set(input.jobId, "cancelled");
        return { status, command: null };
      },
      recordDrainAudit: async (input: Record<string, unknown>) => {
        if (opts.auditThrows?.(String(input.jobId))) throw new Error("audit insert failed");
        pendingAudit.push({ ...input, boundOrg });
      },
    };
    const result = await work(scope); // a throw here discards every pending write
    for (const [jobId, status] of pendingJobs) jobs.get(jobId)!.status = status;
    commands.push(...pendingCommands);
    audit.push(...pendingAudit);
    return result;
  });

  const pages = [opts.orgs];
  const deps = {
    listAdmittedOrganizationIds: vi.fn(async ({ afterOrganizationId }: { afterOrganizationId: string | null }) =>
      afterOrganizationId === null ? (pages[0] ?? []) : []),
    listOrganizationCompanyIds: vi.fn(async (organizationId: string) => opts.companies[organizationId] ?? []),
    listActiveAttempts: vi.fn(async (organizationId: string) => {
      listActiveAttemptsCalls.push(organizationId);
      return [...jobs.values()]
        .filter((j) => j.organizationId === organizationId && !["cancelled", "succeeded"].includes(j.status))
        .map(({ organizationId: o, companyId, jobId }) => ({ organizationId: o, companyId, jobId }));
    }),
    assertRollbackSafe: vi.fn(async (companyId: string) => {
      if (opts.rollbackPending?.has(companyId)) throw new Error("rollback pending");
    }),
    withTenant,
  };
  return { deps, jobs, commands, audit, tenantCalls, listActiveAttemptsCalls, withTenant };
}

function twoOrgFleet(overrides: Partial<Parameters<typeof fakeFleet>[0]> = {}) {
  return fakeFleet({
    orgs: [ORG_A, ORG_B],
    companies: { [ORG_A]: [CO_A1, CO_A2], [ORG_B]: [CO_B1] },
    attempts: [
      { organizationId: ORG_A, companyId: CO_A1, jobId: JOB_A1 },
      { organizationId: ORG_A, companyId: CO_A2, jobId: JOB_A2 },
      { organizationId: ORG_B, companyId: CO_B1, jobId: JOB_B1 },
    ],
    ...overrides,
  });
}

async function runCli(fleet: ReturnType<typeof fakeFleet>, io: Partial<{
  argv: string[];
  distributedExecutionEnabled: boolean;
  openPools: () => Promise<{ close(): Promise<void> } | null>;
}> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const close = vi.fn(async () => {});
  const openPools = vi.fn(io.openPools ?? (async () => ({ close })));
  const code = await runDrainDistributedExecutionCli({
    argv: io.argv ?? ARGV,
    distributedExecutionEnabled: io.distributedExecutionEnabled ?? true,
    openPools,
    composeDeps: () => fleet.deps,
    out: (line: string) => out.push(line),
    err: (line: string) => err.push(line),
  });
  return { code, out, err, openPools, close, text: [...out, ...err].join("\n") };
}

function summaryOf(out: string[]): Record<string, unknown> {
  const line = out.find((l) => l.includes('"summary"'));
  if (!line) throw new Error(`no summary line in output:\n${out.join("\n")}`);
  return JSON.parse(line).summary;
}

function orgLine(out: string[], organizationId: string): Record<string, unknown> {
  const line = out
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .find((l) => l?.organization?.organizationId === organizationId);
  if (!line) throw new Error(`no per-organization line for ${organizationId}:\n${out.join("\n")}`);
  return line.organization;
}

beforeEach(() => {
  reach.created = 0;
  reach.drainAllCalls = [];
});

describe("MIG-009 operator drain trigger (drain:distributed-execution)", () => {
  it("POSITIVE CONTROL: a clean two-Organization fleet drains every attempt and exits 0", async () => {
    const fleet = twoOrgFleet();
    const { code, out } = await runCli(fleet);

    expect(code).toBe(0);
    const summary = summaryOf(out);
    expect(summary.cancelled).toBe(3);
    expect(summary.organizationsScanned).toBe(2);
    expect(summary.skippedOrganizations).toEqual([]);
    expect(orgLine(out, ORG_A).cancelled).toBe(2);
    expect(orgLine(out, ORG_B).cancelled).toBe(1);
    for (const jobId of [JOB_A1, JOB_A2, JOB_B1]) expect(fleet.jobs.get(jobId)!.status).toBe("cancel_requested");
  });

  it("REACH: drainAll is invoked EXACTLY ONCE per CLI run, with the stable operator reason and no widened clamps", async () => {
    const fleet = twoOrgFleet();
    await runCli(fleet);

    expect(reach.created).toBe(1);
    expect(reach.drainAllCalls).toHaveLength(1);
    const options = reach.drainAllCalls[0] as { reason?: string; pageSize?: number; statementTimeoutMs?: number } | undefined;
    expect(options?.reason).toBe(OPERATOR_DRAIN_REASON);
    expect(OPERATOR_DRAIN_REASON).toMatch(/^[a-z][a-z0-9_]*$/);
    // The CLI never asks for more than the module's own ceilings.
    expect(options?.pageSize ?? 32).toBeLessThanOrEqual(32);
    expect(options?.statementTimeoutMs ?? 750).toBeLessThanOrEqual(750);
  });

  it("SILENT-CANCEL (i): a requestCancellation that THROWS for one attempt exits NON-ZERO, attributed to its org and job", async () => {
    // drainAll swallows this throw in a bare `catch {}` and still reports the org
    // `skipped: false` with an empty skip list — the dead lever the exit code must not inherit.
    const fleet = twoOrgFleet({ cancelThrows: ({ jobId }) => jobId === JOB_A2 });
    const { code, out } = await runCli(fleet);

    expect(code).not.toBe(0);
    const summary = summaryOf(out);
    expect(summary.skippedOrganizations).toEqual([]); // the service's own list is still empty…
    expect(summary.failedCancellations).toEqual([
      { organizationId: ORG_A, companyId: CO_A2, jobId: JOB_A2, error: "Error:57014" },
    ]);
    expect(orgLine(out, ORG_A).failedJobIds).toEqual([JOB_A2]);
    expect(orgLine(out, ORG_B).failedJobIds).toEqual([]);
    // …and the rest of the fleet still drained.
    expect(fleet.jobs.get(JOB_A1)!.status).toBe("cancel_requested");
    expect(fleet.jobs.get(JOB_B1)!.status).toBe("cancel_requested");
    expect(fleet.jobs.get(JOB_A2)!.status).toBe("running");
  });

  it("SILENT-CANCEL (ii) positive control: a fully successful drain whose attempts are STILL cancel_requested exits ZERO", async () => {
    // Cancellation is a REQUEST: requestCancellation returns `queued` and the attempt reads
    // `cancel_requested` (non-terminal) until the worker acts. A naive terminal-state recheck
    // would fail this clean run; the trigger must not re-read and must not fail it.
    const fleet = twoOrgFleet();
    const { code, out } = await runCli(fleet);

    expect(code).toBe(0);
    expect(summaryOf(out).failedCancellations).toEqual([]);
    // Every attempt is still non-terminal after the sweep…
    expect([...fleet.jobs.values()].every((j) => j.status === "cancel_requested")).toBe(true);
    // …and the trigger did not re-enumerate to "verify" convergence (one read per org).
    expect(fleet.listActiveAttemptsCalls).toEqual([ORG_A, ORG_B]);
  });

  it("COMMAND ID: derived deterministically from the jobId at the ADAPTER BOUNDARY, never random, never the bare jobId", async () => {
    const first = deriveDrainCommandId(JOB_A1);
    expect(first).toBe(deriveDrainCommandId(JOB_A1));
    expect(first).not.toBe(deriveDrainCommandId(JOB_A2));
    expect(first).not.toBe(JOB_A1); // namespaced: distinct from the budget bridge's `commandId: jobId`
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    // And the adapter actually PASSES the derived id — asserted on the id itself, across two runs.
    const seen: string[] = [];
    for (let run = 0; run < 2; run++) {
      const fleet = twoOrgFleet();
      await runCli(fleet);
      seen.push(...fleet.commands.filter((c) => c.jobId === JOB_A1).map((c) => c.commandId));
    }
    expect(seen).toEqual([first, first]);
  });

  it("SKIP: any skipped Organization exits NON-ZERO and the skip list is printed VERBATIM, not as a count", async () => {
    const fleet = twoOrgFleet({ rollbackPending: new Set([CO_B1]) });
    const { code, out } = await runCli(fleet);

    expect(code).not.toBe(0);
    const summary = summaryOf(out);
    expect(summary.skippedOrganizations).toEqual([ORG_B]);
    expect(summary.skippedCount).toBe(1);
    expect(orgLine(out, ORG_B)).toMatchObject({ skipped: true, reason: "rollback_pending", cancelled: 0 });
    expect(fleet.jobs.get(JOB_B1)!.status).toBe("running");
    expect(fleet.jobs.get(JOB_A1)!.status).toBe("cancel_requested");
  });

  it("FLAG-OFF: exits non-zero with an explicit message and opens NO pool", async () => {
    const fleet = twoOrgFleet();
    const { code, err, openPools } = await runCli(fleet, { distributedExecutionEnabled: false });

    expect(code).not.toBe(0);
    expect(openPools).not.toHaveBeenCalled();
    expect(reach.drainAllCalls).toHaveLength(0);
    expect(err.join("\n")).toMatch(/AOA_DISTRIBUTED_EXECUTION_ENABLED/);
  });

  it("NO POOLS: a flag-on process whose bounded pools do not open exits non-zero without draining", async () => {
    const fleet = twoOrgFleet();
    const { code } = await runCli(fleet, { openPools: async () => null });
    expect(code).not.toBe(0);
    expect(reach.drainAllCalls).toHaveLength(0);
  });

  it("ACTOR: a run without --operator is refused before any pool opens; the declared operator is validated", async () => {
    const fleet = twoOrgFleet();
    const { code, openPools } = await runCli(fleet, { argv: ["node", "drain-distributed-execution"] });
    expect(code).toBe(2);
    expect(openPools).not.toHaveBeenCalled();

    expect(parseDrainOperator(["node", "x", "--operator", "oncall-alice"])).toEqual({
      actorType: "system",
      actorId: "operator-cli:oncall-alice",
    });
    expect(parseDrainOperator(["node", "x", "--operator", "a b"])).toBeNull();
    expect(parseDrainOperator(["node", "x", "--operator", ""])).toBeNull();
    expect(parseDrainOperator(["node", "x", "--operator", "x".repeat(129)])).toBeNull();
  });

  it("AUDIT: one actor-attributed row per drained attempt, written in the SAME tenant unit of work as its cancel", async () => {
    const fleet = twoOrgFleet({
      cancelStatus: (a) => (a.jobId === JOB_A2 ? "job_terminal" : a.jobId === JOB_B1 ? "cancelled" : "queued"),
    });
    const { code } = await runCli(fleet);

    expect(code).toBe(0);
    // job_terminal mutates nothing and is not audited; queued and cancelled are.
    expect(fleet.audit).toHaveLength(2);
    const byJob = Object.fromEntries(fleet.audit.map((row) => [row.jobId, row]));
    expect(byJob[JOB_A1]).toMatchObject({
      actor: { actorType: "system", actorId: "operator-cli:oncall-alice" },
      organizationId: ORG_A,
      companyId: CO_A1,
      outcome: "queued",
      commandId: deriveDrainCommandId(JOB_A1),
      reason: OPERATOR_DRAIN_REASON,
      boundOrg: ORG_A,
    });
    expect(byJob[JOB_B1]).toMatchObject({ outcome: "cancelled", commandId: null, boundOrg: ORG_B });
  });

  it("AUDIT ATOMICITY: an audit write that fails rolls its cancel back and the attempt is reported failed (exit non-zero)", async () => {
    const fleet = twoOrgFleet({ auditThrows: (jobId) => jobId === JOB_B1 });
    const { code, out } = await runCli(fleet);

    expect(code).not.toBe(0);
    // The cancel for JOB_B1 was buffered in the same unit of work as its audit row and discarded
    // with it — never a cancelled attempt with no record of who cancelled it.
    expect(fleet.jobs.get(JOB_B1)!.status).toBe("running");
    expect(fleet.commands.some((c) => c.jobId === JOB_B1)).toBe(false);
    expect(fleet.audit.some((row) => row.jobId === JOB_B1)).toBe(false);
    expect(orgLine(out, ORG_B).failedJobIds).toEqual([JOB_B1]);
  });

  it("MULTI-TENANT: each Organization's attempts are cancelled under ITS OWN tenant binding; one org's failure is reported per-org", async () => {
    const fleet = twoOrgFleet({ cancelThrows: ({ organizationId }) => organizationId === ORG_B });
    const { code, out } = await runCli(fleet);

    // Every cancel ran bound to the attempt's own organization (a mis-scoped binding would read
    // the other tenant's job as not_found and silently drain nothing).
    expect(fleet.tenantCalls).toEqual([
      { boundOrg: ORG_A, jobId: JOB_A1 },
      { boundOrg: ORG_A, jobId: JOB_A2 },
      { boundOrg: ORG_B, jobId: JOB_B1 },
    ]);
    expect(code).not.toBe(0);
    expect(orgLine(out, ORG_A)).toMatchObject({ skipped: false, cancelled: 2, failedJobIds: [] });
    expect(orgLine(out, ORG_B)).toMatchObject({ skipped: false, cancelled: 0, failedJobIds: [JOB_B1] });
    expect(fleet.audit.map((row) => row.boundOrg)).toEqual([ORG_A, ORG_A]);
  });

  it("POOLS are closed even when the drain itself throws", async () => {
    const fleet = twoOrgFleet();
    fleet.deps.listAdmittedOrganizationIds.mockRejectedValueOnce(new Error("pool gone"));
    const { code, close } = await runCli(fleet);
    expect(code).not.toBe(0);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
