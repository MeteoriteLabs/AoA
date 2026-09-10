export const MARKETPLACE_RECONCILIATION_ENTITY_TYPE =
  "marketplace_reconciliation";
export const MARKETPLACE_RECONCILIATION_ACTION_PREFIX =
  "marketplace.reconciliation_";

/**
 * Reserved `action` prefix for security-denial audit rows (DE-19 and the
 * denial-audit class behind `E0-F010` / `E0-F013`).
 *
 * ★ WHAT THE RESERVATION IS FOR. These rows are evidence that a security control
 * REFUSED something, and they are the only durable trace such a refusal leaves.
 * If a caller could choose its own `action` and land in this namespace — the
 * generic `insertActivityLog` helper, `activityService.create`, or an
 * authenticated board client POSTing to `/companies/:cid/activity` — then "there
 * is a denial record" would stop implying "a control denied", and an operator
 * reading the log could be reading forgery. Those three are refused here, and
 * `recordSecurityDenial` in `security-denial-audit.ts` deliberately does its own
 * insert rather than going through them.
 *
 * ★ AND WHAT IT IS NOT — MEASURED, because an earlier draft of this comment
 * claimed a chokepoint that does not exist. There is no single funnel for
 * `activity_log`. At the commit that added this text there are THIRTY-FOUR
 * direct `db.insert(activityLog)` / `tx.insert(activityLog)` sites in
 * `server/src`, and this predicate runs at exactly TWO of them —
 * `insertActivityLog` (`activity-log.ts:35`) and `activityService.create`
 * (`activity.ts:188`) — plus the HTTP route's Zod refinement
 * (`routes/activity.ts:33`) ahead of the second. The other thirty-two write
 * straight past it.
 *
 * The property still holds, but for a NARROWER reason than "everything is
 * refused here": those two are the only writers that accept a caller-supplied
 * `action` at all. Every one of the other thirty-two hard-codes it — a string
 * literal, a ternary of literals (`work-question-continuation-terminal.ts:175`),
 * a literal-union parameter (`user-notes.ts:27`), a module-local const
 * (`marketplace-reconcile.ts:380`, `seed-commander-review.ts:267`), or a
 * statically-prefixed template (`hub-items.ts:1186`, `hub_item.${…}`, which
 * cannot reach this namespace whatever the suffix). The one site typed
 * `action: string` (`operator-break-glass.ts:277`) is a private dep hook with
 * three internal literal call sites.
 *
 * SO: this is a reservation over a write surface whose shape was checked, not a
 * structural chokepoint. A NEW direct insert that took a free-form `action`
 * would bypass it and nothing would fail. THE RULE FOR ANYONE ADDING ONE: a
 * direct `insert(activityLog)` must hard-code its `action`; if the action comes
 * from the caller, route through `insertActivityLog` instead. That rule is not
 * mechanically enforced, and the decision not to enforce it is recorded in
 * `docs/replatform/epics/E0-foundation/findings.md` under E0-F013.
 *
 * The reservation is on the ACTION prefix only, deliberately NOT on entityType:
 * a denial row's `entityType`/`entityId` name the REFUSED RESOURCE (e.g.
 * `memory_item`), which is what makes the existing
 * `activity_log_entity_type_id_idx` answer "what was refused on this item".
 * Reserving entityType too would force a synthetic type and lose that.
 */
export const SECURITY_DENIAL_ACTION_PREFIX = "security.denied.";

/**
 * Reserved `action` prefix for CONTROL-PLANE RETENTION DECISIONS (DE-11's
 * `audit` clause, "sensitive-artifact access and retention are audited").
 *
 * ★ WHY THIS IS A SEPARATE NAMESPACE FROM `security.denied.`, AND NOT A
 * CONVENIENCE. A retention override is NOT a refusal. `resolveStoredRetention`
 * ignores a worker's declared class and stores the derived one; the authority's
 * own doc comment says why that is not an attack — "a worker declaring a SHORTER
 * class than derived is not an attack, but it is the same bug class". Filing
 * those rows under `security.denied.` would make "count the denial rows" answer
 * a different question than "count the refusals", which is precisely the
 * property the denial reservation above exists to protect. So: a distinct
 * prefix, a distinct recorder (`artifact-retention-audit.ts`), and a distinct
 * reservation, enforced at the same two caller-supplied-`action` writers.
 *
 * ★ THE PARTIAL CHECK DOES NOT COVER THIS PREFIX, DELIBERATELY.
 * `activity_log_company_or_denial_check` (migration `0274`) reads
 * `company_id IS NOT NULL OR action LIKE 'security.denied.%'`. A retention row
 * is written from `artifact-commit.ts` inside a LOCKED LEASE, so `ctx.companyId`
 * is always an FK-valid company and the row satisfies the NOT NULL arm. If a
 * future caller ever tries to write a company-less retention row the database
 * refuses it, which is the correct answer: a retention decision with no tenant
 * is not a record anyone can act on.
 */
export const SECURITY_RETENTION_ACTION_PREFIX = "security.retention.";

export class ReservedActivityNamespaceError extends Error {
  constructor(message?: string) {
    super(
      message ??
        "Marketplace reconciliation audit events are reserved for the reconciliation service",
    );
  }
}

export function assertUnreservedActivityNamespace(input: {
  action: string;
  entityType: string;
}): void {
  if (
    input.entityType === MARKETPLACE_RECONCILIATION_ENTITY_TYPE ||
    input.action.startsWith(MARKETPLACE_RECONCILIATION_ACTION_PREFIX)
  ) {
    throw new ReservedActivityNamespaceError();
  }
  if (input.action.startsWith(SECURITY_DENIAL_ACTION_PREFIX)) {
    throw new ReservedActivityNamespaceError(
      "Security-denial audit events are reserved for the security-denial recorder",
    );
  }
  if (input.action.startsWith(SECURITY_RETENTION_ACTION_PREFIX)) {
    throw new ReservedActivityNamespaceError(
      "Retention-decision audit events are reserved for the retention recorder",
    );
  }
}
