import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { safeGetPgid, killProcessTree } from "@armyofagents/adapter-utils/server-utils";

describe("safeGetPgid", () => {
  it("returns null on Windows", () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", {
      value: "win32",
      writable: true,
      configurable: true,
    });
    try {
      expect(safeGetPgid(1234)).toBeNull();
    } finally {
      Object.defineProperty(process, "platform", {
        value: original,
        writable: true,
        configurable: true,
      });
    }
  });

  it("returns null when getpgid throws (non-existent PID)", () => {
    if (process.platform === "win32") return; // skip on actual Windows
    // PID 999999999 is almost certainly not running; getpgid will throw ESRCH
    expect(safeGetPgid(999999999)).toBeNull();
  });

  it("returns a number for the current process on POSIX", () => {
    if (process.platform === "win32") return;
    const pgid = safeGetPgid(process.pid);
    // Should be a positive integer
    expect(typeof pgid).toBe("number");
    expect(pgid).toBeGreaterThan(0);
  });
});

describe("killProcessTree", () => {
  it("is a no-op when both pid and pgid are null", () => {
    expect(() => killProcessTree(null, null)).not.toThrow();
  });

  it("does not throw when passed null pid with null pgid on Windows", () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", {
      value: "win32",
      writable: true,
      configurable: true,
    });
    try {
      // pid=null short-circuits on Windows
      expect(() => killProcessTree(null, null)).not.toThrow();
    } finally {
      Object.defineProperty(process, "platform", {
        value: original,
        writable: true,
        configurable: true,
      });
    }
  });

  it("calls process.kill on POSIX when only pid is available (pgid null)", () => {
    if (process.platform === "win32") return;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as unknown as void);
    try {
      // Pass a fake pid that process.kill might reject — use mock to prevent that
      killProcessTree(12345, null);
      expect(killSpy).toHaveBeenCalledWith(12345, "SIGTERM");
    } finally {
      killSpy.mockRestore();
    }
  });

  it("sends SIGTERM to -pgid on POSIX when pgid is available", () => {
    if (process.platform === "win32") return;
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as unknown as void);
    try {
      killProcessTree(12345, 12300);
      expect(killSpy).toHaveBeenCalledWith(-12300, "SIGTERM");
    } finally {
      killSpy.mockRestore();
    }
  });
});
