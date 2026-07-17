import { EventEmitter } from "node:events";
import { describe, it, expect, vi } from "vitest";
import { runStreamingLogin, type RunStreamingLoginOptions } from "./streaming-login.js";
import type { TrackedChildHandle } from "./server-utils.js";

/** A fake child + handle whose stdout/stderr/close/error we drive by hand. */
function fakeSpawn() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = stdout;
  child.stderr = stderr;
  const terminate = vi.fn();
  const handle: TrackedChildHandle = {
    child: child as never,
    pid: 4242,
    pgid: 4242,
    startedAt: new Date(0),
    terminate,
  };
  const spawn: RunStreamingLoginOptions["spawn"] = () => handle;
  return { spawn, stdout, stderr, child, handle, terminate };
}

const base = (spawn: RunStreamingLoginOptions["spawn"]): RunStreamingLoginOptions => ({
  runId: "login-1",
  command: "codex",
  args: ["login"],
  cwd: "/tmp",
  env: {},
  spawn,
});

describe("runStreamingLogin (Plan 3 T3)", () => {
  it("resolves urlPromise from a stdout chunk", async () => {
    const f = fakeSpawn();
    const { urlPromise, handle } = runStreamingLogin(base(f.spawn));
    expect(handle).toBe(f.handle);
    f.stdout.emit("data", Buffer.from("Sign in at https://chatgpt.com/device?code=AB12 now\n"));
    await expect(urlPromise).resolves.toBe("https://chatgpt.com/device?code=AB12");
  });

  it("resolves urlPromise from stderr (some CLIs print the URL there)", async () => {
    const f = fakeSpawn();
    const { urlPromise } = runStreamingLogin(base(f.spawn));
    f.stderr.emit("data", "visit https://claude.ai/oauth?x=9\n");
    await expect(urlPromise).resolves.toBe("https://claude.ai/oauth?x=9");
  });

  it("exitPromise resolves with the code; urlPromise rejects no-url when the child exits first", async () => {
    const f = fakeSpawn();
    const { urlPromise, exitPromise } = runStreamingLogin(base(f.spawn));
    const urlSettled = urlPromise.catch((e: Error) => e.message);
    f.child.emit("close", 1);
    await expect(exitPromise).resolves.toBe(1);
    await expect(urlSettled).resolves.toBe("no-url");
  });

  it("urlPromise rejects with the spawn error; exitPromise resolves null", async () => {
    const f = fakeSpawn();
    const { urlPromise, exitPromise } = runStreamingLogin(base(f.spawn));
    const urlSettled = urlPromise.catch((e: Error) => e.message);
    f.child.emit("error", new Error("ENOENT"));
    await expect(exitPromise).resolves.toBeNull();
    await expect(urlSettled).resolves.toBe("ENOENT");
  });

  it("rejects urlPromise with login-url-timeout after the discovery window", async () => {
    vi.useFakeTimers();
    try {
      const f = fakeSpawn();
      const { urlPromise } = runStreamingLogin({ ...base(f.spawn), discoveryTimeoutMs: 1000 });
      const settled = urlPromise.catch((e: Error) => e.message);
      await vi.advanceTimersByTimeAsync(1001);
      await expect(settled).resolves.toBe("login-url-timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not reject twice: a URL after timeout is ignored (single-settle)", async () => {
    vi.useFakeTimers();
    try {
      const f = fakeSpawn();
      const { urlPromise } = runStreamingLogin({ ...base(f.spawn), discoveryTimeoutMs: 500 });
      const settled = urlPromise.then(() => "resolved").catch((e: Error) => e.message);
      await vi.advanceTimersByTimeAsync(501);
      f.stdout.emit("data", "https://claude.ai/oauth?late=1\n");
      f.child.emit("close", 0);
      await expect(settled).resolves.toBe("login-url-timeout");
    } finally {
      vi.useRealTimers();
    }
  });
});
