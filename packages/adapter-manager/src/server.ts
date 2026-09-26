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
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  CreateSandboxSpec,
  ExecuteInput,
  ListInput,
  ProviderOpContext,
  ResourceLabels,
  SandboxProvider,
  StagedFileRequest,
} from "@armyofagents/worker-daemon";
import { createRunOutputCapture } from "@armyofagents/worker-daemon";
import {
  EXECUTE_CAPTURE_STDOUT_KEY,
  EXECUTE_STDOUT_TAIL_KEY,
  WireProtocolError,
  decodeOpRequest,
  encodeErrResponse,
  encodeOkResponse,
  isModelledWireError,
} from "@armyofagents/provider-wire/codec";
import type { OwnedLabelsCapability } from "@armyofagents/provider-wire";
import { EXPORT_TEARDOWN_RESERVE_MS } from "@armyofagents/worker-daemon";

import { gateList, gateOwnedOp, redactProjection, type OwnedOpGateDeps } from "./owned-op-gate.js";
import { gateCreate, type CreateGateDeps } from "./create-gate.js";
import { IdempotencyLedger } from "./idempotency-ledger.js";
import { KeyedMutex } from "./keyed-mutex.js";
import { createReaperMetrics, renderReaperMetrics, type ReaperMetricsCounter } from "./reaper-metrics.js";
import { classifyOpFailure, formatOpFailure, type OpFailureClassification } from "./op-failure-classification.js";

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
  /**
   * The durable idempotency ledger's runtime directory (DEP-012 Slice 3 · β1). Used
   * ONLY on a GATED server — every gated `create` records `(identity, idempotencyKey)`
   * here. A real deployment (β2) points it at a configured, out-of-tree volume (a
   * shared volume across replicas is deploy-owed). When omitted on a gated server it
   * defaults to a fresh OS temp dir (component-test posture — per-instance, ephemeral,
   * out-of-tree); an ungated server never constructs a ledger at all.
   */
  readonly idempotencyLedgerDir?: string;
  /**
   * DEP-011 reaper Slice C — the ONE shared AM-local metric counter, created by the bin
   * BEFORE `startServer` and passed into BOTH `/metrics` (here) AND the reaper loop
   * (B2C-F9). When omitted, `/metrics` renders zeros (an ungated server still calls
   * `createProviderServer`, and a gated server with the reaper flag off has no loop).
   */
  readonly reaperMetrics?: ReaperMetricsCounter;
  /**
   * DAT-009-3e — the object-store ORIGINS (`https://host[:port]`) an `export_artifact` upload grant
   * may target. The grant is WORKER-SUPPLIED, so without this a worker holding a valid capability
   * for its own sandbox could hand in a forged grant and have the far provider PUT the sandbox's
   * bytes to any HTTPS endpoint (Codex P1, PR #557). FAIL-CLOSED: absent or empty ⇒ every export
   * is refused. The shipped bin does not set it yet, so a deployed adapter-manager refuses exports
   * until the store origin is configured.
   */
  readonly artifactUploadOrigins?: readonly string[];
  /**
   * E6-F024 — receives the REDACTED classification of every provider-op failure that the leak
   * fence below maps to the generic `WireProtocolError`. Every field is from a closed
   * vocabulary (`op-failure-classification.ts`): never a URL, header, grant, key or message.
   * Defaults to one `console.error` line, so a failure is never silent on the adapter-manager.
   */
  readonly onOpFailure?: (classification: OpFailureClassification) => void;
}

function logOpFailure(classification: OpFailureClassification): void {
  console.error("adapter-manager provider operation failed", classification);
}

type OpHandler = (args: unknown, ctx: ProviderOpContext) => Promise<unknown>;

const OP_ROUTE = /^\/op\/([a-z_]+)$/;

// The gate-required ops. On a GATED server every one routes through a gate; none is
// reached by a raw handler when gated. `create` + `execute` are BOTH gate-required AND
// keyless-handler-backed (so an UNGATED server keeps Unit A's back-compat create +
// execute); the other five are GATED-ONLY. `create` uses the DISTINCT create-gate
// (verify -> spec-label match -> the durable ledger), NOT `gateOwnedOp`.
//
// ★ `create` joins the set AND the `routeGated` switch in the SAME change (β1.2 R2): the
// set and the switch move together, else a gated `create` falls to the `default` reject.
const GATE_REQUIRED_OPS: ReadonlySet<string> = new Set([
  "create",
  "execute",
  "cancel",
  "kill",
  "destroy",
  "reconcile_cleanup",
  "inspect",
  "list",
  // E7-F011 — staging writes into a live OWNED sandbox, so it is a single-sandbox owned op:
  // GATED-ONLY (no keyless raw handler below), routed through `gateOwnedOp`. An ungated
  // server 404s it, matching the B2 teardown ops, because it carries a bearer grant.
  "stage_files",
  // DAT-009-3e — the artifact pair, on the `stage_files` precedent: each reads out of (digest) or
  // uploads from (export, carrying a bearer UPLOAD grant) ONE live owned sandbox, so each is a
  // single-sandbox owned op, GATED-ONLY, routed through `gateOwnedOp`. Neither is a member of the
  // frozen `ProviderOperation` vocabulary, and neither becomes one.
  "digest_artifact",
  "export_artifact",
  // CLI-012 — the metadata-only output enumeration, on the same precedent: it READS the
  // directory tree of ONE live owned sandbox, which is itself a disclosure about that tenant's
  // work, so it is a single-sandbox owned op, GATED-ONLY, routed through `gateOwnedOp`. It is
  // not a member of the frozen `ProviderOperation` vocabulary and does not become one.
  "enumerate_outputs",
]);

export function createProviderServer(options: CreateProviderServerOptions): Server {
  const { provider } = options;
  const controlPlanePublicKey = options.controlPlanePublicKey;
  const now = options.now ?? (() => Date.now());
  // GATED iff a control-plane public key is pinned. Ungated is Unit A's not-deploy-safe
  // posture — see CreateProviderServerOptions.controlPlanePublicKey.
  const gated = controlPlanePublicKey !== undefined;
  // The shared reaper metric counter (or a fresh zeroed one so `/metrics` renders zeros
  // when no reaper is wired). Slice C's loop mutates the SAME ref on the single event loop.
  const reaperMetrics = options.reaperMetrics ?? createReaperMetrics();
  const onOpFailure = options.onOpFailure ?? logOpFailure;

  // A Map (not an object literal) so an inherited prototype key like
  // `constructor`/`__proto__` can NEVER resolve to a handler and return a spurious ok.
  // ONLY create (gate-free) + execute (Unit A keyless back-compat) have raw handlers; the
  // five B2 ops are deliberately ABSENT so an ungated server 404s them (never raw).
  const handlers = new Map<string, OpHandler>([
    ["create", (args, ctx) => provider.create(args as CreateSandboxSpec, ctx)],
    ["execute", (args, ctx) => executeRelayingStdout(provider, args, ctx)],
  ]);

  // The durable ledger + the per-(identity,key) create mutex exist ONLY on a gated
  // server (the create-gate's idempotency authority). The ledger dir is configured, or
  // defaults to a fresh OS temp dir (out-of-tree — never the repo, β1.7).
  const createGateDeps: CreateGateDeps | null = gated
    ? {
        provider,
        controlPlanePublicKey: controlPlanePublicKey!,
        now,
        ledger: new IdempotencyLedger({
          dir: options.idempotencyLedgerDir ?? mkdtempSync(join(tmpdir(), "aoa-am-ledger-")),
        }),
        createLock: new KeyedMutex(),
      }
    : null;

  const artifactUploadOrigins: ReadonlySet<string> = new Set(options.artifactUploadOrigins ?? []);
  /**
   * DAT-009-3e (Codex P1, third round on PR #557) — object keys whose export has already SUCCEEDED
   * on this instance. A redemption is ONE-TIME.
   *
   * ★ WHY. The grant's integrity fields (`expectedSha256`, `maxBytes`) are WORKER-SUPPLIED and no
   * control-plane signature covers them — the presigned url binds the checksum ALGORITHM, never the
   * value. A worker that keeps a url it already redeemed could therefore hand in the same
   * url/objectKey with a different `expectedSha256` and re-PUT different bytes under the key the
   * fenced commit already verified. The control plane refuses to MINT a second grant for a
   * committed artifact (`artifact-transfer-grant.ts`); replaying the first grant went around that,
   * so the adapter-manager refuses the second redemption itself.
   *
   * ★ WHAT THIS IS NOT. It is per-INSTANCE and in-memory: it does not survive a restart and does
   * not reach a second replica, and two concurrent first-exports of one key can both pass. It
   * narrows the replay; it does not authenticate the grant. Only a control-plane-signed grant
   * covering the integrity fields would, and that is a frozen-`worker-protocol` change this ticket
   * may not make (see the result doc's stop).
   *
   * A FAILED export records nothing, so an honest retry still works, and a REPLAY under the same
   * `idempotencyKey` returns the recorded result rather than being refused — `ProviderOpContext`'s
   * own contract is "a repeated key returns the recorded result and does not double-apply", and a
   * lost response must not turn a stored object into a missing output (Codex P2, PR #557).
   *
   * ★ BOUNDED IN TIME, on the SERVER's own clock (Codex P2 then P1, fifth and sixth rounds). The
   * first attempt retained each record for the grant's own `expiresAt` — which is WORKER-SUPPLIED
   * and unauthenticated, so a worker could shorten it, wait for its own record to be evicted, and
   * then replay the still-live url with different bytes. Retention is therefore a fixed
   * server-side window (`UPLOAD_REDEMPTION_RETENTION_MS`) measured from the redemption, which no
   * worker field can shorten, and the map stays bounded by the exports in one window.
   */
  const redeemedUploads = new Map<string, { idempotencyKey: string; result: unknown; recordedAtMs: number }>();

  const gateDeps: OwnedOpGateDeps | null = gated
    ? { provider, controlPlanePublicKey: controlPlanePublicKey!, now, sandboxLock: new KeyedMutex() }
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
      case "create": {
        // The DISTINCT create-gate (no inspect): verify -> spec-label match -> the
        // durable ledger -> provider.create with a stripped key. NOT gateOwnedOp.
        return gateCreate(createGateDeps!, args as CreateSandboxSpec, ctx, capability);
      }
      case "execute": {
        const input = args as ExecuteInput;
        return gateOwnedOp(deps, input.sandboxId, ctx, capability, () => executeRelayingStdout(provider, args, ctx));
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
      case "stage_files": {
        // E7-F011 — a single-sandbox owned mutation (writes files into the live sandbox).
        // Same gate as execute/cancel: verify capability -> AM-local inspect -> field-wise
        // owned-check -> dispatch. The far provider redeems each file's download grant,
        // verifies sha256/maxBytes, and writes; only the result paths cross back.
        const { sandboxId, files } = args as { sandboxId: string; files: readonly StagedFileRequest[] };
        return gateOwnedOp(deps, sandboxId, ctx, capability, () => provider.stageFiles(sandboxId, files, ctx));
      }
      case "enumerate_outputs": {
        // CLI-012 — METADATA ONLY: paths, byte sizes and link markers cross back, never content.
        // Owned-checked first, for the same reason `digest_artifact` is: the shape of another
        // tenant's output tree is a disclosure about that tenant even with no bytes attached.
        const { sandboxId, root } = args as { sandboxId: string; root: string };
        return gateOwnedOp(
          deps,
          sandboxId,
          ctx,
          capability,
          (_detail, remainingMs) => {
            // Bounded for the same reason the artifact pair is: this runs under the per-sandbox
            // lock, and the budget is what is LEFT after the mutex queue, which the gate measures.
            if (remainingMs === undefined || !(remainingMs > 0)) {
              return Promise.reject(
                new WireProtocolError("enumerate_outputs refused: no budget left before the teardown reserve"),
              );
            }
            return provider.enumerateOutputs(sandboxId, root, { ...ctx, deadlineMs: remainingMs });
          },
          // The deadline covers the ownership inspection too — `inspect` honours no deadline of
          // its own and it runs inside the lock.
          artifactOpDeadlineAtMs(ctx, capability, now()),
        );
      }
      case "digest_artifact": {
        // DAT-009-3e — metadata only (sha256 + byte size), never content. Owned-checked first: a
        // digest of another tenant's file is itself a disclosure (it confirms content by hash).
        const { sandboxId, path } = args as { sandboxId: string; path: string };
        return gateOwnedOp(
          deps,
          sandboxId,
          ctx,
          capability,
          (_detail, remainingMs) => {
            // Bounded for the same reason the export is: this runs under the per-sandbox lock. The
            // budget is what is LEFT after the mutex queue, which the gate measures.
            if (remainingMs === undefined || !(remainingMs > 0)) {
              return Promise.reject(new WireProtocolError("digest_artifact refused: no budget left before the teardown reserve"));
            }
            return provider.digestArtifact(sandboxId, path, { ...ctx, deadlineMs: remainingMs });
          },
          // The deadline covers the ownership inspection too — the provider's `inspect` honours no
          // deadline of its own, and it runs inside the lock.
          artifactOpDeadlineAtMs(ctx, capability, now()),
        );
      }
      case "export_artifact": {
        // DAT-009-3e — the far provider re-reads, re-verifies size + sha256 against the grant AT
        // THE CAUSE, and PUTs to the store; only `{objectKey}` crosses back, never bytes. The grant
        // is a bearer capability: it is never logged here, and an unmodelled failure's message
        // (which names the path and digests) is replaced by the leak fence below.
        // The grant type is taken from the PORT (not imported from worker-protocol), keeping this
        // package's manifest at its three declared dependencies.
        const { sandboxId, path, grant } = args as {
          sandboxId: string;
          path: string;
          grant: Parameters<SandboxProvider["exportArtifact"]>[2];
        };
        // ★ The grant is bound BEFORE the provider runs (after the owned-check, so `detail` carries
        // the caller's own verified labels): a refused grant reads nothing and uploads nothing.
        // ★ BOUNDED (Codex P1, PR #557). `gateOwnedOp` holds the per-sandbox lock across the
        // ownership inspection AND this dispatch, so anything unbounded in either would queue the
        // run's own destroy behind it. The budget is the capability's remaining life minus
        // EXPORT_TEARDOWN_RESERVE_MS, the same clamp the supervisor applies to its export window,
        // so destroy always keeps its reserve. It is passed BOTH to the provider (which aborts the
        // read and the upload on it) and to the gate (which releases the lock on it).
        return gateOwnedOp(
          deps,
          sandboxId,
          ctx,
          capability,
          (detail, remainingMs) => {
            assertUploadGrantBound(grant, detail.resourceLabels, artifactUploadOrigins, now());
            if (remainingMs === undefined || !(remainingMs > 0)) {
              return Promise.reject(new WireProtocolError("export_artifact refused: no budget left before the teardown reserve"));
            }
            const objectKey = (grant as { objectKey: string }).objectKey;
            const nowMs = now();
            for (const [key, record] of redeemedUploads) {
              if (nowMs - record.recordedAtMs > UPLOAD_REDEMPTION_RETENTION_MS) redeemedUploads.delete(key);
            }
            const redeemed = redeemedUploads.get(objectKey);
            if (redeemed !== undefined) {
              // Lost-response REPLAY under the same key: hand back the recorded result, upload
              // nothing. Any OTHER key is a re-PUT of an already-stored object and is refused.
              if (redeemed.idempotencyKey === ctx.idempotencyKey) return Promise.resolve(redeemed.result);
              return Promise.reject(new WireProtocolError("export_artifact refused: this object key has already been uploaded"));
            }
            return provider.exportArtifact(sandboxId, path, grant, { ...ctx, deadlineMs: remainingMs }).then((result) => {
              // Recorded only on SUCCESS: a failed export must stay retryable.
              redeemedUploads.set(objectKey, { idempotencyKey: ctx.idempotencyKey, result, recordedAtMs: now() });
              return result;
            });
          },
          artifactOpDeadlineAtMs(ctx, capability, now()),
        );
      }
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

    // DEP-011 reaper Slice C — the metric surface (Prometheus text). Renders zeros when no
    // reaper is wired (Slice 5 owns the scrape target). Beside /healthz, same guarded write.
    if (req.method === "GET" && req.url === "/metrics") {
      sendText(res, 200, renderReaperMetrics(reaperMetrics));
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
          //
          // ★ [Cred-2] (DEP-012 Slice 4+5) — the leak fence. A raw e2b SDK throw reaching
          // here would be forwarded VERBATIM by serializeError, whose TWO unmodelled arms
          // (`err instanceof Error → err.message` AND the non-Error `String(err)`) can carry
          // a leaked provider-auth value (nothing wraps the SDK call that receives envVars).
          // So AM-LOCALLY (not the shared codec — no other consumer perturbed), map ANY error
          // that is not a MODELLED wire class to a FIXED generic WireProtocolError BEFORE
          // encoding — dropping both raw-text arms at once. Modelled classes pass as-is (their
          // messages are fixed by the class vocabulary, never tenant data).
          //
          // ★ E6-F024 — the fence dropped the CAUSE along with the text, so every failure read
          // the same on both sides (the DEP-015 keyed run: a presign host the AM could not
          // reach, logged nowhere). The classification restores the cause from a CLOSED
          // vocabulary only — op, a known error class, a coarse cause, a known error code, an
          // HTTP status — never message text, so the fence still holds. It is logged here and
          // carried in the fixed message for the worker to log.
          //
          // CLI-017-B, round 3 (Codex round 2 on PR #592, ruled by the planning session) — THE
          // CLASSIFICATION IS COMPUTED AND LOGGED FOR **EVERY** FAILURE, INCLUDING THE MODELLED
          // ONES, AND THAT ORDERING IS THE WHOLE FIX.
          //
          // Round 1 added the three SD-5 export refusals to `isModelledWireError` so their CLASS
          // would survive the hop. Correct, and it had a side effect nobody would see by reading
          // the diff: the early return below then fired for exactly those errors, so
          // `classifyOpFailure`'s new refusal branches became UNREACHABLE on the production path.
          // That is worse than never having added them — a reader sees classification code and
          // assumes classification happens, while the operator log holds nothing at all for the
          // one class of failure they most need to tell apart (a file refused for carrying a
          // credential vs. a store the adapter-manager could not reach). A FALSE CLAIM OF
          // ENFORCEMENT IS WORSE THAN A MISSING CHECK.
          //
          // So the classification is computed FIRST and logged for every failure. The modelled
          // arm's RESPONSE is unchanged — it still returns the coded envelope so the driver
          // reconstructs the authoritative class — but the adapter-manager's own operator log now
          // names a cause either way. The fence is untouched: the classification is drawn from a
          // CLOSED vocabulary and never from message text, so logging it for a modelled error
          // cannot carry anything a modelled error was not already allowed to carry.
          const classification = classifyOpFailure(op, err);
          try {
            onOpFailure(classification);
          } catch {
            // A logging sink must never turn a coded failure into a crash or a hang.
          }
          if (isModelledWireError(err)) {
            sendJson(res, 200, encodeErrResponse(err));
            return;
          }
          sendJson(
            res,
            200,
            encodeErrResponse(
              new WireProtocolError(`adapter-manager provider operation failed (${formatOpFailure(classification)})`),
            ),
          );
        }
      })();
    });
  });
}

/**
 * DAT-009-3e — how long a record of a successful export is kept, measured from the redemption on
 * the SERVER's clock. Long enough to cover any honest retry or lost-response replay of a grant
 * (grants are minted with short lives), short enough that the map is bounded by one window's
 * exports. Deliberately NOT the grant's own `expiresAt`, which is worker-supplied (Codex P1).
 */
export const UPLOAD_REDEMPTION_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * DAT-009-3e — the ABSOLUTE instant by which an artifact op must be done: the caller's own budget,
 * clamped to the capability's life minus `EXPORT_TEARDOWN_RESERVE_MS`. That is the clamp the
 * supervisor applies to its own export window, so the run's destroy always keeps its reserve
 * (Codex P1, PR #557). An INSTANT rather than a duration, because the gate's mutex queues: time
 * spent waiting for the lock must be spent budget, not a fresh window.
 * `capability` is defined at every call site: the gate verified it first.
 */
function artifactOpDeadlineAtMs(
  ctx: ProviderOpContext,
  capability: OwnedLabelsCapability | undefined,
  nowMs: number,
): number {
  return Math.min(nowMs + ctx.deadlineMs, (capability?.expiresAt ?? 0) - EXPORT_TEARDOWN_RESERVE_MS);
}

/**
 * DAT-009-3e — bind a WORKER-SUPPLIED upload grant to the verified caller and a configured store,
 * or throw a FIXED `WireProtocolError` (never the url, the key or the labels).
 *
 * 1. Shape: an `upload` / `PUT` grant with string `url` and `objectKey`.
 * 2. Destination: `https:`, and the url's ORIGIN is one the deployment configured
 *    (`artifactUploadOrigins`). None configured ⇒ refused.
 * 3. Tenancy: `objectKey` sits under the caller's OWN attempt prefix,
 *    `organizations/<org>/jobs/<job>/attempts/<attempt>/` — the format of worker-protocol's
 *    `expectedAttemptObjectPrefix` (restated here because this package may not declare
 *    worker-protocol; `check-adapter-manager-boundary`). The labels are the owned-checked ones.
 * 4. The url TARGETS that key: its decoded path ends with `/<objectKey>` (path- or host-style).
 * 5. The grant has not EXPIRED (`expiresAt`, on the server's own clock). A dead grant cannot be
 *    redeemed at the store anyway, and refusing it here is what makes the redemption ledger's
 *    expiry-based eviction safe: an evicted record can never be replayed.
 *
 * This does not authenticate the grant — nothing can, since a presigned url carries no
 * control-plane signature the adapter-manager could check. It confines where a grant can send
 * bytes to the configured store, under the caller's own attempt, which is the most a forged grant
 * could then do and is what the caller's own lease may already write.
 */
function assertUploadGrantBound(
  grant: unknown,
  owned: ResourceLabels,
  allowedOrigins: ReadonlySet<string>,
  nowMs: number,
): void {
  const refuse = (): never => {
    throw new WireProtocolError("export_artifact refused: the upload grant is not bound to this attempt and a configured artifact store");
  };
  if (typeof grant !== "object" || grant === null) refuse();
  const g = grant as Record<string, unknown>;
  if (g.operation !== "upload" || g.method !== "PUT" || typeof g.url !== "string" || typeof g.objectKey !== "string") refuse();
  const objectKey = g.objectKey as string;
  let url: URL;
  try {
    url = new URL(g.url as string);
  } catch {
    return refuse();
  }
  if (url.protocol !== "https:" || !allowedOrigins.has(url.origin)) refuse();
  const prefix = `organizations/${owned.organizationId}/jobs/${owned.jobId}/attempts/${owned.attempt}/`;
  if (!objectKey.startsWith(prefix) || objectKey.length === prefix.length) refuse();
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return refuse();
  }
  if (!path.endsWith(`/${objectKey}`)) refuse();
  const expiresAtMs = typeof g.expiresAt === "string" ? Date.parse(g.expiresAt) : Number.NaN;
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) refuse();
}

/**
 * WRK-018 — `execute`, relaying the optional stdout stream channel across the wire.
 *
 * Without the driver's `captureStdout` flag this is exactly `provider.execute(args, ctx)` — the
 * same input object, no handler, no extra response field. With it, the provider is handed a
 * per-request `onStdout` that feeds the worker-daemon's own `createRunOutputCapture` (bounded,
 * whole-line, fail-closed), and the response gains `stdoutTail`: the tail SCRUBBED with THIS
 * request's env values before it is encoded.
 *
 * ★ Why the env values are the right canaries. On this lane the run's per-run canaries are
 * exactly the redeemed secret values, and the worker puts every one of them — and nothing
 * else — into the sandbox `env` it sends on create AND on execute
 * (`synthesiseRunSecrets`, packages/worker-daemon/src/lease/secret-redemption.ts). The capture
 * is per REQUEST, so one tenant's run can neither read nor be scrubbed by another's; raw
 * output never crosses the wire (a WRK-018 non-goal), and the daemon scrubs again on arrival.
 */
async function executeRelayingStdout(provider: SandboxProvider, args: unknown, ctx: ProviderOpContext): Promise<unknown> {
  const requested = args as ExecuteInput & Record<string, unknown>;
  if (requested[EXECUTE_CAPTURE_STDOUT_KEY] !== true) return provider.execute(requested, ctx);
  const { [EXECUTE_CAPTURE_STDOUT_KEY]: _flag, ...input } = requested;
  const env = isRecordOfUnknown(input.env) ? input.env : {};
  const canaries = Object.values(env).filter((v): v is string => typeof v === "string" && v.length > 0);
  const capture = createRunOutputCapture({ canaries });
  let result;
  try {
    result = await provider.execute({ ...(input as unknown as ExecuteInput), onStdout: capture.onStdout }, ctx);
  } catch (err) {
    // Close on the failure path too: a chunk the provider delivers late is dropped, not held.
    capture.close();
    throw err;
  }
  const { stdoutTail } = capture.close();
  return { ...result, [EXECUTE_STDOUT_TAIL_KEY]: stdoutTail };
}

function isRecordOfUnknown(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

/** Write a text/plain body exactly once (the /metrics Prometheus surface). Same idempotent
 * guard as `sendJson` so a double-write can never crash the request handler. */
function sendText(res: ServerResponse, status: number, body: string): void {
  if (res.headersSent || res.writableEnded) return;
  try {
    res.writeHead(status, { "content-type": "text/plain; version=0.0.4" });
    res.end(body);
  } catch {
    // Socket destroyed between the guard and the write — nothing to recover.
  }
}
