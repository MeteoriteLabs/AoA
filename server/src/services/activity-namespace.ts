export const MARKETPLACE_RECONCILIATION_ENTITY_TYPE =
  "marketplace_reconciliation";
export const MARKETPLACE_RECONCILIATION_ACTION_PREFIX =
  "marketplace.reconciliation_";

/**
 * Reserved `action` prefix for security-denial audit rows (DE-19 and the
 * denial-audit class behind `E0-F010` / `E0-F013`).
 *
 * ★ WHY A RESERVATION AND NOT JUST A CONVENTION. These rows are evidence that a
 * security control REFUSED something, and they are the only durable trace such a
 * refusal leaves. If any caller — the generic `insertActivityLog` helper, or an
 * authenticated board client POSTing to `/companies/:cid/activity` — could mint
 * a row in this namespace, then "there is a denial record" would stop implying
 * "a control denied", and an operator reading the log could be reading forgery.
 * So the ONLY writer is `recordSecurityDenial` in `security-denial-audit.ts`,
 * which deliberately does its own insert rather than going through
 * `insertActivityLog`; everything else is refused here.
 *
 * The reservation is on the ACTION prefix only, deliberately NOT on entityType:
 * a denial row's `entityType`/`entityId` name the REFUSED RESOURCE (e.g.
 * `memory_item`), which is what makes the existing
 * `activity_log_entity_type_id_idx` answer "what was refused on this item".
 * Reserving entityType too would force a synthetic type and lose that.
 */
export const SECURITY_DENIAL_ACTION_PREFIX = "security.denied.";

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
}
