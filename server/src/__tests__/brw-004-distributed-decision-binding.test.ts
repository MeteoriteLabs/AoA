// BRW-004 slice (d) / E8-F002 — the distributed (agent-less, run-less) runtime decision.
//
// ★★★ WHY THIS FILE IS MOSTLY POSITIVE CONTROLS. Relaxing `agent_id` / `run_id` to nullable is
// a two-line schema change with EIGHT downstream hazards, and the design named exactly one of
// them (the timeout sweeper's `runCanceller`). Six more were found by measuring, and two of
// those — the createPrompt zombie-run guard and the answerPrompt liveness gate — would have
// shipped an approval feature that REFUSES EVERY ONE OF ITS OWN PROMPTS at creation and
// REJECTS EVERY ANSWER, with a completely green typecheck, because `getRunStatus(null)` finds
// no row and both guards read "no row" as "the run is terminal".
//
// That is the shape this programme calls its worst: a guard that cannot pass looks exactly
// like a guard that works. So every case below comes in a pair — the distributed arm takes the
// new branch, and the LEGACY arm proves the guard it skips still fires for a heartbeat run. A
// test that only shows the null path succeeding cannot tell "correctly skipped" from
// "accidentally disabled for everyone".
import { describe, expect, it, vi } from "vitest";
import {
  agentRuntimeDecisionService,
  runtimeDecisionSourceUniqueKey,
  DISTRIBUTED_RUN_SENTINEL,
} from "../services/agent-runtime-decisions.js";

const now = () => new Date("2026-09-04T12:00:00.000Z");
const LEGACY_RUN = "11111111-1111-4111-8111-111111111111";

function baseDecision(overrides: Record<string, unknown> = {}) {
  return {
    id: "decision-1",
    companyId: "company-1",
    agentId: "agent-1",
    runId: LEGACY_RUN,
    adapterType: "claude_local",
    adapterSessionId: null,
    adapterSessionParams: null,
    kind: "permission",
    status: "shown",
    nonce: "nonce-1",
    sourceRevision: 2,
    promptHash: "hash-1",
    sourceUniqueKey: "k",
    title: "Allow navigation?",
    summary: null,
    promptText: null,
    toolName: null,
    command: null,
    commandHash: null,
    cwd: null,
    path: null,
    networkTarget: "https://site.test",
    riskClass: "network_egress",
    options: null,
    expiresAt: new Date("2026-09-04T12:15:00.000Z"),
    timeoutPolicy: "deny",
    decision: null,
    answerPayload: null,
    answerIdempotencyKey: null,
    answeredByUserId: null,
    answeredAt: null,
    relayedAt: null,
    relayError: null,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function makeService(repoOverrides: Record<string, unknown> = {}, depOverrides: Record<string, unknown> = {}) {
  const repo = {
    createDecision: vi.fn(async (input) => baseDecision(input as Record<string, unknown>)),
    getDecision: vi.fn(async () => baseDecision()),
    listActiveForRun: vi.fn(async () => []),
    getRunStatus: vi.fn(async () => "running" as string | null),
    listTrustRules: vi.fn(async () => []),
    createTrustRule: vi.fn(async () => ({})),
    revokeTrustRule: vi.fn(async () => ({})),
    markTrustRuleUsed: vi.fn(async () => {}),
    updateDecision: vi.fn(async (_id, patch) => baseDecision(patch as Record<string, unknown>)),
    answerWithTrustRule: vi.fn(async (_id, patch) => ({ decision: baseDecision(patch as Record<string, unknown>), rule: {} })),
    listDueForExpiry: vi.fn(async () => []),
    listStrandedAnswers: vi.fn(async () => []),
    ...repoOverrides,
  };
  const hubItems = {
    emit: vi.fn(async () => ({ id: "hub-1", version: 0 })),
    reconcile: vi.fn(async () => ({ healed: 0, closed: 0, refreshed: 0 })),
  };
  const runCanceller = (depOverrides.runCanceller as unknown) ?? vi.fn(async () => {});
  const service = agentRuntimeDecisionService({} as never, {
    repo: repo as never,
    hubItems: hubItems as never,
    activityLogger: vi.fn(async () => {}),
    runCanceller: runCanceller as never,
    now,
  });
  return { service, repo, hubItems, runCanceller };
}

const distributedPrompt = {
  companyId: "company-1",
  agentId: null,
  runId: null,
  adapterType: "claude_local",
  kind: "permission" as const,
  nonce: "nonce-browser-1",
  title: "Allow navigation to https://site.test?",
  networkTarget: "https://site.test",
  riskClass: "network_egress",
  timeoutPolicy: "deny" as const,
};

describe("E8-F002 — the source identity is null-safe and stays byte-identical across both implementations", () => {
  it("a legacy run renders exactly as it always did", () => {
    // The format for a non-null run is UNCHANGED, or every existing row's dedupe key moves.
    expect(runtimeDecisionSourceUniqueKey({ companyId: "c", runId: LEGACY_RUN, nonce: "n" })).toBe(
      `runtime:c:${LEGACY_RUN}:n`,
    );
  });

  it("a distributed decision renders an explicit sentinel, never the string \"null\"", () => {
    // Template-interpolating a null would have produced "runtime:c:null:n" — an identity that
    // works by accident and breaks the moment anyone edits the template.
    expect(runtimeDecisionSourceUniqueKey({ companyId: "c", runId: null, nonce: "n" })).toBe(
      `runtime:c:${DISTRIBUTED_RUN_SENTINEL}:n`,
    );
    expect(runtimeDecisionSourceUniqueKey({ companyId: "c", runId: null, nonce: "n" })).not.toContain("null");
  });

  it("★ the bridge's INDEPENDENT copy of the rule produces the same bytes, including for null", () => {
    // `job-approval-bridge.ts` computes this identity itself and must not import the service.
    // Two implementations bound only by a comment is a divergence waiting to happen, and
    // making runId nullable is exactly the edit that could have diverged them silently.
    const bridgeCopy = (companyId: string, runId: string | null, nonce: string) =>
      `runtime:${companyId}:${runId ?? DISTRIBUTED_RUN_SENTINEL}:${nonce}`;
    for (const runId of [LEGACY_RUN, null]) {
      expect(bridgeCopy("company-1", runId, "n1")).toBe(
        runtimeDecisionSourceUniqueKey({ companyId: "company-1", runId, nonce: "n1" }),
      );
    }
  });
});

describe("E8-F002 — createPrompt's zombie-run guard is SKIPPED without a run, and still fires with one", () => {
  it("a distributed prompt is created without consulting run status", async () => {
    const { service, repo } = makeService();
    const result = await service.createPrompt(distributedPrompt);
    expect(result.decision).toBeTruthy();
    // The load-bearing assertion: the guard was not merely satisfied, it was not RUN.
    expect(repo.getRunStatus).not.toHaveBeenCalled();
    expect(repo.createDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: null,
        runId: null,
        sourceUniqueKey: `runtime:company-1:${DISTRIBUTED_RUN_SENTINEL}:nonce-browser-1`,
      }),
    );
  });

  // ★★ POSITIVE CONTROL. Without this, "the guard was skipped for a null run" and "the guard
  // was disabled for everyone" are the same green test — and the second is a real regression
  // that would let a zombie CLI mint decisions against a cancelled run.
  it("POSITIVE CONTROL — a LEGACY prompt against a terminal run is still refused", async () => {
    const { service, repo } = makeService({ getRunStatus: vi.fn(async () => "cancelled") });
    await expect(
      service.createPrompt({ ...distributedPrompt, agentId: "agent-1", runId: LEGACY_RUN }),
    ).rejects.toThrow(/run is terminal/);
    expect(repo.getRunStatus).toHaveBeenCalledWith(LEGACY_RUN);
  });

  it("POSITIVE CONTROL — a LEGACY prompt against a live run is created, and DOES consult run status", async () => {
    const { service, repo } = makeService();
    await service.createPrompt({ ...distributedPrompt, agentId: "agent-1", runId: LEGACY_RUN });
    expect(repo.getRunStatus).toHaveBeenCalledWith(LEGACY_RUN);
  });
});

describe("E8-F002 — the hub projection drops the type CLAIM with the referent", () => {
  it("a distributed decision projects no heartbeat_run relation and no agent actor", async () => {
    const { service, hubItems } = makeService();
    await service.createPrompt(distributedPrompt);
    const emitted = (hubItems.emit as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Record<string, unknown>;
    // A hub item declaring relatedEntityType "heartbeat_run" with a null id is a row that lies
    // quietly. `relatedEntityId` is a nullable column and the ancestry lookup is guarded, so
    // nothing would have crashed — which is exactly why this needs an assertion.
    expect(emitted.relatedEntityType).toBeUndefined();
    expect(emitted.relatedEntityId).toBeUndefined();
    expect(emitted.sourceActorType).toBeUndefined();
    expect(emitted.sourceActorId).toBeUndefined();
  });

  // ★ POSITIVE CONTROL — the legacy projection is unchanged. Otherwise the fix above could
  // have been "stop projecting the relation at all", which would silently break every
  // heartbeat-run hub item's deep link.
  it("POSITIVE CONTROL — a LEGACY decision still projects the heartbeat_run relation and agent actor", async () => {
    const { service, hubItems } = makeService();
    await service.createPrompt({ ...distributedPrompt, agentId: "agent-1", runId: LEGACY_RUN });
    const emitted = (hubItems.emit as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Record<string, unknown>;
    expect(emitted.relatedEntityType).toBe("heartbeat_run");
    expect(emitted.relatedEntityId).toBe(LEGACY_RUN);
    expect(emitted.sourceActorType).toBe("agent");
    expect(emitted.sourceActorId).toBe("agent-1");
  });
});

describe("E8-F002 — the timeout sweeper never aims a heartbeat cancellation at a run that does not exist", () => {
  const dueDistributed = () =>
    baseDecision({
      agentId: null,
      runId: null,
      status: "shown",
      timeoutPolicy: "cancel_run",
      expiresAt: new Date("2026-09-04T11:00:00.000Z"),
    });

  it("a distributed decision expires WITHOUT calling the run canceller", async () => {
    const cancel = vi.fn(async () => {});
    const { service } = makeService(
      {
        listDueForExpiry: vi.fn(async () => [dueDistributed()]),
        updateDecision: vi.fn(async (_id, patch) => baseDecision({ ...(patch as Record<string, unknown>), agentId: null, runId: null })),
      },
      { runCanceller: cancel },
    );
    const { processed } = await service.expireDuePrompts({ limit: 10 });
    expect(processed).toBe(1);
    // A cancellation aimed at a null run would be swallowed by the surrounding catch and be
    // indistinguishable from a successful cancel — a dead lever with a green test.
    expect(cancel).not.toHaveBeenCalled();
  });

  // ★ POSITIVE CONTROL — the same policy on a LEGACY decision DOES cancel. Without it, the
  // fix above is indistinguishable from having disabled run cancellation entirely.
  it("POSITIVE CONTROL — a LEGACY cancel_run expiry still cancels its run", async () => {
    const cancel = vi.fn(async () => {});
    const due = baseDecision({
      status: "shown",
      timeoutPolicy: "cancel_run",
      expiresAt: new Date("2026-09-04T11:00:00.000Z"),
    });
    const { service } = makeService(
      {
        listDueForExpiry: vi.fn(async () => [due]),
        updateDecision: vi.fn(async (_id, patch) => baseDecision(patch as Record<string, unknown>)),
      },
      { runCanceller: cancel },
    );
    await service.expireDuePrompts({ limit: 10 });
    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ runId: LEGACY_RUN }));
  });
});

describe("E8-F002 — answerPrompt's liveness gate is SKIPPED without a run, and still fires with one", () => {
  const distributedRow = () => baseDecision({ agentId: null, runId: null, status: "shown" });

  it("a founder can answer a distributed decision", async () => {
    // With the gate unguarded this path called `getRunStatus(null)`, read "no row" as
    // "terminal", cancelled the decision and threw 409 — so a browser prompt could be raised
    // and never answered. The prompt would exist; the answer would be impossible.
    const { service, repo } = makeService({
      getDecision: vi.fn(async () => distributedRow()),
      updateDecision: vi.fn(async (_id, patch) => baseDecision({ ...(patch as Record<string, unknown>), agentId: null, runId: null })),
    });
    const result = await service.answerPrompt({
      companyId: "company-1",
      decisionId: "decision-1",
      actorUserId: "founder-1",
      expectedSourceRevision: 2,
      nonce: "nonce-1",
      kind: "permission",
      decision: "allow_once",
      idempotencyKey: "answer-d1",
    });
    expect(result).toBeTruthy();
    expect(repo.getRunStatus).not.toHaveBeenCalled();
  });

  // ★★ POSITIVE CONTROL — the gate still protects a LEGACY answer whose run went terminal.
  // Without it, "skipped for a null run" and "removed for everyone" are the same green test,
  // and the second reintroduces the forever-stalled ghost the gate was added to prevent.
  it("POSITIVE CONTROL — a LEGACY answer against a terminal run is still refused", async () => {
    const { service, repo } = makeService({
      getDecision: vi.fn(async () => baseDecision({ status: "shown" })),
      getRunStatus: vi.fn(async () => "cancelled"),
    });
    await expect(
      service.answerPrompt({
        companyId: "company-1",
        decisionId: "decision-1",
        actorUserId: "founder-1",
        expectedSourceRevision: 2,
        nonce: "nonce-1",
        kind: "permission",
        decision: "allow_once",
        idempotencyKey: "answer-l1",
      }),
    ).rejects.toThrow(/run ended before the answer could be delivered/);
    expect(repo.getRunStatus).toHaveBeenCalledWith(LEGACY_RUN);
  });
});
