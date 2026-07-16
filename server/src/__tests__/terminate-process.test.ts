import { describe, it, expect, vi } from "vitest";
import { terminateByPid } from "../utils/terminate-process.js";

describe("terminateByPid (Plan 3 T4)", () => {
  it("on win32 runs `taskkill /PID <pid> /T /F` and does not signal a group", () => {
    const runTaskkill = vi.fn();
    const kill = vi.fn();
    terminateByPid(1234, 1234, { platform: "win32", runTaskkill, kill });
    expect(runTaskkill).toHaveBeenCalledWith("taskkill", ["/PID", "1234", "/T", "/F"]);
    expect(kill).not.toHaveBeenCalled();
  });

  it("on POSIX SIGKILLs the process GROUP (negative pgid) when pgid is known", () => {
    const runTaskkill = vi.fn();
    const kill = vi.fn();
    terminateByPid(4242, 4242, { platform: "linux", runTaskkill, kill });
    expect(kill).toHaveBeenCalledWith(-4242, "SIGKILL");
    expect(runTaskkill).not.toHaveBeenCalled();
  });

  it("on POSIX falls back to the bare pid when pgid is null", () => {
    const kill = vi.fn();
    terminateByPid(99, null, { platform: "linux", kill });
    expect(kill).toHaveBeenCalledWith(99, "SIGKILL");
  });

  it("swallows ESRCH / already-dead errors (never throws)", () => {
    const kill = vi.fn(() => {
      throw Object.assign(new Error("no such process"), { code: "ESRCH" });
    });
    expect(() => terminateByPid(7, 7, { platform: "linux", kill })).not.toThrow();
  });

  it("no-ops on a non-finite pid", () => {
    const kill = vi.fn();
    const runTaskkill = vi.fn();
    terminateByPid(Number.NaN, null, { platform: "linux", kill, runTaskkill });
    terminateByPid(0, null, { platform: "linux", kill, runTaskkill });
    expect(kill).not.toHaveBeenCalled();
    expect(runTaskkill).not.toHaveBeenCalled();
  });
});
