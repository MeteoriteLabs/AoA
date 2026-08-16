// -----------------------------------------------------------------------------
// The reserved fault/canary directive contract (CLI-001, no-key core only).
//
// The two conformance suites inject every hostile lever through the opaque
// `params` bag of the provider-neutral invoke port. worker-daemon's PER-OP
// `SandboxProvider` has no such black-box channel, so `perOpToInvokeDriver`
// (the E6-F008 adapter) marshals those levers into the ONLY structured carriers
// the rich per-op types offer — the create-spec `env`/`command` and the execute
// `env` — under these reserved keys. The REAL driver logic never interprets them;
// it round-trips `env`/metadata verbatim. The DETERMINISTIC MOCK TRANSPORT decodes
// them to simulate what a real E2B sandbox would do under fault (an ignored signal,
// a transient teardown, a blocked egress, a timeout/crash). A REAL transport
// ignores them entirely — real faults come from real infrastructure, which is why
// the keyed real-E2B lane authors its own cases rather than reusing these markers.
//
// This module is the ONE place the reserved key names live, shared by the adapter
// (encode) and the mock transport (decode) so they can never silently drift.
// -----------------------------------------------------------------------------

export const DIRECTIVE_KEYS = {
  ignoreCancel: "__aoa_fault_ignore_cancel",
  ignoreKill: "__aoa_fault_ignore_kill",
  destroyFailures: "__aoa_fault_destroy_failures",
  egressClass: "__aoa_egress_class",
  lifecycleFault: "__aoa_lifecycle_fault",
} as const;

/** Metadata keys the provider round-trips through the transport to reconstruct a
 * management record (labels/command/env/workload). Opaque to the transport. */
export const METADATA_KEYS = {
  labels: "__aoa_labels",
  command: "__aoa_command",
  env: "__aoa_env",
  workload: "__aoa_workload",
} as const;

export interface CreateFaultDirectives {
  readonly ignoreCancel: boolean;
  readonly ignoreKill: boolean;
  readonly destroyFailures: number;
}

/** Decode the create-time fault directives from a stored env/metadata bag (mock
 * transport only). Absent/garbage → the benign default (no fault). */
export function decodeCreateFaults(env: Readonly<Record<string, string>>): CreateFaultDirectives {
  const rawDestroy = env[DIRECTIVE_KEYS.destroyFailures];
  const parsed = rawDestroy !== undefined ? Number.parseInt(rawDestroy, 10) : 0;
  return {
    ignoreCancel: env[DIRECTIVE_KEYS.ignoreCancel] === "1",
    ignoreKill: env[DIRECTIVE_KEYS.ignoreKill] === "1",
    destroyFailures: Number.isFinite(parsed) && parsed > 0 ? parsed : 0,
  };
}

export interface ExecuteFaultDirectives {
  readonly egressClass: string | null;
  readonly lifecycleFault: "crash" | "ttl" | null;
}

/** Decode the execute-time fault directives from the command env bag (mock
 * transport only). */
export function decodeExecuteFaults(env: Readonly<Record<string, string>>): ExecuteFaultDirectives {
  const egress = env[DIRECTIVE_KEYS.egressClass];
  const life = env[DIRECTIVE_KEYS.lifecycleFault];
  return {
    egressClass: typeof egress === "string" && egress.length > 0 ? egress : null,
    lifecycleFault: life === "crash" || life === "ttl" ? life : null,
  };
}
