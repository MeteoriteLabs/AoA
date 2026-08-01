// server/src/services/unsandboxed-multitenant-guard.ts
//
// D1 (PR #316 multi-tenant follow-up): explicit "unsandboxed multi-tenant"
// execution gate. When tenant isolation is ENFORCED (cloud_auth), a run whose
// RESOLVED execution target is the local, unsandboxed control-plane host is a
// tenant-code-on-shared-host hazard. Real per-tenant execution isolation is a
// separate, deferred initiative; until it lands, an unsandboxed local run on a
// cloud_auth deployment must be an EXPLICIT operator opt-in rather than the
// silent default fallback.
//
// This guard REFUSES (throws) such a run unless AOA_ALLOW_UNSANDBOXED_MULTITENANT
// is set, and when it is set it logs one loud SECURITY warning per process. It is
// a no-op on every self-hosted deployment (tenantIsolationEnforced() === false —
// local_trusted AND authenticated single-tenant) and a no-op when the resolved
// target is GENUINELY isolated (a gVisor/runsc docker target or a provider-sandbox).
// It does NOT implement isolation — it makes the current unsafe fallback conscious.
//
// A runc / runtime-less docker target is NOT genuine isolation on shared infra: it
// shares the host kernel and, via default bridge networking, can reach the
// control-plane host / cloud metadata endpoint. On cloud_auth WITHOUT a configured
// gVisor (runsc) pool — the default — such a target is a reachable weaker-than-
// promised boundary, so the guard fails closed on it exactly like `local`. Full
// runsc + network:none enforcement is the deferred per-tenant-isolation initiative;
// this guard only refuses the unsafe fallback until it lands.
//
// SIGNAL: gate on tenantIsolationEnforced() (cloud_auth), NOT trustBoundary ===
// "multi_tenant". The latter is TRUE for `authenticated` self-hosts too and would
// wrongly refuse them. The caller passes the boolean so this stays pure/testable.
import type { AdapterExecutionTarget } from "@armyofagents/adapter-utils";
import { logger } from "../middleware/logger.js";

/** Documented opt-in env (see docs/deploy/environment-variables.md). */
export const UNSANDBOXED_MULTITENANT_OPT_IN_ENV = "AOA_ALLOW_UNSANDBOXED_MULTITENANT";

/** True when the resolved target executes directly on the unsandboxed host. */
export function isUnsandboxedLocalTarget(
  target: AdapterExecutionTarget | null | undefined,
): boolean {
  return !target || target.type === "local";
}

/**
 * Docker-family target types. Only `sandbox-docker` is in the current union; the
 * others are matched defensively so a future rename/alias cannot silently reopen
 * the hole. A docker-family target counts as genuine per-tenant isolation on
 * shared infra ONLY when it runs under gVisor (`runtime === "runsc"`).
 */
const DOCKER_FAMILY_TARGET_TYPES: ReadonlySet<string> = new Set([
  "sandbox-docker",
  "docker",
  "local-docker",
]);

/**
 * True when the resolved target must be REFUSED on an enforced-isolation
 * (cloud_auth) deployment absent the opt-in: the unsandboxed local host, OR a
 * docker-family target that is NOT running under gVisor (runc / runtime-less).
 * A `provider-sandbox` (and any future genuinely-isolated target) is not refused.
 */
function requiresSandboxRefusal(
  target: AdapterExecutionTarget | null | undefined,
): boolean {
  if (isUnsandboxedLocalTarget(target)) return true;
  if (target && DOCKER_FAMILY_TARGET_TYPES.has(target.type)) {
    // runc / undefined runtime => shared host kernel + default bridge egress.
    return (target as { runtime?: unknown }).runtime !== "runsc";
  }
  return false;
}

function optInEnabled(env: NodeJS.ProcessEnv): boolean {
  return /^(1|true|yes)$/i.test(env[UNSANDBOXED_MULTITENANT_OPT_IN_ENV]?.trim() ?? "");
}

// One loud warning per process when the operator has opted in.
let hasWarnedUnsandboxedMultitenant = false;

/** Test-only: reset the per-process warn-once latch. */
export function resetUnsandboxedMultitenantWarning(): void {
  hasWarnedUnsandboxedMultitenant = false;
}

export interface UnsandboxedMultitenantGuardOptions {
  /**
   * Whether tenant isolation is enforced for this deployment — pass
   * `tenantIsolationEnforced()` (true iff deploymentMode === "cloud_auth").
   * Do NOT pass a trustBoundary-derived signal: `authenticated` self-hosts are
   * multi_tenant but must NOT be refused.
   */
  tenantIsolationEnforced: boolean;
  /** Human label for the run kind ("org agent" / "crew agent" / "Commander"). */
  sink: string;
  /** Env source (default process.env) — injectable for tests. */
  env?: NodeJS.ProcessEnv;
  /** Logger sink (default the app logger) — injectable for tests. */
  log?: Pick<typeof logger, "warn">;
}

/**
 * Refuse an unsandboxed run on an enforced-isolation (cloud_auth) deployment unless
 * the operator has explicitly opted in via AOA_ALLOW_UNSANDBOXED_MULTITENANT. No-op
 * on every self-hosted deployment and on genuinely-isolated targets (a gVisor/runsc
 * docker target or a provider-sandbox). A runc / runtime-less docker target is
 * treated as unsandboxed and refused like `local`. When opted in, logs one loud
 * warning per process.
 *
 * @throws Error when tenant isolation is enforced (cloud_auth), the target requires
 *   sandbox refusal (local/unsandboxed host, or a non-gVisor docker target), and
 *   the opt-in env is not set.
 */
export function assertUnsandboxedMultitenantAllowed(
  target: AdapterExecutionTarget | null | undefined,
  opts: UnsandboxedMultitenantGuardOptions,
): void {
  // Only cloud_auth (tenant isolation enforced) gates. Every self-hosted
  // deployment — local_trusted AND authenticated single-tenant — is exempt.
  if (!opts.tenantIsolationEnforced) return;
  // Genuinely isolated (gVisor/runsc docker OR provider-sandbox): safe on shared
  // infra. A runc / runtime-less docker target falls through to refusal below.
  if (!requiresSandboxRefusal(target)) return;

  const env = opts.env ?? process.env;
  if (!optInEnabled(env)) {
    throw new Error(
      `Refusing to dispatch a ${opts.sink} run without genuine per-tenant isolation ` +
        `(the unsandboxed control-plane host, or a non-gVisor docker target) under ` +
        `enforced tenant isolation (cloud_auth). Per-tenant execution isolation is not ` +
        `yet implemented; set ${UNSANDBOXED_MULTITENANT_OPT_IN_ENV}=1 to explicitly allow ` +
        `unsandboxed runs on this shared deployment, or configure a gVisor (runsc) or ` +
        `provider-sandbox execution target.`,
    );
  }

  if (!hasWarnedUnsandboxedMultitenant) {
    hasWarnedUnsandboxedMultitenant = true;
    (opts.log ?? logger).warn(
      { sink: opts.sink, optIn: UNSANDBOXED_MULTITENANT_OPT_IN_ENV },
      `SECURITY: ${UNSANDBOXED_MULTITENANT_OPT_IN_ENV} is set — executing ${opts.sink} ` +
        `runs UNSANDBOXED on the shared cloud_auth host. Tenant code runs directly on the ` +
        `control-plane host with NO per-tenant isolation. This override is process-wide: it ` +
        `permits ALL agent, crew, AND Commander runs to execute unsandboxed on this host — ` +
        `not only the ${opts.sink} run that first tripped this one-time warning. This is an ` +
        `explicit operator override; do not use it in production multi-tenant deployments.`,
    );
  }
}
