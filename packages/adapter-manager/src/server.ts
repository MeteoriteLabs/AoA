// -----------------------------------------------------------------------------
// adapter-manager server (DEP-012 Slice 1 · Unit A).
//
// The out-of-process host of the per-op `SandboxProvider`. `createProviderServer({ provider })`
// mounts an HTTP listener; per request it routes a per-op path, deserializes `{args, ctx}`,
// calls `provider.<op>(args, ctx)`, and serializes `{ok: result}` or `{err: <coded>}`. It is
// PROVIDER-AGNOSTIC — the concrete `E2bSandboxProvider` + key-less `MockE2bTransport` are
// injected by the caller (the component test), so this runtime imports no provider and no
// `e2b` SDK.
//
// The codec is imported from the `/codec.js` SUBPATH (not the package barrel) so the
// networked DRIVER is not evaluated into the SERVER's process closure — the server needs the
// (de)serialization only, not the client.
//
// UNIT A wires `create` + `execute` only (+ `/healthz`, reusing the D1 healthcheck shape).
//
// ★ execute has NO server-side ownership gate here and is COMPONENT-TEST-ONLY / NOT
// deploy-safe (S1.1/S1.4). Over a REACHABLE wire an ungated execute is an existence oracle
// + a cross-tenant code-execution vector; it is admissible ONLY in this single-tenant
// loopback test. Unit B builds execute's ownership gate + the six gate-required ops.
//
// ★ NO mTLS / peer-allowlist / net-seg yet. The real topology (`control-net`, mutual-auth,
// peer-allowlist, `internal:true`) is Slice-5 deploy hardening — not modelled here.
// -----------------------------------------------------------------------------

import { createServer, type Server, type ServerResponse } from "node:http";
import type { KeyObject } from "node:crypto";

import type { CreateSandboxSpec, ExecuteInput, ProviderOpContext, SandboxProvider } from "@armyofagents/worker-daemon";
import { WireProtocolError, decodeOpRequest, encodeErrResponse, encodeOkResponse } from "@armyofagents/provider-wire/codec";

import { gateExecute } from "./execute-gate.js";

export interface CreateProviderServerOptions {
  readonly provider: SandboxProvider;
  /**
   * The pinned control-plane PUBLIC key (DEP-012 Unit B1). When PRESENT, `execute` is
   * GATED: every execute request must carry a valid owned-labels capability whose labels
   * + generation match the target sandbox, else the uniform ResourceNotAvailableError.
   * When ABSENT the server is UNGATED — Unit A's component-test-only / NOT deploy-safe
   * posture (S1.4), admissible solely for the single-tenant loopback test. Slice 5's
   * deploy ordering assertion enforces that a real deployment configures the key.
   */
  readonly controlPlanePublicKey?: KeyObject;
  /** Injectable ms-epoch clock for the capability expiry check (default: Date.now). */
  readonly now?: () => number;
}

type OpHandler = (args: unknown, ctx: ProviderOpContext) => Promise<unknown>;

const OP_ROUTE = /^\/op\/([a-z_]+)$/;

export function createProviderServer(options: CreateProviderServerOptions): Server {
  const { provider } = options;
  const controlPlanePublicKey = options.controlPlanePublicKey;
  const now = options.now ?? (() => Date.now());
  // GATED iff a control-plane public key is pinned. Ungated is Unit A's not-deploy-safe
  // posture — see CreateProviderServerOptions.controlPlanePublicKey.
  const gated = controlPlanePublicKey !== undefined;

  // A Map (not an object literal) so an inherited prototype key like
  // `constructor`/`__proto__` can NEVER resolve to a handler and return a spurious ok.
  // When gated, `execute` is routed through the ownership gate below instead of this
  // ungated handler (which remains the Unit-A / keyless-server behavior).
  const handlers = new Map<string, OpHandler>([
    ["create", (args, ctx) => provider.create(args as CreateSandboxSpec, ctx)],
    ["execute", (args, ctx) => provider.execute(args as ExecuteInput, ctx)],
  ]);

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
    const handler = handlers.get(op);

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
          if (!handler) {
            // A known route shape but an op Unit A has not wired -> a WIRE error, never a
            // silent success (Unit B adds the remaining ops).
            sendJson(res, 404, encodeErrResponse(new WireProtocolError(`operation not available in this slice: ${op}`)));
            return;
          }
          const { args, ctx, capability } = decodeOpRequest(body);
          // GATED execute goes through the server-side ownership gate (verify capability
          // -> AM-local inspect -> field-wise owned-check -> dispatch), NOT the ungated
          // handler. A refusal throws the uniform ResourceNotAvailableError, caught below
          // and coded back symmetrically. Every other op (create today) uses its handler.
          const result =
            op === "execute" && gated
              ? await gateExecute(
                  { provider, controlPlanePublicKey: controlPlanePublicKey!, now },
                  args as ExecuteInput,
                  ctx,
                  capability,
                )
              : await handler(args, ctx);
          sendJson(res, 200, encodeOkResponse(result));
        } catch (err) {
          // The provider's domain errors (SandboxNotFoundError / SandboxEgressDeniedError /
          // UnsupportedProviderOperation) + a malformed request cross back as coded err
          // envelopes; the driver reconstructs the authoritative class. sendJson itself is
          // guarded, so this catch can never re-throw out of the async handler.
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
