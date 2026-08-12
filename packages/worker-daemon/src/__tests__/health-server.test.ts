import { afterEach, describe, expect, it } from "vitest";

import { assertLoopbackHost, startHealthServer, type HealthServerHandle } from "../health/health-server.js";
import { createMetrics } from "../metrics/metrics.js";

const openHandles: HealthServerHandle[] = [];

afterEach(async () => {
  while (openHandles.length > 0) {
    const handle = openHandles.pop();
    if (handle) await handle.close();
  }
});

async function get(port: number, pathname: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`);
  return { status: res.status, body: await res.text() };
}

describe("assertLoopbackHost", () => {
  it("accepts numeric loopback hosts", () => {
    expect(() => assertLoopbackHost("127.0.0.1")).not.toThrow();
    expect(() => assertLoopbackHost("::1")).not.toThrow();
  });
  it("rejects non-loopback hosts and the remappable name 'localhost'", () => {
    expect(() => assertLoopbackHost("0.0.0.0")).toThrow(/loopback/i);
    expect(() => assertLoopbackHost("10.0.0.5")).toThrow(/loopback/i);
    // 'localhost' is a name a hosts-file could remap → not accepted (numeric only).
    expect(() => assertLoopbackHost("localhost")).toThrow(/loopback/i);
  });
});

describe("startHealthServer", () => {
  it("binds loopback and serves /healthz + payload-free /metrics", async () => {
    const metrics = createMetrics();
    metrics.setWorkerUp(true);
    const handle = await startHealthServer({ host: "127.0.0.1", port: 0 }, metrics);
    openHandles.push(handle);

    expect(handle.port).toBeGreaterThan(0);

    const health = await get(handle.port, "/healthz");
    expect(health.status).toBe(200);

    const scrape = await get(handle.port, "/metrics");
    expect(scrape.status).toBe(200);
    expect(scrape.body).toContain("worker_up");
    // Payload-free: no tenant/secret content, no obvious identity fields.
    expect(scrape.body).not.toMatch(/organization|company|jobId|secret|token|private/i);

    const missing = await get(handle.port, "/nope");
    expect(missing.status).toBe(404);
  });

  it("rejects a non-loopback bind host before opening a socket", async () => {
    const metrics = createMetrics();
    await expect(startHealthServer({ host: "0.0.0.0", port: 0 }, metrics)).rejects.toThrow(/loopback/i);
  });
});
