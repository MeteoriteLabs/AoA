import { describe, expect, it } from "vitest";

import type { ExecuteInput, ProviderOpContext } from "@armyofagents/worker-daemon";

import { EXECUTE_CAPTURE_STDOUT_KEY, EXECUTE_STDOUT_TAIL_KEY, encodeOpRequest } from "../codec.js";
import { NetworkedProviderDriver } from "../driver.js";

// -----------------------------------------------------------------------------
// WRK-018 slice C — the networked lane's half of the optional stdout stream channel.
//
// A callback cannot cross HTTP, so the driver translates the port's `onStdout` into a
// request FLAG (`captureStdout: true`) and replays the adapter-manager's returned — already
// scrubbed — `stdoutTail` into the caller's callback once `execute` resolves. Without a
// callback the request body is BYTE-IDENTICAL to the pre-channel `{args, ctx}` envelope, and
// an adapter-manager that predates the channel (no `stdoutTail`) degrades to "no output",
// which is "no usage", never a failure.
// -----------------------------------------------------------------------------

const EXEC_RESULT = {
  providerOpId: "op-9",
  exitCode: 0,
  signal: null,
  timedOut: false,
  stdoutRef: "ref:stdout:sbx-1",
  stderrRef: "ref:stderr:sbx-1",
};

interface Captured {
  url: string;
  body: string;
}

function fakeFetch(responseOk: unknown, captured: Captured[]): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    captured.push({ url: String(url), body: String(init?.body ?? "") });
    return new Response(JSON.stringify({ ok: responseOk }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const CTX: ProviderOpContext = { deadlineMs: 5_000, idempotencyKey: "e-1" };
const INPUT: ExecuteInput = { sandboxId: "sbx-1", command: "claude", args: ["--print", "-"], env: { ANTHROPIC_API_KEY: "k" } };

describe("WRK-018 — NetworkedProviderDriver relays the stdout channel", () => {
  it("with onStdout: sends the capture FLAG (never the callback), replays the tail, strips it from the result", async () => {
    const captured: Captured[] = [];
    const driver = new NetworkedProviderDriver({
      baseUrl: "http://am",
      fetch: fakeFetch({ ...EXEC_RESULT, [EXECUTE_STDOUT_TAIL_KEY]: "line-1\nline-2\n" }, captured),
    });
    const got: string[] = [];
    const result = await driver.execute({ ...INPUT, onStdout: (c) => got.push(c) }, CTX);

    expect(captured).toHaveLength(1);
    const sent = JSON.parse(captured[0]!.body) as { args: Record<string, unknown> };
    expect(sent.args[EXECUTE_CAPTURE_STDOUT_KEY]).toBe(true);
    expect("onStdout" in sent.args).toBe(false);
    expect(sent.args).toEqual({ ...INPUT, [EXECUTE_CAPTURE_STDOUT_KEY]: true });
    expect(got).toEqual(["line-1\nline-2\n"]);
    expect(result).toEqual(EXEC_RESULT); // the tail never leaks into the port's ExecuteResult
  });

  it("without onStdout the request body is BYTE-IDENTICAL to the pre-channel envelope", async () => {
    const captured: Captured[] = [];
    const driver = new NetworkedProviderDriver({ baseUrl: "http://am", fetch: fakeFetch(EXEC_RESULT, captured) });
    const result = await driver.execute(INPUT, CTX);
    expect(captured[0]!.body).toBe(encodeOpRequest(INPUT, CTX, undefined));
    expect(result).toEqual(EXEC_RESULT);
  });

  it("an adapter-manager that predates the channel (no tail) -> onStdout never called, run unaffected", async () => {
    const driver = new NetworkedProviderDriver({ baseUrl: "http://am", fetch: fakeFetch(EXEC_RESULT, []) });
    const got: string[] = [];
    const result = await driver.execute({ ...INPUT, onStdout: (c) => got.push(c) }, CTX);
    expect(got).toEqual([]);
    expect(result).toEqual(EXEC_RESULT);
  });

  it("a garbled (non-string) tail is dropped, never forwarded, and the run is unaffected", async () => {
    const driver = new NetworkedProviderDriver({
      baseUrl: "http://am",
      fetch: fakeFetch({ ...EXEC_RESULT, [EXECUTE_STDOUT_TAIL_KEY]: { not: "a string" } }, []),
    });
    const got: unknown[] = [];
    const result = await driver.execute({ ...INPUT, onStdout: (c) => got.push(c) }, CTX);
    expect(got).toEqual([]);
    expect(result).toEqual(EXEC_RESULT);
  });

  it("the driver-owned zero-deadline verdict still short-circuits BEFORE any RPC", async () => {
    const captured: Captured[] = [];
    const driver = new NetworkedProviderDriver({ baseUrl: "http://am", fetch: fakeFetch(EXEC_RESULT, captured) });
    const result = await driver.execute({ ...INPUT, onStdout: () => {} }, { ...CTX, deadlineMs: 0 });
    expect(result.timedOut).toBe(true);
    expect(captured).toHaveLength(0);
  });
});
