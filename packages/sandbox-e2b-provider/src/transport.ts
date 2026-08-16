// -----------------------------------------------------------------------------
// The injectable E2B transport SEAM (CLI-001/D1).
//
// `E2bTransport` abstracts the small set of `e2b` SDK primitives the real driver
// logic (`E2bSandboxProvider`) needs: create / run-command / signal / terminate /
// get-info / list / set-timeout / pause / resume / is-running. The provider is
// programmed AGAINST this interface, never the concrete SDK, so a test can inject
// a deterministic, key-less, pure-TS double (`mock-transport.ts`) and exercise the
// REAL driver logic; the real binding (`real-transport.ts`) wraps the `e2b` SDK.
//
// The seam is deliberately provider-shaped-but-neutral: it carries an opaque
// `metadata` bag (a `Record<string,string>` the provider round-trips) and returns
// primitive lifecycle facts. Transport-level faults surface as the two transport
// error classes below (a transient teardown failure and a blocked-egress refusal),
// which the provider translates into the domain outcomes/denials the conformance
// suites assert. The transport itself makes NO authority decision.
// -----------------------------------------------------------------------------

/** The lifecycle state a transport reports for a sandbox record. */
export type E2bRecordState = "running" | "paused" | "stopped";

/** An opaque provider-owned record. `metadata` is round-tripped verbatim — the
 * provider stores its (management) labels + any test fault directives there; the
 * transport treats it as an opaque blob and never interprets it as authority. */
export interface E2bSandboxRecord {
  readonly sandboxId: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly state: E2bRecordState;
}

/** The primitive result of running a command inside a sandbox. `exitCode` is the
 * process exit status (`null` when it was signalled); `timedOut` marks a deadline
 * hit; `crashed` marks an abnormal (non-timeout) failure the provider maps to a
 * `failed` terminal. Egress refusals are raised, not returned (see below). */
export interface E2bCommandResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly crashed: boolean;
}

/** Outcome of a cancel/kill signal delivery. `delivered: false` models a sandbox
 * that ignored the signal (the provider maps it to `StopOutcome.ignored`). */
export interface E2bSignalResult {
  readonly delivered: boolean;
}

/** A page of records from `list`. */
export interface E2bListPage {
  readonly items: readonly E2bSandboxRecord[];
  readonly nextPageToken: string | null;
}

// --- Transport-level errors (never authority) --------------------------------

/** The transport could not confirm a sandbox exists. The provider maps this to
 * the domain `SandboxNotFoundError` (which the cleanup authority further collapses
 * into the uniform, oracle-free `ResourceNotAvailableError`). */
export class E2bTransportNotFoundError extends Error {
  constructor(sandboxId: string) {
    super(`e2b transport: sandbox not found: ${sandboxId}`);
    this.name = "E2bTransportNotFoundError";
  }
}

/** A transient teardown failure (the E2B control API rejected a terminate). The
 * provider maps this to a REPORTED `CleanupResult{cleanupStatus:"failed"}` — never
 * a throw — so the monotonic cleanup convergence can retry it idempotently. */
export class E2bTransportTransientError extends Error {
  constructor(message = "e2b transport: transient teardown failure") {
    super(message);
    this.name = "E2bTransportTransientError";
  }
}

/** The sandbox network fence refused an egress attempt carrying its frozen
 * destination class. The provider re-raises this as the domain
 * `SandboxEgressDeniedError` carrying the same class. */
export class E2bTransportEgressBlockedError extends Error {
  readonly destinationClass: string;
  constructor(destinationClass: string) {
    super(`e2b transport: egress blocked: ${destinationClass}`);
    this.name = "E2bTransportEgressBlockedError";
    this.destinationClass = destinationClass;
  }
}

// --- The seam ----------------------------------------------------------------

export interface E2bCreateRequest {
  readonly templateId: string;
  readonly timeoutMs: number;
  readonly metadata: Readonly<Record<string, string>>;
  readonly envVars: Readonly<Record<string, string>>;
}

export interface E2bRunCommandRequest {
  readonly sandboxId: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly envVars: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

export interface E2bListRequest {
  readonly pageSize: number;
  readonly pageToken?: string | null;
}

/**
 * The injectable E2B transport. Optional capabilities (`pause`/`resume`) may be
 * absent — the provider gates the optional `checkpoint`/`restore` ops on their
 * presence AND on its own advertisement.
 */
export interface E2bTransport {
  create(req: E2bCreateRequest): Promise<{ readonly sandboxId: string }>;
  runCommand(req: E2bRunCommandRequest): Promise<E2bCommandResult>;
  /** Deliver a graceful-cancel or forced-kill signal to a live sandbox. */
  signal(sandboxId: string, kind: "cancel" | "kill"): Promise<E2bSignalResult>;
  /** Terminate + reclaim a sandbox. May throw {@link E2bTransportTransientError}. */
  terminate(sandboxId: string): Promise<void>;
  getInfo(sandboxId: string): Promise<E2bSandboxRecord>;
  list(req: E2bListRequest): Promise<E2bListPage>;
  setTimeout(sandboxId: string, timeoutMs: number): Promise<void>;
  isRunning(sandboxId: string): Promise<boolean>;
  pause?(sandboxId: string): Promise<{ readonly snapshotId: string }>;
  resume?(sandboxId: string): Promise<void>;
}
