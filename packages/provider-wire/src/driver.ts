// -----------------------------------------------------------------------------
// NetworkedProviderDriver (DEP-012 Slice 1 · Unit A).
//
// Presents the AUTHORITATIVE per-op `SandboxProvider` port over a network hop: each
// implemented op POSTs `{args, ctx}` to the adapter-manager server and deserializes
// `{ok|err}`. It lives OUTSIDE worker-daemon (so the daemon imports nothing new); a
// container composition root (DEP-011) injects it via `deps.provider`, exactly as the
// desktop lane injects `E2bSandboxProvider`.
//
// UNIT A SCOPE. Only `create` + `execute` are wired. The other core ops + the optional
// trio + the artifact pair throw the AUTHORITATIVE `UnsupportedProviderOperation` (the
// worker-daemon class, re-exported via the e2b leaf's `errors.js`) until Unit B builds
// their routes + the server-side ownership gate. `execute`'s route here has NO ownership
// gate and is COMPONENT-TEST-ONLY / not deploy-safe (S1.4).
//
// ★ execute (ONLY) applies the driver-owned zero-deadline short-circuit BEFORE any RPC
// (`deadlineMs <= 0` -> the deterministic timedOut verdict). `create` has no such
// short-circuit — `CreateResult` has no `timedOut` field and the provider substitutes a
// default TTL for a non-positive deadline (e2b-provider.ts #ttl), so there is nothing to
// mirror. Uses Node's global `fetch`; a caller may inject one (tests spy on the hop).
// -----------------------------------------------------------------------------

import type {
  ArtifactDigestResult,
  ArtifactExportMode,
  ArtifactExportResult,
  CheckpointMode,
  CheckpointResult,
  CleanupResult,
  CreateResult,
  CreateSandboxSpec,
  ExecuteInput,
  ExecuteResult,
  HealthMode,
  HealthResult,
  InspectResult,
  ListInput,
  ListResult,
  ProviderOperation,
  ProviderOpContext,
  RestoreResult,
  SandboxProvider,
  StopResult,
} from "@armyofagents/worker-daemon";
import type { ArtifactUploadGrantV1 } from "@armyofagents/worker-protocol";
import { CORE_PROVIDER_OPERATIONS } from "@armyofagents/worker-protocol";
import { UnsupportedProviderOperation } from "@armyofagents/sandbox-e2b-provider/errors.js";

import { decodeOpResponse, encodeOpRequest } from "./codec.js";

export interface NetworkedProviderDriverOptions {
  /** The adapter-manager base URL, e.g. `http://adapter-manager:PORT`. */
  readonly baseUrl: string;
  /** Injectable fetch (default: the global). Tests spy on the network hop through it. */
  readonly fetch?: typeof fetch;
}

export class NetworkedProviderDriver implements SandboxProvider {
  // Shape-faithful to the port contract ("always a superset of the 8 core ops").
  // Unit A only IMPLEMENTS create + execute; the rest throw until Unit B — an honest
  // "not built yet", not a silent no-op.
  readonly advertisedOperations: ReadonlySet<ProviderOperation> = new Set(CORE_PROVIDER_OPERATIONS);
  readonly checkpointMode: CheckpointMode = "none";
  readonly healthMode: HealthMode = "none";
  readonly artifactExportMode: ArtifactExportMode = "none";

  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(options: NetworkedProviderDriverOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#fetch = options.fetch ?? fetch;
  }

  async create(spec: CreateSandboxSpec, ctx: ProviderOpContext): Promise<CreateResult> {
    return this.#post<CreateResult>("create", spec, ctx);
  }

  async execute(input: ExecuteInput, ctx: ProviderOpContext): Promise<ExecuteResult> {
    // Driver-owned zero-deadline verdict — the CLIENT short-circuits before the RPC, so
    // the server is never consulted for an exhausted budget (mirrors the provider's own
    // deadlineMs<=0 short-circuit, kept driver-side so the wire preserves it).
    if (ctx.deadlineMs <= 0) {
      return {
        providerOpId: `wire-execute-zero-deadline:${input.sandboxId}`,
        exitCode: null,
        signal: "SIGKILL",
        timedOut: true,
        stdoutRef: `ref:stdout:${input.sandboxId}`,
        stderrRef: `ref:stderr:${input.sandboxId}`,
      };
    }
    return this.#post<ExecuteResult>("execute", input, ctx);
  }

  // --- not built until Unit B (the ownership gate + the six gate-required ops) ------

  async cancel(_sandboxId: string, _ctx: ProviderOpContext): Promise<StopResult> {
    throw new UnsupportedProviderOperation("cancel");
  }
  async kill(_sandboxId: string, _ctx: ProviderOpContext): Promise<StopResult> {
    throw new UnsupportedProviderOperation("kill");
  }
  async destroy(_sandboxId: string, _ctx: ProviderOpContext): Promise<CleanupResult> {
    throw new UnsupportedProviderOperation("destroy");
  }
  async list(_input: ListInput, _ctx: ProviderOpContext): Promise<ListResult> {
    throw new UnsupportedProviderOperation("list");
  }
  async inspect(_sandboxId: string, _ctx: ProviderOpContext): Promise<InspectResult> {
    throw new UnsupportedProviderOperation("inspect");
  }
  async reconcileCleanup(_sandboxId: string, _ctx: ProviderOpContext): Promise<CleanupResult> {
    throw new UnsupportedProviderOperation("reconcile_cleanup");
  }
  async checkpoint(_sandboxId: string, _ctx: ProviderOpContext): Promise<CheckpointResult> {
    throw new UnsupportedProviderOperation("checkpoint");
  }
  async restore(_sandboxId: string, _ctx: ProviderOpContext): Promise<RestoreResult> {
    throw new UnsupportedProviderOperation("restore");
  }
  async health(_sandboxId: string, _ctx: ProviderOpContext): Promise<HealthResult> {
    throw new UnsupportedProviderOperation("health");
  }
  async digestArtifact(_sandboxId: string, _path: string, _ctx: ProviderOpContext): Promise<ArtifactDigestResult> {
    throw new UnsupportedProviderOperation("digest_artifact");
  }
  async exportArtifact(
    _sandboxId: string,
    _path: string,
    _grant: ArtifactUploadGrantV1,
    _ctx: ProviderOpContext,
  ): Promise<ArtifactExportResult> {
    throw new UnsupportedProviderOperation("export_artifact");
  }

  async #post<R>(op: "create" | "execute", args: unknown, ctx: ProviderOpContext): Promise<R> {
    const res = await this.#fetch(`${this.#baseUrl}/op/${op}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: encodeOpRequest(args, ctx),
    });
    // Body-driven: the codec decides ok vs err vs garbled regardless of HTTP status. A
    // non-JSON / non-envelope body (e.g. a bare 500) surfaces as a WireProtocolError,
    // never as a silent success.
    return decodeOpResponse<R>(await res.text());
  }
}
