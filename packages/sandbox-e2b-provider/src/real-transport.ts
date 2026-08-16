// -----------------------------------------------------------------------------
// RealE2bTransport — the `e2b` SDK binding of the transport seam (CLI-001/D1/D4).
//
// This is the ONLY module that touches the `e2b` SDK and the ONLY module that
// reads the provider-control credential (`E2B_API_KEY`). It is exercised solely by
// the keyed real-E2B lane (`E2B_API_KEY` present); the no-key core never imports
// it (the tests inject `MockE2bTransport`). It is authored + parse-verified here;
// the operator supplies the key + template and dispatches the lane.
//
// The credential is confined here (DEP-006 reuse): it is read from the environment
// (rotatable/revocable without touching this code) and passed only to the SDK — it
// never crosses the provider-neutral invoke seam, never enters a projection, and
// never appears in the adapter/provider/mock. The static boundary checker asserts
// `E2B_API_KEY` appears in NO other runtime source file.
//
// The `e2b` surface is accessed through a deliberately loose local facade: the SDK
// types are broad and version-sensitive, and this binding is not run in the no-key
// build, so its SDK interactions are cast rather than statically pinned. Behavioral
// correctness is the keyed lane's job, not the typechecker's.
// -----------------------------------------------------------------------------

import { Sandbox } from "e2b";

import {
  E2bTransportNotFoundError,
  E2bTransportTransientError,
  type E2bCommandResult,
  type E2bCreateRequest,
  type E2bListPage,
  type E2bListRequest,
  type E2bRecordState,
  type E2bRunCommandRequest,
  type E2bSandboxRecord,
  type E2bSignalResult,
  type E2bTransport,
} from "./transport.js";

/** Loose facade over the version-sensitive `e2b` SDK surface (keyed lane only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SandboxSdk = any;

export interface RealE2bTransportOptions {
  /** The provider-control API key. Defaults to `process.env.E2B_API_KEY`. Read
   * ONLY here (DEP-006 credential confinement). */
  readonly apiKey?: string;
  /** Advertise pause/resume (E2B beta) — off by default. */
  readonly enablePauseResume?: boolean;
}

function requireApiKey(explicit?: string): string {
  const key = explicit ?? process.env.E2B_API_KEY;
  if (!key || key.length === 0) {
    throw new Error("RealE2bTransport requires E2B_API_KEY (provider-control credential) — set it in the keyed lane, never in the no-key build");
  }
  return key;
}

function mapState(raw: unknown): E2bRecordState {
  const s = typeof raw === "string" ? raw.toLowerCase() : "";
  if (s.includes("run")) return "running";
  if (s.includes("paus")) return "paused";
  return "stopped";
}

function toRecord(info: SandboxSdk): E2bSandboxRecord {
  const metadata = (info?.metadata ?? {}) as Record<string, string>;
  return {
    sandboxId: String(info?.sandboxId ?? info?.sandbox_id ?? ""),
    metadata,
    state: mapState(info?.state ?? info?.status),
  };
}

export class RealE2bTransport implements E2bTransport {
  readonly #apiKey: string;
  readonly #sdk: SandboxSdk;
  pause?: (sandboxId: string) => Promise<{ readonly snapshotId: string }>;
  resume?: (sandboxId: string) => Promise<void>;

  constructor(options: RealE2bTransportOptions = {}) {
    this.#apiKey = requireApiKey(options.apiKey);
    this.#sdk = Sandbox as SandboxSdk;
    if (options.enablePauseResume) {
      this.pause = async (sandboxId: string) => {
        const snapshotId = await this.#sdk.betaPause(sandboxId, { apiKey: this.#apiKey });
        return { snapshotId: String(snapshotId ?? sandboxId) };
      };
      this.resume = async (sandboxId: string) => {
        await this.#sdk.connect(sandboxId, { apiKey: this.#apiKey });
      };
    }
  }

  async create(req: E2bCreateRequest): Promise<{ sandboxId: string }> {
    const sandbox = await this.#sdk.create(req.templateId, {
      apiKey: this.#apiKey,
      timeoutMs: req.timeoutMs,
      metadata: req.metadata,
      envs: req.envVars,
    });
    return { sandboxId: String(sandbox?.sandboxId ?? "") };
  }

  async runCommand(req: E2bRunCommandRequest): Promise<E2bCommandResult> {
    const sandbox = await this.#sdk.connect(req.sandboxId, { apiKey: this.#apiKey });
    const full = [req.command, ...req.args].join(" ");
    try {
      const result = await sandbox.commands.run(full, {
        envs: req.envVars,
        timeoutMs: req.timeoutMs,
      });
      const exitCode = typeof result?.exitCode === "number" ? result.exitCode : 0;
      return { exitCode, signal: null, timedOut: false, crashed: exitCode !== 0 };
    } catch (err) {
      // A real timeout surfaces as an SDK timeout error; map it to a timed-out
      // terminal (the keyed lane refines egress/crash mapping against real infra).
      const name = err instanceof Error ? err.name : "";
      if (name.toLowerCase().includes("timeout")) {
        return { exitCode: null, signal: "SIGKILL", timedOut: true, crashed: false };
      }
      throw err;
    }
  }

  async signal(sandboxId: string, _kind: "cancel" | "kill"): Promise<E2bSignalResult> {
    // E2B has no in-sandbox graceful-cancel primitive distinct from teardown; a
    // signal is best-effort and reported delivered. The escalation ladder relies on
    // the forced `terminate` for reclamation.
    try {
      await this.#sdk.getInfo(sandboxId, { apiKey: this.#apiKey });
      return { delivered: true };
    } catch {
      return { delivered: true };
    }
  }

  async terminate(sandboxId: string): Promise<void> {
    try {
      await this.#sdk.kill(sandboxId, { apiKey: this.#apiKey });
    } catch (err) {
      if (this.#isNotFound(err)) throw new E2bTransportNotFoundError(sandboxId);
      throw new E2bTransportTransientError(err instanceof Error ? err.message : undefined);
    }
  }

  async getInfo(sandboxId: string): Promise<E2bSandboxRecord> {
    try {
      const info = await this.#sdk.getInfo(sandboxId, { apiKey: this.#apiKey });
      return toRecord(info);
    } catch (err) {
      if (this.#isNotFound(err)) throw new E2bTransportNotFoundError(sandboxId);
      throw err;
    }
  }

  async list(req: E2bListRequest): Promise<E2bListPage> {
    const paginator = this.#sdk.list({ apiKey: this.#apiKey, limit: req.pageSize, nextToken: req.pageToken ?? undefined });
    const items: E2bSandboxRecord[] = [];
    const page = typeof paginator?.nextItems === "function" ? await paginator.nextItems() : await paginator;
    for (const info of (page ?? []) as SandboxSdk[]) items.push(toRecord(info));
    const nextPageToken = typeof paginator?.nextToken === "string" ? paginator.nextToken : null;
    return { items, nextPageToken };
  }

  async setTimeout(sandboxId: string, timeoutMs: number): Promise<void> {
    await this.#sdk.setTimeout(sandboxId, timeoutMs, { apiKey: this.#apiKey });
  }

  async isRunning(sandboxId: string): Promise<boolean> {
    try {
      const sandbox = await this.#sdk.connect(sandboxId, { apiKey: this.#apiKey });
      return Boolean(await sandbox.isRunning());
    } catch {
      return false;
    }
  }

  #isNotFound(err: unknown): boolean {
    const name = err instanceof Error ? err.name : "";
    return name === "NotFoundError" || name === "SandboxNotFoundError" || name.toLowerCase().includes("notfound");
  }
}

export function createRealE2bTransport(options: RealE2bTransportOptions = {}): RealE2bTransport {
  return new RealE2bTransport(options);
}
