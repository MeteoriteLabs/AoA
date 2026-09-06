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

import { CommandExitError, Sandbox } from "e2b";

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
  type E2bStagedFile,
  type E2bStreamHandlers,
  type E2bTransport,
} from "./transport.js";
import { isE2bNotFound, shellJoin } from "./real-transport-helpers.js";

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

  async runCommand(req: E2bRunCommandRequest, handlers?: E2bStreamHandlers): Promise<E2bCommandResult> {
    const sandbox = await this.#sdk.connect(req.sandboxId, { apiKey: this.#apiKey });
    // Quote every token so the argv survives the collapse into e2b's single
    // command-STRING API — a naive space-join silently breaks `sh -c "<script>"`.
    const full = shellJoin(req.command, req.args);
    try {
      // CLI-003/D1 — bind the `e2b` SDK command stream to the streaming callbacks.
      // The SDK invokes `onStdout`/`onStderr` with each output chunk as it is
      // produced; they are best-effort observation and never alter the result.
      const result = await sandbox.commands.run(full, {
        envs: req.envVars,
        timeoutMs: req.timeoutMs,
        onStdout: handlers?.onStdout ? (data: unknown) => handlers.onStdout?.(String(data)) : undefined,
        onStderr: handlers?.onStderr ? (data: unknown) => handlers.onStderr?.(String(data)) : undefined,
      });
      const exitCode = typeof result?.exitCode === "number" ? result.exitCode : 0;
      return { exitCode, signal: null, timedOut: false, crashed: exitCode !== 0 };
    } catch (err) {
      // ── (a) THE COMMAND RAN AND EXITED NON-ZERO. A normal outcome, NOT a fault.
      //
      // E7-F014, observed in a real E2B sandbox (run 33789547290, confirmed by the
      // mutant run 33790235730): `sandbox.commands.run()` is `start()` then
      // `CommandHandle.wait()`, and `wait()` THROWS for any non-zero exit —
      // `if (this.result.exitCode !== 0) throw new CommandExitError(this.result)`
      // (e2b@2.30.5, `src/sandbox/commands/commandHandle.ts:176`). Nothing on the way
      // out converted it back, so `result` above was never assigned, the throw
      // travelled through `E2bSandboxProvider.execute` untouched, and the supervisor's
      // execute-catch wrote the durable terminal as `exitCode: null` +
      // `errorCode: "execute_failed"`. Every failing distributed run lost its exit
      // code, and `crashed: exitCode !== 0` above was unreachable.
      //
      // `CommandExitError` is an exception carrying a COMPLETED `CommandResult`
      // (`implements CommandResult`, with an `exitCode: number` getter), so convert it
      // back into the ordinary result shape this seam already models — and which
      // `MockE2bTransport` has always returned for a crashed command
      // (`{ exitCode: 1, crashed: true }`). That restores attribution without any new
      // shape: the provider passes `exitCode` straight through, and the supervisor
      // reaches its ORDINARY terminal (`status` from the code, not the catch).
      //
      // ★ NARROW ON THE CLASS, AND READ THE STATUS OFF IT — never manufacture one.
      // The SDK draws precisely this line itself, in the same `wait()`: a command that
      // produced NO exit status throws `iterationError` or a bare
      // `SandboxError("Process exited without a result")` instead of a
      // `CommandExitError`. Those are case (b) — the sandbox or transport FAULTED —
      // and they must keep throwing, so the supervisor still tears down and reports
      // `execute_failed`. Reporting a fault as "exited N" would invent an exit status
      // that never existed, which is strictly worse than losing a real one. The
      // `instanceof` is the SDK's own idiom for this narrowing (`isAuthFailure`,
      // `isMissingUpstream` both gate on `err instanceof CommandExitError`), and it
      // fails CLOSED: anything that is not that class keeps its current path.
      if (err instanceof CommandExitError) {
        const exitCode = err.exitCode;
        // Defensive: the status is READ, never defaulted. A `CommandExitError` whose
        // `exitCode` is not a number carries no status to report, so it stays a throw
        // rather than becoming a fabricated "exited 1".
        if (typeof exitCode === "number") {
          return { exitCode, signal: null, timedOut: false, crashed: exitCode !== 0 };
        }
      }
      // ── (b) THE SANDBOX OR TRANSPORT FAULTED — no exit status exists.
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
      // `Sandbox.kill` resolves `true` when the sandbox was found and killed and
      // `false` when it was already gone — it does NOT throw for a missing sandbox.
      // Surface the gone case as the uniform not-found signal so repeated teardown is
      // idempotent (the second terminate of a reclaimed sandbox → not-found, no hang).
      const killed = await this.#sdk.kill(sandboxId, { apiKey: this.#apiKey });
      if (killed === false) throw new E2bTransportNotFoundError(sandboxId);
    } catch (err) {
      if (err instanceof E2bTransportNotFoundError) throw err;
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

  // --- CLI-002/D1 staging fs primitives (keyed lane only) --------------------

  async writeFiles(sandboxId: string, files: readonly E2bStagedFile[]): Promise<void> {
    const sandbox = await this.#sdk.connect(sandboxId, { apiKey: this.#apiKey });
    for (const file of files) {
      // `sandbox.files.write(path, data)` accepts bytes; a Buffer view keeps the
      // e2b SDK's Node upload path happy without copying the underlying data.
      await sandbox.files.write(file.path, Buffer.from(file.bytes));
    }
  }

  async readFile(sandboxId: string, path: string): Promise<Uint8Array> {
    try {
      const sandbox = await this.#sdk.connect(sandboxId, { apiKey: this.#apiKey });
      const data = await sandbox.files.read(path, { format: "bytes" });
      if (data instanceof Uint8Array) return data;
      if (typeof data === "string") return new TextEncoder().encode(data);
      return new Uint8Array(data as ArrayBufferLike);
    } catch (err) {
      if (this.#isNotFound(err)) throw new E2bTransportNotFoundError(`${sandboxId}:${path}`);
      throw err;
    }
  }

  async listDir(sandboxId: string, path: string): Promise<readonly string[]> {
    try {
      const sandbox = await this.#sdk.connect(sandboxId, { apiKey: this.#apiKey });
      const entries = await sandbox.files.list(path);
      const arr = Array.isArray(entries) ? entries : [];
      return arr.map((e: SandboxSdk) => String(e?.path ?? e?.name ?? ""));
    } catch (err) {
      if (this.#isNotFound(err)) throw new E2bTransportNotFoundError(`${sandboxId}:${path}`);
      throw err;
    }
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
    // Delegates to the SDK-free classifier (no-key-tested): named not-found/bad-target
    // classes + a base `SandboxError` carrying a 4xx status (an absent/foreign sandbox
    // lookup surfaces as an unmapped 4xx, not `NotFoundError`, against real E2B).
    return isE2bNotFound(err);
  }
}

export function createRealE2bTransport(options: RealE2bTransportOptions = {}): RealE2bTransport {
  return new RealE2bTransport(options);
}
