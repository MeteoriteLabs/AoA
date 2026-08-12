/**
 * Loopback-only health + payload-free metrics HTTP surface (WRK-001).
 *
 * Binds a tiny `node:http` server to a loopback address only, exposing
 * `GET /healthz` (liveness) and `GET /metrics` (payload-free bounded counters).
 * It exposes no tenant data and no remote-reachable interface; a non-loopback
 * bind host is rejected BEFORE any socket opens (H-06 network boundary).
 */

import { createServer, type Server } from "node:http";

import { isLoopbackHost } from "../config/config.js";
import type { Metrics } from "../metrics/metrics.js";

/** Throw unless `host` is a loopback bind address (single source: config). */
export function assertLoopbackHost(host: string): void {
  if (!isLoopbackHost(host)) {
    throw new Error(
      `health host ${JSON.stringify(host)} is not loopback; refusing to bind a ` +
        "remote-reachable health/metrics surface",
    );
  }
}

export interface HealthServerConfig {
  readonly host: string;
  readonly port: number;
}

export interface HealthServerHandle {
  /** The actually-bound port (useful when port 0 is requested in tests). */
  readonly port: number;
  close(): Promise<void>;
}

export async function startHealthServer(
  config: HealthServerConfig,
  metrics: Metrics,
): Promise<HealthServerHandle> {
  // Reject a non-loopback host BEFORE any socket is created.
  assertLoopbackHost(config.host);

  const server: Server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (req.method === "GET" && url === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("ok\n");
      return;
    }
    if (req.method === "GET" && url === "/metrics") {
      res.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
      res.end(metrics.renderPrometheus());
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found\n");
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: unknown) => reject(err);
    server.once("error", onError);
    server.listen(config.port, config.host, () => {
      server.removeListener("error", onError);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : config.port;

  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
