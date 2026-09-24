import { describe, expect, it, vi } from "vitest";

import { createWorkerLogger, type Logger } from "../logging/logger.js";
import { LOG_RECORD_REFUSED_LINE, createRedactingDestination } from "../logging/redacting-destination.js";
import { REDACTION_MARKER } from "../supervisor/redaction.js";
import { createRunCanaryCoordinator } from "../supervisor/run-canaries.js";
import { createRunOutputCapture } from "../supervisor/run-output.js";
import {
  RUN_OUTPUT_PROBE_LOG_MESSAGE,
  RUN_OUTPUT_PROBE_MAX_CHARS,
  RUN_OUTPUT_PROBE_MAX_LINES,
  RUN_OUTPUT_PROBE_TAG,
  selectRunOutputProbeLines,
} from "../supervisor/run-output-probe.js";
import { createUsageObserver } from "../supervisor/usage-observer.js";

// -----------------------------------------------------------------------------
// DEP-023 — the run-output REDACTION PROBE and the transport-boundary log scrubber.
//
// The E5 audit matrix's clause 5 had no floor on either lane because redaction WORKED and nothing
// could SEE it: the scrubbed tail's only consumer returned four integers. These tests pin the two
// halves of the restored surface and, more importantly, the SAFETY ARGUMENT that lets it exist:
//
//   1. the selector forwards only tagged, bounded lines of an ALREADY-SCRUBBED tail;
//   2. an end-to-end pass over the REAL capture shows the marker present and the canary absent,
//      and a mutation of the scrubber flips BOTH arms;
//   3. the `E4-F019` sink-collision class — a secret equal to `msg`/`time`/`level`, which the pino
//      sink adds BELOW every caller-side scrubber — is NOT reachable through this surface, because
//      its log destination scrubs the SERIALIZED record.
// -----------------------------------------------------------------------------

const CANARY = "m1fmcanary0123456789abcdef0123456789abcdef";

function tailThrough(chunks: readonly string[], canaries: readonly string[]): string {
  const capture = createRunOutputCapture({ canaries });
  for (const chunk of chunks) capture.onStdout(chunk);
  return capture.close().stdoutTail;
}

describe("selectRunOutputProbeLines — a selector, bounded and opt-in", () => {
  it("selects only lines that START with the tag", () => {
    const tail = [
      `{"type":"system"}`,
      `${RUN_OUTPUT_PROBE_TAG} ANTHROPIC_API_KEY=${REDACTION_MARKER}`,
      `{"type":"result"}`,
    ].join("\n");
    expect(selectRunOutputProbeLines(tail)).toEqual([`${RUN_OUTPUT_PROBE_TAG} ANTHROPIC_API_KEY=${REDACTION_MARKER}`]);
  });

  it("does NOT admit a line that merely contains the tag, nor one that is indented into it", () => {
    expect(selectRunOutputProbeLines(`prefix ${RUN_OUTPUT_PROBE_TAG} x=1`)).toEqual([]);
    expect(selectRunOutputProbeLines(`  ${RUN_OUTPUT_PROBE_TAG} x=1`)).toEqual([]);
  });

  it("is bounded: at most one line, truncated, surrogate-safe, CRLF-normalised", () => {
    const many = [1, 2, 3].map((n) => `${RUN_OUTPUT_PROBE_TAG} n=${n}`).join("\r\n");
    expect(selectRunOutputProbeLines(many)).toEqual([`${RUN_OUTPUT_PROBE_TAG} n=1`]);
    expect(RUN_OUTPUT_PROBE_MAX_LINES).toBe(1);

    const long = `${RUN_OUTPUT_PROBE_TAG} ${"x".repeat(RUN_OUTPUT_PROBE_MAX_CHARS * 2)}`;
    expect(selectRunOutputProbeLines(long)[0]!.length).toBe(RUN_OUTPUT_PROBE_MAX_CHARS);

    const surrogate = `${RUN_OUTPUT_PROBE_TAG} ${"a".repeat(RUN_OUTPUT_PROBE_MAX_CHARS - RUN_OUTPUT_PROBE_TAG.length - 1)}😀`;
    const picked = selectRunOutputProbeLines(surrogate)[0]!;
    expect(picked.charCodeAt(picked.length - 1)).not.toBeGreaterThanOrEqual(0xd800);
  });

  it("forwards nothing for an empty tail", () => {
    expect(selectRunOutputProbeLines("")).toEqual([]);
  });
});

describe("the observer's probe path, over the REAL capture", () => {
  const echoed = [`${RUN_OUTPUT_PROBE_TAG} ANTHROPIC_API_KEY=${CANARY}\n`, `{"type":"result","usage":{}}\n`];

  function observe({ runOutputProbe }: { runOutputProbe: boolean }) {
    const lines: Array<{ fields: Record<string, unknown>; message: string }> = [];
    const logger = {
      info: (a: unknown, b?: string) => {
        lines.push({ fields: a as Record<string, unknown>, message: String(b) });
      },
    };
    const observeRun = createUsageObserver({ runOutputProbe, logger: logger as Pick<Logger, "info"> });
    const obs = observeRun({
      handoff: {} as never,
      exec: {} as never,
      output: { stdoutTail: tailThrough(echoed, [CANARY]), runtimeMillis: 10 },
    }) as { logs?: ReadonlyArray<{ message: string }> };
    return { obs, lines };
  }

  it("carries the SCRUBBED line to both halves: the marker is present, the canary is not", () => {
    const { obs, lines } = observe({ runOutputProbe: true });
    const eventMessage = obs.logs?.[0]?.message ?? "";
    expect(eventMessage).toContain(REDACTION_MARKER);
    expect(eventMessage).not.toContain(CANARY);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.message).toBe(RUN_OUTPUT_PROBE_LOG_MESSAGE);
    expect(String(lines[0]!.fields.probeLine)).toContain(REDACTION_MARKER);
    expect(String(lines[0]!.fields.probeLine)).not.toContain(CANARY);
  });

  it("is OFF by default: no log entry, no log line, no field on the observation", () => {
    const { obs, lines } = observe({ runOutputProbe: false });
    expect(obs.logs).toBeUndefined();
    expect(lines).toEqual([]);
  });

  it("★ POSITIVE CONTROL — with the scrubber's substitution removed BOTH arms flip", () => {
    // The mutation is expressed as the capture's own contract: a tail that was never scrubbed.
    // `createRunOutputCapture` is fail-closed, so removing `redactString` makes `scrubOutputText`
    // refuse and the tail is EMPTY; removing the refusal too leaks the value verbatim. Both
    // mutations are shown here, because only together do they cover "the marker vanished" and
    // "the canary appeared".
    const unscrubbedTail = echoed.join("");
    const leaked = selectRunOutputProbeLines(unscrubbedTail);
    expect(leaked[0]).toContain(CANARY);
    expect(leaked[0]).not.toContain(REDACTION_MARKER);

    // And the OTHER direction of fail-closed: when the substitution RE-FORMS a needle (the
    // marker's own bytes plus a neighbour), the whole tail is dropped rather than forwarded
    // half-scrubbed — so the probe surface cannot carry a residual either.
    const refusedTail = tailThrough([`${RUN_OUTPUT_PROBE_TAG} k=abxyzw\n`], ["d»xyzw", "ab"]);
    expect(refusedTail).toBe("");
    expect(selectRunOutputProbeLines(refusedTail)).toEqual([]);
  });
});

describe("E4-F019 — the sink-collision class is NOT reachable through this surface", () => {
  function loggerOver(canaries: readonly string[]): { logger: Logger; written: string[] } {
    const written: string[] = [];
    const logger = createWorkerLogger({
      destination: { write: (line: string) => void written.push(line) },
      redactionCanaries: () => canaries,
    });
    return { logger, written };
  }

  it("scrubs a secret that equals a STRUCTURAL token the sink adds below every caller-side scrub", () => {
    // The finding, verbatim: a redeemed secret may be ANY non-empty string, so one equal to `msg`
    // is emitted by the SINK on every line. With the transport-boundary scrubber it cannot be.
    for (const token of ["msg", "time", "level"]) {
      const { logger, written } = loggerOver([token]);
      logger.info({ leaseId: "lease-1" }, "worker: a line");
      const line = written.join("");
      expect(line).not.toContain(`"${token}"`);
      expect(line).toContain(REDACTION_MARKER);
    }
  });

  it("scrubs a digit run occurring inside the epoch `time` the sink stamps", () => {
    // Pin the clock so the digit run is deterministic rather than a lucky collision.
    const now = 1790154392922;
    vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const digits = String(now).slice(3, 8);
      const { logger, written } = loggerOver([digits]);
      logger.info({ leaseId: "lease-1" }, "worker: a line");
      expect(written.join("")).not.toContain(digits);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("leaves every byte untouched when no run holds a canary", () => {
    const { logger, written } = loggerOver([]);
    logger.info({ leaseId: "lease-1" }, "worker: a line");
    const parsed = JSON.parse(written.join("").trim()) as Record<string, unknown>;
    expect(parsed.msg).toBe("worker: a line");
    expect(parsed.leaseId).toBe("lease-1");
  });

  it("REFUSES a record it cannot scrub rather than writing it (fail closed)", () => {
    const written: string[] = [];
    let refusals = 0;
    const dest = createRedactingDestination({
      destination: { write: (line: string) => void written.push(line) },
      // Needles are applied LONGEST FIRST, so `ab` scrubs to the marker AFTER `d»xyzw` has
      // already been looked for: the marker's own tail plus `xyzw` then re-forms it, leaving a
      // residual the scrubber cannot remove. The record is refused rather than half-scrubbed.
      canaries: () => ["d»xyzw", "ab"],
      onRefused: () => {
        refusals += 1;
      },
    });
    dest.write(`{"msg":"abxyzw"}\n`);
    expect(refusals).toBe(1);
    expect(written.join("")).toContain("refused by the redaction transport");
    expect(written.join("")).not.toContain("abxyzw");
    expect(LOG_RECORD_REFUSED_LINE).toContain("refused by the redaction transport");
  });

  it("★ POSITIVE CONTROL — WITHOUT the transport scrubber the structural token IS emitted verbatim", () => {
    const written: string[] = [];
    const logger = createWorkerLogger({ destination: { write: (line: string) => void written.push(line) } });
    logger.info({ leaseId: "lease-1" }, "worker: a line");
    // This is E4-F019 exactly: `msg` is present, and nothing a caller could have run would remove
    // it. The assertion is the control for the three tests above.
    expect(written.join("")).toContain('"msg"');
  });

  it("fails CLOSED when the canary source throws — 'cannot read' is never 'there are none'", () => {
    const written: string[] = [];
    const dest = createRedactingDestination({
      destination: { write: (line: string) => void written.push(line) },
      canaries: () => {
        throw new Error("no coordinator");
      },
    });
    dest.write(`{"msg":"something"}\n`);
    expect(written.join("")).not.toContain("something");
    expect(written.join("")).toContain("refused by the redaction transport");
  });
});

describe("the canary snapshot the transport scrubber reads", () => {
  it("is live, de-duplicated across leases, and empties when a run settles", () => {
    const coordinator = createRunCanaryCoordinator();
    expect(coordinator.snapshot()).toEqual([]);
    coordinator.ensure("lease-a").push(CANARY, CANARY);
    coordinator.ensure("lease-b").push("other");
    expect([...coordinator.snapshot()].sort()).toEqual([CANARY, "other"].sort());
    coordinator.release("lease-a");
    expect(coordinator.snapshot()).toEqual(["other"]);
    coordinator.release("lease-b");
    expect(coordinator.snapshot()).toEqual([]);
  });
});
