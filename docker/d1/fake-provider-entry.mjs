// -----------------------------------------------------------------------------
// DEP-002 fake-provider service entry (harness glue — NOT part of the DEP-000
// package). It wraps the committed @armyofagents/sandbox-fake-provider driver +
// invocation ledger and exposes them over the container network on TWO ports:
//
//   * DECLARED API  (AOA_FAKE_PROVIDER_API_PORT, default 8080) — /healthz,
//     /invoke, /replay. Reachable by control-plane + workers (the provider
//     execute/driver surface).
//   * CONTROL endpoint (AOA_FAKE_PROVIDER_CTL_PORT, default 8081) — /script,
//     /reset, /invocations. Guarded by an application-layer PEER ALLOWLIST
//     (AOA_FAKE_PROVIDER_CTL_ALLOW) so only workers + the test-runner may script
//     fixtures; the control-plane is refused (403). FAIL-CLOSED (FIX B): an
//     empty/unset allowlist DENIES all; opening it requires the explicit sentinel
//     AOA_FAKE_PROVIDER_CTL_ALLOW='*'. See docker/d1/ctl-allowlist.mjs.
//
// NOTE ON THE BOUNDARY: the plan §2.3 places control-plane on provider-ctl-net
// ("declared provider API only") while requiring the control endpoint be
// unreachable BY control-plane. Because control-plane shares all three of the
// fake's networks, that boundary is NOT expressible by Docker network
// segmentation alone; it is enforced here at the application layer (peer
// allowlist). See docker/d1/README.md "control-endpoint boundary" + the DEP-002
// result note. This file is deferred-to-CI (never run locally on Windows).
// -----------------------------------------------------------------------------

import { createServer } from "node:http";
import { createPublicKey } from "node:crypto";
import { lookup } from "node:dns/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createFakeSandboxProvider,
  createFakeSandboxProviderPort,
  createNodeEvalRunner,
  loadFixtureFromDir,
  sha256Hex,
} from "@armyofagents/sandbox-fake-provider";
import { PROVIDER_OPERATIONS } from "@armyofagents/worker-protocol";

import { parseCtlAllow, isCtlPeerAllowed } from "./ctl-allowlist.mjs";

const API_PORT = Number(process.env.AOA_FAKE_PROVIDER_API_PORT ?? "8080");
const CTL_PORT = Number(process.env.AOA_FAKE_PROVIDER_CTL_PORT ?? "8081");
// FAIL-CLOSED (FIX B): empty/unset => deny all; explicit '*' sentinel => open.
const CTL_ALLOW = parseCtlAllow(process.env.AOA_FAKE_PROVIDER_CTL_ALLOW);
const ALLOW = CTL_ALLOW.peers; // sentinel-free peer hostnames to resolve to IPs
const FIXTURES_DIR =
  process.env.AOA_FAKE_PROVIDER_FIXTURES_DIR ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "tests", "fixtures", "distributed-execution");

const OP_SET = new Set(PROVIDER_OPERATIONS);
const provider = createFakeSandboxProvider();

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.trim() === "") return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function normalizeIp(addr) {
  if (!addr) return "";
  return addr.startsWith("::ffff:") ? addr.slice(7) : addr;
}

// Resolve the allowlisted peer hostnames to IPs at startup (docker DNS).
async function resolveAllowedIps() {
  const ips = new Set();
  for (const host of ALLOW) {
    try {
      const results = await lookup(host, { all: true });
      for (const r of results) ips.add(normalizeIp(r.address));
    } catch {
      // A peer that does not resolve yet is simply not admitted; re-resolved lazily.
    }
  }
  return ips;
}

// --- declared API (execute/driver) ------------------------------------------
const apiServer = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const route = `${req.method} ${url.pathname}`;
  (async () => {
    if (route === "GET /healthz") return send(res, 200, { ok: true });
    if (route === "POST /invoke") {
      const body = await readBody(req);
      const providerId = String(body.providerId ?? "");
      const op = String(body.op ?? "");
      if (providerId === "") return send(res, 400, { ok: false, error: "providerId is required" });
      if (!OP_SET.has(op)) return send(res, 400, { ok: false, error: `unknown provider operation: ${op}` });
      const args = { providerId, ...(body.args ?? {}) };
      const result = await provider.makeDriver(providerId).invoke(op, args);
      return send(res, 200, { ok: true, result });
    }
    if (route === "POST /replay") {
      const body = await readBody(req);
      const providerId = String(body.providerId ?? "");
      if (providerId === "") return send(res, 400, { ok: false, error: "providerId is required" });
      return send(res, 200, { ok: true, result: await provider.replay(providerId) });
    }
    return send(res, 404, { ok: false, error: `no route: ${route}` });
  })().catch((err) => send(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) }));
});

// --- control endpoint (peer-gated) ------------------------------------------
let allowedIps = new Set();
const ctlServer = createServer((req, res) => {
  const peer = normalizeIp(req.socket.remoteAddress ?? "");
  // FAIL-CLOSED: deny unless '*' sentinel OR the peer's IP resolved from the
  // (non-empty) allowlist. An empty/unset allowlist denies every peer.
  if (!isCtlPeerAllowed(CTL_ALLOW, allowedIps, peer)) {
    return send(res, 403, { ok: false, error: `control endpoint is peer-restricted; ${peer || "<unknown>"} is not allowlisted` });
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const route = `${req.method} ${url.pathname}`;
  (async () => {
    if (route === "GET /invocations") {
      return send(res, 200, provider.invocations(url.searchParams.get("providerId") ?? undefined));
    }
    if (route === "POST /reset") {
      provider.reset();
      return send(res, 200, { ok: true });
    }
    if (route === "POST /script") {
      const body = await readBody(req);
      const providerId = String(body.providerId ?? "");
      if (providerId === "") return send(res, 400, { ok: false, error: "providerId is required" });
      const fixture = await provider.script({
        providerId,
        fixture: body.fixture,
        fixtureId: typeof body.fixtureId === "string" ? body.fixtureId : undefined,
        loadFixture: (id) => loadFixtureFromDir(FIXTURES_DIR, id),
        failureInjection: body.failureInjection ?? null,
        includeAllCheckpoints: body.includeAllCheckpoints === true,
        // DEP-016 — `canned` (default) | `suppressed`; the driver refuses any other value.
        // `suppressed` is the m1-spine profile's positive control (execute reports usage: null).
        usageMode: body.usageMode === undefined ? undefined : body.usageMode,
      });
      return send(res, 200, { ok: true, fixtureId: fixture.id });
    }
    return send(res, 404, { ok: false, error: `no route: ${route}` });
  })().catch((err) => send(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) }));
});

// --- DEP-019: the provider WIRE (the face a DEPLOYED worker reaches) --------
//
// `POST /op/<op>` with `{args, ctx, capability}` — the adapter-manager's own
// `createProviderServer`, over the reference provider's per-op port. It is the REAL server and
// the REAL ownership gate, not a hand-rolled double: the point of this lane is to prove the
// DEPLOYED worker performs the journey, and a re-implemented wire would move the thing under
// test into the harness.
//
// OFF BY DEFAULT. Without `AOA_FAKE_PROVIDER_WIRE_PORT` nothing is imported and nothing listens,
// so the `bounded`/`foundation` train sees this service exactly as before.
//
// ★ ARMED, IT IS A REFUSAL-TO-BOOT OR A GATED SERVER — never an ungated one.
// `createProviderServer`'s `controlPlanePublicKey` is OPTIONAL and the whole gate reduces to
// `gated = controlPlanePublicKey !== undefined`, so a missing key would leave create + execute on
// RAW, UNGATED handlers. Every way the key can fail to load is therefore an exit(1) here, exactly
// as `bin/adapter-manager.ts` fail-closes for the same reason. A private key is refused too:
// `createPublicKey` would silently derive the public half of one.
async function startWireServer() {
  const wirePort = Number(process.env.AOA_FAKE_PROVIDER_WIRE_PORT ?? "");
  if (!Number.isInteger(wirePort) || wirePort <= 0) return null;

  const wireAppDir = process.env.AOA_FAKE_PROVIDER_WIRE_APP_DIR ?? "/wire-app";
  const keyPath = (process.env.AOA_FAKE_PROVIDER_CONTROL_PLANE_PUBLIC_KEY_FILE ?? "").trim();
  if (keyPath === "") {
    throw new Error(
      "AOA_FAKE_PROVIDER_WIRE_PORT is set but AOA_FAKE_PROVIDER_CONTROL_PLANE_PUBLIC_KEY_FILE is not; " +
        "refusing to start an UNGATED provider wire",
    );
  }
  const bytes = readFileSync(keyPath);
  if (bytes.toString("utf8").includes("PRIVATE KEY")) {
    throw new Error(
      "AOA_FAKE_PROVIDER_CONTROL_PLANE_PUBLIC_KEY_FILE points at a PRIVATE key — mount the ed25519 PUBLIC SPKI PEM only",
    );
  }
  const controlPlanePublicKey = createPublicKey(bytes);
  if (controlPlanePublicKey.asymmetricKeyType !== "ed25519") {
    throw new Error(
      `AOA_FAKE_PROVIDER_CONTROL_PLANE_PUBLIC_KEY_FILE is a ${String(controlPlanePublicKey.asymmetricKeyType)} key, expected ed25519`,
    );
  }

  // ★ THE PROBE-SCRIPT PIN, built from the DAEMON'S OWN CONSTANT (Codex P1, PR #572). The
  // wrapper is published in this repo and `$0` comes from the job envelope, so pinning the
  // wrapper alone would let a job put arbitrary JavaScript in `$0`. Importing `ENV_PROBE_SCRIPT`
  // here — out of the wire tree's own worker-daemon build — means the pin has no second copy that
  // could drift from what `DEP-017` actually ships.
  const { ENV_PROBE_SCRIPT, ENV_PROBE_METADATA_URL } = await import(
    `${wireAppDir}/node_modules/@armyofagents/worker-daemon/dist/supervisor/env-probe.js`
  );
  const allowedProbeScriptDigests = new Set([sha256Hex(ENV_PROBE_SCRIPT)]);
  // ★ AND THE ARGUMENTS (Codex P2, PR #572). The pinned script reads `argv[2]` as a metadata URL
  // and `fetch`es it, so pinning the bytes alone would still let a job choose the address this
  // host dials. Taken from the daemon's OWN constant, for the same no-second-copy reason.
  if (typeof ENV_PROBE_METADATA_URL !== "string" || ENV_PROBE_METADATA_URL === "") {
    throw new Error("the worker-daemon build exports no ENV_PROBE_METADATA_URL; refusing to run the probe unpinned");
  }

  const { createProviderServer } = await import(`${wireAppDir}/dist/server.js`);
  const wireProvider = createFakeSandboxProviderPort({
    runNodeEval: createNodeEvalRunner(),
    allowedProbeScriptDigests,
    allowedProbeMetadataUrl: ENV_PROBE_METADATA_URL,
  });
  const server = createProviderServer({ provider: wireProvider, controlPlanePublicKey });
  server.listen(wirePort, "0.0.0.0", () =>
    console.log(
      `fake-provider GATED provider wire on 0.0.0.0:${wirePort} ` +
        `(1 pinned probe-script digest + a pinned probe argv shape; ownership gate ON)`,
    ),
  );
  return server;
}

async function start() {
  allowedIps = await resolveAllowedIps();
  // Re-resolve the allowlist periodically so peers that start later are admitted.
  setInterval(() => {
    resolveAllowedIps().then((ips) => (allowedIps = ips)).catch(() => {});
  }, 5000).unref();
  apiServer.listen(API_PORT, "0.0.0.0", () => console.log(`fake-provider declared API on 0.0.0.0:${API_PORT}`));
  const allowDesc = CTL_ALLOW.open ? "* (OPEN)" : ALLOW.join(",") || "<none> (fail-closed: deny all)";
  ctlServer.listen(CTL_PORT, "0.0.0.0", () => console.log(`fake-provider control endpoint on 0.0.0.0:${CTL_PORT} (allow: ${allowDesc})`));
  // DEP-019 — LAST, and its failure is fatal: `start()`'s catch exits 1. A wire that was asked
  // for and did not come up must not leave a half-started service that the compose reports
  // healthy (the healthcheck probes the declared API only).
  await startWireServer();
}

start().catch((err) => {
  console.error("fake-provider entry failed:", err);
  process.exit(1);
});
