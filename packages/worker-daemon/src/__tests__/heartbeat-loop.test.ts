import { describe, expect, it, vi } from "vitest";

import { createHeartbeatLoop } from "../poll/heartbeat-loop.js";
import { SessionTerminalError, type SessionProvider } from "../poll/poll-loop.js";
import type { WorkerSession } from "../enrollment/enroll.js";

const SESSION: WorkerSession = {
  token: "t",
  workerId: "w",
  targetId: "tgt",
  deviceGeneration: 1,
  obtainedAtMs: 0,
  ttlMs: 900_000,
  expiresAtMs: 900_000,
};

const liveProvider = (): SessionProvider => ({
  get: async () => SESSION,
  recover: async () => SESSION,
});

const terminalProvider = (): SessionProvider => ({
  get: async () => {
    throw new SessionTerminalError();
  },
  recover: async () => {
    throw new SessionTerminalError();
  },
});

/** A manual clock: each sleep() parks until advance() releases the oldest waiter. */
function manualClock() {
  const waiters: Array<() => void> = [];
  return {
    sleep: (_ms: number) => new Promise<void>((resolve) => waiters.push(resolve)),
    advance: () => {
      const w = waiters.shift();
      if (w) w();
    },
    pending: () => waiters.length,
  };
}

const stubKey = {} as never;
const stubClient = {} as never;

describe("createHeartbeatLoop", () => {
  it("beats immediately and resolves firstBeat=ok", async () => {
    const send = vi.fn(async () => "ok" as const);
    const loop = createHeartbeatLoop({
      session: liveProvider(),
      key: stubKey,
      client: stubClient,
      intervalMs: 1000,
      sleep: manualClock().sleep,
      send,
    });
    loop.start();
    await expect(loop.firstBeat).resolves.toBe("ok");
    expect(send).toHaveBeenCalledTimes(1);
    loop.stop();
  });

  it("beats again after the interval elapses", async () => {
    const send = vi.fn(async () => "ok" as const);
    const clock = manualClock();
    const loop = createHeartbeatLoop({
      session: liveProvider(),
      key: stubKey,
      client: stubClient,
      intervalMs: 1000,
      sleep: clock.sleep,
      send,
    });
    loop.start();
    await loop.firstBeat;
    expect(send).toHaveBeenCalledTimes(1);
    clock.advance(); // release the interval sleep after the first ok beat
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    loop.stop();
  });

  it("resolves firstBeat=terminal and never beats when the session is terminal", async () => {
    const send = vi.fn(async () => "ok" as const);
    const loop = createHeartbeatLoop({
      session: terminalProvider(),
      key: stubKey,
      client: stubClient,
      intervalMs: 1000,
      sleep: manualClock().sleep,
      send,
    });
    loop.start();
    await expect(loop.firstBeat).resolves.toBe("terminal");
    expect(send).not.toHaveBeenCalled();
    loop.stop();
  });

  it("a transient failure does not resolve firstBeat, then a later success does", async () => {
    const send = vi.fn(async (): Promise<"ok" | "failed"> => "ok");
    send.mockResolvedValueOnce("failed");
    const clock = manualClock();
    const loop = createHeartbeatLoop({
      session: liveProvider(),
      key: stubKey,
      client: stubClient,
      intervalMs: 1000,
      retryDelayMs: 100,
      sleep: clock.sleep,
      send,
    });
    loop.start();
    // First beat failed -> loop parked on the retry sleep, firstBeat NOT resolved yet.
    await vi.waitFor(() => expect(clock.pending()).toBe(1));
    clock.advance(); // release the retry sleep -> second beat succeeds
    await expect(loop.firstBeat).resolves.toBe("ok");
    expect(send).toHaveBeenCalledTimes(2);
    loop.stop();
  });
});
