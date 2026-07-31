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
// target is already isolated (sandbox-docker / provider-sandbox). It does NOT
// implement isolation — it makes the current unsafe fallback conscious.
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
 * Refuse an unsandboxed local run on an enforced-isolation (cloud_auth) deployment
 * unless the operator has explicitly opted in via AOA_ALLOW_UNSANDBOXED_MULTITENANT.
 * No-op on every self-hosted deployment and on already-isolated (sandbox) targets.
 * When opted in, logs one loud warning per process.
 *
 * @throws Error when tenant isolation is enforced (cloud_auth), the target is
 *   local/unsandboxed, and the opt-in env is not set.
 */
export function assertUnsandboxedMultitenantAllowed(
  target: AdapterExecutionTarget | null | undefined,
  opts: UnsandboxedMultitenantGuardOptions,
): void {
  // Only cloud_auth (tenant isolation enforced) gates. Every self-hosted
  // deployment — local_trusted AND authenticated single-tenant — is exempt.
  if (!opts.tenantIsolationEnforced) return;
  // Already isolated (sandbox-docker / provider-sandbox): safe on shared infra.
  if (!isUnsandboxedLocalTarget(target)) return;

  const env = opts.env ?? process.env;
  if (!optInEnabled(env)) {
    throw new Error(
      `Refusing to dispatch a ${opts.sink} run on the unsandboxed control-plane host ` +
        `under enforced tenant isolation (cloud_auth). Per-tenant execution isolation is ` +
        `not yet implemented; set ${UNSANDBOXED_MULTITENANT_OPT_IN_ENV}=1 to explicitly ` +
        `allow unsandboxed local runs on this shared deployment, or configure a sandboxed ` +
        `execution target.`,
    );
  }

  if (!hasWarnedUnsandboxedMultitenant) {
    hasWarnedUnsandboxedMultitenant = true;
    (opts.log ?? logger).warn(
      { sink: opts.sink, optIn: UNSANDBOXED_MULTITENANT_OPT_IN_ENV },
      `SECURITY: ${UNSANDBOXED_MULTITENANT_OPT_IN_ENV} is set — executing ${opts.sink} ` +
        `runs UNSANDBOXED on the shared cloud_auth host. Tenant code runs directly on the ` +
        `control-plane host with NO per-tenant isolation. This is an explicit operator ` +
        `override; do not use it in production multi-tenant deployments.`,
    );
  }
}
