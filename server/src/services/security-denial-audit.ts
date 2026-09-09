import type { Db } from "@armyofagents/db";
import { activityLog } from "@armyofagents/db";
import type { ActivityActorType } from "@armyofagents/shared";
import { sanitizeRecord } from "../redaction.js";
import { logger } from "../middleware/logger.js";
import { SECURITY_DENIAL_ACTION_PREFIX } from "./activity-namespace.js";

/**
 * The durable record a security refusal leaves behind.
 *
 * ★ THE PROBLEM THIS EXISTS FOR. Seventeen crossings in
 * `docs/architecture/distributed-execution-threat-controls.json` assert that
 * denials are audited. On every one of them the deny path returned before
 * anything durable was written, so a refused cross-tenant read, a replayed
 * credential and a shed submission were all INDISTINGUISHABLE FROM TRAFFIC THAT
 * NEVER HAPPENED (`E0-F010`, `E0-F013`). This is the first writer for that
 * class. It closes ONE of the seventeen — DE-19's `memory.get` half — and the
 * remaining sixteen are enumerated in the finding, not here.
 *
 * ★ ATTRIBUTION IS THE CONTRACT. The crossings do not assert "a denial is
 * counted"; they assert denials are ATTRIBUTABLE. A count-only, id-free metric
 * (the DE-06 and DE-29 shape: `metrics.artifactOp({outcome:"denied"})`,
 * `metrics.secretRead({outcome:"denied"})`) does not satisfy them, because it
 * cannot answer WHO was refused, in WHICH tenant, on WHICH resource, and WHY.
 * Every field below is required for exactly that reason, and the proving test
 * asserts each of the four separately rather than asserting a row exists.
 *
 * ★ WHY `activity_log` AND NOT A NEW TABLE. Three properties decide it:
 *   1. It is the live product audit store with an existing redaction pass
 *      (`sanitizeRecord`), so a denial cannot become the leak it records.
 *   2. It is DELIBERATELY OUTSIDE the tenant RLS kernel — migration
 *      `0245_job_activity_audit_rls.sql:15-18` records `activity_log` and
 *      `hub_audit` as "CAV-005 legacy, non-forced" and grants `aoa_app`
 *      SELECT+INSERT (`0213:98`, `0214:166`). Every RLS-forced table
 *      (`jobs`, `job_events`, `job_projection_receipts`,
 *      `worker_lease_rejections`, …) would refuse a denial write for the same
 *      reason the read was denied — the org GUC is exactly what is wrong in the
 *      cross-tenant case. A denial recorder cannot live behind the policy it
 *      exists to observe.
 *   3. `action`/`entityType` are free text and `details` is jsonb, so the
 *      namespace needs no schema change and no DDL.
 *
 * ★ THE LIMIT, AS IT NOW STANDS — E0-F013 DECISION 2, RULED (a2) 2026-09-09.
 * The paragraph that used to sit here said `activity_log.company_id` is NOT NULL
 * and that a denial with no resolvable company "CANNOT be written here at all".
 * That is no longer true and is replaced rather than footnoted, because a stale
 * limit in a recorder's own contract is how a caller learns the wrong rule.
 *
 * `company_id` is now NULLABLE, a nullable `organization_id` sits beside it, and
 * a partial CHECK (`company_id IS NOT NULL OR action LIKE 'security.denied.%'`)
 * keeps the NOT NULL guarantee for every product writer while admitting a
 * tenantless row inside this recorder's reserved namespace ONLY. Migration
 * `0274_activity_log_denial_sink.sql`; ruling
 * `docs/replatform/DECISION-REQUEST-unattributable-denial-sink.md` §4.
 *
 * ★ WHAT THAT DOES AND DOES NOT BUY, per axis:
 *   - a denial that resolves a company still writes it, unchanged;
 *   - a denial that resolves only an ORGANIZATION (DE-03's eight session-bound
 *     refusals, DE-15's drain, five of DE-06's six fence throws) now writes a row
 *     attributed to that organization and to no company;
 *   - two DE-03 sites stay DOUBLY NULL even under (a2) and this recorder does not
 *     pretend otherwise: `server/src/services/worker-enrollment.ts:315`, where
 *     `authoritativeOrganizationId` is typed `string | null` and an unrouted
 *     enrollment code yields no organization, and the pre-code refusal at `:295`,
 *     which fires before any organization is resolved at all. Those rows are
 *     attributable to nothing but the device thumbprint and proof id in
 *     `details`, and that is the honest ceiling, not an oversight.
 *   - `organization_id` is `ON DELETE restrict`, not `cascade`, and a null-company
 *     row does not cascade with any company. Decision 3(b)'s "a suspect deletes
 *     their own denial history" therefore has less surface here, but is NOT
 *     answered by this slice.
 *
 * ★ THE ORGANIZATION MUST BE VERIFIED, NEVER CALLER-SUPPLIED. This is the whole
 * difference between the ruled option (a2) and the rejected option (c). Callers
 * pass `organizationId` ONLY when it came out of a control-plane-minted, HMAC-
 * verified artefact (`verifyWorkerOperationProof` → `verifyWorkerSessionToken`,
 * `worker-operation-proof.ts:47-60`) or out of a row read in this transaction.
 * A value taken off the wire lets a prober CHOOSE THE DESTINATION of the record
 * of its own refusal — dilute it, flood a victim's feed, or omit it to force the
 * row back into the tenantless bucket. A prober that controls the attribution
 * controls the audit. Do not add a caller-supplied path.
 *
 * ★ TRANSACTION DISCIPLINE, and why callers must read this. `db` MUST be a
 * pool-level handle, never the transaction that is about to reject. Many
 * denials in this class are a `throw` INSIDE a tenant transaction (DE-04,
 * DE-12, DE-29), so an in-transaction write of the denial is rolled back with
 * it — DE-29 is the proof, where the audit UPDATE at
 * `job-control.ts:3139` sits after the throw at `:3122` and never runs. DE-19,
 * the crossing wired here, denies OUTSIDE any transaction, which is why it is
 * the first one: it does not force that lifecycle problem on the first slice.
 * The fence denials will.
 *
 * ★ IT NEVER THROWS, AND WHAT THAT COSTS. A failure to record must not convert a
 * security refusal into a 500: that would both hand the caller an oracle (a
 * refused id behaves differently from an absent one) and make the audit path a
 * denial-of-service lever on the refusal path. So a failed insert is logged at
 * error level, carrying the same attribution the row would have carried, and
 * swallowed. The cost is that a silently-broken writer looks like a quiet
 * system — the exact failure class this programme exists to stop — so the
 * proving test (`de-19-memory-denial-audit.integration.test.ts`) is written to
 * go RED when the write is removed, and it was observed doing so.
 */
export interface SecurityDenialInput {
  /**
   * The tenant the refusal happened in, on the COMPANY axis.
   *
   * `null` ONLY where the refusing control genuinely holds no FK-valid company —
   * `organization → company` is 1:N and therefore not a function, so there is no
   * reverse lookup to perform (`companies.ts:20`, and the only unique constraint
   * over `organization_id` is the composite `companies_org_id_uq`, `:87`). Pass
   * `null` because the company is ABSENT, never because it was inconvenient to
   * thread: a null here is a claim that nothing in scope resolves one.
   */
  companyId: string | null;
  /**
   * The tenant the refusal happened in, on the ORGANIZATION axis. Added by
   * E0-F013 Decision 2 (a2) so an organization-only refusal records WHO was
   * refused instead of "someone, somewhere".
   *
   * ★ MUST be token-attested or DB-resolved — see the header. Never a value the
   * caller put on the wire.
   *
   * Optional, and `null` is a real answer: at two DE-03 sites there is no
   * organization either (see the header).
   */
  organizationId?: string | null;
  /**
   * The crossing id from `distributed-execution-threat-controls.json` whose
   * `audit` clause this row exists to satisfy, e.g. "DE-19". Makes a row
   * traceable back to the obligation that required it.
   */
  crossing: string;
  /**
   * What was refused, as a stable slug appended to the reserved action prefix —
   * e.g. "memory_read" becomes `security.denied.memory_read`.
   */
  surface: string;
  /**
   * WHY, as a stable machine code and never free prose (prose cannot be counted,
   * alerted on, or compared across releases). Distinct codes must correspond to
   * distinct BRANCHES in the refusing control, so a reader can tell a
   * cross-tenant probe from an unapproved row.
   */
  reason: string;
  /** WHO — the actor kind, mirroring the `activity_log.actor_type` vocabulary. */
  actorType: ActivityActorType;
  /** WHO — the actor's stable id. `actor_id` is plain text with no FK, so this
   * is safe for identities (agent keys, external MCP principals) that have no
   * row in `agents` or `auth`. */
  actorId: string;
  /** WHICH RESOURCE — the kind of thing that was refused, e.g. "memory_item". */
  entityType: string;
  /** WHICH RESOURCE — its id. */
  entityId: string;
  /**
   * The control that refused, as `path/to/file.ts:line` or a symbol name. This
   * is what lets an operator go from a row to the line, and what makes a stale
   * record visible when the line moves.
   */
  control: string;
  /** Anything else worth keeping. Redacted through `sanitizeRecord` before insert. */
  details?: Record<string, unknown> | null;
}

/**
 * Record one security refusal durably and attributably. Returns the row id, or
 * `null` when nothing could be written (which is logged at error level).
 *
 * Deliberately does NOT publish a live event. `logActivity`'s publish is
 * company-scoped, so broadcasting a denial would push a cross-tenant probe into
 * the probed company's own event stream — turning an audit record into a
 * disclosure channel.
 */
export async function recordSecurityDenial(
  db: Db,
  input: SecurityDenialInput,
): Promise<string | null> {
  const action = `${SECURITY_DENIAL_ACTION_PREFIX}${input.surface}`;
  const details = sanitizeRecord({
    ...(input.details ?? {}),
    crossing: input.crossing,
    reason: input.reason,
    control: input.control,
    actorSource: input.actorType,
  });

  try {
    const [row] = await db
      .insert(activityLog)
      .values({
        companyId: input.companyId,
        // E0-F013 Decision 2 (a2). Undefined and null are the same row here — the
        // column is nullable and has no default — but the explicit `?? null`
        // keeps the value that reaches the database identical to the value the
        // caller passed, so a test can assert the two doubly-null DE-03 sites
        // really do write a doubly-null row rather than a defaulted one.
        organizationId: input.organizationId ?? null,
        actorType: input.actorType,
        actorId: input.actorId,
        action,
        entityType: input.entityType,
        entityId: input.entityId,
        // The FK'd `agent_id`/`run_id` columns are deliberately left null: they
        // reference `agents` and `heartbeat_runs`, and a denial's actor is often
        // precisely an identity with no such row (an external key, a stale run,
        // a caller from another tenant). A dangling FK would make the write fail
        // for the same reason the read was denied. Actor identity rides
        // `actor_id` (plain text) and `details` instead.
        agentId: null,
        runId: null,
        details,
      })
      .returning({ id: activityLog.id });
    return row?.id ?? null;
  } catch (err) {
    logger.error(
      {
        service: "security-denial-audit",
        event: "security.denial_audit_write_failed",
        crossing: input.crossing,
        action,
        companyId: input.companyId,
        organizationId: input.organizationId ?? null,
        actorType: input.actorType,
        actorId: input.actorId,
        entityType: input.entityType,
        entityId: input.entityId,
        reason: input.reason,
        control: input.control,
        err,
      },
      "failed to record a security denial — the refusal still stands, but it is now unattributable",
    );
    return null;
  }
}
