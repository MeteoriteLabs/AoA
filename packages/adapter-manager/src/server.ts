// -----------------------------------------------------------------------------
// adapter-manager server (DEP-012 Slice 1 · Units A + B1 + B2).
//
// The out-of-process host of the per-op `SandboxProvider`. `createProviderServer({ provider })`
// mounts an HTTP listener; per request it routes a per-op path, deserializes `{args, ctx}`,
// calls the provider (directly or THROUGH the ownership gate), and serializes `{ok: result}`
// or `{err: <coded>}`. It is PROVIDER-AGNOSTIC — the concrete `E2bSandboxProvider` + key-less
// `MockE2bTransport` are injected by the caller (the component test), so this runtime imports
// no provider and no `e2b` SDK.
//
// ★ EXHAUSTIVE FAIL-CLOSED ROUTING (B2). When GATED (a control-plane public key is pinned),
// EVERY gate-required op — `execute` + the 4 teardown ops + `inspect`/`list` — routes THROUGH
// the ownership gate; there is NO raw `handler` fallback reachable for any of them. The 5 ops
// B2 adds (cancel/kill/destroy/reconcile_cleanup/inspect/list minus execute) have NO Map
// handler at all, so on an UNGATED (keyless) server they 404 — a raw `provider.inspect`/`list`
// (which would leak env/secrets) can NEVER return over the wire. Only `execute` keeps its
// keyless-ungated handler (Unit A back-compat).
//
// ★ NO mTLS / peer-allowlist / net-seg yet. The real topology (`control-net`, mutual-auth,
// peer-allowlist, `internal:true`) is Slice-5 deploy hardening — not modelled here.
// -----------------------------------------------------------------------------

import { createServer, type Server, type ServerResponse } from "node:http";
import type { KeyObject } from "node:crypto";

import type {
  CreateSandboxSpec,
  ExecuteInput,
  ListInput,
  ProviderOpContext,
  SandboxProvider,
} from "@armyofagents/worker-daemon";
import { WireProtocolError, decodeOpRequest, encodeErrResponse, encodeOkResponse } from "@armyofagents/provider-wire/codec";
import type { OwnedLabelsCapability } from "@armyofagents/provider-wire";

import { gateList, gateOwnedOp, redactProjection, type OwnedOpGateDeps } from "./owned-op-gate.js";

export interface CreateProviderServerOptions {
  readonly provider: SandboxProvider;
  /**
   * The pinned control-plane PUBLIC key (DEP-012 Units B1/B2). When PRESENT, the server
   * is GATED: every gate-required op (execute + the 4 teardown ops + inspect/list) must
   * carry a valid owned-labels capability whose labels + generation match the target,
   * else the uniform ResourceNotAvailableError. When ABSENT the server is UNGATED — Unit
   * A's component-test-only / NOT deploy-safe posture (S1.4): only create + execute have
   * handlers, and the 5 B2 ops 404 (a raw inspect/list can never leak). Slice 5's deploy
   * ordering assertion enforces that a real deployment configures the key.
   */
  readonly controlPlanePublicKey?: KeyObject;
  /** Injectable ms-epoch clock for the capability expiry check (default: Date.now). */
  readonly now?: () => number;
}

type OpHandler = (args: unknown, ctx: ProviderOpContext) => Promise<unknown>;

const OP_ROUTE = /^\/op\/([a-z_]+)$/;

// The gate-required ops. On a GATED server every one routes through the ownership gate;
// none has a raw handler. `execute` is BOTH gate-required AND keyless-handler-backed (so an
// UNGATED server keeps Unit A's back-compat execute); the other five are GATED-ONLY.
const GATE_REQUIRED_OPS: ReadonlySet<string> = new Set([
  "execute",
  "cancel",
  "kill",
  "destroy",
  "reconcile_cleanup",
  "inspect",
  "list",
]);

export function createProviderServer(options: CreateProviderServerOptions): Server {
  const { provider } = options;
  const controlPlanePublicKey = options.controlPlanePublicKey;
  const now = options.now ?? (() => Date.now());
  // GATED iff a control-plane public key is pinned. Ungated is Unit A's not-deploy-safe
  // posture — see CreateProviderServerOptions.controlPlanePublicKey.
  const gated = controlPlanePublicKey !== undefined;

  // A Map (not an object literal) so an inherited prototype key like
  // `constructor`/`__proto__` can NEVER resolve to a handler and return a spurious ok.
  // ONLY create (gate-free) + execute (Unit A keyless back-compat) have raw handlers; the
  // five B2 ops are deliberately ABSENT so an ungated server 404s them (never raw).
  const handlers = new Map<string, OpHandler>([
    ["create", (args, ctx) => provider.create(args as CreateSandboxSpec, ctx)],
    ["execute", (args, ctx) => provider.execute(args as ExecuteInput, ctx)],
  ]);

  const gateDeps: OwnedOpGateDeps | null = gated
    ? { provider, controlPlanePublicKey: controlPlanePublicKey!, now }
    : null;

  // Route a gate-required op THROUGH the ownership gate (only reachable when gated).
  function routeGated(
    op: string,
    args: unknown,
    ctx: ProviderOpContext,
    capability: OwnedLabelsCapability | undefined,
  ): Promise<unknown> {
    const deps = gateDeps!;
    switch (op) {
      case "execute": {
        const input = args as ExecuteInput;
        return gateOwnedOp(deps, input.sandboxId, ctx, capability, () => provider.execute(input, ctx));
      }
      case "cancel": {
        const sandboxId = args as string;
        return gateOwnedOp(deps, sandboxId, ctx, capability, () => provider.cancel(sandboxId, ctx));
      }
      case "kill": {
        const sandboxId = args as string;
        return gateOwnedOp(deps, sandboxId, ctx, capability, () => provider.kill(sandboxId, ctx));
      }
      case "destroy": {
        const sandboxId = args as string;
        return gateOwnedOp(deps, sandboxId, ctx, capability, () => provider.destroy(sandboxId, ctx));
      }
      case "reconcile_cleanup": {
        const sandboxId = args as string;
        return gateOwnedOp(deps, sandboxId, ctx, capability, () => provider.reconcileCleanup(sandboxId, ctx));
      }
      case "inspect": {
        const sandboxId = args as string;
        // The gate fetches the detail for the owned-check; the route RETURNS redact(that
        // ALREADY-FETCHED detail) — NEVER provider.inspect raw, NEVER the full detail.
        return gateOwnedOp(deps, sandboxId, ctx, capability, (detail) => Promise.resolve(redactProjection(detail)));
      }
      case "list":
        return gateList(deps, args as ListInput, ctx, capability);
      default:
        // GATE_REQUIRED_OPS is the exhaustive set; this is unreachable.
        return Promise.reject(new WireProtocolError(`operation not available in this slice: ${op}`));
    }
  }

  return createServer((req, res) => {
    // A socket/stream error must never become an uncaught exception (process crash).
    res.on("error", () => {});

    if (req.method === "GET" && req.url === "/healthz") {
      sendJson(res, 200, JSON.stringify({ status: "ok" }));
      return;
    }

    const match = req.method === "POST" && req.url ? OP_ROUTE.exec(req.url) : null;
    if (!match) {
      sendJson(res, 404, encodeErrResponse(new WireProtocolError(`no route for ${req.method} ${req.url ?? ""}`)));
      return;
    }

    const op = match[1];

    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("error", () => {
      sendJson(res, 200, encodeErrResponse(new WireProtocolError("request stream error")));
    });
    req.on("end", () => {
      void (async () => {
        try {
          // GATED + a gate-required op -> the ownership gate (verify capability -> AM-local
          // inspect -> field-wise owned-check -> dispatch). A refusal throws the uniform
          // ResourceNotAvailableError, caught below and coded back symmetrically.
          if (gated && GATE_REQUIRED_OPS.has(op)) {
            const { args, ctx, capability } = decodeOpRequest(body);
            const result = await routeGated(op, args, ctx, capability);
            sendJson(res, 200, encodeOkResponse(result));
            return;
          }
          // Otherwise a raw handler (create always; execute when ungated). An op with no
          // handler — the five B2 ops on an UNGATED server, or a truly unknown op — is a
          // WIRE error (404), never a raw provider.inspect/list and never a silent success.
          const handler = handlers.get(op);
          if (!handler) {
            sendJson(res, 404, encodeErrResponse(new WireProtocolError(`operation not available in this slice: ${op}`)));
            return;
          }
          const { args, ctx } = decodeOpRequest(body);
          const result = await handler(args, ctx);
          sendJson(res, 200, encodeOkResponse(result));
        } catch (err) {
          // The provider's domain errors (SandboxNotFoundError / SandboxEgressDeniedError /
          // UnsupportedProviderOperation / the uniform ResourceNotAvailableError) + a
          // malformed request cross back as coded err envelopes; the driver reconstructs the
          // authoritative class. sendJson is guarded, so this catch can never re-throw.
          sendJson(res, 200, encodeErrResponse(err));
        }
      })();
    });
  });
}

/** Write a JSON body exactly once. Idempotent: a second call (e.g. after a mid-flight
 * stream error already ended the response) is a no-op, so a double-write can never throw
 * `ERR_STREAM_HEADERS_SENT` out of the request handler and crash the process. */
function sendJson(res: ServerResponse, status: number, body: string): void {
  if (res.headersSent || res.writableEnded) return;
  try {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(body);
  } catch {
    // The socket was destroyed between the guard and the write — swallow; there is no
    // response to send and nothing to recover.
  }
}
