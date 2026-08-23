// BRW-002 — session orchestration (unit-shaped; runs on every OS, no browser needed).
//
// The orchestrator takes an injected driver so the ORDER of operations is testable without a
// browser. That matters because the two most dangerous requirements in this ticket are
// mutually constrained and neither is visible from a screenshot:
//
//   * video is only written when the context CLOSES;
//   * closing the context DELETES the downloads staging area.
//
// So a download must be persisted BEFORE close, and close must still happen. Get the order
// wrong and you silently lose the downloads or the video. Design v1 stated neither, and a
// comment cannot fail. These tests can.
import { describe, expect, it } from "vitest";
import { runBrowserSession, type BrowserDriver, type SessionConfig } from "../run-session.js";

const CONFIG: SessionConfig = {
  downloadRoot: "/job/downloads",
  steps: [{ action: "navigate", url: "https://site.test/" }],
  launch: { headless: true, chromiumSandbox: true, args: [] },
};

/** Records every driver interaction in order, so ordering is an assertion, not a comment. */
function recordingDriver(overrides: Partial<RecordingOptions> = {}) {
  const calls: string[] = [];
  const downloads = overrides.downloads ?? [];
  const driver: BrowserDriver = {
    async launch(options) {
      calls.push(`launch(sandbox=${String(options.chromiumSandbox)})`);
      if (overrides.launchThrows) throw new Error("launch failed");
      return {
        async navigate(url) {
          calls.push(`navigate(${url})`);
          if (overrides.navigateThrows) throw new Error("navigation failed");
        },
        async collectDownloads() {
          calls.push("collectDownloads");
          return downloads.map((name) => ({
            suggestedFilename: () => name,
            async saveAs(target: string) {
              calls.push(`saveAs(${target})`);
            },
          }));
        },
        async close() {
          calls.push("close");
        },
      };
    },
  };
  return { driver, calls };
}

interface RecordingOptions {
  downloads: string[];
  launchThrows: boolean;
  navigateThrows: boolean;
}

/** Ports measured before/after launch. Empty delta = contained. */
function ports(before: number[], after: number[]) {
  let call = 0;
  return async () => (call++ === 0 ? before : after);
}

const resolvePath = (root: string, name: string) => ({ ok: true as const, path: `${root}/${name}` });

describe("BRW-002 session — the guard runs BEFORE the browser starts", () => {
  it("refuses an unsafe launch without ever calling the driver", async () => {
    const { driver, calls } = recordingDriver();
    const result = await runBrowserSession(
      { ...CONFIG, launch: { ...CONFIG.launch, cdpPort: 9222 } },
      { driver, measurePorts: ports([], []), resolvePath, env: {} },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("cdp_port_requested");
    // The point: a refused launch must not have started anything.
    expect(calls).toEqual([]);
  });

  it("refuses when chromiumSandbox is not enabled", async () => {
    const { driver, calls } = recordingDriver();
    const result = await runBrowserSession(
      { ...CONFIG, launch: { headless: true, args: [] } },
      { driver, measurePorts: ports([], []), resolvePath, env: {} },
    );
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("BRW-002 session — containment is measured across the launch", () => {
  it("passes when the browser opens no port", async () => {
    const { driver } = recordingDriver();
    const result = await runBrowserSession(CONFIG, {
      driver,
      measurePorts: ports([49983], [49983]),
      resolvePath,
      env: {},
    });
    expect(result.ok).toBe(true);
  });

  it("FAILS when the browser opened a port, and still closes the context", async () => {
    const { driver, calls } = recordingDriver();
    const result = await runBrowserSession(CONFIG, {
      driver,
      measurePorts: ports([49983], [49983, 9222]),
      resolvePath,
      env: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("port_opened");
    expect(result.detail).toContain("9222");
    // A containment failure must not also leak the browser.
    expect(calls).toContain("close");
  });

  it("tolerates an infrastructure port that closed during the run", async () => {
    // One-directional delta: envd going away is not a containment failure.
    const { driver } = recordingDriver();
    const result = await runBrowserSession(CONFIG, {
      driver,
      measurePorts: ports([49983, 8080], [8080]),
      resolvePath,
      env: {},
    });
    expect(result.ok).toBe(true);
  });
});

describe("BRW-002 session — THE ORDERING INVARIANT", () => {
  it("persists every download BEFORE closing the context", async () => {
    const { driver, calls } = recordingDriver({ downloads: ["a.pdf", "b.csv"] });
    const result = await runBrowserSession(CONFIG, {
      driver,
      measurePorts: ports([], []),
      resolvePath,
      env: {},
    });
    expect(result.ok).toBe(true);

    const closeAt = calls.indexOf("close");
    const saveAts = calls
      .map((c, i) => (c.startsWith("saveAs(") ? i : -1))
      .filter((i) => i >= 0);
    expect(saveAts.length).toBe(2);
    expect(closeAt).toBeGreaterThan(-1);
    // Closing first would delete the staging area and lose every download, silently.
    for (const at of saveAts) expect(at).toBeLessThan(closeAt);
  });

  it("still closes the context so video is flushed", async () => {
    const { driver, calls } = recordingDriver({ downloads: ["a.pdf"] });
    await runBrowserSession(CONFIG, { driver, measurePorts: ports([], []), resolvePath, env: {} });
    // Skipping close to "protect" downloads would silently lose video instead.
    expect(calls[calls.length - 1]).toBe("close");
  });

  it("persists downloads even when a navigation step failed", async () => {
    const { driver, calls } = recordingDriver({ downloads: ["partial.pdf"], navigateThrows: true });
    const result = await runBrowserSession(CONFIG, {
      driver,
      measurePorts: ports([], []),
      resolvePath,
      env: {},
    });
    expect(result.ok).toBe(false);
    // Evidence already produced must survive a failed run — it is exactly the evidence
    // someone will want in order to understand the failure.
    expect(calls.some((c) => c.startsWith("saveAs("))).toBe(true);
    expect(calls).toContain("close");
  });
});

describe("BRW-002 session — download destinations are confined", () => {
  it("routes every download through the path resolver", async () => {
    const seen: Array<[string, string]> = [];
    const { driver, calls } = recordingDriver({ downloads: ["report.pdf"] });
    await runBrowserSession(CONFIG, {
      driver,
      measurePorts: ports([], []),
      resolvePath: (root, name) => {
        seen.push([root, name]);
        return { ok: true, path: `${root}/${name}` };
      },
      env: {},
    });
    expect(seen).toEqual([["/job/downloads", "report.pdf"]]);
    expect(calls).toContain("saveAs(/job/downloads/report.pdf)");
  });

  it("does NOT save a download whose destination is refused", async () => {
    const { driver, calls } = recordingDriver({ downloads: ["../escape.txt"] });
    const result = await runBrowserSession(CONFIG, {
      driver,
      measurePorts: ports([], []),
      resolvePath: () => ({ ok: false, reason: "outside_root", detail: "escapes" }),
      env: {},
    });
    // The refusal is reported, and crucially nothing was written.
    expect(calls.some((c) => c.startsWith("saveAs("))).toBe(false);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("download_refused");
  });
});

describe("BRW-002 session — a launch failure is reported, not swallowed", () => {
  it("reports a driver launch failure", async () => {
    const { driver } = recordingDriver({ launchThrows: true });
    const result = await runBrowserSession(CONFIG, {
      driver,
      measurePorts: ports([], []),
      resolvePath,
      env: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("launch_failed");
  });
});
