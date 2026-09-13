/**
 * cloud-plugin-reconcile-audit.ts — DE-16's `audit` clause, RECONCILIATIONS
 * CONJUNCT ("blocked plugin routes, dispatch, and reconciliations are audited").
 *
 * ★ THE DEFECT THIS CLOSES, AND ITS EXACT SIZE.
 * `docs/architecture/distributed-execution-threat-controls.json` DE-16 asserts
 * that blocked plugin routes, dispatch, AND reconciliations are audited. The
 * clause is a conjunction. The route + dispatch half is delivered by E0-F013
 * Decision 3.2 (`recordCloudPluginDenial`, `security.denied.cloud_plugin_execution`).
 * The RECONCILIATIONS conjunct was not: `reconcileCloudBlockedPlugins`
 * (`plugin-lifecycle.ts`) flips every stale non-uninstalled `plugins` row to the
 * blocked metadata-only state at `cloud_auth` boot and called only
 * `recordCloudPluginBootReconciled` — a PROCESS-MEMORY counter/gauge
 * (`cloud-plugin-execution.ts`) that resets on every restart. No durable row was
 * written, so a reboot that reconciled a company's stale `ready` plugin to
 * blocked left the same trace as a boot that reconciled nothing. This module is
 * the durable record.
 *
 * ★ WHAT IS RECORDED, AND WHAT IS NOT — stated first, because a partial delivery
 * described as a whole one is this programme's own failure class.
 *   RECORDED: one row per plugin ACTUALLY reconciled to blocked at boot — a row
 *     that was non-uninstalled and NOT already blocked. It says WHO (the boot/
 *     machine identity), in WHICH tenant (the plugin's own FK-valid company),
 *     on WHICH resource (the reconciled plugin), and WHAT (the prior status it
 *     was moved FROM, and the blocked reason it was moved TO).
 *   NOT RECORDED, AND NOT A GAP: a row already carrying
 *     `PLUGIN_WORKER_BLOCKED_IN_CLOUD`. The reconciler SKIPS it (idempotent
 *     no-op on a re-boot / a second replica), so no row is reconciled and none is
 *     recorded. A reader must not read "no row this boot" as "nothing is
 *     blocked": the blocked STATE is on the `plugins` row itself. What this
 *     module recovers is the durable, attributable TRANSITION, which the counter
 *     could not.
 *   NOT CLAIMED: the ROUTE + DISPATCH conjuncts (delivered separately under
 *     `security.denied.`, see `cloud-plugin-denial-audit.ts`), and every non-audit
 *     DE-16 clause. This module delivers the reconciliations conjunct and nothing
 *     else — DE-16 stays `partial`.
 *
 * ★ ATTRIBUTION IS A REAL-TENANT, SYSTEM-ACTOR ROW — a DIFFERENT SHAPE from the
 * route/dispatch half's company-NULL operator rows, and deliberately so.
 *   - `companyId` = `plugins.company_id`. It is NOT NULL and FK-valid (references
 *     `companies`), read from the DB row, NEVER caller-supplied — so this is a
 *     normal company-attributed audit row, and it satisfies the partial CHECK
 *     `activity_log_company_or_denial_check`'s NOT NULL arm.
 *   - `organizationId` = null. A boot reconciliation holds no control-plane-
 *     attested organization: unlike the denial recorder, whose org is trustworthy
 *     ONLY from an HMAC-minted token, there is no token here. Null is the honest
 *     answer, not a missing one.
 *   - `actorType` = "system". A boot pass has no principal — no `agents` row, no
 *     `auth` row — so neither `agent` nor `user` is truthful, matching the
 *     worker→"system" convention the retention/object-access recorders use.
 *   - `actorId` = a stable plain-text identifier (`CLOUD_PLUGIN_BOOT_RECONCILE_ACTOR`)
 *     with no FK, the same plain-text-no-FK choice those recorders make for a
 *     worker id.
 *   - `entityType`/`entityId` = the reconciled plugin.
 *
 * ★ WHY `activity_log`. The same three properties that put the denial, retention
 * and object-access recorders there: it is the live product audit store with an
 * existing redaction pass, it is deliberately outside the tenant RLS kernel, and
 * `action`/`entityType` are free text with a jsonb `details`, so this needs no
 * schema change and no DDL.
 *
 * ★ IT NEVER THROWS. A failure to record must not turn boot reconciliation into a
 * crash — the record is evidence about a state change that already happened, and
 * losing the evidence must not lose the reconciliation. A failed insert is logged
 * at error level carrying the attribution the row would have carried. The cost of
 * a swallow is that a silently-broken writer looks like a quiet system, so
 * `de-16-reconciliation-audit.integration.test.ts` is written to go RED when the
 * write is removed, and it was observed doing so.
 */
import type { Db } from "@armyofagents/db";
import { activityLog } from "@armyofagents/db";
import { sanitizeRecord } from "../redaction.js";
import { logger } from "../middleware/logger.js";
import { SECURITY_RECONCILE_ACTION_PREFIX } from "./activity-namespace.js";
import { PLUGIN_WORKER_BLOCKED_IN_CLOUD } from "./cloud-plugin-execution.js";

/** The surface slug for a cloud-plugin boot reconciliation-to-blocked. */
export const CLOUD_PLUGIN_RECONCILE_BLOCKED_SURFACE = "cloud_plugin_blocked";

/** The action a reconciliation row carries → `security.reconcile.cloud_plugin_blocked`. */
export const CLOUD_PLUGIN_RECONCILE_ACTION = `${SECURITY_RECONCILE_ACTION_PREFIX}${CLOUD_PLUGIN_RECONCILE_BLOCKED_SURFACE}`;

/**
 * The stable plain-text `actor_id` for the boot reconciliation. It is a
 * machine/boot identity with NO FK — a reconciliation pass has no principal — so
 * it is stored directly, the same plain-text-no-FK choice the worker recorders
 * make for a worker id.
 */
export const CLOUD_PLUGIN_BOOT_RECONCILE_ACTOR = "cloud-plugin-boot-reconciliation";

/**
 * Record one cloud-plugin boot reconciliation-to-blocked durably and
 * attributably. Returns the row id, or `null` when nothing could be written
 * (logged at error). NEVER throws — a broken recorder must not turn boot
 * reconciliation into a crash.
 *
 * Deliberately does NOT publish a live event, for the reason the sibling
 * recorders give: an audit record that broadcasts is one that can be used as a
 * channel.
 */
export async function recordCloudPluginReconcileToBlocked(
  db: Db,
  input: {
    /** The reconciled plugin's id (`plugins.id`). */
    pluginId: string;
    /** The reconciled plugin's own company id (`plugins.company_id`, NOT NULL / FK-valid). */
    companyId: string;
    /** The status the plugin held BEFORE it was reconciled to the blocked state. */
    priorStatus: string;
  },
): Promise<string | null> {
  const details = sanitizeRecord({
    crossing: "DE-16",
    control: "server/src/services/plugin-lifecycle.ts:reconcileCloudBlockedPlugins",
    operation: "boot_reconcile",
    // The two values the record exists for: what it was moved FROM, and the
    // blocked reason it was moved TO.
    priorStatus: input.priorStatus,
    statusReasonCode: PLUGIN_WORKER_BLOCKED_IN_CLOUD,
  });

  try {
    const [row] = await db
      .insert(activityLog)
      .values({
        // A REAL, FK-valid company read from the plugin row — not caller-supplied.
        companyId: input.companyId,
        // No control-plane-attested organization at boot; see the header.
        organizationId: null,
        // Boot/machine identity, no principal — same convention as the worker
        // recorders.
        actorType: "system",
        actorId: CLOUD_PLUGIN_BOOT_RECONCILE_ACTOR,
        action: CLOUD_PLUGIN_RECONCILE_ACTION,
        entityType: "plugin",
        entityId: input.pluginId,
        // Left null: `agent_id`/`run_id` are FK'd to `agents`/`heartbeat_runs`
        // and a boot reconciliation has a row in neither.
        agentId: null,
        runId: null,
        details,
      })
      .returning({ id: activityLog.id });
    return row?.id ?? null;
  } catch (err) {
    logger.error(
      {
        service: "cloud-plugin-reconcile-audit",
        event: "security.reconcile_audit_write_failed",
        crossing: "DE-16",
        action: CLOUD_PLUGIN_RECONCILE_ACTION,
        companyId: input.companyId,
        pluginId: input.pluginId,
        priorStatus: input.priorStatus,
        err,
      },
      "failed to record a cloud-plugin boot reconciliation — the plugin is still blocked, but the transition is now unattributable",
    );
    return null;
  }
}
