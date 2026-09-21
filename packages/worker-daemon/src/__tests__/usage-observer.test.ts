import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { usagePayloadV1Schema } from "@armyofagents/worker-protocol";

import { createMetrics } from "../metrics/metrics.js";
import {
  RUN_USAGE_MISSING_METRIC,
  createUsageObserver,
  parseClaudeStreamJsonUsage,
} from "../supervisor/usage-observer.js";
import { makeHandoff } from "./support/supervisor-fixtures.js";

// -----------------------------------------------------------------------------
// WRK-018 slice A — the daemon-local `claude_local` usage parser (E4-D13) and the
// `observeRun` it composes.
//
// The daemon cannot import `@armyofagents/adapters` (E4-D01), so the format is PORTED,
// not shared. The port is only honest if it agrees with the server parser
// (`parseClaudeStreamJson`, packages/adapters/claude-local/src/server/parse.ts) on a REAL
// transcript — so the first case reads the real captured `claude --output-format
// stream-json --verbose` transcript the server suite already pins
// (server/src/__tests__/fixtures/claude-stream-json-tool-call.jsonl, commit cdc078d56),
// by path, and asserts the same field map the server applies:
//   input_tokens -> inputTokens, output_tokens -> outputTokens,
//   cache_read_input_tokens -> cachedInputTokens.
// -----------------------------------------------------------------------------

const REAL_TRANSCRIPT = fileURLToPath(
  new URL("../../../../server/src/__tests__/fixtures/claude-stream-json-tool-call.jsonl", import.meta.url),
);

function resultLine(usage: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "done", ...(usage ? { usage } : {}), ...extra });
}

const EXEC = { providerOpId: "op-1", exitCode: 0, signal: null, timedOut: false, stdoutRef: "r:o", stderrRef: "r:e" };

describe("WRK-018 — parseClaudeStreamJsonUsage (daemon-local port, E4-D13)", () => {
  it("reads the REAL captured claude stream-json transcript with the server parser's field map", () => {
    const transcript = readFileSync(REAL_TRANSCRIPT, "utf8");
    // Pin the fixture itself so a silently-edited fixture cannot make this vacuous.
    expect(transcript).toContain('"type":"result"');
    expect(parseClaudeStreamJsonUsage(transcript)).toEqual({ inputTokens: 7, outputTokens: 352, cachedInputTokens: 61348 });
  });

  it("the LAST result line wins (server parity: finalResult is overwritten)", () => {
    const text = [
      resultLine({ input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1 }),
      '{"type":"assistant","message":{"content":[]}}',
      resultLine({ input_tokens: 9, output_tokens: 8, cache_read_input_tokens: 7 }),
    ].join("\n");
    expect(parseClaudeStreamJsonUsage(text)).toEqual({ inputTokens: 9, outputTokens: 8, cachedInputTokens: 7 });
  });

  it("tolerates CRLF, blank lines and non-JSON noise around the result line", () => {
    const text = `noise\r\n\r\n{not json\r\n${resultLine({ input_tokens: 3, output_tokens: 4, cache_read_input_tokens: 0 })}\r\n`;
    expect(parseClaudeStreamJsonUsage(text)).toEqual({ inputTokens: 3, outputTokens: 4, cachedInputTokens: 0 });
  });

  it("a missing usage FIELD falls back to 0 (server parity), but a missing usage OBJECT is no usage", () => {
    expect(parseClaudeStreamJsonUsage(resultLine({ input_tokens: 5 }))).toEqual({ inputTokens: 5, outputTokens: 0, cachedInputTokens: 0 });
    expect(parseClaudeStreamJsonUsage(resultLine(undefined))).toBeNull();
  });

  it("a PRESENT but non-numeric count (e.g. redacted to the marker, or a string) is NO usage, never a silent 0 (Codex P2, PR #546)", () => {
    expect(parseClaudeStreamJsonUsage(resultLine({ input_tokens: "«redacted»", output_tokens: 5 }))).toBeNull();
    expect(parseClaudeStreamJsonUsage(resultLine({ input_tokens: "12", output_tokens: 5 }))).toBeNull();
    expect(parseClaudeStreamJsonUsage(resultLine({ input_tokens: null, output_tokens: 5 }))).toBeNull();
  });

  it("a FINAL result line the scrubber made unparseable voids usage; an EARLIER result line never stands in for it", () => {
    const earlier = resultLine({ input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1 });
    // A numeric canary "4" redacted inside a bare count: no longer valid JSON.
    const corrupted = '{"type":"result","usage":{"input_tokens":«redacted»2,"output_tokens":9}}';
    expect(parseClaudeStreamJsonUsage(`${earlier}\n${corrupted}\n`)).toBeNull();
    // ...while a valid result line AFTER a corrupted one still wins (last valid line = final).
    expect(parseClaudeStreamJsonUsage(`${corrupted}\n${earlier}\n`)).toEqual({ inputTokens: 1, outputTokens: 1, cachedInputTokens: 1 });
  });

  it("no result line, empty output, or a non-integer/negative count is NO usage (never an invalid event)", () => {
    expect(parseClaudeStreamJsonUsage("")).toBeNull();
    expect(parseClaudeStreamJsonUsage('{"type":"assistant"}\n{"type":"system","subtype":"init"}')).toBeNull();
    expect(parseClaudeStreamJsonUsage(resultLine({ input_tokens: 1.5, output_tokens: 1 }))).toBeNull();
    expect(parseClaudeStreamJsonUsage(resultLine({ input_tokens: -1, output_tokens: 1 }))).toBeNull();
  });
});

describe("WRK-018 — createUsageObserver (the composed observeRun)", () => {
  it("builds a schema-valid UsagePayloadV1 with runtimeMillis from the SUPERVISOR's clock", async () => {
    const observe = createUsageObserver();
    const obs = await observe({
      handoff: makeHandoff(),
      exec: EXEC,
      output: { stdoutTail: resultLine({ input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30 }), runtimeMillis: 1234 },
    });
    expect(obs.usage).toEqual({ inputTokens: 10, outputTokens: 20, cachedInputTokens: 30, runtimeMillis: 1234 });
    expect(usagePayloadV1Schema.parse(obs.usage)).toEqual(obs.usage);
    expect(obs.logs).toBeUndefined(); // usage only: stdout is NEVER re-emitted as log events
  });

  it("no parseable usage -> usage null, NO throw, and the missing-usage counter increments", async () => {
    const metrics = createMetrics();
    const observe = createUsageObserver({ metrics });
    const noOutput = await observe({ handoff: makeHandoff(), exec: EXEC });
    const noResult = await observe({ handoff: makeHandoff(), exec: EXEC, output: { stdoutTail: "hello\n", runtimeMillis: 5 } });
    expect(noOutput.usage).toBeNull();
    expect(noResult.usage).toBeNull();
    expect(metrics.renderPrometheus()).toContain(`${RUN_USAGE_MISSING_METRIC} 2`);
  });
});
