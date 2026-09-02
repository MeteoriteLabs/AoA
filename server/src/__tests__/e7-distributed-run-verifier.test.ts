// evidence-verifier A — the E7-1 distributed-run promotion gate (design v2, §4).
//
// PURE store-fixture units — no embedded-PG, no drizzle — exactly like
// cli-006-canary-preflight.test.ts. Each fixture reddens for EXACTLY ONE clause
// (the anti-vacuity invariant): (b)->1, (c)->2, (d)->3, (e)/(f)->4, (g)/(h)->5.
//
// Clause 5 is the load-bearing anti-false-PASS clause: a distributed HANDOFF that no
// worker ever leased terminalizes carrying every mark clauses 1-4 check, so fixture
// (g) is the v1 false-PASS this whole verifier exists to catch.

import { describe, expect, it } from "vitest";
import {
  createE7DistributedRunVerifier,
  e7VerifyExitCode,
  formatVerifyResult,
  detectHardLeakClasses,
  type E7RunVerifierStore,
  type E7RunRow,
  type E7AttemptRow,
  type E7LeaseRow,
  type E7JobEventRow,
  type E7AttemptTerminalReceiptRow,
  type E7ScanSurface,
} from "../services/e7-distributed-run-verifier.js";
import { redactSecretsInString } from "../redaction.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY = "22222222-2222-4222-8222-222222222222";
const OTHER_COMPANY = "99999999-9999-4999-8999-999999999999";
const ORG = "33333333-3333-4333-8333-333333333333";
const JOB_ID = "44444444-4444-4444-8444-444444444444";
const ATTEMPT_ID = "55555555-5555-4555-8555-555555555555";
const LEASE_ID = "66666666-6666-4666-8666-666666666666";

// Leak-class values the CHOSEN hard matcher actually catches (anti-vacuity — the
// programme's signature defect is a clause-4 fixture that plants a value nothing
// matches). Each is asserted against the real matcher in its own test's setup.
const PROVIDER_KEY_LEAK = "sk-ant-api03ABCDEFabcdef0123456789"; // provider-key class
const E2B_KEY_VALUE = "e2b_0123456789abcdefghijKLMN"; // e2b_ + >=16 alnum
const E2B_LEAK_LINE = `E2B_API_KEY=${E2B_KEY_VALUE}`; // literal assignment + value
// A BARE e2b_ key with NO `E2B_API_KEY=` prefix — exercises the `e2b_key` value arm
// in ISOLATION (the assignment arm cannot fire on it), so deleting that arm reddens.
const BARE_E2B_VALUE = "e2b_0123456789abcdefghijMNOP";
const BROAD_ONLY_TOKEN = "sess_abcdefghij0123456789ABCD"; // pattern-7 broad, NOT a hard class

function run(overrides: Partial<E7RunRow> = {}): E7RunRow {
  return {
    id: RUN_ID,
    companyId: COMPANY,
    executionOwner: "distributed",
    distributedJobId: JOB_ID,
    distributedAttemptId: ATTEMPT_ID,
    status: "cancelled",
    errorCode: null,
    error: null,
    finishedAt: new Date("2026-08-28T00:00:00.000Z"),
    ...overrides,
  };
}

function attempt(overrides: Partial<E7AttemptRow> = {}): E7AttemptRow {
  return {
    id: ATTEMPT_ID,
    organizationId: ORG,
    companyId: COMPANY,
    jobId: JOB_ID,
    status: "cancelled",
    ...overrides,
  };
}

function lease(overrides: Partial<E7LeaseRow> = {}): E7LeaseRow {
  return { id: LEASE_ID, companyId: COMPANY, status: "revoked", ...overrides };
}

function event(eventType: string, overrides: Partial<E7JobEventRow> = {}): E7JobEventRow {
  return {
    eventId: `event-${eventType}`,
    companyId: COMPANY,
    eventType,
    payload: { type: eventType },
    ...overrides,
  };
}

function receipt(overrides: Partial<E7AttemptTerminalReceiptRow> = {}): E7AttemptTerminalReceiptRow {
  return { projectionKind: "attempt_terminal", status: "applied", companyId: COMPANY, ...overrides };
}

interface GoldenParts {
  runRow?: E7RunRow;
  attemptRow?: E7AttemptRow | null;
  leases?: E7LeaseRow[];
  events?: E7JobEventRow[];
  terminalReceipt?: E7AttemptTerminalReceiptRow | null;
  surfaces?: E7ScanSurface[];
  produced?: { workspacePatchArtifacts: number; taskOutputs: number };
}

// Fixture (a): the golden journey — distributed owner, both ids, cancelled+finished,
// a leased+started+projected+revoked attempt, clean surfaces.
function goldenStore(parts: GoldenParts = {}): E7RunVerifierStore {
  const runRow = parts.runRow ?? run();
  const attemptRow = parts.attemptRow === undefined ? attempt() : parts.attemptRow;
  const leases = parts.leases ?? [lease()];
  const events = parts.events ?? [event("attempt_started"), event("log"), event("terminal")];
  const terminalReceipt = parts.terminalReceipt === undefined ? receipt() : parts.terminalReceipt;
  const surfaces = parts.surfaces ?? [];
  const produced = parts.produced ?? { workspacePatchArtifacts: 1, taskOutputs: 1 };
  return {
    getRun: async (id) => (id === runRow.id ? runRow : null),
    getAttempt: async (id) => (attemptRow && id === attemptRow.id ? attemptRow : null),
    listLeases: async () => leases,
    listJobEvents: async () => events,
    getAttemptTerminalReceipt: async () => terminalReceipt,
    listRunSecretScanSurfaces: async () => surfaces,
    countProducedOutputs: async () => produced,
  };
}

function clauses(result: { failures: readonly { clause: number }[] }): Set<number> {
  return new Set(result.failures.map((f) => f.clause));
}

describe("evidence-verifier A — fixture table (design §4, one clause per fixture)", () => {
  it("(a) golden distributed journey PASSES", async () => {
    const verifier = createE7DistributedRunVerifier({ store: goldenStore() });
    const result = await verifier.verify({ runId: RUN_ID });
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.observed.executionOwner).toBe("distributed");
    expect(result.observed.leaseCount).toBe(1);
    expect(result.observed.attemptStartedEvents).toBe(1);
    expect(result.observed.terminalEvents).toBe(1);
    expect(result.observed.projectionReceiptApplied).toBe(true);
    expect(result.observed.organizationId).toBe(ORG);
  });

  it("(b) execution_owner=null FAILS clause 1 only", async () => {
    const verifier = createE7DistributedRunVerifier({
      store: goldenStore({ runRow: run({ executionOwner: null }) }),
    });
    const result = await verifier.verify({ runId: RUN_ID });
    expect(result.ok).toBe(false);
    expect(clauses(result)).toEqual(new Set([1]));
  });

  it("(c) a distributed id null FAILS clause 2 only", async () => {
    const verifier = createE7DistributedRunVerifier({
      store: goldenStore({ runRow: run({ distributedAttemptId: null }) }),
    });
    const result = await verifier.verify({ runId: RUN_ID });
    expect(result.ok).toBe(false);
    expect(clauses(result)).toEqual(new Set([2]));
  });

  it("(d) status=running, finished_at=null FAILS clause 3 only", async () => {
    const verifier = createE7DistributedRunVerifier({
      store: goldenStore({ runRow: run({ status: "running", finishedAt: null }) }),
    });
    const result = await verifier.verify({ runId: RUN_ID });
    expect(result.ok).toBe(false);
    expect(clauses(result)).toEqual(new Set([3]));
  });

  it("(e) a job_events log payload leaking a provider key FAILS clause 4 only", async () => {
    // Anti-vacuity: the planted value MUST trip the real matcher.
    expect(redactSecretsInString(PROVIDER_KEY_LEAK)).not.toBe(PROVIDER_KEY_LEAK);
    const verifier = createE7DistributedRunVerifier({
      store: goldenStore({
        events: [
          event("attempt_started"),
          event("log", { eventId: "leaky-log", payload: { line: `authenticating with ${PROVIDER_KEY_LEAK}` } }),
          event("terminal"),
        ],
      }),
    });
    const result = await verifier.verify({ runId: RUN_ID });
    expect(result.ok).toBe(false);
    expect(clauses(result)).toEqual(new Set([4]));
    const c4 = result.failures.find((f) => f.clause === 4)!;
    expect(c4.reason).toContain("job_events");
    expect(c4.reason).not.toContain(PROVIDER_KEY_LEAK); // never quote the match
  });

  it("(f) stdout_excerpt leaking an E2B key FAILS clause 4, and the raw value appears NOWHERE", async () => {
    // Anti-vacuity: the line trips A's explicit E2B arms — the bare `e2b_<16+>` key AND the
    // literal `E2B_API_KEY=` assignment (the assignment arm catches an E2B key regardless of
    // the value's shape, which is exactly why A carries it rather than leaning on the heuristic).
    const verifier = createE7DistributedRunVerifier({
      store: goldenStore({
        surfaces: [{ surface: "heartbeat_runs", fieldOrEventId: "stdout_excerpt", text: E2B_LEAK_LINE }],
      }),
    });
    const result = await verifier.verify({ runId: RUN_ID });
    expect(result.ok).toBe(false);
    expect(clauses(result)).toEqual(new Set([4]));
    const printed = formatVerifyResult(result);
    for (const blob of [JSON.stringify(result), printed]) {
      expect(blob).not.toContain(E2B_KEY_VALUE);
      expect(blob).not.toContain(E2B_LEAK_LINE);
    }
  });

  it("(g) THE v1 false-PASS: a never-leased handoff FAILS clause 5 only", async () => {
    const verifier = createE7DistributedRunVerifier({
      store: goldenStore({ leases: [], events: [], terminalReceipt: null }),
    });
    const result = await verifier.verify({ runId: RUN_ID });
    expect(result.ok).toBe(false);
    expect(clauses(result)).toEqual(new Set([5]));
    expect(result.observed.leaseCount).toBe(0);
  });

  it("(h) a cross-tenant attempt row FAILS clause 5 only (tenant)", async () => {
    const verifier = createE7DistributedRunVerifier({
      store: goldenStore({ attemptRow: attempt({ companyId: OTHER_COMPANY }) }),
    });
    const result = await verifier.verify({ runId: RUN_ID });
    expect(result.ok).toBe(false);
    expect(clauses(result)).toEqual(new Set([5]));
  });

  it("(i) an absent run returns notFound, no throw", async () => {
    const verifier = createE7DistributedRunVerifier({ store: goldenStore() });
    const result = await verifier.verify({ runId: "00000000-0000-4000-8000-000000000000" });
    expect(result.ok).toBe(false);
    expect(result.notFound).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("(j) a durable FAILED terminal PASSES; observed surfaces the status", async () => {
    const verifier = createE7DistributedRunVerifier({
      store: goldenStore({
        runRow: run({ status: "failed", error: "coding CLI exited 1", errorCode: "nonzero_exit" }),
        attemptRow: attempt({ status: "failed" }),
        leases: [lease({ status: "released" })], // not cancelled → no revoked requirement
        events: [event("attempt_started"), event("terminal")],
      }),
    });
    const result = await verifier.verify({ runId: RUN_ID });
    expect(result.ok).toBe(true);
    expect(result.observed.status).toBe("failed");
    expect(result.observed.errorCode).toBe("nonzero_exit");
  });
});

describe("evidence-verifier A — clause 5 corroboration edges", () => {
  it("a cancelled terminal WITHOUT a revoked lease FAILS clause 5 (fence not revoked)", async () => {
    const verifier = createE7DistributedRunVerifier({
      store: goldenStore({ leases: [lease({ status: "released" })] }),
    });
    const result = await verifier.verify({ runId: RUN_ID });
    expect(result.ok).toBe(false);
    expect(clauses(result)).toEqual(new Set([5]));
  });

  it("a missing attempt_started event FAILS clause 5", async () => {
    const verifier = createE7DistributedRunVerifier({
      store: goldenStore({ events: [event("log"), event("terminal")] }),
    });
    const result = await verifier.verify({ runId: RUN_ID });
    expect(result.ok).toBe(false);
    expect(clauses(result)).toEqual(new Set([5]));
  });

  it("a pending (not applied) terminal projection receipt FAILS clause 5", async () => {
    const verifier = createE7DistributedRunVerifier({
      store: goldenStore({ terminalReceipt: receipt({ status: "pending" }) }),
    });
    const result = await verifier.verify({ runId: RUN_ID });
    expect(result.ok).toBe(false);
    expect(clauses(result)).toEqual(new Set([5]));
    expect(result.observed.projectionReceiptApplied).toBe(false);
  });

  it("a cross-tenant terminal receipt FAILS clause 5", async () => {
    const verifier = createE7DistributedRunVerifier({
      store: goldenStore({ terminalReceipt: receipt({ companyId: OTHER_COMPANY }) }),
    });
    const result = await verifier.verify({ runId: RUN_ID });
    expect(result.ok).toBe(false);
    expect(clauses(result)).toEqual(new Set([5]));
  });

  it("an attempt whose job_id does not match the run's distributed_job_id FAILS clause 5", async () => {
    const verifier = createE7DistributedRunVerifier({
      store: goldenStore({ attemptRow: attempt({ jobId: "77777777-7777-4777-8777-777777777777" }) }),
    });
    const result = await verifier.verify({ runId: RUN_ID });
    expect(result.ok).toBe(false);
    expect(clauses(result)).toEqual(new Set([5]));
  });
});

describe("evidence-verifier A — clause 4 leak specificity + no-leak invariant", () => {
  it("a broad <prefix>_<20+> token is ADVISORY, not a hard fail", async () => {
    // It must NOT trip a hard class — else this would test the wrong thing.
    const verifier = createE7DistributedRunVerifier({
      store: goldenStore({
        surfaces: [{ surface: "task_outputs", fieldOrEventId: "summary", text: `session ${BROAD_ONLY_TOKEN}` }],
      }),
    });
    const result = await verifier.verify({ runId: RUN_ID });
    expect(result.ok).toBe(true); // advisory does NOT fail the gate
    expect(result.observed.suspectedHeuristicHits.length).toBeGreaterThanOrEqual(1);
    const hit = result.observed.suspectedHeuristicHits[0];
    expect(hit.surface).toBe("task_outputs");
    expect(JSON.stringify(result)).not.toContain(BROAD_ONLY_TOKEN); // still never quoted
  });

  it("a BARE e2b_ key (no E2B_API_KEY= prefix) FAILS clause 4 via the e2b_key value arm in isolation", async () => {
    // Anti-vacuity: the bare value trips the `e2b_key` value arm and NOT the
    // assignment arm — so deleting the `e2b_key` matcher makes this fixture redden
    // (without it, the earlier E2B fixtures still pass via the assignment arm).
    expect(detectHardLeakClasses(BARE_E2B_VALUE)).toContain("e2b_key");
    expect(detectHardLeakClasses(BARE_E2B_VALUE)).not.toContain("e2b_api_key_assignment");
    expect(detectHardLeakClasses(BARE_E2B_VALUE)).not.toContain("provider_key");
    const verifier = createE7DistributedRunVerifier({
      store: goldenStore({
        events: [
          event("attempt_started"),
          event("log", { eventId: "bare-e2b", payload: { note: `spawned sandbox ${BARE_E2B_VALUE}` } }),
          event("terminal"),
        ],
      }),
    });
    const result = await verifier.verify({ runId: RUN_ID });
    expect(result.ok).toBe(false);
    expect(clauses(result)).toEqual(new Set([4]));
    expect(JSON.stringify(result)).not.toContain(BARE_E2B_VALUE);
  });

  it("a connection-string URI in a scan surface FAILS clause 4", async () => {
    const conn = "postgresql://user:hunter2@db.internal:5432/app";
    const verifier = createE7DistributedRunVerifier({
      store: goldenStore({
        surfaces: [{ surface: "heartbeat_runs", fieldOrEventId: "error", text: `connect failed: ${conn}` }],
      }),
    });
    const result = await verifier.verify({ runId: RUN_ID });
    expect(result.ok).toBe(false);
    expect(clauses(result)).toEqual(new Set([4]));
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });

  it("no planted secret from ANY hard surface appears in the result or printed output", async () => {
    const verifier = createE7DistributedRunVerifier({
      store: goldenStore({
        events: [
          event("attempt_started"),
          event("log", { eventId: "leaky", payload: { key: PROVIDER_KEY_LEAK } }),
          event("terminal"),
        ],
        surfaces: [{ surface: "heartbeat_runs", fieldOrEventId: "detected_outputs", text: E2B_LEAK_LINE }],
      }),
    });
    const result = await verifier.verify({ runId: RUN_ID });
    // Positive control: the scanner MUST have actually fired clause 4 — otherwise the
    // absence assertions below would pass vacuously (nothing matched, nothing to leak).
    expect(result.ok).toBe(false);
    expect(result.failures.filter((f) => f.clause === 4).length).toBeGreaterThanOrEqual(2);
    const printed = formatVerifyResult(result);
    for (const blob of [JSON.stringify(result), printed]) {
      expect(blob).not.toContain(PROVIDER_KEY_LEAK);
      expect(blob).not.toContain(E2B_KEY_VALUE);
    }
  });
});

describe("evidence-verifier A — expected org/company assertion + read-only surface", () => {
  it("an expected companyId that mismatches the run FAILS (identity)", async () => {
    const verifier = createE7DistributedRunVerifier({ store: goldenStore() });
    const result = await verifier.verify({ runId: RUN_ID, expected: { companyId: OTHER_COMPANY } });
    expect(result.ok).toBe(false);
  });

  it("an expected organizationId that mismatches the attempt FAILS (identity)", async () => {
    const verifier = createE7DistributedRunVerifier({ store: goldenStore() });
    const result = await verifier.verify({
      runId: RUN_ID,
      expected: { organizationId: "88888888-8888-4888-8888-888888888888" },
    });
    expect(result.ok).toBe(false);
  });

  it("matching expected org + company still PASSES the golden run", async () => {
    const verifier = createE7DistributedRunVerifier({ store: goldenStore() });
    const result = await verifier.verify({ runId: RUN_ID, expected: { organizationId: ORG, companyId: COMPANY } });
    expect(result.ok).toBe(true);
  });

  // The port type exposes only reads, so "no mutation" is a compile-time guarantee.
  // What this test guards is that verify() drops NO evidence source — if it stopped
  // consulting one (e.g. listLeases), the called-set would shrink and this reddens.
  it("consults all 7 read evidence sources and drops none", async () => {
    const calls: string[] = [];
    const base = goldenStore();
    const store: E7RunVerifierStore = {
      getRun: async (...a) => (calls.push("getRun"), base.getRun(...a)),
      getAttempt: async (...a) => (calls.push("getAttempt"), base.getAttempt(...a)),
      listLeases: async (...a) => (calls.push("listLeases"), base.listLeases(...a)),
      listJobEvents: async (...a) => (calls.push("listJobEvents"), base.listJobEvents(...a)),
      getAttemptTerminalReceipt: async (...a) => (calls.push("getAttemptTerminalReceipt"), base.getAttemptTerminalReceipt(...a)),
      listRunSecretScanSurfaces: async (...a) => (calls.push("listRunSecretScanSurfaces"), base.listRunSecretScanSurfaces(...a)),
      countProducedOutputs: async (...a) => (calls.push("countProducedOutputs"), base.countProducedOutputs(...a)),
    };
    await createE7DistributedRunVerifier({ store }).verify({ runId: RUN_ID });
    expect(new Set(calls)).toEqual(
      new Set([
        "getRun",
        "getAttempt",
        "listLeases",
        "listJobEvents",
        "getAttemptTerminalReceipt",
        "listRunSecretScanSurfaces",
        "countProducedOutputs",
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// E7-F003 — the capability blind spot, PINNED ON PURPOSE.
//
// ★ DO NOT "FIX" THIS DESCRIBE BLOCK. It asserts today's behaviour deliberately,
// exactly as the MIG-010 Unit 2.2 repro did: it is the record of what the verifier
// could not see. `ok` answers "was the distributed journey corroborated" — the
// MECHANISM — and a context-free run corroborates that journey perfectly well.
// Making `ok` false here would be the naive fix CLI-008 Unit A explicitly rejects
// (`producedArtifacts` is structurally 0 until Unit F ships output capture, so a
// clause folded into `ok` is a gate nobody can pass — and a permanently-red gate
// gets bypassed, argued around, or deleted).
//
// If this block reddens, someone folded capability into `ok`. Read
// `docs/replatform/qa/2026-09-02-cli-008-unit-a-verifier-clause-plan.md` §"The
// design decision" before changing anything.
// ---------------------------------------------------------------------------
describe("evidence-verifier A — E7-F003 blind spot (pinned: today's verifier blesses a context-free run)", () => {
  // A run whose sandbox agent had no tools, no identity, no workspace and a
  // context-free prompt, and whose CLI exited 127 — yet a worker leased it,
  // started it, terminalized it, and the projector applied the receipt. Every
  // existing clause is satisfied; NOTHING the agent did reached AoA.
  function contextFreeRunStore() {
    return goldenStore({
      runRow: run({ status: "failed", errorCode: "nonzero_exit", error: "claude: command not found (exit 127)" }),
      attemptRow: attempt({ status: "failed" }),
      leases: [lease({ status: "released" })],
      events: [event("attempt_started"), event("terminal")],
      produced: { workspacePatchArtifacts: 0, taskOutputs: 0 },
    });
  }

  it("a context-free run that produced NOTHING satisfies every clause and PASSES (this is the defect)", async () => {
    const verifier = createE7DistributedRunVerifier({ store: contextFreeRunStore() });
    const result = await verifier.verify({ runId: RUN_ID });
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("the produced-output counts are VISIBLE and INERT — the signal exists and changes nothing", async () => {
    const verifier = createE7DistributedRunVerifier({ store: contextFreeRunStore() });
    const result = await verifier.verify({ runId: RUN_ID });
    // The pairing IS the finding: the verifier computed the number that would
    // catch this, reported it, and let the run through anyway.
    expect(result.observed.producedArtifacts).toEqual({ workspacePatchArtifacts: 0, taskOutputs: 0 });
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CLI-008 Unit A — the capability dimension, and the three properties that make
// it real (plan Task 4). Each is a mutation target, named in the test.
// ---------------------------------------------------------------------------
describe("evidence-verifier A — clause 6: capability, a dimension separate from ok", () => {
  const NOTHING_PRODUCED = { workspacePatchArtifacts: 0, taskOutputs: 0 };

  it("a context-free run is capabilityProven=false with exactly one clause-6 failure", async () => {
    const verifier = createE7DistributedRunVerifier({ store: goldenStore({ produced: NOTHING_PRODUCED }) });
    const result = await verifier.verify({ runId: RUN_ID });
    // MUTATION 1: delete the capability computation and this reddens, while the
    // E7-F003 pin above stays green. If nothing reds, the dimension is decorative.
    expect(result.capabilityProven).toBe(false);
    expect(result.capabilityFailures.map((f) => f.clause)).toEqual([6]);
    // The reason must teach an operator what is UNBUILT, not restate that a count was 0.
    expect(result.capabilityFailures[0].reason).toContain("Unit F");
    expect(result.capabilityFailures[0].reason).toContain("observeRun");
  });

  it("the capability failure NEVER enters failures, so ok stays true", async () => {
    const verifier = createE7DistributedRunVerifier({ store: goldenStore({ produced: NOTHING_PRODUCED }) });
    const result = await verifier.verify({ runId: RUN_ID });
    // MUTATION 2: push the capability failure into `failures` instead and BOTH this
    // and the E7-F003 pin redden. This is the guard against the exact regression the
    // design rejects — `producedArtifacts` is structurally 0 until Unit F, so a
    // capability clause folded into `ok` makes E7-1 permanently red.
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.failures.some((f) => f.clause === 6)).toBe(false);
  });

  // MUTATION 3, both arms: a dimension that can never be true is not a check.
  it("a committed workspace_patch artifact ALONE flips capabilityProven true", async () => {
    const verifier = createE7DistributedRunVerifier({
      store: goldenStore({ produced: { workspacePatchArtifacts: 1, taskOutputs: 0 } }),
    });
    const result = await verifier.verify({ runId: RUN_ID });
    expect(result.capabilityProven).toBe(true);
    expect(result.capabilityFailures).toEqual([]);
  });

  it("a task_output ALONE flips capabilityProven true", async () => {
    const verifier = createE7DistributedRunVerifier({
      store: goldenStore({ produced: { workspacePatchArtifacts: 0, taskOutputs: 1 } }),
    });
    const result = await verifier.verify({ runId: RUN_ID });
    expect(result.capabilityProven).toBe(true);
    expect(result.capabilityFailures).toEqual([]);
  });

  it("a mechanism FAILURE does not suppress the capability verdict (both dimensions, always)", async () => {
    const verifier = createE7DistributedRunVerifier({
      store: goldenStore({ leases: [], events: [], terminalReceipt: null, produced: NOTHING_PRODUCED }),
    });
    const result = await verifier.verify({ runId: RUN_ID });
    expect(result.ok).toBe(false);
    expect(result.capabilityProven).toBe(false);
    expect(formatVerifyResult(result)).toContain("capability: NOT PROVEN");
  });

  it("an absent run is capabilityProven=false — a run that does not exist proved nothing", async () => {
    const verifier = createE7DistributedRunVerifier({ store: goldenStore() });
    const result = await verifier.verify({ runId: "00000000-0000-4000-8000-000000000000" });
    expect(result.notFound).toBe(true);
    expect(result.capabilityProven).toBe(false);
  });
});

describe("evidence-verifier A — the RESULT line cannot be quoted as capability", () => {
  it("a mechanism-PASS with capability unproven says so ON THE RESULT LINE", async () => {
    const verifier = createE7DistributedRunVerifier({
      store: goldenStore({ produced: { workspacePatchArtifacts: 0, taskOutputs: 0 } }),
    });
    const result = await verifier.verify({ runId: RUN_ID });
    expect(result.ok).toBe(true);
    const resultLine = formatVerifyResult(result)
      .split("\n")
      .find((l) => l.includes("RESULT:"))!;
    // The property (plan Task 3 Step 1): a reader who sees ONLY this line must not
    // come away believing capability was proven. So PASS is never unqualified, and
    // the capability verdict travels with it.
    expect(resultLine).toContain("NOT PROVEN");
    expect(resultLine).toContain("mechanism");
    expect(resultLine).not.toContain("RESULT: PASS —"); // the old unqualified wording
  });

  it("the counts are printed with the verdict, on a passing run", async () => {
    const verifier = createE7DistributedRunVerifier({
      store: goldenStore({ produced: { workspacePatchArtifacts: 2, taskOutputs: 3 } }),
    });
    const printed = formatVerifyResult(await verifier.verify({ runId: RUN_ID }));
    expect(printed).toContain("capability: PROVEN (workspace_patch_artifacts=2 task_outputs=3)");
    expect(printed).toContain("RESULT: PASS (mechanism)");
  });
});

describe("evidence-verifier A — the --require-capability exit decision", () => {
  // ★ THIS TABLE EXISTS BECAUSE OF WHAT THIS UNIT IS. Unit A stops a claim from living only in
  // prose. A `--require-capability` flag whose enforcing branch is exercised by nothing would
  // reproduce that exact shape one level up: everyone believes it gates the campaign, and
  // nothing checks that it does. The decision is pure, so all four rows are reachable without
  // a live DATABASE_URL.
  const cases: ReadonlyArray<[boolean, boolean, boolean, 0 | 1 | 3]> = [
    // ok,  capabilityProven, requireCapability, expected
    [true, true, false, 0],
    [true, false, false, 0], // today's real run: mechanism green, capability unproven, not required
    [true, false, true, 3], // ★ the branch the campaign flips at Unit F
    [false, false, true, 1], // a mechanism failure OUTRANKS the capability flag
  ];

  for (const [ok, capabilityProven, requireCapability, expected] of cases) {
    it(`ok=${ok} capabilityProven=${capabilityProven} requireCapability=${requireCapability} -> exit ${expected}`, () => {
      expect(e7VerifyExitCode({ ok, capabilityProven }, requireCapability)).toBe(expected);
    });
  }

  it("3 is distinct from 1, so a campaign script can tell the two failures apart", () => {
    // "the journey did not happen" and "the journey happened and proved nothing about the
    // agent" call for different next steps; collapsing them would hide the second.
    expect(e7VerifyExitCode({ ok: false, capabilityProven: false }, true)).toBe(1);
    expect(e7VerifyExitCode({ ok: true, capabilityProven: false }, true)).toBe(3);
  });
});
