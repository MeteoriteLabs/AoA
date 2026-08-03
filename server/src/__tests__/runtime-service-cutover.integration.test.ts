import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { terminatePersistedLocalRuntimeProcess } from "../services/workspace-runtime.js";

const itLinux = process.platform === "linux" ? it : it.skip;

describe("cloud runtime-service cutover", () => {
  it("awaits stale-process reconciliation before scheduling desired-service restart", () => {
    const source = fs.readFileSync(new URL("../index.ts", import.meta.url), "utf8");
    const reconcile = source.indexOf("await reconcilePersistedRuntimeServicesOnStartup");
    const workQuestionTick = source.indexOf("tickWorkQuestionWorkers();");
    const workQuestionInterval = source.indexOf("setInterval(() => tickWorkQuestionWorkers()");
    const schedulerGate = source.indexOf("if (config.heartbeatSchedulerEnabled)");
    const restart = source.indexOf("void restartDesiredRuntimeServicesOnStartup");
    expect(reconcile).toBeGreaterThan(-1);
    expect(workQuestionTick).toBeGreaterThan(reconcile);
    expect(workQuestionInterval).toBeGreaterThan(reconcile);
    expect(reconcile).toBeLessThan(schedulerGate);
    expect(restart).toBeGreaterThan(reconcile);
  });

  it("includes stopped local-process rows that retain a persisted PID in startup reconciliation", () => {
    const source = fs.readFileSync(new URL("../services/workspace-runtime.ts", import.meta.url), "utf8");
    const reconcile = source.indexOf("export async function reconcilePersistedRuntimeServicesOnStartup");
    const providerRefScan = source.indexOf("isNotNull(workspaceRuntimeServices.providerRef)", reconcile);
    expect(providerRefScan).toBeGreaterThan(reconcile);
  });

  itLinux("kills an identity-matched detached process before startup can continue", async () => {
    const startedAt = new Date();
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    const pid = child.pid!;
    await delay(100);

    try {
      await expect(terminatePersistedLocalRuntimeProcess({
        providerRef: String(pid),
        startedAt,
      })).resolves.toBe(true);
    } finally {
      try { process.kill(-pid, "SIGKILL"); } catch { /* already reaped */ }
    }
  }, 10_000);

  itLinux("fails closed when a detached leader exits but its process group survives", async () => {
    const leader = spawn(process.execPath, [
      "-e",
      [
        "const { spawn } = require('node:child_process');",
        "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
        "child.unref();",
      ].join(" "),
    ], {
      detached: true,
      stdio: "ignore",
    });
    leader.unref();
    const pid = leader.pid!;

    const isAlive = (target: number) => {
      try {
        process.kill(target, 0);
        return true;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === "EPERM";
      }
    };

    try {
      const deadline = Date.now() + 5_000;
      while (Date.now() <= deadline && (isAlive(pid) || !isAlive(-pid))) {
        await delay(25);
      }

      expect(isAlive(pid)).toBe(false);
      expect(isAlive(-pid)).toBe(true);
      await expect(terminatePersistedLocalRuntimeProcess({
        providerRef: String(pid),
        startedAt: new Date(),
      })).resolves.toBe(false);
      expect(isAlive(-pid)).toBe(true);
    } finally {
      try { process.kill(-pid, "SIGKILL"); } catch { /* already reaped */ }
    }
  }, 10_000);
});
