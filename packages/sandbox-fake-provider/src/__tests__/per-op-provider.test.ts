// DEP-019 — the reference provider on the AUTHORITATIVE per-op port.
//
// This is the face a DEPLOYED worker reaches, through `NetworkedProviderDriver` and the
// adapter-manager's `createProviderServer`. What it must get right is the small set of things the
// worker and the ownership gate actually depend on:
//   1. `create` stamps the run's ownership labels and `inspect` returns them UNCHANGED — the gate
//      compares them field-for-field against the run's capability, so a mangled label is a refused
//      run, not a wrong answer;
//   2. `create` is idempotent on `idempotencyKey` — a lost response must not leave two sandboxes;
//   3. `execute` runs the scripted command and streams the transcript;
//   4. `list` is scoped to the coarse ownership selector and does not leak another worker's
//      sandbox — the cross-tenant case, at the provider;
//   5. `destroy`/`reconcile_cleanup` are idempotent — the cleanup ladder re-drives;
//   6. every OPTIONAL op is refused explicitly, never silently successful.

import { describe, expect, it } from "vitest";

import { UnsupportedProviderOperation, createFakeSandboxProviderPort } from "../index.js";

const LABELS_A = {
  organizationId: "0d016a00-0000-4000-8000-00000000000a",
  targetId: "target-a",
  workerId: "worker-a",
  jobId: "job-a",
  attempt: 1,
  leaseId: "lease-a",
  deviceGeneration: 3,
};
const LABELS_B = { ...LABELS_A, organizationId: "0d016b00-0000-4000-8000-00000000000b", workerId: "worker-b", jobId: "job-b", leaseId: "lease-b" };

const ctx = (idempotencyKey: string, deadlineMs = 60_000) => ({ deadlineMs, idempotencyKey });

function spec(labels: typeof LABELS_A, args: readonly string[] = []) {
  return { resourceLabels: labels, command: "claude", args, env: { ANTHROPIC_API_KEY: "sk-own" }, workloadType: "batch" };
}

describe("per-op reference provider — ownership labels (DEP-019)", () => {
  it("create stamps the labels and inspect returns them UNCHANGED", async () => {
    const p = createFakeSandboxProviderPort();
    const created = await p.create(spec(LABELS_A), ctx("k1"));
    expect(created.resourceLabels).toEqual(LABELS_A);
    const inspected = await p.inspect(created.sandboxId);
    expect(inspected.resourceLabels).toEqual(LABELS_A);
    expect(inspected.sandboxId).toBe(created.sandboxId);
    expect(inspected.generation).toBe(LABELS_A.deviceGeneration);
    expect(inspected.state).toBe("running");
  });

  it("create is idempotent on the idempotency key — one lost response, one sandbox", async () => {
    const p = createFakeSandboxProviderPort();
    const first = await p.create(spec(LABELS_A), ctx("same-key"));
    const replay = await p.create(spec(LABELS_A), ctx("same-key"));
    expect(replay.sandboxId).toBe(first.sandboxId);
    const listed = await p.list({ ownershipSelector: LABELS_A, pageSize: 50 });
    expect(listed.resources).toHaveLength(1);
  });

  it("a DIFFERENT key creates a second sandbox (the idempotency is not a global singleton)", async () => {
    const p = createFakeSandboxProviderPort();
    const first = await p.create(spec(LABELS_A), ctx("k1"));
    const second = await p.create(spec(LABELS_A), ctx("k2"));
    expect(second.sandboxId).not.toBe(first.sandboxId);
  });
});

describe("per-op reference provider — list is ownership-scoped (DEP-019)", () => {
  it("another worker's sandbox is NOT listed, with the owner's own as the positive control", async () => {
    const p = createFakeSandboxProviderPort();
    const a = await p.create(spec(LABELS_A), ctx("ka"));
    await p.create(spec(LABELS_B), ctx("kb"));
    const own = await p.list({ ownershipSelector: LABELS_A, pageSize: 50 });
    expect(own.resources.map((r) => r.sandboxId)).toEqual([a.sandboxId]);
    const foreign = await p.list({ ownershipSelector: { ...LABELS_A, workerId: "someone-else" }, pageSize: 50 });
    expect(foreign.resources).toEqual([]);
  });
});

describe("per-op reference provider — execute (DEP-019)", () => {
  it("runs the scripted command and streams the transcript", async () => {
    const p = createFakeSandboxProviderPort();
    const created = await p.create(spec(LABELS_A), ctx("k"));
    const chunks: string[] = [];
    const result = await p.execute(
      { sandboxId: created.sandboxId, command: "claude", args: [], env: {}, onStdout: (c) => chunks.push(c) },
      ctx("ke"),
    );
    expect(result).toMatchObject({ exitCode: 0, timedOut: false, signal: null });
    expect(result.stdoutRef).toBe(`ref:stdout:${created.sandboxId}`);
    expect(chunks.join("")).toContain('"type":"result"');
  });

  it("the scripted args steer it: --aoa-fake-usage=suppressed removes the result line", async () => {
    const p = createFakeSandboxProviderPort();
    const created = await p.create(spec(LABELS_A), ctx("k"));
    const chunks: string[] = [];
    await p.execute(
      { sandboxId: created.sandboxId, command: "claude", args: ["--aoa-fake-usage=suppressed"], env: {}, onStdout: (c) => chunks.push(c) },
      ctx("ke"),
    );
    expect(chunks.join("")).not.toContain('"type":"result"');
  });

  it("an unknown sandbox is a NOT-FOUND throw, never a successful execute", async () => {
    const p = createFakeSandboxProviderPort();
    await expect(p.execute({ sandboxId: "nope", command: "claude", args: [], env: {} }, ctx("k"))).rejects.toThrow(
      /sandbox not found/,
    );
  });
});

describe("per-op reference provider — cleanup is idempotent (DEP-019)", () => {
  it("destroy twice is success twice, and the sandbox leaves the listing", async () => {
    const p = createFakeSandboxProviderPort();
    const created = await p.create(spec(LABELS_A), ctx("k"));
    expect((await p.destroy(created.sandboxId)).cleanupStatus).toBe("success");
    expect((await p.destroy(created.sandboxId)).cleanupStatus).toBe("success");
    expect((await p.reconcileCleanup(created.sandboxId)).cleanupStatus).toBe("success");
    expect((await p.list({ ownershipSelector: LABELS_A, pageSize: 50 })).resources).toEqual([]);
  });

  it("cancel and kill stop the sandbox", async () => {
    const p = createFakeSandboxProviderPort();
    const created = await p.create(spec(LABELS_A), ctx("k"));
    expect((await p.cancel(created.sandboxId)).outcome).toBe("stopped");
    expect((await p.kill(created.sandboxId)).outcome).toBe("stopped");
    expect((await p.inspect(created.sandboxId)).state).toBe("stopped");
  });
});

describe("per-op reference provider — the optional ops are REFUSED, never silently ok (DEP-019)", () => {
  it.each(["checkpoint", "restore", "health", "digestArtifact", "exportArtifact", "stageFiles", "startProcess", "processStatus", "signalProcess"])(
    "%s throws UnsupportedProviderOperation",
    (op) => {
      const p = createFakeSandboxProviderPort() as unknown as Record<string, () => unknown>;
      expect(() => p[op]!()).toThrow(UnsupportedProviderOperation);
    },
  );
});

describe("per-op reference provider — an EMPTY idempotency key is not a key (DEP-019)", () => {
  // ★ A LIVE DEFECT, not a hypothetical. `gateCreate` calls
  // `provider.create(spec, { ...ctx, idempotencyKey: "" })` on purpose — its header records that
  // stripping the key makes the durable ledger the sole idempotency authority. So every gated
  // create arrives with the SAME empty key. Keying the replay map on it handed the second run the
  // first run's sandbox, whose ownership labels belong to another lease; the gate refused it and
  // the D1 run died `create_failed` / `errorClass: "other"`. Caught by the live lane, pinned here.
  it("two creates with an EMPTY key are two DISTINCT sandboxes, each with its own labels", async () => {
    const p = createFakeSandboxProviderPort();
    const first = await p.create(spec(LABELS_A), { deadlineMs: 60_000, idempotencyKey: "" });
    const second = await p.create(spec(LABELS_B), { deadlineMs: 60_000, idempotencyKey: "" });
    expect(second.sandboxId).not.toBe(first.sandboxId);
    expect(second.resourceLabels).toEqual(LABELS_B);
    expect((await p.inspect(second.sandboxId)).resourceLabels).toEqual(LABELS_B);
    expect((await p.inspect(first.sandboxId)).resourceLabels).toEqual(LABELS_A);
  });

  it("a NON-empty key still replays — the guard narrows the empty case only", async () => {
    const p = createFakeSandboxProviderPort();
    const first = await p.create(spec(LABELS_A), ctx("k"));
    expect((await p.create(spec(LABELS_A), ctx("k"))).sandboxId).toBe(first.sandboxId);
  });
});
