// -----------------------------------------------------------------------------
// MockE2bTransport — the deterministic, key-less, pure-TS E2B transport double
// (CLI-001/D3). It records the call shapes the real driver makes and replays a
// faithful E2B-shaped response, so the REAL `E2bSandboxProvider` logic is proven
// (op routing, idempotency, TTL, redaction-source, denial translation, idempotent
// cleanup) WITHOUT a key or a network. It is the ONLY substituted layer.
//
// It decodes the reserved fault directives (`directives.ts`) the E6-F008 adapter
// folds into create/execute env, and simulates exactly what a real E2B sandbox
// would do under fault: an ignored signal, a transient teardown that a retry
// clears, a blocked egress carrying its class, a deterministic timeout/crash. The
// directives are the ONLY non-happy-path input; with none it behaves as a clean
// sandbox host. It makes NO authority decision — the facet/authority gate is the
// adapter's, the domain translation is the provider's.
// -----------------------------------------------------------------------------

import { decodeCreateFaults, decodeExecuteFaults, METADATA_KEYS } from "./directives.js";
import {
  E2bTransportEgressBlockedError,
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

interface MockRecord {
  sandboxId: string;
  metadata: Record<string, string>;
  state: E2bRecordState;
  ignoreCancel: boolean;
  ignoreKill: boolean;
  /** Remaining teardown attempts that FAIL transiently before reclamation. */
  destroyFailuresRemaining: number;
  /** CLI-002/D1 — deterministic in-memory filesystem: absolute path → bytes. */
  fs: Map<string, Uint8Array>;
}

export interface MockE2bTransportOptions {
  /** Advertise pause/resume support (so a provider may advertise checkpoint/
   * restore). Default false — matches the no-key core's default disposition. */
  readonly supportsPauseResume?: boolean;
}

export class MockE2bTransport implements E2bTransport {
  readonly #records = new Map<string, MockRecord>();
  #counter = 0;

  // `pause`/`resume` are conditionally present so the provider's advertisement gate
  // is exercised on both branches. Assigned in the constructor when enabled.
  pause?: (sandboxId: string) => Promise<{ readonly snapshotId: string }>;
  resume?: (sandboxId: string) => Promise<void>;

  constructor(options: MockE2bTransportOptions = {}) {
    if (options.supportsPauseResume) {
      this.pause = async (sandboxId: string) => {
        this.#requireRecord(sandboxId).state = "paused";
        return { snapshotId: `snap-${sandboxId}` };
      };
      this.resume = async (sandboxId: string) => {
        this.#requireRecord(sandboxId).state = "running";
      };
    }
  }

  #requireRecord(sandboxId: string): MockRecord {
    const record = this.#records.get(sandboxId);
    if (!record) throw new E2bTransportNotFoundError(sandboxId);
    return record;
  }

  async create(req: E2bCreateRequest): Promise<{ sandboxId: string }> {
    this.#counter += 1;
    // Zero-padded so lexical sort === creation order (deterministic pagination).
    const sandboxId = `sbx-${String(this.#counter).padStart(6, "0")}`;
    const env = decodeEnv(req.metadata[METADATA_KEYS.env]);
    const faults = decodeCreateFaults(env);
    this.#records.set(sandboxId, {
      sandboxId,
      metadata: { ...req.metadata },
      state: "running",
      ignoreCancel: faults.ignoreCancel,
      ignoreKill: faults.ignoreKill,
      destroyFailuresRemaining: faults.destroyFailures,
      fs: new Map<string, Uint8Array>(),
    });
    return { sandboxId };
  }

  async runCommand(req: E2bRunCommandRequest, handlers?: E2bStreamHandlers): Promise<E2bCommandResult> {
    const record = this.#requireRecord(req.sandboxId);
    const faults = decodeExecuteFaults(req.envVars);
    if (faults.egressClass && faults.egressClass !== "allow") {
      throw new E2bTransportEgressBlockedError(faults.egressClass);
    }
    // CLI-002/D1 — the fake CLI's file mutations: apply the reserved fs-write
    // directive to the in-memory fs BEFORE reporting a terminal, modeling a real
    // CLI writing a KNOWN file inside the sandbox. Skipped on a crash/timeout run.
    // CLI-003/D1 — the fake CLI's streamed output: replay the reserved stream-chunk
    // directive to the onStdout/onStderr callbacks in order, modeling a real CLI
    // emitting output as it runs. Skipped on a crash/timeout run (no clean stream).
    if (faults.lifecycleFault === null) {
      for (const write of faults.fsWrites) {
        record.fs.set(write.path, new TextEncoder().encode(write.content));
      }
      if (handlers) {
        for (const chunk of faults.streamChunks) {
          if (chunk.stream === "stdout") handlers.onStdout?.(chunk.data);
          else handlers.onStderr?.(chunk.data);
        }
      }
    }
    // HONEST transport semantics: a zero/positive command budget does NOT itself
    // decide the timeout — the driver owns the zero-budget verdict (e2b-provider
    // short-circuits deadlineMs<=0 before ever reaching the transport), and real E2B
    // enforces a positive budget itself. The ONLY transport-authored timeout here is a
    // sandbox-TTL fire (lifecycleFault:"ttl"), a genuine provider-side mechanism.
    const timedOut = faults.lifecycleFault === "ttl";
    const crashed = faults.lifecycleFault === "crash";
    return {
      exitCode: crashed ? 1 : timedOut ? null : 0,
      signal: timedOut ? "SIGKILL" : null,
      timedOut,
      crashed,
    };
  }

  async signal(sandboxId: string, kind: "cancel" | "kill"): Promise<E2bSignalResult> {
    const record = this.#records.get(sandboxId);
    if (!record) return { delivered: true }; // already gone — a no-op convergence
    if (kind === "cancel" && record.ignoreCancel) return { delivered: false };
    if (kind === "kill" && record.ignoreKill) return { delivered: false };
    record.state = "stopped";
    return { delivered: true };
  }

  async terminate(sandboxId: string): Promise<void> {
    const record = this.#records.get(sandboxId);
    if (!record) throw new E2bTransportNotFoundError(sandboxId);
    if (record.destroyFailuresRemaining > 0) {
      record.destroyFailuresRemaining -= 1;
      throw new E2bTransportTransientError();
    }
    this.#records.delete(sandboxId);
  }

  async getInfo(sandboxId: string): Promise<E2bSandboxRecord> {
    const record = this.#requireRecord(sandboxId);
    return { sandboxId: record.sandboxId, metadata: { ...record.metadata }, state: record.state };
  }

  async list(req: E2bListRequest): Promise<E2bListPage> {
    const all = [...this.#records.values()]
      .sort((a, b) => (a.sandboxId < b.sandboxId ? -1 : a.sandboxId > b.sandboxId ? 1 : 0))
      .map((r): E2bSandboxRecord => ({ sandboxId: r.sandboxId, metadata: { ...r.metadata }, state: r.state }));
    const cursor = req.pageToken ?? null;
    let start = 0;
    if (cursor !== null) {
      const idx = all.findIndex((r) => r.sandboxId === cursor);
      start = idx >= 0 ? idx + 1 : all.length;
    }
    const slice = all.slice(start, start + req.pageSize);
    const end = start + slice.length;
    const nextPageToken = end < all.length && slice.length > 0 ? slice[slice.length - 1].sandboxId : null;
    return { items: slice, nextPageToken };
  }

  async setTimeout(sandboxId: string, _timeoutMs: number): Promise<void> {
    this.#requireRecord(sandboxId);
  }

  async isRunning(sandboxId: string): Promise<boolean> {
    const record = this.#records.get(sandboxId);
    return record !== undefined && record.state === "running";
  }

  // --- CLI-002/D1 staging fs primitives -------------------------------------

  async writeFiles(sandboxId: string, files: readonly E2bStagedFile[]): Promise<void> {
    const record = this.#requireRecord(sandboxId);
    for (const file of files) {
      // Copy the bytes so a later caller mutation of the source buffer can't
      // retroactively alter staged content (deterministic isolation).
      record.fs.set(file.path, Uint8Array.from(file.bytes));
    }
  }

  async readFile(sandboxId: string, path: string): Promise<Uint8Array> {
    const record = this.#requireRecord(sandboxId);
    const bytes = record.fs.get(path);
    if (bytes === undefined) throw new E2bTransportNotFoundError(`${sandboxId}:${path}`);
    return Uint8Array.from(bytes);
  }

  async listDir(sandboxId: string, path: string): Promise<readonly string[]> {
    const record = this.#requireRecord(sandboxId);
    const prefix = path.endsWith("/") ? path : `${path}/`;
    return [...record.fs.keys()].filter((p) => p === path || p.startsWith(prefix)).sort();
  }

  /** Test-only: current live sandbox count (zero after a full converge). */
  liveCount(): number {
    return this.#records.size;
  }
}

function decodeEnv(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Record<string, string>;
  } catch {
    // fall through
  }
  return {};
}

export function createMockE2bTransport(options: MockE2bTransportOptions = {}): MockE2bTransport {
  return new MockE2bTransport(options);
}
