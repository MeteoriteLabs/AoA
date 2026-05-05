import { describe, it, expect, vi } from "vitest";
import { resolveProcessGroupId, signalRunningProcess } from "@armyofagents/adapter-utils/server-utils";
import { spawn } from "node:child_process";

describe("resolveProcessGroupId", () => {
  it("returns null on Windows", () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", {
      value: "win32",
      writable: true,
      configurable: true,
    });
    try {
      const fakeChild = { pid: 1234 } as ReturnType<typeof spawn>;
      expect(resolveProcessGroupId(fakeChild)).toBeNull();
    } finally {
      Object.defineProperty(process, "platform", {
        value: original,
        writable: true,
        configurable: true,
      });
    }
  });

  it("returns the child's pid on POSIX (which equals pgid when spawned with detached:true)", () => {
    if (process.platform === "win32") return;
    const fakeChild = { pid: 1234 } as ReturnType<typeof spawn>;
    expect(resolveProcessGroupId(fakeChild)).toBe(1234);
  });

  it("returns null when child has no pid (spawn failed)", () => {
    const fakeChild = { pid: undefined } as unknown as ReturnType<typeof spawn>;
    expect(resolveProcessGroupId(fakeChild)).toBeNull();
  });

  it("returns null when child pid is invalid (0)", () => {
    if (process.platform === "win32") return;
    const fakeChild = { pid: 0 } as ReturnType<typeof spawn>;
    expect(resolveProcessGroupId(fakeChild)).toBeNull();
  });
});

describe("signalRunningProcess", () => {
  it("uses process.kill(-pgid, signal) on POSIX when processGroupId is valid", () => {
    if (process.platform === "win32") return;

    let capturedTarget: number | null = null;
    let capturedSignal: NodeJS.Signals | string | null = null;
    const originalKill = process.kill;
    (process as unknown as { kill: typeof process.kill }).kill = ((pid: number, sig?: NodeJS.Signals | number) => {
      capturedTarget = pid;
      capturedSignal = (sig as NodeJS.Signals) ?? null;
      return true;
    }) as typeof process.kill;

    try {
      const childKill = vi.fn();
      const fakeChild = { pid: 1234, killed: false, kill: childKill } as unknown as ReturnType<typeof spawn>;
      signalRunningProcess({ child: fakeChild, processGroupId: 1234 }, "SIGTERM");
      expect(capturedTarget).toBe(-1234);
      expect(capturedSignal).toBe("SIGTERM");
      expect(childKill).not.toHaveBeenCalled();
    } finally {
      (process as unknown as { kill: typeof process.kill }).kill = originalKill;
    }
  });

  it("falls back to child.kill when group signal throws", () => {
    if (process.platform === "win32") return;

    const originalKill = process.kill;
    (process as unknown as { kill: typeof process.kill }).kill = (() => {
      throw new Error("ESRCH");
    }) as typeof process.kill;

    try {
      const childKill = vi.fn();
      const fakeChild = { pid: 1234, killed: false, kill: childKill } as unknown as ReturnType<typeof spawn>;
      signalRunningProcess({ child: fakeChild, processGroupId: 1234 }, "SIGTERM");
      expect(childKill).toHaveBeenCalledWith("SIGTERM");
    } finally {
      (process as unknown as { kill: typeof process.kill }).kill = originalKill;
    }
  });

  it("uses child.kill on Windows", () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", writable: true, configurable: true });

    try {
      const childKill = vi.fn();
      const fakeChild = { pid: 1234, killed: false, kill: childKill } as unknown as ReturnType<typeof spawn>;
      signalRunningProcess({ child: fakeChild, processGroupId: 1234 }, "SIGTERM");
      expect(childKill).toHaveBeenCalledWith("SIGTERM");
    } finally {
      Object.defineProperty(process, "platform", { value: original, writable: true, configurable: true });
    }
  });

  it("does not double-signal an already-killed child on Windows", () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", writable: true, configurable: true });

    try {
      const childKill = vi.fn();
      const fakeChild = { pid: 1234, killed: true, kill: childKill } as unknown as ReturnType<typeof spawn>;
      signalRunningProcess({ child: fakeChild, processGroupId: 1234 }, "SIGTERM");
      expect(childKill).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, "platform", { value: original, writable: true, configurable: true });
    }
  });
});
