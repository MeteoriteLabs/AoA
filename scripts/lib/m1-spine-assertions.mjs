// -----------------------------------------------------------------------------
// DEP-016 — the m1-spine campaign profile's tenant set and its VERDICT functions.
//
// Pure: no I/O, no Docker, no PostgreSQL. The LIVE profile (tests/d1/m1-spine.test.mjs) gathers
// rows from a running D1 stack and passes them here; the self-test
// (scripts/lib/__tests__/m1-spine-assertions.test.mjs) proves each verdict can say NO. Keeping
// the verdicts pure is what lets a PR prove them: the live half runs only in the D1 merge-train.
//
// What the profile asserts (E6 implementation plan §4c DEP-016, as amended at S0-8):
//   * F10 multi-tenant: three Organizations — two enabled through the per-Organization rollout
//     policy (`AOA_DISTRIBUTED_EXECUTION_ROLLOUT`) and one CONTROL that is absent from it — with
//     the SAME policy on every control-plane replica;
//   * the deployment-wide crew switch `AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED` is off on every
//     replica (it has no per-Organization dimension, so it would arm crew for every tenant);
//   * per enabled tenant, a handed-off attempt through the REAL ingest writes EXACTLY ONE
//     `cost_events` row with cost > 0 attributed to that tenant's own Company, ONE applied
//     `authoritative_cost` receipt of that tenant, and the JOB-017 audit rows
//     (`job.attempt_started`, `job.attempt_terminal`) of that tenant;
//   * the control tenant is refused: the real placement authority, on every replica, decides
//     `legacy` because the Organization is disabled, it is offered no work, and it has no events,
//     cost rows or receipts.
// -----------------------------------------------------------------------------

/** Every cost violation's message carries this, so the workflow's usage-suppressed positive
 * control can prove it went red for the RIGHT reason (and not, say, a bring-up failure). */
export const M1_SPINE_COST_MARKER = "[m1-spine:cost]";

/**
 * Every USAGE-CARDINALITY violation's message carries this, for the duplicate-usage positive
 * control. Separate from the cost marker because the two controls prove different things: the
 * suppressed run proves the cost assertion can fail, and the duplicate run proves the "exactly one"
 * arms can fail in the OTHER direction.
 *
 * ★ WHY THIS EXISTS AT ALL (added 2026-09-23). `WRK-018` acceptance 1 is *"one real keyed run emits
 * EXACTLY ONE `usage` equal to the result line"*, and a Codex P1 on PR #564 established that the
 * keyed run's stored `usage_json` row cannot establish it: a stored row cannot be distinguished from
 * a duplicate or a replay of itself. A CARDINALITY claim needs a counted population, which is what
 * this profile has — the accepted `usage` events of one attempt, counted in `job_events` — so the
 * assertion is collected here, per tenant, with a duplicate that must red.
 */
export const M1_SPINE_USAGE_MARKER = "[m1-spine:usage]";

function tenant(key, n) {
  // Fixed ids: the rollout policy is static env on the replicas, so the Organizations it names
  // must be known before the stack boots. Version-4-shaped so every uuid validator accepts them.
  const hex = n.toString(16);
  return Object.freeze({
    key,
    organizationId: `0d016${hex}00-0000-4000-8000-00000000000${hex}`,
    companyId: `0d016${hex}01-0000-4000-8000-00000000000${hex}`,
    agentId: `0d016${hex}02-0000-4000-8000-00000000000${hex}`,
    issuePrefix: `M1S${key}`,
  });
}

/** The F10 tenant set: two enabled Organizations and one control. */
export const M1_SPINE_TENANTS = Object.freeze({
  enabled: Object.freeze([tenant("A", 0xa), tenant("B", 0xb)]),
  control: tenant("C", 0xc),
});

/** The model every enabled tenant's agent runs; a KNOWN rate in the versioned schedule
 * (`server/src/services/internal-agent/cost-model.ts` RATES), so the fail-closed resolver prices it. */
export const M1_SPINE_AGENT_MODEL = "claude-sonnet-4-6";

/** The workload the profile runs and the rollout enables. */
export const M1_SPINE_WORKLOAD = "batch";

/**
 * The exact `AOA_DISTRIBUTED_EXECUTION_ROLLOUT` value on every control-plane replica. The two
 * enabled Organizations are `canary` (CLI-006: placement sees `active`, so their attempts are
 * lease-eligible); the control Organization is ABSENT, which `parseDistributedExecutionRolloutMap`
 * reads as disabled.
 */
export const M1_SPINE_ROLLOUT_ENV_VALUE = JSON.stringify({
  organizations: Object.fromEntries(
    M1_SPINE_TENANTS.enabled.map((t) => [t.organizationId, { mode: "canary", workloads: [M1_SPINE_WORKLOAD] }]),
  ),
});

const CONTROL_PLANE_REPLICAS = Object.freeze(["control-plane", "control-plane-b"]);
export { CONTROL_PLANE_REPLICAS as M1_SPINE_CONTROL_PLANE_REPLICAS };

function violation(code, message) {
  if (code.startsWith("cost:")) return { code, message: `${M1_SPINE_COST_MARKER} ${message}` };
  if (code.startsWith("usage:")) return { code, message: `${M1_SPINE_USAGE_MARKER} ${message}` };
  return { code, message };
}

// ── the committed override (static; runs in pr.yml) ───────────────────────────

/**
 * Text-level checks of `docker/d1/m1-spine.override.yml`. Deliberately textual: the file uses
 * compose's `!override` tag, which the repo's dependency-free yaml-lite does not parse, and the
 * three properties below are all a matter of what the file literally says.
 */
export function evaluateSpineOverrideText(text) {
  const out = [];
  const src = String(text);
  const rolloutLines = src.match(/^\s*AOA_DISTRIBUTED_EXECUTION_ROLLOUT:\s*'([^'\n]*)'\s*$/gm) ?? [];
  const values = rolloutLines.map((line) => line.replace(/^\s*AOA_DISTRIBUTED_EXECUTION_ROLLOUT:\s*'/, "").replace(/'\s*$/, ""));
  const exact = values.filter((v) => v === M1_SPINE_ROLLOUT_ENV_VALUE).length;
  if (exact !== CONTROL_PLANE_REPLICAS.length || values.length !== CONTROL_PLANE_REPLICAS.length) {
    out.push(violation(
      "override:rollout_not_on_every_replica",
      `expected the declared rollout value on exactly ${CONTROL_PLANE_REPLICAS.length} replicas, found ${exact} exact of ${values.length}`,
    ));
  }
  for (const replica of CONTROL_PLANE_REPLICAS) {
    if (!new RegExp(`^  ${replica}:\\s*$`, "m").test(src)) {
      out.push(violation("override:rollout_not_on_every_replica", `replica ${replica} has no service block`));
    }
  }
  if (/AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED/.test(src.replace(/^\s*#.*$/gm, ""))) {
    out.push(violation("override:crew_switch_present", "the profile must not set the deployment-wide crew switch"));
  }
  if (!/^  worker-a:\n    profiles: \[[^\]]+\]\s*$/m.test(src)) {
    out.push(violation("override:worker_a_not_excluded", "worker-a must be moved out of the default profile (one-worker topology)"));
  }
  return out;
}

// ── per replica ──────────────────────────────────────────────────────────────

/**
 * @param {object} o
 * @param {string} o.replica
 * @param {string|null} o.rolloutRaw   the replica's raw AOA_DISTRIBUTED_EXECUTION_ROLLOUT
 * @param {boolean} o.deploymentEnabled readDistributedExecutionDeploymentFlag on the replica
 * @param {Record<string,string>} o.resolved organizationId -> resolveRunRolloutState(...)
 * @param {string|null} o.crewRaw       the raw AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED (null = unset)
 * @param {boolean|null} o.crewEnabled  readDistributedCrewRolloutFlag, or null if it threw
 */
export function evaluateReplicaRollout(o) {
  const out = [];
  const r = o.replica;
  if (o.deploymentEnabled !== true) {
    out.push(violation("rollout:deployment_disabled", `${r}: AOA_DISTRIBUTED_EXECUTION_ENABLED is not on`));
  }
  if (o.rolloutRaw !== M1_SPINE_ROLLOUT_ENV_VALUE) {
    out.push(violation("rollout:value_mismatch", `${r}: rollout value differs from the declared tenant set`));
  }
  for (const t of M1_SPINE_TENANTS.enabled) {
    if (o.resolved?.[t.organizationId] !== "canary") {
      out.push(violation("rollout:enabled_tenant_not_canary", `${r}: tenant ${t.key} resolves to ${String(o.resolved?.[t.organizationId])}`));
    }
  }
  const control = o.resolved?.[M1_SPINE_TENANTS.control.organizationId];
  if (control !== "off") {
    out.push(violation("rollout:control_not_off", `${r}: control tenant resolves to ${String(control)}`));
  }
  if (o.crewEnabled === null) {
    out.push(violation("crew:switch_unparseable", `${r}: AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED=${JSON.stringify(o.crewRaw)} is not a boolean`));
  } else if (o.crewEnabled !== false) {
    out.push(violation("crew:switch_on", `${r}: AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED is on`));
  }
  return out;
}

// ── an enabled tenant ────────────────────────────────────────────────────────

/**
 * @param {{ tenant: object, observation: object }} input
 * observation: { acceptedThroughSeq, jobEventTypes, attemptStatus,
 *   usageEvents: [{eventId, organizationId, companyId, payload:{inputTokens,outputTokens,cachedInputTokens,runtimeMillis}}]
 *              — the ACCEPTED `usage` events of THIS attempt, from `job_events`,
 *   costRows: [{companyId, costCents, sourceIdempotencyKey}]  — every cost_events row whose key
 *             names ANY event of this attempt, across ALL Companies (so a misattributed row is seen),
 *   costReceipts: [{status, organizationId, companyId, sourceIdentity, aggregateKind}] — authoritative_cost, this job,
 *   activity: [{action, companyId, actorType, actorId}]        — job.attempt_* rows for this job,
 *   expectedActorId — `worker:<the leased worker id>`, the actor JOB-017 must have recorded,
 *   auditReceipts: [{status, organizationId, companyId}] }     — activity_audit, this job
 */
export function evaluateEnabledTenantSpine({ tenant: t, observation: o }) {
  const out = [];
  const k = `tenant ${t.key}`;
  if (o.attemptStatus !== "succeeded") {
    out.push(violation("journey:attempt_not_succeeded", `${k}: attempt status ${String(o.attemptStatus)}`));
  }

  // Audit (JOB-017, E3-D-AUDIT-SET): exactly one of each named action, this tenant's Company.
  for (const action of ["job.attempt_started", "job.attempt_terminal"]) {
    const rows = (o.activity ?? []).filter((a) => a.action === action);
    const suffix = action.replace("job.", "");
    if (rows.length === 0) out.push(violation(`audit:missing_${suffix}`, `${k}: no ${action} activity row`));
    if (rows.length > 1) out.push(violation(`audit:duplicate_${suffix}`, `${k}: ${rows.length} ${action} rows`));
  }
  if ((o.activity ?? []).some((a) => a.companyId !== t.companyId)) {
    out.push(violation("audit:wrong_company", `${k}: an audit row is attributed to another Company`));
  }
  // Codex P2 (PR #566): an audit row with the right action and Company but the WRONG actor records
  // false provenance — it says a different worker did the thing. JOB-017's actor for an accepted
  // mutation is `system` / `worker:<the worker whose fenced event was accepted>`.
  if (o.expectedActorId) {
    const wrong = (o.activity ?? []).filter((a) => a.actorType !== "system" || a.actorId !== o.expectedActorId);
    if (wrong.length > 0) {
      out.push(violation(
        "audit:wrong_actor",
        `${k}: ${wrong.length} audit row(s) name ${JSON.stringify(wrong.map((a) => `${a.actorType}/${a.actorId}`))}, not system/${o.expectedActorId}`,
      ));
    }
  }
  const auditReceipts = o.auditReceipts ?? [];
  if (auditReceipts.length !== 2 || auditReceipts.some((r) => r.status !== "applied")) {
    out.push(violation("audit:receipts", `${k}: expected 2 applied activity_audit receipts, saw ${JSON.stringify(auditReceipts.map((r) => r.status))}`));
  }
  if (auditReceipts.some((r) => r.organizationId !== t.organizationId || r.companyId !== t.companyId)) {
    out.push(violation("audit:receipt_wrong_tenant", `${k}: an activity_audit receipt names another tenant`));
  }

  // Usage cardinality (the WRK-018 acceptance-1 collection point). EXACTLY ONE accepted `usage`
  // event for this attempt — never `>= 1`, because a duplicate is precisely what a stored row
  // cannot rule out — and its units are the ones the charge was computed from.
  const usageEvents = o.usageEvents ?? [];
  if (usageEvents.length !== 1) {
    out.push(violation(
      usageEvents.length === 0 ? "usage:no_usage_event" : "usage:not_exactly_one",
      `${k}: the attempt has ${usageEvents.length} accepted usage event(s) in job_events, expected exactly 1`,
    ));
  }
  if (usageEvents.some((e) => e.organizationId !== t.organizationId || e.companyId !== t.companyId)) {
    // F10: an event of another Organization must never be counted toward this tenant's one.
    out.push(violation("usage:wrong_tenant", `${k}: an accepted usage event names another tenant`));
  }
  if (o.expectedUnits) {
    for (const event of usageEvents) {
      const stored = event.payload ?? {};
      const differs = ["inputTokens", "outputTokens", "cachedInputTokens", "runtimeMillis"]
        .some((field) => Number(stored[field]) !== Number(o.expectedUnits[field]));
      if (differs) {
        out.push(violation(
          "usage:units_differ",
          `${k}: the stored usage ${JSON.stringify(stored)} is not the units the provider reported ${JSON.stringify(o.expectedUnits)}`,
        ));
      }
    }
  }

  // Cost (JOB-016): exactly one row, cost > 0, this tenant's Company; one applied receipt.
  const costRows = o.costRows ?? [];
  if (costRows.length === 0) {
    out.push(violation("cost:no_cost_row", `${k}: the handed-off attempt wrote NO cost_events row`));
  } else if (costRows.length > 1) {
    out.push(violation("cost:not_exactly_one", `${k}: ${costRows.length} cost_events rows for one attempt`));
  }
  if (costRows.some((row) => !(Number(row.costCents) > 0))) {
    out.push(violation("cost:zero_cost", `${k}: a cost_events row has cost_cents ${JSON.stringify(costRows.map((r) => r.costCents))}`));
  }
  if (costRows.some((row) => row.companyId !== t.companyId)) {
    out.push(violation("cost:wrong_company", `${k}: a cost_events row is attributed to another Company`));
  }
  // Codex P2 (PR #566): the Company is not the whole attribution. A charge rolled up to a DIFFERENT
  // agent of the same Company corrupts per-agent spend and the agent-scope hard stop while every
  // company-level number stays right, so the agent is checked too.
  if (costRows.some((row) => row.agentId !== t.agentId)) {
    out.push(violation(
      "cost:wrong_agent",
      `${k}: a cost_events row rolls up to ${JSON.stringify(costRows.map((r) => r.agentId))}, not this tenant's agent ${t.agentId}`,
    ));
  }
  const receipts = o.costReceipts ?? [];
  if (receipts.length === 0) {
    out.push(violation("cost:receipt_missing", `${k}: no authoritative_cost receipt`));
  } else if (receipts.length > 1) {
    out.push(violation("cost:receipt_not_exactly_one", `${k}: ${receipts.length} authoritative_cost receipts`));
  }
  if (receipts.some((r) => r.status !== "applied")) {
    out.push(violation("cost:receipt_not_applied", `${k}: authoritative_cost receipt status ${JSON.stringify(receipts.map((r) => r.status))}`));
  }
  if (receipts.some((r) => r.organizationId !== t.organizationId || r.companyId !== t.companyId)) {
    out.push(violation("cost:receipt_wrong_tenant", `${k}: an authoritative_cost receipt names another tenant`));
  }
  // Codex P2 (PR #566): the RECEIPT is the replay/re-drive guard, so it must be bound to the event it
  // guards. One applied receipt of the right tenant whose `source_identity` names a DIFFERENT event
  // means idempotency is attached to the wrong thing — a second delivery of THIS event would charge
  // again, and a re-drive would drive the wrong one.
  if (usageEvents.length === 1 && receipts.length === 1) {
    const expected = `cost:${t.companyId}:${usageEvents[0].eventId}`;
    if (receipts[0].sourceIdentity !== expected) {
      out.push(violation(
        "cost:receipt_not_keyed_to_event",
        `${k}: the authoritative_cost receipt names ${JSON.stringify(receipts[0].sourceIdentity)}, not ${expected}`,
      ));
    }
    if (receipts[0].aggregateKind !== "cost_events") {
      out.push(violation(
        "cost:receipt_wrong_aggregate",
        `${k}: the authoritative_cost receipt's aggregate kind is ${JSON.stringify(receipts[0].aggregateKind)}, not cost_events`,
      ));
    }
  }

  // The row must carry the SAME numbers as the accepted usage event, and be keyed to it: a charge
  // computed from anything else is not a charge for this attempt's reported usage.
  if (usageEvents.length === 1 && costRows.length === 1) {
    const units = usageEvents[0].payload ?? {};
    const row = costRows[0];
    const sameNumbers = Number(row.inputTokens) === Number(units.inputTokens) &&
      Number(row.outputTokens) === Number(units.outputTokens) &&
      Number(row.cachedInputTokens) === Number(units.cachedInputTokens);
    if (!sameNumbers) {
      out.push(violation("usage:row_units_differ", `${k}: the cost row's tokens are not the accepted usage event's`));
    }
    if (row.sourceIdempotencyKey !== `cost:${t.companyId}:${usageEvents[0].eventId}`) {
      out.push(violation("usage:row_not_keyed_to_event", `${k}: the cost row is not keyed to this attempt's usage event`));
    }
  }
  return out;
}

// ── the control tenant ───────────────────────────────────────────────────────

/**
 * @param {{ tenant: object, observation: object }} input
 * observation: { placements: [{replica, disposition, leaseEligible, reasonCode}] — the REAL
 *   placement service's decision for a control-tenant attempt, one per replica;
 *   positiveControlPlacement: {disposition, mode, reasonCode} | {error} — the SAME service on an
 *     ENABLED tenant;
 *   pollOutcome; jobEvents; costRowsForCompany; receipts }
 */
export function evaluateControlTenant({ tenant: t, observation: o }) {
  const out = [];
  const k = `control tenant ${t.key}`;
  const placements = o.placements ?? [];
  const replicas = new Set(placements.map((p) => p.replica));
  for (const replica of CONTROL_PLANE_REPLICAS) {
    if (!replicas.has(replica)) out.push(violation("control:not_every_replica", `${k}: no placement observed on ${replica}`));
  }
  for (const p of placements) {
    if (p.disposition !== "legacy" || p.leaseEligible !== false) {
      out.push(violation("control:placed_distributed", `${k}: ${p.replica} placed it ${p.disposition} (leaseEligible=${p.leaseEligible})`));
    } else if (p.reasonCode !== "organization_disabled") {
      out.push(violation("control:wrong_reason", `${k}: ${p.replica} refused it for ${p.reasonCode}, not organization_disabled`));
    }
  }
  // The positive control: the SAME placement service, on an ENABLED tenant, must reach a real
  // non-legacy decision. Without it, "the control was refused" could equally mean "placement
  // refuses everything" (a broken pool, a missing flag), which proves nothing about the rollout.
  const pc = o.positiveControlPlacement;
  if (!pc || pc.error || !pc.disposition || pc.disposition === "legacy" || pc.mode === "legacy" ||
      pc.reasonCode === "organization_disabled") {
    out.push(violation(
      "control:positive_control_also_legacy",
      `${k}: the same placement service on an ENABLED tenant was ${JSON.stringify(pc ?? null)}, so the refusal is not shown to be the rollout's`,
    ));
  }
  if (o.pollOutcome !== "no_work") out.push(violation("control:offered_work", `${k}: poll outcome ${String(o.pollOutcome)}`));
  if (o.jobEvents !== 0) out.push(violation("control:has_job_events", `${k}: ${o.jobEvents} job_events`));
  if (o.costRowsForCompany !== 0) out.push(violation("control:has_cost_rows", `${k}: ${o.costRowsForCompany} cost_events rows`));
  if (o.receipts !== 0) out.push(violation("control:has_receipts", `${k}: ${o.receipts} projection receipts`));
  return out;
}

// ── hostile cross-tenant cases (F10: "denied, not merely empty") ─────────────

/**
 * The isolation half of F10, which the per-tenant verdicts above cannot see: they only ever look at
 * matching identities. Each case pairs a HOSTILE attempt by tenant B against tenant A's attempt with
 * the SAME-TENANT positive control, so "denied" is never confused with "nothing works".
 *
 * @param {object} o
 * @param {{status:number, ackStatus:string|null}} o.hostileEventUpload  B's worker uploading an event
 *        onto A's lease over the real fenced ingest.
 * @param {{status:number, ackStatus:string|null}} o.ownEventUpload      the SAME upload by A's own worker.
 * @param {{status:number, outcome:string|null}} o.hostileAck            B acknowledging A's lease.
 * @param {number} o.foreignScopeEventCount  A's `job_events` read under B's tenant scope through the
 *        non-owner `aoa_app` pool with RLS (must be 0).
 * @param {number} o.ownScopeEventCount      the same read under A's own scope (must be > 0).
 * @param {number} o.costRowsAfterHostile    A's cost rows after the hostile traffic (must be unchanged).
 * @param {number} o.costRowsBeforeHostile
 * @param {number} o.usageEventsBeforeHostile / o.usageEventsAfterHostile — likewise for the accepted
 *        `usage` events of A's attempt: a foreign worker must not be able to add one.
 */
export function evaluateCrossTenantIsolation(o) {
  const out = [];
  const accepted = (r) => r && r.status === 200 && r.ackStatus === "accepted";
  if (accepted(o.hostileEventUpload)) {
    out.push(violation(
      "isolation:foreign_event_accepted",
      `a foreign tenant's worker uploaded an event onto another tenant's lease and it was ACCEPTED (status ${o.hostileEventUpload.status})`,
    ));
  }
  if (!accepted(o.ownEventUpload)) {
    out.push(violation(
      "isolation:own_event_denied",
      `the SAME upload by the owning tenant's own worker was not accepted (status ${o.ownEventUpload?.status}, ack ${o.ownEventUpload?.ackStatus}) — the denial above proves nothing`,
    ));
  }
  if (o.hostileAck && o.hostileAck.status === 200 && o.hostileAck.outcome === "acknowledged") {
    out.push(violation("isolation:foreign_ack_accepted", "a foreign tenant's worker acknowledged another tenant's lease"));
  }
  if (o.foreignScopeEventCount !== 0) {
    out.push(violation(
      "isolation:foreign_scope_reads_events",
      `a foreign tenant scope read ${o.foreignScopeEventCount} of another tenant's job_events through the non-owner pool`,
    ));
  }
  if (!(o.ownScopeEventCount > 0)) {
    out.push(violation(
      "isolation:own_scope_reads_nothing",
      `the owning tenant's own scope read ${o.ownScopeEventCount} rows — the 0 above is not RLS isolation`,
    ));
  }
  if (o.usageEventsAfterHostile !== o.usageEventsBeforeHostile) {
    out.push(violation(
      "isolation:usage_moved",
      `the hostile traffic changed the victim's accepted usage events from ${o.usageEventsBeforeHostile} to ${o.usageEventsAfterHostile}`,
    ));
  }
  if (o.costRowsAfterHostile !== o.costRowsBeforeHostile) {
    out.push(violation(
      "isolation:cost_moved",
      `the hostile traffic changed the victim's cost rows from ${o.costRowsBeforeHostile} to ${o.costRowsAfterHostile}`,
    ));
  }
  return out;
}

export function formatViolations(violations) {
  return violations.map((v) => `  - ${v.code}: ${v.message}`).join("\n");
}
