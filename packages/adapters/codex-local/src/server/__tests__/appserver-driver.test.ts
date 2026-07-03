import { describe, expect, it, vi } from "vitest";
import {
  driveCodexAppServer,
  type AppServerDriverClient,
  type AppServerAccumulator,
  type NeutralIntermediate,
} from "../app-server/driver.js";

/**
 * W5c Task 3 — driver unit tests.
 *
 * The driver is exercised against a SCRIPTED FAKE client (not real codex). The
 * fake records outbound requests/notifications, lets the test resolve them, and
 * exposes `serverRequest(id, method, params)` to simulate the server asking for
 * an approval and `deliverNotification(method, params)` to feed the notification
 * stream (which the driver routes to the injected accumulator + watches for
 * turn/completed | turn/failed).
 *
 * The accumulator is a fake that records `onNotification` calls and returns a
 * fixed `result()` — Task 4 supplies the real parse/remap accumulator.
 */

interface ScriptedRequest {
  method: string;
  params: unknown;
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  __settled?: boolean;
}

function makeFakeClient() {
  const requests: ScriptedRequest[] = [];
  const notifies: Array<{ method: string; params: unknown }> = [];
  const responses: Array<{ id: number | string; result: unknown }> = [];
  let onServerRequest:
    | ((id: number | string, method: string, params: unknown) => void | Promise<void>)
    | undefined;
  let onNotification: ((method: string, params: unknown) => void) | undefined;

  const client: AppServerDriverClient = {
    request(method, params) {
      return new Promise((resolve, reject) => {
        requests.push({ method, params, resolve, reject });
      });
    },
    notify(method, params) {
      notifies.push({ method, params });
    },
    respond(id, result) {
      responses.push({ id, result });
    },
    respondError() {
      /* not exercised here */
    },
    onClose() {
      /* no-op */
    },
    close() {
      /* no-op */
    },
  };

  return {
    client,
    requests,
    notifies,
    responses,
    setServerRequestHandler(
      cb: (id: number | string, method: string, params: unknown) => void | Promise<void>,
    ) {
      onServerRequest = cb;
    },
    setNotificationHandler(cb: (method: string, params: unknown) => void) {
      onNotification = cb;
    },
    /** Simulate a server-initiated approval request. */
    async serverRequest(id: number | string, method: string, params: unknown) {
      await onServerRequest?.(id, method, params);
    },
    /** Simulate a server notification frame. */
    deliverNotification(method: string, params: unknown) {
      onNotification?.(method, params);
    },
    /** Await the next outbound request matching `method` (poll the microtask queue). */
    async waitForRequest(method: string): Promise<ScriptedRequest> {
      for (let i = 0; i < 50; i++) {
        const found = requests.find((r) => r.method === method && !r.__settled);
        if (found) return found;
        await Promise.resolve();
      }
      throw new Error(
        `request ${method} never sent; saw: ${requests.map((r) => r.method).join(",")}`,
      );
    },
  };
}

function resolveReq(req: ScriptedRequest, result: unknown) {
  req.__settled = true;
  req.resolve(result);
}
function rejectReq(req: ScriptedRequest, err: Error) {
  req.__settled = true;
  req.reject(err);
}

function makeAccumulator(result: Partial<NeutralIntermediate> = {}) {
  const calls: Array<{ method: string; params: unknown }> = [];
  const acc: AppServerAccumulator = {
    onNotification(method, params) {
      calls.push({ method, params });
    },
    result() {
      return {
        summary: "",
        usage: null,
        errorMessage: null,
        errorCode: null,
        ...result,
      };
    },
  };
  return { acc, calls };
}

function baseInput(fake: ReturnType<typeof makeFakeClient>, acc: AppServerAccumulator) {
  return {
    runId: "run-1",
    cwd: "/work/proj",
    input: [{ type: "text" as const, text: "do the thing" }],
    approvalPolicy: "untrusted" as const,
    timeoutSec: 0,
    client: fake.client,
    accumulator: acc,
    onServerApproval: async () => "accept" as const,
    registerServerRequestHandler: fake.setServerRequestHandler,
    registerNotificationHandler: fake.setNotificationHandler,
  };
}

/** Drive the handshake, returning the pending turn/start request. */
async function driveHandshake(
  fake: ReturnType<typeof makeFakeClient>,
  threadId: string,
  opts: { resumeId?: string; resumeUnknown?: boolean } = {},
) {
  const init = await fake.waitForRequest("initialize");
  resolveReq(init, { userAgent: "x" });

  if (opts.resumeId) {
    const resume = await fake.waitForRequest("thread/resume");
    if (opts.resumeUnknown) {
      rejectReq(resume, new Error("thread 019f-abcd not found"));
      const start = await fake.waitForRequest("thread/start");
      resolveReq(start, { thread: { id: threadId } });
    } else {
      resolveReq(resume, { thread: { id: threadId } });
    }
  } else {
    const start = await fake.waitForRequest("thread/start");
    resolveReq(start, { thread: { id: threadId } });
  }

  const turn = await fake.waitForRequest("turn/start");
  return { turn };
}

describe("driveCodexAppServer (W5c Task 3)", () => {
  it("happy path: initialize→initialized→thread/start→turn/start→turn/completed", async () => {
    const fake = makeFakeClient();
    const { acc, calls } = makeAccumulator({ summary: "done" });
    const onServerApproval = vi.fn(async () => "accept" as const);

    const promise = driveCodexAppServer({ ...baseInput(fake, acc), onServerApproval });

    const { turn } = await driveHandshake(fake, "thread-abc");

    expect(turn.params).toMatchObject({
      threadId: "thread-abc",
      approvalPolicy: "untrusted",
      input: [{ type: "text", text: "do the thing" }],
    });

    // `initialized` notification was sent after initialize resolved.
    expect(fake.notifies).toEqual([{ method: "initialized", params: undefined }]);

    resolveReq(turn, { turn: { id: "turn-1" } });
    fake.deliverNotification("turn/completed", { threadId: "thread-abc" });

    const result = await promise;
    expect(result.sessionId).toBe("thread-abc");
    expect(result.timedOut).toBe(false);
    expect(result.clearSession).toBe(false);
    expect(result.summary).toBe("done");
    expect(calls.some((c) => c.method === "turn/completed")).toBe(true);
  });

  it("resume (portable/success): stored id + matching cwd → thread/resume → continues, no clearSession", async () => {
    const fake = makeFakeClient();
    const { acc } = makeAccumulator();

    const promise = driveCodexAppServer({
      ...baseInput(fake, acc),
      session: { sessionId: "stored-xyz", cwd: "/work/proj" },
    });

    const { turn } = await driveHandshake(fake, "stored-xyz", { resumeId: "stored-xyz" });
    expect(turn.params).toMatchObject({ threadId: "stored-xyz" });

    resolveReq(turn, { turn: { id: "t1" } });
    fake.deliverNotification("turn/completed", {});

    const result = await promise;
    expect(result.sessionId).toBe("stored-xyz");
    expect(result.clearSession).toBe(false);
    expect(fake.requests.some((r) => r.method === "thread/resume")).toBe(true);
    expect(fake.requests.filter((r) => r.method === "thread/start")).toHaveLength(0);
  });

  it("resume-unavailable: unknown-session error → fresh thread/start → new id → clearSession NOT set", async () => {
    const fake = makeFakeClient();
    const { acc } = makeAccumulator();

    const promise = driveCodexAppServer({
      ...baseInput(fake, acc),
      session: { sessionId: "stale-1", cwd: "/work/proj" },
    });

    const { turn } = await driveHandshake(fake, "fresh-2", {
      resumeId: "stale-1",
      resumeUnknown: true,
    });
    expect(turn.params).toMatchObject({ threadId: "fresh-2" });

    resolveReq(turn, { turn: { id: "t1" } });
    fake.deliverNotification("turn/completed", {});

    const result = await promise;
    expect(result.sessionId).toBe("fresh-2");
    // A replacement id WAS obtained → clearSession must NOT be set (mirror of
    // toResult's `!resolvedSessionId`).
    expect(result.clearSession).toBe(false);
  });

  it("turn/failed → intermediate carries errorMessage (+errorCode)", async () => {
    const fake = makeFakeClient();
    const { acc } = makeAccumulator({ errorMessage: "boom", errorCode: "E_X" });

    const promise = driveCodexAppServer({ ...baseInput(fake, acc) });

    const { turn } = await driveHandshake(fake, "thread-f");
    resolveReq(turn, { turn: { id: "t1" } });
    fake.deliverNotification("turn/failed", {
      turn: { error: { message: "boom", code: "E_X" } },
    });

    const result = await promise;
    expect(result.errorMessage).toBe("boom");
    expect(result.errorCode).toBe("E_X");
    expect(result.timedOut).toBe(false);
  });

  it("timeout → terminate() called + timedOut:true, no hang", async () => {
    vi.useFakeTimers();
    try {
      const fake = makeFakeClient();
      const { acc } = makeAccumulator();
      const terminate = vi.fn();

      const promise = driveCodexAppServer({
        ...baseInput(fake, acc),
        timeoutSec: 5,
        terminate,
      });

      const init = await fake.waitForRequest("initialize");
      resolveReq(init, {});
      const start = await fake.waitForRequest("thread/start");
      resolveReq(start, { thread: { id: "thread-t" } });
      const turn = await fake.waitForRequest("turn/start");
      resolveReq(turn, { turn: { id: "t1" } });

      await vi.advanceTimersByTimeAsync(5000);

      const result = await promise;
      expect(result.timedOut).toBe(true);
      expect(terminate).toHaveBeenCalledTimes(1);
      expect(result.sessionId).toBe("thread-t");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cwd-mismatch → skips resume, fresh thread/start + warn", async () => {
    const fake = makeFakeClient();
    const { acc } = makeAccumulator();
    const warn = vi.fn();

    const promise = driveCodexAppServer({
      ...baseInput(fake, acc),
      cwd: "/work/proj",
      session: { sessionId: "stored-xyz", cwd: "/some/other/dir" },
      onWarn: warn,
    });

    const { turn } = await driveHandshake(fake, "fresh-nx");
    expect(turn.params).toMatchObject({ threadId: "fresh-nx" });
    resolveReq(turn, { turn: { id: "t1" } });
    fake.deliverNotification("turn/completed", {});

    await promise;
    expect(fake.requests.some((r) => r.method === "thread/resume")).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it("approval routing: server request → onServerApproval → respond with decision", async () => {
    const fake = makeFakeClient();
    const { acc } = makeAccumulator();
    const onServerApproval = vi.fn(async () => "accept" as const);

    const promise = driveCodexAppServer({ ...baseInput(fake, acc), onServerApproval });

    const { turn } = await driveHandshake(fake, "thread-ap");
    resolveReq(turn, { turn: { id: "t1" } });

    await fake.serverRequest(42, "item/commandExecution/requestApproval", {
      command: "rm -rf /",
    });

    expect(onServerApproval).toHaveBeenCalledWith(
      "item/commandExecution/requestApproval",
      { command: "rm -rf /" },
    );
    expect(fake.responses).toContainEqual({ id: 42, result: { decision: "accept" } });

    fake.deliverNotification("turn/completed", {});
    await promise;
  });

  it("approval routing fail-closed: onServerApproval throws → respond decline", async () => {
    const fake = makeFakeClient();
    const { acc } = makeAccumulator();
    const onServerApproval = vi.fn(async () => {
      throw new Error("bridge down");
    });

    const promise = driveCodexAppServer({ ...baseInput(fake, acc), onServerApproval });

    const { turn } = await driveHandshake(fake, "thread-fc");
    resolveReq(turn, { turn: { id: "t1" } });

    await fake.serverRequest(7, "item/fileChange/requestApproval", { path: "x" });
    expect(fake.responses).toContainEqual({ id: 7, result: { decision: "decline" } });

    fake.deliverNotification("turn/completed", {});
    await promise;
  });
});
