// -----------------------------------------------------------------------------
// DEP-018 — the campaign fault matrix's PURE verdicts.
//
// Pure: no I/O, no Docker, no PostgreSQL. Two decisions live here, and the checker
// (`scripts/check-campaign-fault-matrix.mjs`) is a thin CLI over them:
//
//   1. `evaluateFaultMatrixDeclaration(matrix)` — is the committed declaration
//      (`tests/d1/fault-matrix.json`) COMPLETE? Every gate profile present, every case family
//      the E6 plan's Outcome names present per profile, and the F10 tenant matrix present in
//      EVERY profile (per-tenant journey, the nine cross-tenant denial surfaces, refusal of the
//      control tenant, and the four legacy tables of acceptance 5).
//   2. `evaluateFaultMatrixEvidence(matrix, bundle)` — did each declared case's injection
//      actually FIRE, and did the observed classification match the declared one?
//
// ── WHY THE SECOND DECISION EXISTS AT ALL ────────────────────────────────────
// The E6 plan's acceptance 1 says it in one line: *"a case whose injection did not fire is a
// failure, not a pass."* A matrix that only declared cases would be a list, and a lane that only
// ran them would leave no way to tell a case that fired from a case that silently no-opped —
// the failure class (`A check that nothing runs is not a check`) this programme exists to stop.
// So the harness records, per case, whether the injection was OBSERVED to take effect, and this
// verdict refuses the bundle otherwise.
//
// ── AND WHY IT IS HONEST IN BOTH DIRECTIONS ──────────────────────────────────
// A case may be declared `pending` — a keyed run this build agent may not dispatch (founder
// ruling F8), or a structurally unreachable injection on this lane. A pending case needs a
// reason and a named owner, it can never be reported as a pass, and a bundle that DOES carry
// evidence for a pending case is REFUSED: the declaration has gone stale and must be rewritten
// rather than quietly inheriting a pass. (The same tripwire shape DEP-016 used for the DEP-017
// env probe, `evaluateEnvProbeObservability`.)
// -----------------------------------------------------------------------------

/** The committed declaration's path, relative to the repo root. */
export const FAULT_MATRIX_PATH = "tests/d1/fault-matrix.json";

/** The schema version the checker understands. A bump must come with a checker change. */
export const FAULT_MATRIX_SCHEMA_VERSION = 1;

/**
 * The three partial gates M1 names (`docs/replatform/epic-regrooming/scope-triage.md`
 * §"Proposed milestone partial gates"). Every one of them carries a fault matrix; the F10 tenant
 * matrix is required in EVERY profile, not only the keyless one.
 */
export const GATE_PROFILES = Object.freeze(["M1-D1-SPINE", "M1a-D2-MECHANISM", "M1-D2-CODING"]);

/** The case families the E6 plan's Outcome enumerates. */
export const CASE_FAMILIES = Object.freeze([
  "fault_control",
  "restart_reconciliation",
  "cancellation",
  "provider_failure",
  "cleanup",
  "credential",
  "tenant",
]);

/**
 * Per profile, the families its Outcome REQUIRES (E6 implementation plan §4c DEP-018):
 *   M1-D1-SPINE      — the journey's fault controls (Toxiproxy), restart and reconciliation
 *                      (WRK-013), cancellation;
 *   M1a-D2-MECHANISM — cancellation, provider failure, reconciliation, EVERY cleanup path;
 *   M1-D2-CODING     — all of that plus the credential cases.
 * `tenant` is required everywhere ("Every profile — the F10 tenant matrix").
 */
export const REQUIRED_FAMILIES = Object.freeze({
  "M1-D1-SPINE": Object.freeze(["fault_control", "restart_reconciliation", "cancellation", "tenant"]),
  "M1a-D2-MECHANISM": Object.freeze([
    "cancellation", "provider_failure", "restart_reconciliation", "cleanup", "tenant",
  ]),
  "M1-D2-CODING": Object.freeze([
    "cancellation", "provider_failure", "restart_reconciliation", "cleanup", "credential", "tenant",
  ]),
});

/**
 * The nine cross-tenant surfaces the M1 plan's `DEP-018` row names: *"A cannot lease, read,
 * cancel or see B's jobs, events, secrets, staged inputs, outputs, cost rows or tool calls"*
 * (`docs/replatform/qa/2026-09-21-m1-execution-plan.md` §4). Enumerated rather than counted, so
 * a surface cannot be dropped by editing a number.
 */
export const REQUIRED_TENANT_SURFACES = Object.freeze([
  "lease", "read", "cancel", "events", "secrets", "staged_inputs", "outputs", "cost_rows", "tool_calls",
]);

/**
 * Acceptance 5 (added at M1 Step 0, S0-8): the legacy `companyId` tables the distributed path
 * writes or reads, which per E2-D03 (LOCKED) carry GRANTs to the non-owner role and NO RLS — so
 * their isolation rests on QUERY PREDICATES and E2's RLS evidence must not be cited for them.
 * Each therefore needs its own case, with a same-tenant positive control AND an anti-vacuity
 * control (the same read with the tenant predicate removed DOES return the foreign row).
 */
export const REQUIRED_LEGACY_TABLES = Object.freeze([
  "cost_events", "activity_log", "task_outputs", "provider_credentials",
]);

/** F10's minimum enabled-tenant count, mirrored from `MIN_ENABLED_ORGANIZATIONS`
 * (`scripts/lib/m1-shipped-boot.mjs`) so the two lanes cannot disagree about what F10 means. */
export const MIN_ENABLED_TENANT_JOURNEYS = 2;

export const EVIDENCE_MODES = Object.freeze(["required", "pending"]);
/** `keyed` — an E2B run only the planning session may dispatch (F8). `structural` — the
 * injection has no reachable producer on this lane, with the blocker cited at source. */
export const PENDING_KINDS = Object.freeze(["keyed", "structural"]);

export const TENANT_CASE_KINDS = Object.freeze([
  "per_tenant_journey", "cross_tenant_denial", "control_tenant_refused", "legacy_table_isolation",
]);

/** Every declaration violation's message carries this, so a positive control can prove the
 * checker went red for the DECLARATION reason and not, say, an unreadable file. */
export const DECLARATION_MARKER = "[fault-matrix:declaration]";
/** Likewise for the evidence half. The two are separate because they fail for different reasons
 * and a lane needs to tell them apart. */
export const EVIDENCE_MARKER = "[fault-matrix:evidence]";

function violation(marker, code, message) {
  return { code, message: `${marker} ${message}` };
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

// ── 1. the declaration ───────────────────────────────────────────────────────

/**
 * @param {unknown} matrix the parsed `tests/d1/fault-matrix.json`
 * @returns {{code:string,message:string}[]} empty = the declaration is complete
 */
export function evaluateFaultMatrixDeclaration(matrix) {
  const out = [];
  const v = (code, message) => out.push(violation(DECLARATION_MARKER, code, message));

  if (!isPlainObject(matrix)) {
    v("declaration:not_an_object", "the fault matrix is not a JSON object");
    return out;
  }
  if (matrix.schemaVersion !== FAULT_MATRIX_SCHEMA_VERSION) {
    v("declaration:schema_version", `schemaVersion is ${JSON.stringify(matrix.schemaVersion)}, not ${FAULT_MATRIX_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(matrix.profiles)) {
    v("declaration:no_profiles", "the fault matrix has no `profiles` array");
    return out;
  }

  const declaredProfiles = matrix.profiles.map((p) => (isPlainObject(p) ? p.profile : null));
  for (const profile of GATE_PROFILES) {
    if (!declaredProfiles.includes(profile)) {
      v("declaration:profile_missing", `gate profile ${profile} is not declared`);
    }
  }
  for (const [index, profile] of declaredProfiles.entries()) {
    if (!GATE_PROFILES.includes(profile)) {
      v("declaration:unknown_profile", `profiles[${index}] declares ${JSON.stringify(profile)}, which is not one of the three M1 gate profiles`);
    }
  }
  if (new Set(declaredProfiles).size !== declaredProfiles.length) {
    v("declaration:duplicate_profile", `the same gate profile is declared twice: ${JSON.stringify(declaredProfiles)}`);
  }

  const seenCaseIds = new Set();
  for (const entry of matrix.profiles) {
    if (!isPlainObject(entry)) {
      v("declaration:profile_not_an_object", "a `profiles` entry is not an object");
      continue;
    }
    const profile = entry.profile;
    if (!Array.isArray(entry.cases) || entry.cases.length === 0) {
      v("declaration:profile_has_no_cases", `profile ${String(profile)} declares no cases`);
      continue;
    }

    const families = new Set();
    const surfaces = new Set();
    const tables = new Set();
    // ★ DISTINCT tenants, not a count (Codex P2, PR #573). Counting labels let a matrix that
    // declared tenant A's journey TWICE and omitted tenant B satisfy the F10 minimum — i.e. the
    // checker would certify a profile that leaves an enabled tenant unproven, which is exactly
    // the claim F10 exists to make.
    const journeyTenants = new Set();
    let controlTenantRefused = 0;

    for (const c of entry.cases) {
      if (!isPlainObject(c)) {
        v("declaration:case_not_an_object", `profile ${String(profile)} has a case that is not an object`);
        continue;
      }
      const id = c.case;
      const where = `profile ${String(profile)} case ${JSON.stringify(id ?? null)}`;
      if (!isNonEmptyString(id)) {
        v("declaration:case_missing_id", `${where}: a case needs a non-empty \`case\` id`);
      } else if (seenCaseIds.has(id)) {
        v("declaration:duplicate_case_id", `case id ${JSON.stringify(id)} is declared more than once (ids are unique across profiles)`);
      } else {
        seenCaseIds.add(id);
      }

      if (!CASE_FAMILIES.includes(c.family)) {
        v("declaration:unknown_family", `${where}: family ${JSON.stringify(c.family ?? null)} is not one of ${CASE_FAMILIES.join(", ")}`);
      } else {
        families.add(c.family);
      }

      // The injection is what makes a case a case. A declaration whose injection has no named
      // mechanism cannot be shown to have fired, which is acceptance 1's whole subject.
      if (!isPlainObject(c.injection)) {
        v("declaration:case_missing_injection", `${where}: no \`injection\` object`);
      } else {
        if (!isNonEmptyString(c.injection.mechanism)) {
          v("declaration:injection_missing_mechanism", `${where}: the injection names no \`mechanism\``);
        }
        if (!isNonEmptyString(c.injection.observedBy)) {
          // Without an observation the "fired" flag would be the harness asserting its own
          // intent. `observedBy` names the probe whose result decides it.
          v("declaration:injection_missing_observer", `${where}: the injection names no \`observedBy\` — nothing would decide whether it fired`);
        }
      }
      if (!isNonEmptyString(c.expectedClassification)) {
        v("declaration:case_missing_classification", `${where}: no \`expectedClassification\``);
      }

      if (!EVIDENCE_MODES.includes(c.evidence)) {
        v("declaration:unknown_evidence_mode", `${where}: evidence ${JSON.stringify(c.evidence ?? null)} is not one of ${EVIDENCE_MODES.join(", ")}`);
      } else if (c.evidence === "pending") {
        if (!PENDING_KINDS.includes(c.pendingKind)) {
          v("declaration:pending_missing_kind", `${where}: a pending case needs \`pendingKind\` ∈ ${PENDING_KINDS.join(", ")}`);
        }
        if (!isNonEmptyString(c.pendingReason)) {
          v("declaration:pending_missing_reason", `${where}: a pending case needs a \`pendingReason\``);
        }
        if (!isNonEmptyString(c.pendingOwner)) {
          v("declaration:pending_missing_owner", `${where}: a pending case needs a \`pendingOwner\` — an unowned pending case is a case nobody will ever run`);
        }
      }

      if (c.family === "tenant") {
        const t = c.tenantCase;
        if (!isPlainObject(t)) {
          v("declaration:tenant_case_missing", `${where}: a \`tenant\` case needs a \`tenantCase\` object`);
          continue;
        }
        if (!TENANT_CASE_KINDS.includes(t.kind)) {
          v("declaration:tenant_case_unknown_kind", `${where}: tenantCase.kind ${JSON.stringify(t.kind ?? null)} is not one of ${TENANT_CASE_KINDS.join(", ")}`);
          continue;
        }
        if (t.kind === "per_tenant_journey") {
          if (!isNonEmptyString(t.tenant)) {
            v("declaration:journey_missing_tenant", `${where}: a per-tenant journey names no tenant`);
          } else if (journeyTenants.has(t.tenant)) {
            v("declaration:duplicate_journey_tenant", `${where}: tenant ${JSON.stringify(t.tenant)} already has a per-tenant journey in this profile`);
          } else {
            journeyTenants.add(t.tenant);
          }
        } else if (t.kind === "cross_tenant_denial") {
          if (!REQUIRED_TENANT_SURFACES.includes(t.surface)) {
            v("declaration:unknown_tenant_surface", `${where}: surface ${JSON.stringify(t.surface ?? null)} is not one of ${REQUIRED_TENANT_SURFACES.join(", ")}`);
          } else {
            surfaces.add(t.surface);
          }
          if (t.positiveControl !== true) {
            // F10: "each tenant denial needs a positive control, a same-tenant request that
            // succeeds". Without it, "denied" is indistinguishable from "nothing works".
            v("declaration:denial_without_positive_control", `${where}: a cross-tenant denial must declare \`positiveControl: true\``);
          }
        } else if (t.kind === "control_tenant_refused") {
          controlTenantRefused += 1;
        } else if (t.kind === "legacy_table_isolation") {
          if (!REQUIRED_LEGACY_TABLES.includes(t.table)) {
            v("declaration:unknown_legacy_table", `${where}: table ${JSON.stringify(t.table ?? null)} is not one of ${REQUIRED_LEGACY_TABLES.join(", ")}`);
          } else {
            tables.add(t.table);
          }
          if (t.positiveControl !== true) {
            v("declaration:legacy_without_positive_control", `${where}: a legacy-table case must declare \`positiveControl: true\``);
          }
          if (t.antiVacuityControl !== true) {
            // Acceptance 5: the predicate-removed read must return the foreign row, or an empty
            // result proves the table was empty rather than the filter doing the work.
            v("declaration:legacy_without_anti_vacuity", `${where}: a legacy-table case must declare \`antiVacuityControl: true\` (these four tables have NO RLS — E2-D03)`);
          }
          if (!isNonEmptyString(t.productionPath)) {
            // "through the production query path the distributed path uses … not a hand-written
            // test query". The path is named in the declaration so a reviewer can check it.
            v("declaration:legacy_without_production_path", `${where}: a legacy-table case must name the \`productionPath\` (file + symbol) it reads or writes through`);
          }
        }
      } else if (c.tenantCase !== undefined) {
        v("declaration:tenant_case_on_non_tenant", `${where}: a non-\`tenant\` case must not carry a \`tenantCase\``);
      }
    }

    if (GATE_PROFILES.includes(profile)) {
      for (const family of REQUIRED_FAMILIES[profile] ?? []) {
        if (!families.has(family)) {
          v("declaration:required_family_missing", `profile ${profile} declares no \`${family}\` case`);
        }
      }
      // The F10 tenant matrix, in EVERY profile.
      if (journeyTenants.size < MIN_ENABLED_TENANT_JOURNEYS) {
        v("declaration:tenant_matrix_journeys", `profile ${profile} declares per-tenant journeys for ${journeyTenants.size} DISTINCT tenant(s) (${JSON.stringify([...journeyTenants])}); F10 requires at least ${MIN_ENABLED_TENANT_JOURNEYS}`);
      }
      for (const surface of REQUIRED_TENANT_SURFACES) {
        if (!surfaces.has(surface)) {
          v("declaration:tenant_matrix_surface_missing", `profile ${profile} declares no cross-tenant denial for \`${surface}\``);
        }
      }
      if (controlTenantRefused === 0) {
        v("declaration:tenant_matrix_control_missing", `profile ${profile} declares no \`control_tenant_refused\` case`);
      }
      for (const table of REQUIRED_LEGACY_TABLES) {
        if (!tables.has(table)) {
          v("declaration:tenant_matrix_legacy_table_missing", `profile ${profile} declares no legacy-table isolation case for \`${table}\` (E2-D03: granted, no RLS — the filter is the only boundary)`);
        }
      }
    }
  }
  return out;
}

// ── 2. the evidence ──────────────────────────────────────────────────────────

/**
 * @param {object} matrix   the declaration (already shape-checked by the caller)
 * @param {object} bundle   `{ profile, runId?, cases: [{case, injectionFired, observedClassification,
 *                            positiveControlPassed?, antiVacuityObservedForeignRow?, note?}] }`
 * @returns {{violations: {code:string,message:string}[], summary: object}}
 */
export function evaluateFaultMatrixEvidence(matrix, bundle) {
  const out = [];
  const v = (code, message) => out.push(violation(EVIDENCE_MARKER, code, message));
  const summary = { profile: null, declared: 0, required: 0, pending: 0, fired: 0, complete: false };

  if (!isPlainObject(bundle) || !isNonEmptyString(bundle.profile)) {
    v("evidence:bundle_unreadable", "the evidence bundle names no profile");
    return { violations: out, summary };
  }
  summary.profile = bundle.profile;
  const entry = (matrix?.profiles ?? []).find((p) => isPlainObject(p) && p.profile === bundle.profile);
  if (!entry) {
    v("evidence:undeclared_profile", `the bundle reports profile ${JSON.stringify(bundle.profile)}, which the fault matrix does not declare`);
    return { violations: out, summary };
  }
  if (!Array.isArray(bundle.cases)) {
    v("evidence:bundle_has_no_cases", `the bundle for ${bundle.profile} carries no \`cases\` array`);
    return { violations: out, summary };
  }

  const declared = new Map();
  for (const c of entry.cases) if (isPlainObject(c) && isNonEmptyString(c.case)) declared.set(c.case, c);
  summary.declared = declared.size;

  const reported = new Map();
  for (const row of bundle.cases) {
    if (!isPlainObject(row) || !isNonEmptyString(row.case)) {
      v("evidence:row_unreadable", "an evidence row names no case");
      continue;
    }
    if (reported.has(row.case)) {
      v("evidence:duplicate_row", `case ${row.case} is reported twice in the bundle`);
      continue;
    }
    reported.set(row.case, row);
    if (!declared.has(row.case)) {
      // Acceptance 4: the checker reds on an UNDECLARED case. A case that ran but was never
      // declared is a case nobody reviewed the expected classification of.
      v("evidence:undeclared_case", `the bundle reports case ${JSON.stringify(row.case)}, which profile ${bundle.profile} does not declare`);
    }
  }

  for (const [id, c] of declared) {
    const row = reported.get(id);
    if (c.evidence === "pending") {
      summary.pending += 1;
      if (row) {
        // Honest in BOTH directions: a pending case that DID produce evidence means the
        // declaration is stale, and inheriting the pass would be exactly the silent drift this
        // matrix exists to stop.
        v("evidence:pending_case_reported", `case ${id} is declared pending (${String(c.pendingKind)}: ${String(c.pendingReason)}) but the bundle reports evidence for it — rewrite the declaration rather than inherit a pass`);
      }
      continue;
    }
    summary.required += 1;
    if (!row) {
      v("evidence:case_not_run", `case ${id} is declared \`required\` but the bundle carries no evidence for it`);
      continue;
    }
    if (row.injectionFired !== true) {
      // Acceptance 1, literally: a case whose injection did not fire is a FAILURE, not a pass.
      v("evidence:injection_did_not_fire", `case ${id}: the bundle records injectionFired=${JSON.stringify(row.injectionFired ?? null)} — a declared case whose injection did not fire is a failure, not a pass`);
    } else {
      summary.fired += 1;
    }
    if (row.observedClassification !== c.expectedClassification) {
      v("evidence:classification_mismatch", `case ${id}: observed ${JSON.stringify(row.observedClassification ?? null)}, declared ${JSON.stringify(c.expectedClassification)}`);
    }
    const t = isPlainObject(c.tenantCase) ? c.tenantCase : null;
    if (t && (t.kind === "cross_tenant_denial" || t.kind === "legacy_table_isolation")) {
      if (row.positiveControlPassed !== true) {
        v("evidence:positive_control_missing", `case ${id}: no passing same-tenant positive control (positiveControlPassed=${JSON.stringify(row.positiveControlPassed ?? null)}) — "denied" is not distinguishable from "nothing works"`);
      }
    }
    if (t && t.kind === "legacy_table_isolation" && row.antiVacuityObservedForeignRow !== true) {
      v("evidence:anti_vacuity_missing", `case ${id}: the predicate-removed read did not return the foreign row (antiVacuityObservedForeignRow=${JSON.stringify(row.antiVacuityObservedForeignRow ?? null)}) — the empty result is not shown to be the filter's work`);
    }
  }

  summary.complete = out.length === 0 && summary.pending === 0;
  return { violations: out, summary };
}

export function formatViolations(violations) {
  return (violations ?? []).map((v) => `  - ${v.code}: ${v.message}`).join("\n");
}
