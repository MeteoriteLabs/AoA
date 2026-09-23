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

/** The adapter type every enabled tenant's agent carries. The server resolves a `task_run`'s rate
 * from the assignee agent's `adapter_type` + `adapter_config.model` (`resolveModelForSource`), so
 * this is the provider the charge must name. One constant, used by the seed AND by the expectation:
 * a charge that names anything else means the resolver did not price from this agent. */
export const M1_SPINE_AGENT_ADAPTER_TYPE = "claude_local";

/** The rate schedule version the charge must be priced against
 * (`AUTHORITATIVE_RATE_VERSION`, `server/src/services/job-authoritative-rate.ts`). Pinned on
 * purpose: a re-price bumps that constant, and this profile should go red until the campaign's
 * expectation is updated with it. */
export const M1_SPINE_RATE_VERSION = 1;

/**
 * The units the reference provider reports (`FAKE_PROVIDER_CANNED_USAGE_V1`,
 * `packages/sandbox-fake-provider/src/fake-driver.ts`). MIRRORED here — a `scripts/lib` module
 * cannot import the TypeScript package — and the live profile compares this mirror with what the
 * provider actually reported, so the two cannot drift apart silently.
 */
export const M1_SPINE_CANNED_UNITS = Object.freeze({
  inputTokens: 120_000,
  outputTokens: 30_000,
  cachedInputTokens: 0,
  runtimeMillis: 4_200,
});

/** `claude-sonnet-4-6` at rate version 1, in cents per million tokens (the `RATES` row in
 * `server/src/services/internal-agent/cost-model.ts`). Mirrored for the same reason. */
export const M1_SPINE_RATE_CENTS_PER_M = Object.freeze({ input: 300, output: 1500 });

/**
 * The EXACT charge those units and that rate produce: 120 000/1e6 × 300 + 30 000/1e6 × 1500
 * = 36 + 45 = **81** cents, rounded half-up as `computeCostCents` does. Derived, not typed in, so
 * the arithmetic is stated rather than asserted. Codex (eighth round): "cost > 0" would pass a
 * charge of 1 or 810 cents with every other assertion satisfied.
 */
export const M1_SPINE_EXPECTED_COST_CENTS = Math.round(
  (M1_SPINE_CANNED_UNITS.inputTokens / 1_000_000) * M1_SPINE_RATE_CENTS_PER_M.input +
    (M1_SPINE_CANNED_UNITS.outputTokens / 1_000_000) * M1_SPINE_RATE_CENTS_PER_M.output,
);

/**
 * The execution-target slug the PRODUCTION canary credential binding routes to
 * (`CANARY_EXECUTION_TARGET_SLUG`, `server/src/services/canary-credential-binding.ts`). Each
 * tenant's target carries it, so the REAL placement service can SELECT that target — which is what
 * makes the enabled-path control a working placement (Codex P1, PR #566). Mirrored, not imported:
 * a `scripts/lib` module cannot import the server's TypeScript.
 */
export const M1_SPINE_CANARY_TARGET_SLUG = "aoa-canary-e2b";

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

/** The replica service blocks the override must configure IDENTICALLY (the S0-8 amendment: the
 * rollout policy on BOTH control-plane replicas). A CONFIG claim about the file. */
const CONFIGURED_REPLICAS = Object.freeze(["control-plane", "control-plane-b"]);
/** The control planes the profile actually RUNS. `M1-D1-SPINE` is "one control-plane instance, one
 * separately deployed worker" (`docs/replatform/epic-regrooming/scope-triage.md`), so
 * `control-plane-b` sits in the excluded profile and no replica/HA behaviour can affect evidence
 * presented as single-control-plane (Codex P1, PR #566). */
const RUNNING_REPLICAS = Object.freeze(["control-plane"]);
export { CONFIGURED_REPLICAS as M1_SPINE_CONFIGURED_REPLICAS, RUNNING_REPLICAS as M1_SPINE_CONTROL_PLANE_REPLICAS };

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
  // ★ PER SERVICE BLOCK, not per file (Codex P2, PR #566). Counting two matching assignments
  // anywhere would pass a file that put BOTH under `control-plane` and left `control-plane-b`
  // without one — and since the profile deliberately does not START the second replica, no live
  // probe would ever catch that drift.
  const blocks = new Map();
  let current = null;
  for (const line of src.split("\n")) {
    const header = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) {
      current = header[1];
      blocks.set(current, []);
      continue;
    }
    if (current && /^\S/.test(line)) current = null; // left the `services:` mapping
    if (current) blocks.get(current).push(line);
  }
  for (const replica of CONFIGURED_REPLICAS) {
    const block = blocks.get(replica);
    if (!block) {
      out.push(violation("override:rollout_not_on_every_replica", `replica ${replica} has no service block`));
      continue;
    }
    const values = block
      .map((line) => /^\s*AOA_DISTRIBUTED_EXECUTION_ROLLOUT:\s*'([^'\n]*)'\s*$/.exec(line))
      .filter(Boolean)
      .map((m) => m[1]);
    if (values.length !== 1 || values[0] !== M1_SPINE_ROLLOUT_ENV_VALUE) {
      out.push(violation(
        "override:rollout_not_on_every_replica",
        `replica ${replica} carries ${values.length} rollout assignment(s)${values.length === 1 ? " and it differs from the declared tenant set" : ""}; expected exactly one, byte-equal`,
      ));
    }
  }
  if (/AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED/.test(src.replace(/^\s*#.*$/gm, ""))) {
    out.push(violation("override:crew_switch_present", "the profile must not set the deployment-wide crew switch"));
  }
  if (!/^  worker-a:\n    profiles: \[[^\]]+\]/m.test(src)) {
    out.push(violation("override:worker_a_not_excluded", "worker-a must be moved out of the default profile (one-worker topology)"));
  }
  if (!/^  control-plane-b:\n    profiles: \[[^\]]+\]/m.test(src)) {
    out.push(violation(
      "override:second_replica_not_excluded",
      "control-plane-b must be moved out of the default profile — M1-D1-SPINE is ONE control plane",
    ));
  }
  if (/^      control-plane-b:\n        condition:/m.test(src)) {
    out.push(violation(
      "override:second_replica_not_excluded",
      "test-runner still depends on control-plane-b, which the active profile does not start",
    ));
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
  // The M1a freeze checklist (M1 plan §6) also requires the distributed TOOL SURFACE off — the
  // deployment flag AND every tenant's per-Organization `tools` opt-in, since either alone is
  // necessary-not-sufficient (E7-D10 / CLI-016). Codex, seventh round.
  if (o.toolSurfaceArmed === null) {
    out.push(violation("tools:flag_unparseable", `${r}: AOA_DISTRIBUTED_TOOL_SURFACE_ENABLED=${JSON.stringify(o.toolSurfaceRaw)} is not a value this binary accepts`));
  } else if (o.toolSurfaceArmed !== false) {
    out.push(violation("tools:deployment_armed", `${r}: the distributed tool surface is ARMED deployment-wide; M1a excludes it`));
  }
  for (const [organizationId, enabled] of Object.entries(o.organizationToolSurface ?? {})) {
    if (enabled !== false) {
      out.push(violation("tools:organization_opted_in", `${r}: Organization ${organizationId} opts in to the distributed tool surface`));
    }
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
 * observation: { acceptedThroughSeq, attemptStatus,
 *   events: [{eventId, eventType}] — this attempt's accepted job_events, in order,
 *   usageEvents: [{eventId, organizationId, companyId, payload:{inputTokens,outputTokens,cachedInputTokens,runtimeMillis}}]
 *              — the ACCEPTED `usage` events of THIS attempt, from `job_events`,
 *   costRows: [{companyId, costCents, sourceIdempotencyKey}]  — every cost_events row whose key
 *             names ANY event of this attempt, across ALL Companies (so a misattributed row is seen),
 *   costReceipts: [{status, organizationId, companyId, sourceIdentity, aggregateKind}] — authoritative_cost, this job,
 *   activity: [{action, companyId, actorType, actorId}]        — job.attempt_* rows for this job,
 *   expectedActorId — `worker:<the leased worker id>`, the actor JOB-017 must have recorded,
 *   auditReceipts: [{status, organizationId, companyId, sourceIdentity, aggregateKind}] } — activity_audit, this job
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
  // Codex P2 (PR #566), the audit side of the same point: a receipt is a per-EVENT replay/re-drive
  // guard, so two applied receipts keyed to unrelated events of the same job would leave the
  // `attempt_started` or `terminal` mutation unguarded. Require exactly the two identities JOB-017
  // mints, `activity:<company>:<that accepted event id>`, over the named set.
  const auditedEvents = (o.events ?? []).filter((e) => e.eventType === "attempt_started" || e.eventType === "terminal");
  if (auditedEvents.length === 2) {
    const expected = auditedEvents.map((e) => `activity:${t.companyId}:${e.eventId}`).sort();
    const seen = auditReceipts.map((r) => r.sourceIdentity).sort();
    if (JSON.stringify(expected) !== JSON.stringify(seen)) {
      out.push(violation(
        "audit:receipt_not_keyed_to_events",
        `${k}: the activity_audit receipts name ${JSON.stringify(seen)}, not the accepted attempt_started + terminal events ${JSON.stringify(expected)}`,
      ));
    }
    // Codex P2 (PR #566), fifth round: the receipt's TARGET is the row it says it wrote. A receipt
    // whose `target_aggregate_id` points at an unrelated row makes the replay/re-drive evidence
    // claim a link that does not exist.
    // ★ PER RECEIPT, not per set (Codex, sixth round): comparing the two sorted sets passes even when
    // the two receipts are SWAPPED — the `attempt_started` receipt targeting the terminal row and
    // vice versa — in which case every replay guard points at the wrong mutation. Each receipt is
    // therefore resolved through its OWN source event to the action its target row must carry.
    const actionForEventType = { attempt_started: "job.attempt_started", terminal: "job.attempt_terminal" };
    const activityById = new Map((o.activity ?? []).filter((a) => a.id).map((a) => [a.id, a]));
    const eventTypeById = new Map(auditedEvents.map((e) => [e.eventId, e.eventType]));
    for (const receipt of auditReceipts) {
      const eventId = String(receipt.sourceIdentity ?? "").split(":").pop();
      const expectedAction = actionForEventType[eventTypeById.get(eventId)];
      if (!expectedAction) continue; // the identity itself is already judged above
      const target = activityById.get(receipt.targetAggregateId);
      if (!target || target.action !== expectedAction) {
        out.push(violation(
          "audit:receipt_target_mismatch",
          `${k}: the receipt for the ${eventTypeById.get(eventId)} event targets ${JSON.stringify(receipt.targetAggregateId)} ` +
            `(${target ? target.action : "not one of this attempt's activity rows"}), not its own ${expectedAction} row`,
        ));
      }
    }
    if (auditReceipts.some((r) => r.aggregateKind !== "activity_log")) {
      out.push(violation(
        "audit:receipt_wrong_aggregate",
        `${k}: an activity_audit receipt's aggregate kind is ${JSON.stringify(auditReceipts.map((r) => r.aggregateKind))}, not activity_log`,
      ));
    }
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
  // The units the amount expectation is derived from must be the ones the provider reported, or the
  // exact-charge check above would be pinned to something this run did not use.
  if (o.expectedUnits) {
    const drifted = Object.keys(M1_SPINE_CANNED_UNITS)
      .filter((field) => Number(o.expectedUnits[field]) !== Number(M1_SPINE_CANNED_UNITS[field]));
    if (drifted.length > 0) {
      out.push(violation(
        "usage:units_not_canned",
        `${k}: the provider reported ${JSON.stringify(o.expectedUnits)}, which differs from the canned units this profile prices against in ${JSON.stringify(drifted)}`,
      ));
    }
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
  // The EXACT charge, not merely a positive one. Everything it depends on is pinned above.
  for (const row of costRows) {
    if (Number(row.costCents) !== M1_SPINE_EXPECTED_COST_CENTS) {
      out.push(violation(
        "cost:unexpected_amount",
        `${k}: the charge is ${JSON.stringify(row.costCents)} cents, not the ${M1_SPINE_EXPECTED_COST_CENTS} the canned units and rate version ${M1_SPINE_RATE_VERSION} produce`,
      ));
    }
  }
  if (costRows.some((row) => !(Number(row.costCents) > 0))) {
    out.push(violation("cost:zero_cost", `${k}: a cost_events row has cost_cents ${JSON.stringify(costRows.map((r) => r.costCents))}`));
  }
  if (costRows.some((row) => row.companyId !== t.companyId)) {
    out.push(violation("cost:wrong_company", `${k}: a cost_events row is attributed to another Company`));
  }
  // Codex P2 (PR #566), third round: a positive charge is not enough. A row priced from another
  // KNOWN model, another provider or another rate version is still positive, and still wrong — the
  // spend and the hard stop would then be computed from the wrong schedule.
  for (const row of costRows) {
    const wrong = [];
    if (row.provider !== M1_SPINE_AGENT_ADAPTER_TYPE) wrong.push(`provider ${JSON.stringify(row.provider)}`);
    if (row.model !== M1_SPINE_AGENT_MODEL) wrong.push(`model ${JSON.stringify(row.model)}`);
    if (row.rateId !== M1_SPINE_AGENT_MODEL) wrong.push(`rateId ${JSON.stringify(row.rateId)}`);
    if (Number(row.rateVersion) !== M1_SPINE_RATE_VERSION) wrong.push(`rateVersion ${JSON.stringify(row.rateVersion)}`);
    if (wrong.length > 0) {
      out.push(violation(
        "cost:wrong_rate_metadata",
        `${k}: a cost_events row was priced with ${wrong.join(", ")} — expected ${M1_SPINE_AGENT_ADAPTER_TYPE} / ${M1_SPINE_AGENT_MODEL} at rate version ${M1_SPINE_RATE_VERSION}`,
      ));
    }
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
    if (costRows.length === 1 && receipts[0].targetAggregateId !== costRows[0].id) {
      out.push(violation(
        "cost:receipt_target_mismatch",
        `${k}: the authoritative_cost receipt targets ${JSON.stringify(receipts[0].targetAggregateId)}, not the cost row it says it wrote (${costRows[0].id})`,
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
  for (const replica of RUNNING_REPLICAS) {
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
  // The control must be a WORKING enabled placement, not merely a non-legacy one (Codex P1,
  // PR #566): `queued` and `failed` are also non-legacy, so a regression in which the real service
  // can select NO target would leave the campaign green.
  const pc = o.positiveControlPlacement;
  if (!pc || pc.error || pc.disposition !== "selected" || pc.mode !== "active" || pc.leaseEligible !== true) {
    out.push(violation(
      "control:positive_control_not_selected",
      `${k}: the same placement service on an ENABLED tenant returned ${JSON.stringify(pc ?? null)} — it must SELECT a lease-eligible target (disposition "selected", mode "active", leaseEligible true), or the refusal is not shown to be the rollout's`,
    ));
  }
  if (o.pollOutcome !== "no_work") out.push(violation("control:offered_work", `${k}: poll outcome ${String(o.pollOutcome)}`));
  if (o.jobEvents !== 0) out.push(violation("control:has_job_events", `${k}: ${o.jobEvents} job_events`));
  if (o.costRowsForCompany !== 0) out.push(violation("control:has_cost_rows", `${k}: ${o.costRowsForCompany} cost_events rows`));
  if (o.receipts !== 0) out.push(violation("control:has_receipts", `${k}: ${o.receipts} projection receipts`));
  return out;
}

// ── criterion 5 / the DEP-017 env probe (acceptance 6) ──────────────────────

/**
 * The message prefix the DEP-017 probe's summary carries (`ENV_PROBE_LOG_PREFIX` in
 * `scripts/lib/m1-shipped-boot.mjs` on that ticket's branch). MIRRORED rather than imported,
 * deliberately: that module does not exist in this tree yet, and this profile's job is to prove the
 * probe is NOT observed here — a check that imported the thing it says is absent could not run.
 */
export const ENV_PROBE_LOG_PREFIX = "dep017.env_probe ";

/**
 * DEP-016 acceptance 6, second fork. The `m1-spine` lane cannot observe the DEP-017 env probe: its
 * workers do not dispatch (`AOA_WORKER_DISPATCH_ENABLED` is declared ABSENT for them —
 * `scripts/lib/d1-dispatch-declared.mjs`), the harness plays the worker over the real HTTP
 * endpoints, and the reference provider's `execute` runs no command, so nothing in the sandbox
 * could probe anything. The ticket's instruction for that case is to RECORD it, and an unobserved
 * probe must never be reported as a pass.
 *
 * This verdict is the tripwire that keeps the record honest in BOTH directions: a bundle that
 * declares the probe unobserved while the attempt's events DO carry a summary is refused (the
 * record has gone stale and must be rewritten), and a bundle that CLAIMS observation without a
 * summary is refused too.
 */
export function evaluateEnvProbeObservability({ declaredObserved, logMessages }) {
  const out = [];
  const summaries = (logMessages ?? []).filter((m) => String(m ?? "").startsWith(ENV_PROBE_LOG_PREFIX));
  if (declaredObserved === false && summaries.length > 0) {
    out.push(violation(
      "criterion5:probe_emitted_but_recorded_unobserved",
      `the attempt carries ${summaries.length} DEP-017 env-probe summary event(s), but this profile records criterion 5 as NOT observed — the record is stale`,
    ));
  }
  if (declaredObserved === true && summaries.length === 0) {
    out.push(violation(
      "criterion5:claimed_without_summary",
      "criterion 5 is claimed observed, but the attempt carries no DEP-017 env-probe summary",
    ));
  }
  return out;
}

// ── hostile cross-tenant cases (F10: "denied, not merely empty") ─────────────

/**
 * The refusal shapes the worker-control surface gives a foreign tenant, measured live on the D1
 * stack: the session's worker does not own the lease, so the fenced events route answers
 * `401 unauthorized`, and the ack route cannot find the lease under the presented fence, so it
 * answers `409 stale_fence`. Pinned rather than "anything that is not an acceptance", so a 500 or a
 * transport-shaped failure can never masquerade as enforcement (Codex P2, PR #566).
 */
export const EXPECTED_FOREIGN_UPLOAD_STATUS = 401;
export const EXPECTED_FOREIGN_UPLOAD_CODE = "unauthorized";
export const EXPECTED_FOREIGN_ACK_STATUS = 409;
export const EXPECTED_FOREIGN_ACK_CODE = "stale_fence";

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
  } else if (o.hostileEventUpload?.status !== EXPECTED_FOREIGN_UPLOAD_STATUS ||
             o.hostileEventUpload?.code !== EXPECTED_FOREIGN_UPLOAD_CODE) {
    // A DENIAL, not merely a non-acceptance (Codex P2, PR #566): a 500, a transport-shaped failure
    // or a malformed 200 are all "not accepted" while proving no enforcement at all.
    out.push(violation(
      "isolation:foreign_event_not_denied",
      `the foreign upload returned ${JSON.stringify({ status: o.hostileEventUpload?.status ?? null, code: o.hostileEventUpload?.code ?? null })}, ` +
        `not the expected refusal ${EXPECTED_FOREIGN_UPLOAD_STATUS} ${EXPECTED_FOREIGN_UPLOAD_CODE}`,
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
  } else if (o.hostileAck?.status !== EXPECTED_FOREIGN_ACK_STATUS || o.hostileAck?.code !== EXPECTED_FOREIGN_ACK_CODE) {
    out.push(violation(
      "isolation:foreign_ack_not_denied",
      `the foreign ack returned ${JSON.stringify({ status: o.hostileAck?.status ?? null, code: o.hostileAck?.code ?? null })}, ` +
        `not the expected refusal ${EXPECTED_FOREIGN_ACK_STATUS} ${EXPECTED_FOREIGN_ACK_CODE}`,
    ));
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

// ── the rollback rehearsal (MIG-009), criterion 6 ───────────────────────────

/** The audit action MIG-009's drain writes in the same transaction as each cancel. */
export const DRAIN_AUDIT_ACTION = "job.drain.requested";

/** The reason every cancel command and audit row of an operator drain carries
 * (`OPERATOR_DRAIN_REASON`, `server/src/services/distributed-execution-drain-trigger.ts`). */
export const DRAIN_REASON = "distributed_execution_rollback";

/**
 * The rollback rehearsal this profile's Outcome requires ("including the rollback rehearsal through
 * the `MIG-009` CLI", E6 implementation plan) and that criterion 6 consumes. Judged on what the
 * drain actually did, per tenant:
 *
 *  - the CLI exited 0 (its own contract: no Organization skipped and every cancel committed);
 *  - each enabled tenant's DRAINABLE job carries its own `job.drain.requested` row, attributed to
 *    the operator the CLI was given and to that tenant's own Organization and Company (F10);
 *  - the drain was SELECTIVE: the already-terminal journey attempts were not drained. Without this
 *    a drain that cancelled everything indiscriminately would look like a passing rehearsal.
 *
 * @param {object} o
 * @param {number|null} o.exitCode
 * @param {string} o.expectedActorId  `operator-cli:<who>`
 * @param {Array<{tenantKey:string, organizationId:string, companyId:string, jobId:string}>} o.drainableJobs
 * @param {Array<{action:string, entityId:string, organizationId:string, companyId:string, actorType:string, actorId:string}>} o.auditRows
 * @param {string[]} o.terminalJobIds  jobs that were already terminal when the drain ran
 * @param {Array<{attemptId:string, jobId:string, status:string}>} o.attempts  every probed attempt's
 *        state AFTER the drain, PER ATTEMPT
 * @param {Array<{attemptId:string, jobId:string, organizationId:string, companyId:string, activeLeases:number, disposition:string|null}>} o.preDrainCandidates
 *        every NON-TERMINAL attempt of the profile's Organizations, taken BEFORE the drain ran
 * @param {Array<{jobId:string, commandKind:string, reason:string|null}>} o.commands  the control
 *        commands those jobs carry after the drain
 */
export function evaluateRollbackRehearsal(o) {
  const out = [];
  if (o.exitCode !== 0) {
    out.push(violation("rollback:cli_failed", `the MIG-009 drain CLI exited ${JSON.stringify(o.exitCode)}, not 0`));
  }
  // Scoped to THIS drain by its operator nonce. An attempt still non-terminal when a later drain
  // runs (a LEASED one stays `cancel_requested` until its lease holder completes it, and nothing
  // on this lane does) legitimately accumulates one audit row PER drain — measured on the second
  // live run. Counting them all would make the rehearsal fail on its own history.
  const rows = (o.auditRows ?? []).filter((r) => r.action === DRAIN_AUDIT_ACTION &&
    r.actorType === "system" && r.actorId === o.expectedActorId);
  const rowsAnyDrain = (o.auditRows ?? []).filter((r) => r.action === DRAIN_AUDIT_ACTION);

  // ★ EVERY attempt the drain could touch, not only the ones this profile seeded (Codex P1,
  // PR #566). The census is taken BEFORE the drain and includes the isolation case's LEASED
  // attempt, the enabled-placement probe and the control tenant's legacy attempt — so a drain that
  // skipped the leased branch, or that left a tenant's attempt running, cannot pass because two
  // freshly seeded unleased attempts happened to move.
  // ★ Keyed by ATTEMPT, not by job (Codex P1, PR #566): the drain's store deduplicates cancellation
  // per job, so a job carrying two simultaneously non-terminal attempts could show one cancelled
  // while a sibling kept running — which a job-keyed map would hide.
  const statusByAttempt = new Map((o.attempts ?? []).map((a) => [a.attemptId, a.status]));
  const statusesByJob = new Map();
  for (const a of o.attempts ?? []) statusesByJob.set(a.jobId, [...(statusesByJob.get(a.jobId) ?? []), a.status]);
  // Per ATTEMPT, not per job (Codex P2, PR #566): a stale command from an earlier lease of the same
  // job would otherwise satisfy every leased candidate of that job, leaving the current attempt
  // with nothing telling its lease holder to stop.
  const commandsByAttempt = new Map();
  for (const command of o.commands ?? []) {
    commandsByAttempt.set(command.attemptId, [...(commandsByAttempt.get(command.attemptId) ?? []), command]);
  }
  for (const candidate of o.preDrainCandidates ?? []) {
    const leased = Number(candidate.activeLeases) > 0;
    // ★ The two branches differ, and the difference is the point (measured live): an UNLEASED
    // attempt is cancelled outright, while a LEASED one is put into `cancel_requested` with a
    // `cancel` command carrying the rollback reason — the lease holder completes it. Asserting
    // "cancelled" for both would have been wrong, and asserting only one branch would let the
    // other regress unseen.
    const expected = leased ? "cancel_requested" : "cancelled";
    const status = statusByAttempt.get(candidate.attemptId);
    if (status !== expected) {
      out.push(violation(
        "rollback:candidate_not_cancelled",
        `a non-terminal attempt the drain should have rolled back (job ${candidate.jobId}, org ${candidate.organizationId}, ` +
          `${leased ? "LEASED" : "unleased"}, placement ${candidate.disposition}) is ${JSON.stringify(status ?? null)}, expected ${expected}`,
      ));
    }
    const cancels = (commandsByAttempt.get(candidate.attemptId) ?? []).filter((c) => c.commandKind === "cancel");
    if (leased && cancels.length === 0) {
      out.push(violation(
        "rollback:leased_candidate_no_command",
        `the LEASED attempt ${candidate.attemptId} of job ${candidate.jobId} has no cancel command of its own — nothing tells its lease holder to stop`,
      ));
    }
    if (leased && cancels.length > 0 && cancels.every((c) => c.reason !== DRAIN_REASON)) {
      out.push(violation(
        "rollback:command_wrong_reason",
        `the cancel command for job ${candidate.jobId} carries ${JSON.stringify(cancels.map((c) => c.reason))}, not ${DRAIN_REASON}`,
      ));
    }
    if (!leased && cancels.length > 0) {
      out.push(violation(
        "rollback:unleased_candidate_has_command",
        `the UNLEASED attempt of job ${candidate.jobId} produced a cancel command; it is cancelled directly`,
      ));
    }
    const own = rows.filter((r) => r.entityId === candidate.jobId);
    if (own.length !== 1) {
      out.push(violation(
        "rollback:candidate_no_audit_row",
        `job ${candidate.jobId} has ${own.length} ${DRAIN_AUDIT_ACTION} rows, expected exactly 1`,
      ));
    } else if ((own[0].detailsOrganizationId ?? own[0].organizationId ?? null) !== candidate.organizationId ||
               own[0].companyId !== candidate.companyId) {
      out.push(violation(
        "rollback:candidate_audit_wrong_tenant",
        `the drain audit row for job ${candidate.jobId} names another tenant`,
      ));
    } else if (own[0].detailsReason !== DRAIN_REASON) {
      // The row must say WHY the mutation happened. A correct command beside an audit row that
      // records no reason, or another one, misstates the record a rehearsal exists to make.
      out.push(violation(
        "rollback:audit_wrong_reason",
        `the drain audit row for job ${candidate.jobId} records reason ${JSON.stringify(own[0].detailsReason ?? null)}, not ${DRAIN_REASON}`,
      ));
    }
  }

  for (const job of o.drainableJobs ?? []) {
    const own = rows.filter((r) => r.entityId === job.jobId);
    const anyDrain = rowsAnyDrain.filter((r) => r.entityId === job.jobId);
    if (own.length === 0 && anyDrain.length > 0) {
      // A row exists for this job, but not from THIS drain's operator: the rehearsal is
      // unattributed, which is a different defect from "the drain did not audit at all".
      out.push(violation(
        "rollback:audit_wrong_actor",
        `tenant ${job.tenantKey}: the drain audit row names ${JSON.stringify(anyDrain.map((r) => `${r.actorType}/${r.actorId}`))}, not system/${o.expectedActorId} — the rehearsal is unattributed`,
      ));
      continue;
    }
    if (own.length !== 1) {
      out.push(violation(
        "rollback:no_audit_row",
        `tenant ${job.tenantKey}: ${own.length} ${DRAIN_AUDIT_ACTION} rows for its drained job, expected exactly 1`,
      ));
      continue;
    }
    const row = own[0];
    // MIG-009 records the Organization in the row's `details` (the `activity_log.organization_id`
    // COLUMN is nullable and this writer leaves it null — measured on the live drain), so the
    // tenant check reads whichever the row carries and requires it to be this tenant's.
    const auditedOrganizationId = row.detailsOrganizationId ?? row.organizationId ?? null;
    if (auditedOrganizationId !== job.organizationId || row.companyId !== job.companyId) {
      out.push(violation(
        "rollback:audit_wrong_tenant",
        `tenant ${job.tenantKey}: its drain audit row names another tenant`,
      ));
    }
    if (row.actorType !== "system" || row.actorId !== o.expectedActorId) {
      out.push(violation(
        "rollback:audit_wrong_actor",
        `tenant ${job.tenantKey}: the drain audit row names ${row.actorType}/${row.actorId}, not system/${o.expectedActorId} — the rehearsal is unattributed`,
      ));
    }
  }
  // ★ The drain's EFFECT, not only its audit (Codex P1, PR #566): an audit row written while the
  // attempt stayed non-terminal would be a rehearsal that rolled nothing back.

  for (const job of o.drainableJobs ?? []) {
    const status = job.attemptId ? statusByAttempt.get(job.attemptId) : (statusesByJob.get(job.jobId) ?? [])[0];
    if (status !== "cancelled") {
      out.push(violation(
        "rollback:attempt_not_cancelled",
        `tenant ${job.tenantKey}: its drained attempt is ${JSON.stringify(status ?? null)} after the drain, not "cancelled"`,
      ));
    }
  }
  for (const jobId of o.terminalJobIds ?? []) {
    const statuses = statusesByJob.get(jobId) ?? [];
    if (statuses.some((status) => status !== "succeeded")) {
      out.push(violation(
        "rollback:terminal_attempt_moved",
        `the drain moved an already-terminal attempt (${jobId}) to ${JSON.stringify(statuses)} — it is not selective`,
      ));
    }
    if (rowsAnyDrain.some((r) => r.entityId === jobId)) {
      out.push(violation(
        "rollback:drained_a_terminal_attempt",
        `the drain cancelled an already-terminal attempt (${jobId}) — it is not selective`,
      ));
    }
  }
  return out;
}

export function formatViolations(violations) {
  return violations.map((v) => `  - ${v.code}: ${v.message}`).join("\n");
}
