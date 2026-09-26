// -----------------------------------------------------------------------------
// WRK-018 slice C — the adapter-manager relay of the optional stdout stream channel, over
// the REAL gated wire (ed25519 capability, create-gate, owned-op gate) to the REAL
// E2bSandboxProvider on the key-less mock transport.
//
// ★ H-04 on the wire. Raw tenant output must never cross the wire unredacted (a ticket
// non-goal). The adapter-manager already holds the run's env — it received it on create and
// again on execute — and on this lane the run's canaries ARE exactly its env values (the
// daemon's `synthesiseRunSecrets` puts every redeemed value into `env` and nothing else). So
// the AM scrubs the captured tail with THAT REQUEST's env values, using the daemon's own
// `createRunOutputCapture` (one fail-closed implementation, not a copy), before encoding the
// response. The daemon's supervisor then scrubs again with its canaries (defence in depth).
//
// Each canary assertion reads the RAW HTTP response body, so it reds if the AM-side scrub is
// removed even though the supervisor's second scrub would hide it downstream.
// -----------------------------------------------------------------------------

import { generateKeyPairSync } from "node:crypto";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createSupervisor,
  createUsageObserver,
  type CreateSandboxSpec,
  type ProviderOpContext,
  type ResourceLabels,
} from "@armyofagents/worker-daemon";
import { E2bSandboxProvider } from "@armyofagents/sandbox-e2b-provider/e2b-provider.js";
import { MockE2bTransport } from "@armyofagents/sandbox-e2b-provider/mock-transport.js";
import {
  NetworkedProviderDriver,
  OWNED_LABELS_CAPABILITY_AUDIENCE,
  OWNED_LABELS_CAPABILITY_VERSION,
} from "@armyofagents/provider-wire";
import { signOwnedLabelsCapability } from "@armyofagents/provider-capability";

import { createProviderServer } from "../server.js";
// The worker-daemon supervisor fixtures (schema-valid handoffs), by path: test support only.
import {
  collectingSink,
  handoffLabels,
  makeHandoff,
  SUPERVISOR_IDENTITY,
} from "../../../worker-daemon/src/__tests__/support/supervisor-fixtures.js";
import { compatibleOffer } from "../../../worker-daemon/src/__tests__/support/poll-fixtures.js";

// The mock transport's reserved stream directive (`directives.ts` DIRECTIVE_KEYS.streamChunks;
// that module is not on the e2b package's export map, so the key is spelled here).
const DIRECTIVE_KEYS = { streamChunks: "__aoa_stream_chunks" } as const;
type RunCommandArgs = Parameters<MockE2bTransport["runCommand"]>;
type E2bRunCommandRequest = RunCommandArgs[0];
type E2bStreamHandlers = NonNullable<RunCommandArgs[1]>;
type E2bCommandResult = Awaited<ReturnType<MockE2bTransport["runCommand"]>>;

const MARKER = "«redacted»";
const CANARY_A = "sk-ant-api03-AM-LANE-CANARY-AAAA-1122334455";
const CANARY_B = "sk-ant-api03-AM-LANE-CANARY-BBBB-6677889900";

/** Records the stdout the provider's transport produced (the positive control) and the
 * handlers each runCommand received. */
class RecordingTransport extends MockE2bTransport {
  readonly stdoutSeen: string[] = [];
  readonly handlerArgs: Array<E2bStreamHandlers | undefined> = [];
  override async runCommand(req: E2bRunCommandRequest, handlers?: E2bStreamHandlers): Promise<E2bCommandResult> {
    this.handlerArgs.push(handlers);
    const onStdout = handlers?.onStdout;
    if (onStdout === undefined) return super.runCommand(req, handlers);
    return super.runCommand(req, {
      ...handlers,
      onStdout: (c: string) => {
        this.stdoutSeen.push(c);
        onStdout(c);
      },
    });
  }
}

const controlPlane = generateKeyPairSync("ed25519");
let transport: RecordingTransport;
let server: ReturnType<typeof createProviderServer>;
let baseUrl: string;
/** Every raw response body the AM sent for /op/execute, captured on the wire. */
let executeBodies: string[];

const wireFetch: typeof fetch = (async (url: string | URL, init?: RequestInit) => {
  const res = await fetch(url, init);
  const text = await res.text();
  if (String(url).endsWith("/op/execute")) executeBodies.push(text);
  return new Response(text, { status: res.status, headers: res.headers });
}) as typeof fetch;

async function start(gated: boolean): Promise<void> {
  transport = new RecordingTransport();
  executeBodies = [];
  const provider = new E2bSandboxProvider({ transport });
  server = createProviderServer({ provider, ...(gated ? { controlPlanePublicKey: controlPlane.publicKey } : {}) });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

function mint(labels: ResourceLabels) {
  return signOwnedLabelsCapability(
    { v: OWNED_LABELS_CAPABILITY_VERSION, audience: OWNED_LABELS_CAPABILITY_AUDIENCE, ownedLabels: labels, expiresAt: Date.now() + 3_600_000 },
    controlPlane.privateKey,
  );
}

function ctx(key: string): ProviderOpContext {
  return { deadlineMs: 5_000, idempotencyKey: key };
}

function claudeStream(canary: string, tokens: { i: number; o: number; c: number }): Array<{ stream: string; data: string }> {
  const text =
    `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: `key ${canary}` }] } })}\n` +
    `${JSON.stringify({ type: "result", result: `bye ${canary}`, usage: { input_tokens: tokens.i, output_tokens: tokens.o, cache_read_input_tokens: tokens.c } })}\n`;
  const cut = text.indexOf(canary) + 7; // split INSIDE the canary
  return [
    { stream: "stdout", data: text.slice(0, cut) },
    { stream: "stdout", data: text.slice(cut) },
  ];
}

function labelsFor(org: string, lease: string): ResourceLabels {
  return { organizationId: org, targetId: "tgt-1", workerId: "wkr-1", jobId: `job-${lease}`, attempt: 1, leaseId: lease, deviceGeneration: 7 };
}

async function createOwned(labels: ResourceLabels, env: Record<string, string>): Promise<{ driver: NetworkedProviderDriver; sandboxId: string }> {
  const driver = new NetworkedProviderDriver({ baseUrl, capability: mint(labels), fetch: wireFetch });
  const spec: CreateSandboxSpec = { resourceLabels: labels, command: "claude", args: [], env, workloadType: "batch" };
  const { sandboxId } = await driver.create(spec, ctx(`c-${labels.leaseId}`));
  return { driver, sandboxId };
}

describe("WRK-018 — adapter-manager relays the stdout channel (gated wire)", () => {
  beforeEach(() => start(true));

  it("★ the tail crosses SCRUBBED: the canary is absent from the raw HTTP response", async () => {
    const env = { ANTHROPIC_API_KEY: CANARY_A, [DIRECTIVE_KEYS.streamChunks]: JSON.stringify(claudeStream(CANARY_A, { i: 1, o: 2, c: 3 })) };
    const { driver, sandboxId } = await createOwned(labelsFor("org-a", "lease-a"), env);
    const got: string[] = [];
    await driver.execute({ sandboxId, command: "claude", args: [], env, onStdout: (c) => got.push(c) }, ctx("e-a"));

    expect(transport.stdoutSeen.join("")).toContain(CANARY_A); // positive control
    expect(executeBodies).toHaveLength(1);
    expect(executeBodies[0]).not.toContain(CANARY_A); // ZERO tolerance, on the wire itself
    expect(executeBodies[0]).toContain("stdoutTail");
    expect(got).toHaveLength(1);
    expect(got[0]).not.toContain(CANARY_A);
    expect(got[0]).toContain(MARKER);
    expect(got[0]).toContain('"input_tokens":1');
  });

  it("without the capture flag the response carries NO tail and the provider gets NO handlers", async () => {
    const env = { [DIRECTIVE_KEYS.streamChunks]: JSON.stringify(claudeStream(CANARY_A, { i: 1, o: 2, c: 3 })) };
    const { driver, sandboxId } = await createOwned(labelsFor("org-a", "lease-a"), env);
    await driver.execute({ sandboxId, command: "claude", args: [], env }, ctx("e-plain"));
    expect(executeBodies[0]).not.toContain("stdoutTail");
    expect(transport.handlerArgs).toEqual([undefined]);
  });

  it("multi-tenant (F10): two Organizations' concurrent executes each get ONLY their own scrubbed tail", async () => {
    const envA = { ANTHROPIC_API_KEY: CANARY_A, [DIRECTIVE_KEYS.streamChunks]: JSON.stringify(claudeStream(CANARY_A, { i: 1, o: 2, c: 3 })) };
    const envB = { ANTHROPIC_API_KEY: CANARY_B, [DIRECTIVE_KEYS.streamChunks]: JSON.stringify(claudeStream(CANARY_B, { i: 40, o: 50, c: 60 })) };
    const a = await createOwned(labelsFor("org-a", "lease-a"), envA);
    const b = await createOwned(labelsFor("org-b", "lease-b"), envB);
    const gotA: string[] = [];
    const gotB: string[] = [];
    await Promise.all([
      a.driver.execute({ sandboxId: a.sandboxId, command: "claude", args: [], env: envA, onStdout: (c) => gotA.push(c) }, ctx("e-a")),
      b.driver.execute({ sandboxId: b.sandboxId, command: "claude", args: [], env: envB, onStdout: (c) => gotB.push(c) }, ctx("e-b")),
    ]);
    expect(gotA.join("")).toContain('"input_tokens":1,');
    expect(gotA.join("")).not.toContain('"input_tokens":40');
    expect(gotB.join("")).toContain('"input_tokens":40');
    expect(gotB.join("")).not.toContain('"input_tokens":1,');
    for (const body of executeBodies) {
      expect(body).not.toContain(CANARY_A);
      expect(body).not.toContain(CANARY_B);
    }
    // Cross-tenant: org-a's capability cannot execute (and so cannot read) org-b's sandbox.
    await expect(
      a.driver.execute({ sandboxId: b.sandboxId, command: "claude", args: [], env: envA, onStdout: () => {} }, ctx("e-x")),
    ).rejects.toThrow();
  });
});

describe("WRK-018 — keyless (ungated) raw execute handler relays the same way", () => {
  beforeEach(() => start(false));

  it("scrubs the tail on the ungated route too", async () => {
    const env = { ANTHROPIC_API_KEY: CANARY_A, [DIRECTIVE_KEYS.streamChunks]: JSON.stringify(claudeStream(CANARY_A, { i: 7, o: 8, c: 9 })) };
    const driver = new NetworkedProviderDriver({ baseUrl, fetch: wireFetch });
    const { sandboxId } = await driver.create(
      { resourceLabels: labelsFor("org-a", "lease-a"), command: "claude", args: [], env, workloadType: "batch" },
      ctx("c-1"),
    );
    const got: string[] = [];
    await driver.execute({ sandboxId, command: "claude", args: [], env, onStdout: (c) => got.push(c) }, ctx("e-1"));
    expect(transport.stdoutSeen.join("")).toContain(CANARY_A);
    expect(executeBodies[0]).not.toContain(CANARY_A);
    expect(got.join("")).toContain('"input_tokens":7');
  });
});

describe("WRK-018 — the networked LANE end to end: real supervisor -> makeRunProvider -> gated AM -> E2B", () => {
  beforeEach(() => start(true));

  function otherOrgHandoff() {
    // `makeHandoff` parses through the frozen `leaseOfferV1Schema`; the offer-level override
    // replaces the whole job with a second Organization's copy.
    const job = compatibleOffer().job as Record<string, unknown>;
    return makeHandoff({
      leaseId: "00000000-0000-4000-8000-0000000000c5",
      job: {
        ...job,
        organizationId: "00000000-0000-4000-8000-0000000000c2",
        companyId: "00000000-0000-4000-8000-0000000000c4",
        jobId: "00000000-0000-4000-8000-0000000000c3",
      },
    });
  }

  it("★ each Organization's run emits exactly ONE usage event equal to its own result line; no canary anywhere", async () => {
    const handoffA = makeHandoff();
    const handoffB = otherOrgHandoff();
    const labelsA = handoffLabels();
    const labelsB: ResourceLabels = {
      ...labelsA,
      organizationId: String(handoffB.offer.job.organizationId),
      jobId: String(handoffB.offer.job.jobId),
      leaseId: handoffB.leaseId,
    };
    const perLease = new Map([
      [handoffA.leaseId, { canary: CANARY_A, labels: labelsA, tokens: { i: 11, o: 22, c: 33 } }],
      [handoffB.leaseId, { canary: CANARY_B, labels: labelsB, tokens: { i: 44, o: 55, c: 66 } }],
    ]);
    const sink = collectingSink();
    const tails = new Map<string, string>();
    const usage = createUsageObserver();
    const supervisor = createSupervisor({
      makeRunProvider: ({ capability }) =>
        new NetworkedProviderDriver({ baseUrl, capability: capability as never, fetch: wireFetch }),
      identity: SUPERVISOR_IDENTITY,
      eventSink: sink,
      redactionCanaries: [],
      materializeRunSecrets: async (h) => {
        const run = perLease.get(h.leaseId)!;
        return {
          env: { ANTHROPIC_API_KEY: run.canary, [DIRECTIVE_KEYS.streamChunks]: JSON.stringify(claudeStream(run.canary, run.tokens)) },
          canaries: [run.canary],
          capability: mint(run.labels) as never,
        };
      },
      observeRun: async (input) => {
        tails.set(input.handoff.leaseId, input.output?.stdoutTail ?? "");
        return usage(input);
      },
    });

    await Promise.all([supervisor.accept(handoffA), supervisor.accept(handoffB)]);

    for (const [leaseId, run] of perLease) {
      const events = sink.events.filter((e) => e.leaseId === leaseId);
      expect(events.every((e) => e.organizationId === run.labels.organizationId)).toBe(true);
      const usages = events.filter((e) => e.eventType === "usage");
      expect(usages).toHaveLength(1);
      const u = usages[0];
      if (u?.eventType === "usage") {
        expect(u.payload).toMatchObject({ inputTokens: run.tokens.i, outputTokens: run.tokens.o, cachedInputTokens: run.tokens.c });
      }
      const terminal = events.at(-1);
      if (terminal?.eventType === "terminal") expect(terminal.payload.status).toBe("succeeded");
      expect(tails.get(leaseId)).not.toMatch(/AM-LANE-CANARY/);
    }
    expect(transport.stdoutSeen.join("")).toContain(CANARY_A); // positive control
    expect(transport.stdoutSeen.join("")).toContain(CANARY_B);
    expect(JSON.stringify(sink.events)).not.toMatch(/AM-LANE-CANARY/);
    for (const body of executeBodies) expect(body).not.toMatch(/AM-LANE-CANARY/);
  });
});
