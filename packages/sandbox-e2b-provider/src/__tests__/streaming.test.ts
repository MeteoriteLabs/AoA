import { describe, expect, it } from "vitest";

import {
  createSupervisor,
  createUsageObserver,
  type ResourceLabels,
} from "@armyofagents/worker-daemon";

import { MockE2bTransport } from "../mock-transport.js";
import { DIRECTIVE_KEYS, METADATA_KEYS, decodeStreamChunks } from "../directives.js";
import { E2bSandboxProvider } from "../e2b-provider.js";
import type { E2bRunCommandRequest, E2bStreamHandlers, E2bCommandResult } from "../transport.js";
// WRK-018 — the worker-daemon supervisor fixtures (schema-valid lease handoffs), by path:
// they are test support, not package surface.
import {
  collectingSink,
  makeHandoff,
  SUPERVISOR_IDENTITY,
} from "../../../worker-daemon/src/__tests__/support/supervisor-fixtures.js";

/** The fixed scrub marker (mirrors worker-daemon's REDACTION_MARKER). */
const REDACTION_MARKER = "«redacted»";

const LABELS: ResourceLabels = {
  organizationId: "org-1",
  targetId: "tgt-1",
  workerId: "wkr-1",
  jobId: "job-1",
  attempt: 1,
  leaseId: "lease-1",
  deviceGeneration: 1,
};

/** Records what `runCommand` was handed and what it streamed to stdout. */
class RecordingTransport extends MockE2bTransport {
  readonly handlerArgs: Array<E2bStreamHandlers | undefined> = [];
  readonly argCounts: number[] = [];
  readonly stdoutSeen: string[] = [];
  override async runCommand(req: E2bRunCommandRequest, ...rest: [E2bStreamHandlers?]): Promise<E2bCommandResult> {
    this.argCounts.push(1 + rest.length);
    const handlers = rest[0];
    this.handlerArgs.push(handlers);
    if (handlers?.onStdout === undefined) return super.runCommand(req, ...rest);
    const onStdout = handlers.onStdout;
    return super.runCommand(req, {
      ...handlers,
      onStdout: (c: string) => {
        this.stdoutSeen.push(c);
        onStdout(c);
      },
    });
  }
}

// -----------------------------------------------------------------------------
// CLI-003/D1 — the streaming exec seam on `E2bTransport.runCommand`, proven WITHOUT
// a key against the deterministic MockE2bTransport.
//
// Before CLI-003 `runCommand` returned only `{exitCode,signal,timedOut,crashed}` —
// no stdout/stderr stream — so a coding run's output was uncapturable no-key. This
// suite proves: (1) the mock replays deterministic stdout/stderr chunks (from the
// reserved `__aoa_stream_chunks` directive) to the `onStdout`/`onStderr` callbacks,
// in order; (2) the `E2bCommandResult` shape is UNCHANGED; (3) absent handlers /
// absent directive is a benign no-op.
// -----------------------------------------------------------------------------

async function createSandbox(transport: MockE2bTransport): Promise<string> {
  const { sandboxId } = await transport.create({
    templateId: "base",
    timeoutMs: 60_000,
    metadata: { [METADATA_KEYS.env]: "{}" },
    envVars: {},
  });
  return sandboxId;
}

describe("CLI-003/D1 — streaming exec seam (mock transport, no key)", () => {
  it("replays deterministic stdout/stderr chunks to the handlers, in order", async () => {
    const transport = new MockE2bTransport();
    const sandboxId = await createSandbox(transport);

    const stdout: string[] = [];
    const stderr: string[] = [];
    const chunks = [
      { stream: "stdout", data: "building...\n" },
      { stream: "stderr", data: "warning: deprecated\n" },
      { stream: "stdout", data: "done\n" },
    ];
    const result = await transport.runCommand(
      {
        sandboxId,
        command: "codex",
        args: ["exec"],
        envVars: { [DIRECTIVE_KEYS.streamChunks]: JSON.stringify(chunks) },
        timeoutMs: 30_000,
      },
      { onStdout: (c) => stdout.push(c), onStderr: (c) => stderr.push(c) },
    );

    expect(stdout).toEqual(["building...\n", "done\n"]);
    expect(stderr).toEqual(["warning: deprecated\n"]);
    // The command result shape is unchanged (no stream fields leaked into it).
    expect(result).toEqual({ exitCode: 0, signal: null, timedOut: false, crashed: false });
  });

  it("is a benign no-op with no handlers and no directive", async () => {
    const transport = new MockE2bTransport();
    const sandboxId = await createSandbox(transport);
    const result = await transport.runCommand({
      sandboxId,
      command: "sh",
      args: ["-c", "true"],
      envVars: {},
      timeoutMs: 30_000,
    });
    expect(result).toEqual({ exitCode: 0, signal: null, timedOut: false, crashed: false });
  });

  it("does not stream on a crash/timeout run (chunks skipped like fs-writes)", async () => {
    const transport = new MockE2bTransport();
    const sandboxId = await createSandbox(transport);
    const stdout: string[] = [];
    const result = await transport.runCommand(
      {
        sandboxId,
        command: "codex",
        args: [],
        envVars: {
          [DIRECTIVE_KEYS.lifecycleFault]: "crash",
          [DIRECTIVE_KEYS.streamChunks]: JSON.stringify([{ stream: "stdout", data: "x" }]),
        },
        timeoutMs: 30_000,
      },
      { onStdout: (c) => stdout.push(c) },
    );
    expect(stdout).toEqual([]);
    expect(result.crashed).toBe(true);
  });

  it("decodeStreamChunks tolerates garbage (benign empty default)", () => {
    expect(decodeStreamChunks(undefined)).toEqual([]);
    expect(decodeStreamChunks("not-json")).toEqual([]);
    expect(decodeStreamChunks(JSON.stringify([{ stream: "bogus", data: "x" }]))).toEqual([]);
    expect(decodeStreamChunks(JSON.stringify([{ stream: "stdout", data: 5 }]))).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// WRK-018 slice B — the provider port's OPTIONAL stdout stream channel, carried through
// `E2bSandboxProvider.execute` onto the transport's `onStdout` handler (which existed since
// CLI-003/D1 but which `execute` never passed). Then the E2B LANE end to end: the real
// supervisor over this provider + the mock transport's stream directive, with a planted
// canary, must emit exactly one usage event and let the canary reach nothing.
// -----------------------------------------------------------------------------

describe("WRK-018 — E2bSandboxProvider.execute carries the stdout channel", () => {
  const RESULT = JSON.stringify({ type: "result", usage: { input_tokens: 12, output_tokens: 34, cache_read_input_tokens: 56 } });

  async function providerWithSandbox(): Promise<{ transport: RecordingTransport; provider: E2bSandboxProvider; sandboxId: string }> {
    const transport = new RecordingTransport();
    const provider = new E2bSandboxProvider({ transport });
    const created = await provider.create(
      { resourceLabels: LABELS, command: "claude", args: [], env: {}, workloadType: "batch" },
      { deadlineMs: 30_000, idempotencyKey: "c-1" },
    );
    return { transport, provider, sandboxId: created.sandboxId };
  }

  it("forwards each stdout chunk, in order, to input.onStdout (stderr is NOT carried)", async () => {
    const { provider, sandboxId } = await providerWithSandbox();
    const got: string[] = [];
    const chunks = [
      { stream: "stdout", data: '{"type":"assistant"}\n' },
      { stream: "stderr", data: "warn\n" },
      { stream: "stdout", data: `${RESULT}\n` },
    ];
    const result = await provider.execute(
      { sandboxId, command: "claude", args: [], env: { [DIRECTIVE_KEYS.streamChunks]: JSON.stringify(chunks) }, onStdout: (c) => got.push(c) },
      { deadlineMs: 30_000, idempotencyKey: "e-1" },
    );
    expect(got).toEqual(['{"type":"assistant"}\n', `${RESULT}\n`]);
    expect(result.exitCode).toBe(0);
    // The result shape is unchanged: refs only, no bytes.
    expect(Object.keys(result).sort()).toEqual(["exitCode", "providerOpId", "signal", "stderrRef", "stdoutRef", "timedOut"]);
  });

  it("without onStdout the transport gets NO handlers (byte-identical to the pre-channel call)", async () => {
    const { transport, provider, sandboxId } = await providerWithSandbox();
    await provider.execute(
      { sandboxId, command: "claude", args: [], env: { [DIRECTIVE_KEYS.streamChunks]: JSON.stringify([{ stream: "stdout", data: "x" }]) } },
      { deadlineMs: 30_000, idempotencyKey: "e-2" },
    );
    expect(transport.handlerArgs).toEqual([undefined]);
    expect(transport.argCounts).toEqual([1]);
  });
});

describe("WRK-018 — E2B lane end to end (real supervisor + E2bSandboxProvider + mock transport)", () => {
  const CANARY = "sk-ant-api03-E2B-LANE-CANARY-9f8e7d6c5b4a";

  it("★ exactly ONE usage event equal to the result line; the planted canary reaches no event, log or observer input", async () => {
    const assistant = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: `key ${CANARY}` }] } });
    const result = JSON.stringify({ type: "result", result: `bye ${CANARY}`, usage: { input_tokens: 101, output_tokens: 202, cache_read_input_tokens: 303 } });
    const stream = `${assistant}\n${result}\n`;
    const cut = stream.indexOf(CANARY) + 10; // split INSIDE the canary
    const chunks = [
      { stream: "stdout", data: stream.slice(0, cut) },
      { stream: "stdout", data: stream.slice(cut) },
    ];
    const transport = new RecordingTransport();
    const provider = new E2bSandboxProvider({ transport });
    const sink = collectingSink();
    const logLines: string[] = [];
    const log = (a: unknown, b?: unknown): void => {
      logLines.push(JSON.stringify([a, b ?? null]));
    };
    const tails: string[] = [];
    const usageObserver = createUsageObserver();
    const supervisor = createSupervisor({
      provider,
      identity: SUPERVISOR_IDENTITY,
      eventSink: sink,
      redactionCanaries: [],
      materializeRunSecrets: async () => ({
        env: { ANTHROPIC_API_KEY: CANARY, [DIRECTIVE_KEYS.streamChunks]: JSON.stringify(chunks) },
        canaries: [CANARY],
      }),
      observeRun: async (input) => {
        tails.push(input.output?.stdoutTail ?? "<none>");
        return usageObserver(input);
      },
      logger: { info: log, warn: log, error: log, flush: async () => {} } as never,
    });

    await supervisor.accept(makeHandoff());

    // Positive control: the canary really crossed the transport's stdout handler.
    expect(transport.stdoutSeen.join("")).toContain(CANARY);
    const usages = sink.events.filter((e) => e.eventType === "usage");
    expect(usages).toHaveLength(1);
    const u = usages[0];
    if (u?.eventType === "usage") expect(u.payload).toMatchObject({ inputTokens: 101, outputTokens: 202, cachedInputTokens: 303 });
    expect(tails).toHaveLength(1);
    expect(tails[0]).not.toContain(CANARY);
    expect(tails[0]).toContain(REDACTION_MARKER);
    expect(JSON.stringify(sink.events)).not.toContain(CANARY);
    expect(logLines.join("\n")).not.toContain(CANARY);
  });
});
