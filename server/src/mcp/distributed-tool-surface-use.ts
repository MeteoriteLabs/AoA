// server/src/mcp/distributed-tool-surface-use.ts
//
// CLI-016 (M1b, founder ruling F10) — the PER-ORGANIZATION tool-surface gate at USE.
//
// The dispatch side (heartbeat.ts, the canary block) already withholds the brokered `aoa` MCP
// config and its run_jwt bearer from a run whose Organization has not opted in. This is the
// same decision re-proven per call at `/mcp` authorization, for three reasons:
//   1. Enabling tools for one tenant must never enable them for another — a gate that exists
//      only at dispatch is a claim about what was emitted, not about what is admitted.
//   2. Rollback must reach runs ALREADY dispatched. The run_jwt lives up to 48h; without this,
//      unsetting the kill switch or removing an Organization's `tools` would leave every
//      sandbox already holding a bearer with the surface until the JWT expired.
//   3. It sits beside the DAT-007 currency gate (`classifyRunCurrency`), which decides whether
//      the run still holds a live fence; this decides whether its TENANT is armed. Both deny
//      with the same coarse forbidden, so neither leaks which one refused.
//
// Pure and drizzle-free, like `distributed-run-currency.ts`, so the security decision is
// testable without a database; the DB reader is `distributed-tool-surface-use-resolver.ts`.

import type { RunCurrencyVerdict } from "./distributed-run-currency.js";

/** The row facts the reader resolves for the SIGNED run id, plus the tenant's armed state. */
export interface ToolSurfaceUseSnapshot {
  /** A `heartbeat_runs` row exists for the signed run id. */
  readonly runFound: boolean;
  /** `heartbeat_runs.company_id`. */
  readonly runCompanyId: string | null;
  /** `heartbeat_runs.execution_owner` — `"distributed"` only for a handed-off org run. */
  readonly executionOwner: string | null;
  /**
   * `resolveDistributedToolSurface(...).authorized` for the run's company's Organization: the
   * deployment kill switch AND that Organization's `tools: true` (decision E7-D10).
   */
  readonly organizationArmed: boolean;
}

/**
 * Decide whether a run-JWT actor's `/mcp` call is admitted by the per-Organization gate.
 *
 * The order mirrors `classifyRunCurrency`, and so do the two admits:
 *   1. No run row → ADMIT. Not an org distributed run; the DAT-007 fail-open class (crew,
 *      reaped). A run_jwt is only ever minted for a distributed run row
 *      (`resolveRunJwtValue` throws otherwise), so this admits no distributed bearer.
 *   2. Company mismatch → DENY (defense in depth over the endpoint's own tenant check).
 *   3. Not distributed → ADMIT. A LOCAL run's tools are the local adapter's, not this surface.
 *   4. Distributed → ADMIT iff the run's Organization is armed.
 */
export function classifyToolSurfaceAtUse(
  snapshot: ToolSurfaceUseSnapshot,
  companyId: string,
): RunCurrencyVerdict {
  if (!snapshot.runFound) return "admit";
  if (snapshot.runCompanyId !== companyId) return "deny";
  if (snapshot.executionOwner !== "distributed") return "admit";
  return snapshot.organizationArmed ? "admit" : "deny";
}
