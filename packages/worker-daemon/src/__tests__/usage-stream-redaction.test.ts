import { describe, expect, it } from "vitest";

import { leaseOfferV1Schema, type WorkerEventV1 } from "@armyofagents/worker-protocol";

import { createMetrics } from "../metrics/metrics.js";
import type { Logger } from "../logging/logger.js";
import type { LeaseHandoff } from "../poll/poll-loop.js";
import { REDACTION_MARKER } from "../supervisor/redaction.js";
import { createRunCanaryCoordinator } from "../supervisor/run-canaries.js";
import {
  RUN_OUTPUT_DROPPED_METRIC,
  createRunOutputCapture,
} from "../supervisor/run-output.js";
import { createSupervisor, type RunObservation, type SupervisorDeps } from "../supervisor/supervisor.js";
import { createUsageObserver } from "../supervisor/usage-observer.js";
import { createFakeSandboxProvider } from "./support/fake-provider.js";
import { compatibleOffer } from "./support/poll-fixtures.js";
import { collectingSink, makeHandoff, SUPERVISOR_IDENTITY } from "./support/supervisor-fixtures.js";

// -----------------------------------------------------------------------------
// WRK-018 — H-04 zero tolerance: every byte of the stdout stream channel is scrubbed by
// the run's OWN per-run canaries before anything derived from it can leave the worker.
//
// ★ Why the assertions look at what `observeRun` RECEIVES and not only at the events:
// the composed usage observer emits four integers, so a canary could never appear in a
// `usage` event even with redaction deleted — an events-only assertion would stay green
// against a broken scrubber (a check that evaluates nothing). The seam's INPUT is the
// leak surface (any future observer that emitted text would ship it), so that is what
// these tests pin, and deleting the scrubber reds them (mutation M1 in the result record).
// -----------------------------------------------------------------------------

const CANARY_A = "sk-ant-api03-CANARY-AAAA-0123456789abcdef";
const CANARY_B = "sk-ant-api03-CANARY-BBBB-fedcba9876543210";

function resultLine(tokens: { i: number; o: number; c: number }, text = "done"): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: text,
    usage: { input_tokens: tokens.i, output_tokens: tokens.o, cache_read_input_tokens: tokens.c },
  });
}

/** Split `s` into chunks that break INSIDE `needle` (so a per-chunk scrub would miss it). */
function splitThrough(s: string, needle: string): string[] {
  const at = s.indexOf(needle);
  if (at < 0) throw new Error("splitThrough: needle absent");
  const cut = at + Math.floor(needle.length / 2);
  return [s.slice(0, cut), s.slice(cut)];
}

function recordingLogger(): Logger & { readonly lines: string[] } {
  const lines: string[] = [];
  const push = (a: unknown, b?: unknown): void => {
    lines.push(JSON.stringify([a, b ?? null], (_k, v) => (v instanceof Error ? String(v) : v)));
  };
  return {
    lines,
    info: push as Logger["info"],
    warn: push as Logger["warn"],
    error: push as Logger["error"],
    flush: async () => {},
  };
}

/** A second Organization's lease, parsed through the frozen schema (never hand-rolled). */
function otherOrgHandoff(): LeaseHandoff {
  const base = compatibleOffer({ leaseId: "00000000-0000-4000-8000-0000000000c5" });
  const job = base.job as Record<string, unknown>;
  const offer = leaseOfferV1Schema.parse({
    ...base,
    job: {
      ...job,
      organizationId: "00000000-0000-4000-8000-0000000000c2",
      companyId: "00000000-0000-4000-8000-0000000000c4",
      jobId: "00000000-0000-4000-8000-0000000000c3",
    },
  });
  return { offer, leaseId: String(offer.leaseId), fenceToken: String(offer.fenceToken), workloadClass: "batch" };
}

describe("WRK-018 — createRunOutputCapture (the per-run scrubber)", () => {
  it("scrubs a canary SPLIT across two chunks (per-chunk redaction would miss it)", () => {
    const cap = createRunOutputCapture({ canaries: [CANARY_A] });
    for (const c of splitThrough(`key=${CANARY_A}\nnext\n`, CANARY_A)) cap.onStdout(c);
    const { stdoutTail } = cap.close();
    expect(stdoutTail).not.toContain(CANARY_A);
    expect(stdoutTail).toBe(`key=${REDACTION_MARKER}\nnext\n`);
  });

  it("scrubs every line-segment of a MULTI-LINE canary (a PEM-shaped secret)", () => {
    const pem = "-----BEGIN KEY-----\nMIIBsecretBODYline1\nMIIBsecretBODYline2\n-----END KEY-----";
    const cap = createRunOutputCapture({ canaries: [pem] });
    cap.onStdout("leak: MIIBsecretBODYline1\nand MIIBsecretBODYline2 too\n");
    const { stdoutTail } = cap.close();
    expect(stdoutTail).not.toContain("MIIBsecretBODYline1");
    expect(stdoutTail).not.toContain("MIIBsecretBODYline2");
  });

  it("reads the canary array LIVE (seeded after construction — the coordinator's contract)", () => {
    const live: string[] = [];
    const cap = createRunOutputCapture({ canaries: live });
    cap.onStdout(`x ${CANARY_A}\n`);
    live.push(CANARY_A);
    expect(cap.close().stdoutTail).not.toContain(CANARY_A);
  });

  it("overflow keeps only WHOLE trailing lines — a canary straddling the cut cannot survive half-redacted", () => {
    const drops: string[] = [];
    const cap = createRunOutputCapture({ canaries: [CANARY_A], maxChars: 64, onDrop: (r) => drops.push(r) });
    // A long line holding the canary, then short lines; the tail bound forces a trim.
    cap.onStdout(`${"z".repeat(40)}${CANARY_A}${"z".repeat(40)}\n`);
    for (let i = 0; i < 20; i++) cap.onStdout(`line-${i}\n`);
    const { stdoutTail } = cap.close();
    expect(stdoutTail.length).toBeLessThanOrEqual(128);
    expect(stdoutTail.startsWith("line-")).toBe(true); // starts at a line boundary
    expect(stdoutTail).not.toContain("CANARY");
    expect(drops).toContain("overflow");
  });

  it("a single line longer than the bound is dropped whole, including its continuation", () => {
    const cap = createRunOutputCapture({ canaries: [], maxChars: 16 });
    cap.onStdout("a".repeat(40));
    cap.onStdout("b".repeat(40)); // still the same (dropped) line
    cap.onStdout("bb\nkept\n");
    expect(cap.close().stdoutTail).toBe("kept\n");
  });

  it("a chunk arriving AFTER close is dropped and counted, never buffered", () => {
    const drops: string[] = [];
    const cap = createRunOutputCapture({ canaries: [], onDrop: (r) => drops.push(r) });
    cap.onStdout("a\n");
    expect(cap.close().stdoutTail).toBe("a\n");
    cap.onStdout(`late ${CANARY_A}\n`);
    expect(drops).toEqual(["late_chunk"]);
  });

  it("a canary that is a SUBSTRING of the marker is scrubbed, not mistaken for a residual (Codex P2, PR #546)", () => {
    // "red"/"redacted"/"a" all occur inside «redacted»; the residual check must ignore
    // occurrences that lie wholly inside a replacement marker, or every tail is dropped.
    for (const canary of ["red", "redacted", "a"]) {
      const drops: string[] = [];
      const cap = createRunOutputCapture({ canaries: [canary], onDrop: (r) => drops.push(r) });
      cap.onStdout(`x ${canary} y\n{"type":"result"}\n`);
      const { stdoutTail } = cap.close();
      expect(drops).toEqual([]);
      expect(stdoutTail).toContain(REDACTION_MARKER);
      expect(stdoutTail.split(REDACTION_MARKER).join("")).not.toContain(canary);
    }
  });

  it("a canary EQUAL to (or containing) the marker is never excused as 'inside a marker' (Codex P2, PR #546)", () => {
    for (const canary of [REDACTION_MARKER, `x${REDACTION_MARKER}`]) {
      const drops: string[] = [];
      const cap = createRunOutputCapture({ canaries: [canary], onDrop: (r) => drops.push(r) });
      cap.onStdout(`secret=${canary}\n`);
      const { stdoutTail } = cap.close();
      expect(stdoutTail).not.toContain(canary);
      // The exact-marker canary cannot be scrubbed at all (its replacement IS itself), so the
      // tail must be refused; a canary merely CONTAINING the marker scrubs to the bare marker.
      if (canary === REDACTION_MARKER) expect(drops).toContain("unscrubbable");
    }
  });

  it("FAIL CLOSED: output that still holds a canary after scrubbing is dropped entirely", () => {
    // Longest-first single-pass scrubbing turns "wxyzq" into "w«redacted»" via the "xyzq"
    // needle AFTER the longer needle already ran — a residual the post-check must catch.
    // (Needles are deliberately NON-hex: the sequencer scrubs events with the same canaries,
    // and a hex needle such as "bc" would also rewrite random event ids and fail the run.)
    const drops: string[] = [];
    const cap = createRunOutputCapture({ canaries: ["xyzq", `w${REDACTION_MARKER}`], onDrop: (r) => drops.push(r) });
    cap.onStdout("wxyzq\n");
    const { stdoutTail } = cap.close();
    expect(stdoutTail).not.toContain(`w${REDACTION_MARKER}`);
    expect(drops).toContain("unscrubbable");
  });
});

describe("WRK-018 — the supervisor channel (fake provider lane)", () => {
  function spyObserver(): { observeRun: NonNullable<SupervisorDeps["observeRun"]>; seen: string[] } {
    const real = createUsageObserver();
    const seen: string[] = [];
    return {
      seen,
      observeRun: async (input) => {
        seen.push(input.output?.stdoutTail ?? "<no output>");
        return real(input);
      },
    };
  }

  it("★ exactly ONE usage event equal to the result line; the planted canary reaches NO event, log, or observer input", async () => {
    const stdout = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: `my key is ${CANARY_A}` }] } }),
      resultLine({ i: 111, o: 222, c: 333 }, `final answer mentions ${CANARY_A}`),
      "",
    ].join("\n");
    const chunks = splitThrough(stdout, CANARY_A);
    const delivered: string[] = [];
    const fake = createFakeSandboxProvider({
      stdoutChunks: () => {
        delivered.push(...chunks);
        return chunks;
      },
    });
    const sink = collectingSink();
    const logger = recordingLogger();
    const { observeRun, seen } = spyObserver();
    const supervisor = createSupervisor({
      provider: fake,
      identity: SUPERVISOR_IDENTITY,
      eventSink: sink,
      redactionCanaries: [],
      canaryCoordinator: createRunCanaryCoordinator(),
      materializeRunSecrets: async () => ({ env: { ANTHROPIC_API_KEY: CANARY_A }, canaries: [CANARY_A] }),
      observeRun,
      logger,
    });

    await supervisor.accept(makeHandoff());

    // Positive control: the canary really was IN the stream the provider delivered.
    expect(delivered.join("")).toContain(CANARY_A);
    const usages = sink.events.filter((e) => e.eventType === "usage");
    expect(usages).toHaveLength(1);
    const usage = usages[0];
    if (usage?.eventType === "usage") {
      expect(usage.payload).toMatchObject({ inputTokens: 111, outputTokens: 222, cachedInputTokens: 333 });
      expect(usage.payload.runtimeMillis).toBeGreaterThanOrEqual(0);
    }
    expect(sink.events.map((e) => e.eventType)).toEqual(["attempt_started", "usage", "terminal"]);
    // Zero tolerance, three surfaces.
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toContain(CANARY_A);
    expect(seen[0]).toContain(REDACTION_MARKER);
    expect(JSON.stringify(sink.events)).not.toContain(CANARY_A);
    expect(logger.lines.join("\n")).not.toContain(CANARY_A);
  });

  it("no parseable usage -> NO usage event, the run still succeeds, the missing counter fires", async () => {
    const metrics = createMetrics();
    const fake = createFakeSandboxProvider({ stdoutChunks: ["plain text, no result line\n"] });
    const sink = collectingSink();
    const supervisor = createSupervisor({
      provider: fake,
      identity: SUPERVISOR_IDENTITY,
      eventSink: sink,
      redactionCanaries: [],
      observeRun: createUsageObserver({ metrics }),
      metrics,
    });
    await supervisor.accept(makeHandoff());
    expect(sink.events.map((e) => e.eventType)).toEqual(["attempt_started", "terminal"]);
    const terminal = sink.events.at(-1);
    if (terminal?.eventType === "terminal") expect(terminal.payload.status).toBe("succeeded");
    expect(metrics.renderPrometheus()).toContain("run_usage_missing_total 1");
  });

  it("a provider that does NOT implement the channel gives a byte-identical event stream", async () => {
    const strip = (events: WorkerEventV1[]): unknown[] =>
      events.map(({ eventId: _i, occurredAt: _o, eventDigest: _d, ...rest }) => rest);
    const run = async (observeRun?: SupervisorDeps["observeRun"]): Promise<WorkerEventV1[]> => {
      const sink = collectingSink();
      const supervisor = createSupervisor({
        provider: createFakeSandboxProvider(), // never calls onStdout
        identity: SUPERVISOR_IDENTITY,
        eventSink: sink,
        redactionCanaries: [],
        ...(observeRun ? { observeRun } : {}),
      });
      await supervisor.accept(makeHandoff());
      return sink.events;
    };
    const before = await run();
    const after = await run(createUsageObserver());
    expect(strip(after)).toEqual(strip(before));
  });

  it("without observeRun the supervisor passes NO onStdout to the provider (the channel is inert)", async () => {
    let sawCallback: boolean | null = null;
    const fake = createFakeSandboxProvider({
      stdoutChunks: (input) => {
        sawCallback = true;
        return [String(input.command)];
      },
    });
    const supervisor = createSupervisor({ provider: fake, identity: SUPERVISOR_IDENTITY, eventSink: collectingSink(), redactionCanaries: [] });
    await supervisor.accept(makeHandoff());
    // The fake only consults stdoutChunks when `input.onStdout` is present.
    expect(sawCallback).toBeNull();
  });

  it("redaction drops are counted on the supervisor's metrics", async () => {
    const metrics = createMetrics();
    const fake = createFakeSandboxProvider({ stdoutChunks: ["wxyzq\n"] });
    const supervisor = createSupervisor({
      provider: fake,
      identity: SUPERVISOR_IDENTITY,
      eventSink: collectingSink(),
      redactionCanaries: ["xyzq", `w${REDACTION_MARKER}`],
      observeRun: createUsageObserver({ metrics }),
      metrics,
    });
    await supervisor.accept(makeHandoff());
    expect(metrics.renderPrometheus()).toContain(`${RUN_OUTPUT_DROPPED_METRIC}{reason="unscrubbable"} 1`);
  });
});

describe("WRK-018 — multi-tenant (F10): two Organizations' concurrent runs on ONE daemon", () => {
  it("each run's stream, canaries and usage stay inside its own attempt", async () => {
    const handoffA = makeHandoff();
    const handoffB = otherOrgHandoff();
    expect(handoffA.offer.job.organizationId).not.toBe(handoffB.offer.job.organizationId);

    const outFor = (key: string): string[] => {
      const isA = key === CANARY_A;
      const text = [
        JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: `token ${key}` }] } }),
        resultLine(isA ? { i: 1, o: 2, c: 3 } : { i: 40, o: 50, c: 60 }, `bye ${key}`),
        "",
      ].join("\n");
      return splitThrough(text, key);
    };
    const fake = createFakeSandboxProvider({ stdoutChunks: (input) => outFor(String(input.env.ANTHROPIC_API_KEY)) });
    const sink = collectingSink();
    const seenByLease = new Map<string, string>();
    const real = createUsageObserver();
    const supervisor = createSupervisor({
      provider: fake,
      identity: SUPERVISOR_IDENTITY,
      eventSink: sink,
      redactionCanaries: [],
      canaryCoordinator: createRunCanaryCoordinator(),
      materializeRunSecrets: async (h) => {
        const key = h.leaseId === handoffA.leaseId ? CANARY_A : CANARY_B;
        return { env: { ANTHROPIC_API_KEY: key }, canaries: [key] };
      },
      observeRun: async (input): Promise<RunObservation> => {
        seenByLease.set(input.handoff.leaseId, input.output?.stdoutTail ?? "");
        return real(input);
      },
    });

    // CONCURRENT: both runs are in flight together and their chunks interleave.
    await Promise.all([supervisor.accept(handoffA), supervisor.accept(handoffB)]);

    const eventsOf = (orgId: string): WorkerEventV1[] => sink.events.filter((e) => e.organizationId === orgId);
    const a = eventsOf(String(handoffA.offer.job.organizationId));
    const b = eventsOf(String(handoffB.offer.job.organizationId));
    expect(a.length + b.length).toBe(sink.events.length);

    const usageOf = (events: WorkerEventV1[]): unknown[] =>
      events.filter((e) => e.eventType === "usage").map((e) => (e.eventType === "usage" ? { ...e.payload, runtimeMillis: 0 } : null));
    // Same-tenant positive control + cross-tenant denial, per side.
    expect(usageOf(a)).toEqual([{ inputTokens: 1, outputTokens: 2, cachedInputTokens: 3, runtimeMillis: 0 }]);
    expect(usageOf(b)).toEqual([{ inputTokens: 40, outputTokens: 50, cachedInputTokens: 60, runtimeMillis: 0 }]);
    for (const e of a) expect(e.leaseId).toBe(handoffA.leaseId);
    for (const e of b) expect(e.leaseId).toBe(handoffB.leaseId);

    // Each observer saw ONLY its own run's (scrubbed) stream.
    const tailA = seenByLease.get(handoffA.leaseId) ?? "";
    const tailB = seenByLease.get(handoffB.leaseId) ?? "";
    expect(tailA).toContain('"input_tokens":1,');
    expect(tailA).not.toContain('"input_tokens":40');
    expect(tailB).toContain('"input_tokens":40');
    expect(tailB).not.toContain('"input_tokens":1,');
    for (const t of [tailA, tailB]) {
      expect(t).not.toContain(CANARY_A);
      expect(t).not.toContain(CANARY_B);
    }
    expect(JSON.stringify(sink.events)).not.toMatch(/CANARY-(AAAA|BBBB)/);
  });
});
