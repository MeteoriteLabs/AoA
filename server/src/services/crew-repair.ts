/**
 * @fileoverview Repair a company whose crew provisioning degraded (T2.3b).
 *
 * **Why this exists.** `provisionCompanyCrew` runs at exactly one instant —
 * company creation — and `crew-updater.ts:151` skips `…@legacy` and NULL-origin
 * rows *forever*. So one CDN blip, cold cache, deadline, or process restart at
 * that instant permanently excludes the company from every future crew update.
 * T2.3's fail-open degrade is only an acceptable trade because this module
 * exists: the degraded state has to be recoverable, or "born updateable" is one
 * network call wide.
 *
 * ── The three degraded states, and why they need three different answers ─────
 *
 * 1. **`crewless`** — infrastructure agents (Commander, Steward) exist but there
 *    is no crew team row and no crew agents at all. Reached when
 *    `inspectCrewTeamInstall` returned `unknown` (a DB blip at exactly the wrong
 *    moment) and `provisionCompanyCrew` correctly refused to seed. There is
 *    nothing to collide with, so this is the one state where re-running
 *    {@link provisionCompanyCrew} verbatim is right.
 *
 * 2. **`unmanaged`** — the company has crew agents, but stamped `…@legacy` or
 *    NULL. This is the state Phase 2 exists to eliminate, and it is the one
 *    where re-running `provisionCompanyCrew` is WRONG: `installTeam` inserts a
 *    fresh row per roster entry, and `resolveAgentNameConflict` renames each
 *    collision, so a naive repair mints `Scout-2` / `Reviewer-2` /
 *    `default-crew-2` — every duplicate carrying the SAME `templateOrigin`,
 *    which then breaks the single-row lookups at `resolver.ts:208` and
 *    `team-reconcile.ts:74`. Deleting the legacy rows instead is worse: they own
 *    tasks, runs and assignments by id.
 *
 *    So this state is repaired by **adoption**: re-point each existing row at
 *    its catalog template in place, through the already-tested
 *    {@link applyCrewAgentUpdate}. Agent ids survive; `name`, `role`, `title`
 *    and `adapterType` survive (see that function's docblock); origin, version,
 *    skillKeys, tool allowlist, triggers and instruction bundle come from the
 *    catalog. Adoption claims exactly the rows a fresh install would have
 *    collided with — which is precisely why it cannot duplicate them.
 *
 *    Roster members with no local counterpart (Reviewer, which has no legacy
 *    seeder at all — see `LEGACY_CREW_SEEDER_COVERAGE`) are NOT installed here.
 *    Adoption writes the `teams` row + `team_members` links, which is exactly
 *    what `reconcileTeamMembers` needs to install the remainder on its own,
 *    already-wired pass.
 *
 * 3. **`operation-row-stale`** — the crew IS installed, but its
 *    `marketplace_install_operations` row still says `failure`. T2.3's
 *    averted-clobber path tries to repair that row, but the repair write uses
 *    the same connection that just failed; if the DB is what broke, the row
 *    stays `failure` and therefore CLAIMABLE, and the next
 *    `provisionCompanyCrew` would legitimately claim it and re-install over a
 *    committed roster. The retry belongs here (plan Step 4b), not inside T2.3.
 *
 * **Everything here fails closed.** If the roster cannot be mapped onto the
 * company's rows, this module does nothing and logs — it never installs
 * alongside crew rows it could not account for.
 */

import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents, teams, teamMembers, marketplaceInstallOperations } from "@armyofagents/db";
import type { CatalogItem } from "@armyofagents/shared";
import { logger } from "../middleware/logger.js";
import { applyCrewAgentUpdate } from "./marketplace-install/crew-updater.js";
import type { AgentInstructionsServiceLike } from "./marketplace-install/agent-create.js";
import { resolveTeamSlugConflict } from "./marketplace-install/conflict-resolver.js";
import { fetchCatalogResource } from "./marketplace-install/fetch-resource.js";
import {
  OPERATION_CLAIM_STALE_AFTER_MS,
  updateOperation,
} from "./marketplace-install/operation-store.js";
import {
  DEFAULT_CREW_TEAM_ITEM_ID,
  crewBootstrapIdempotencyKey,
} from "./marketplace-install/crew-bootstrap.js";
import { provisionCompanyCrew, type CrewProvisioningOutcome } from "./crew-provisioning.js";

/**
 * Agents that are AoA infrastructure rather than marketplace crew, identified by
 * name because that is the only stable key they have: `seed-crew-agent.ts`
 * stamps no origin, `backfill-template-origin.ts` stamps `Commander@legacy` but
 * skips Steward entirely (it is absent from `CREW_NAMES`), so origin cannot
 * separate them.
 *
 * They are excluded from the "does this company have a crew?" count — otherwise
 * every crewless company would look populated and never be repaired.
 *
 * ⚠️ T2.4 publishes Steward and moves it into the crew roster. When that lands,
 * remove it here in the same change, or a genuinely crewless company that still
 * has its legacy Steward will read as `unmanaged` and adoption will claim it.
 * (That is the safe direction — it adopts rather than duplicates — but the
 * classification would be wrong.)
 */
export const INFRASTRUCTURE_AGENT_NAMES: ReadonlySet<string> = new Set(["Commander", "Steward"]);

/** A `templateOrigin` that puts the row inside the update pipeline. */
export function isMarketplaceManagedOrigin(origin: string | null): origin is string {
  return origin !== null && origin.length > 0 && !origin.endsWith("@legacy");
}

export interface CrewAgentSnapshot {
  id: string;
  name: string;
  templateOrigin: string | null;
  templateVersion: string | null;
  adapterType: string;
  adapterConfig: Record<string, unknown> | null;
  runtimeConfig: Record<string, unknown> | null;
  skillKeys: string[];
}

export type CrewRepairVerdict =
  /** Crew team row + at least one marketplace-managed crew agent. Nothing to do. */
  | "healthy"
  /** Installed, but the bootstrap operation row still lies (plan Step 4b, case 2). */
  | "operation-row-stale"
  /** No crew team and no crew agents at all (plan Step 4b, case 1). */
  | "crewless"
  /** Crew agents exist but are `…@legacy`/NULL — frozen out of crew-updater. */
  | "unmanaged";

export interface CrewRepairDiagnosis {
  companyId: string;
  verdict: CrewRepairVerdict;
  /** The `teams` row for `team:aoa-curated/default-crew`, if it exists. */
  teamId: string | null;
  /** Crew agents (infrastructure excluded) already inside the update pipeline. */
  managedCrew: CrewAgentSnapshot[];
  /** Crew agents (infrastructure excluded) with a `…@legacy`/NULL origin. */
  unmanagedCrew: CrewAgentSnapshot[];
  /** The `bootstrap-crew:<companyId>` operation row, if one was ever written. */
  operation: { id: string; status: string; startedAt: Date } | null;
}

/**
 * Is this operation row a lie that a later provisioning pass could act on?
 *
 * Mirrors `claimOperationForDispatch` exactly, and that is the point: a row is
 * only worth sealing if it is CLAIMABLE, because claimable-over-a-committed-crew
 * is the whole hazard. So:
 * - `failure` — claimable now. The plan's Step 4b case 2.
 * - `pending` — claimable now, at any age (nobody has started it).
 * - `running` older than {@link OPERATION_CLAIM_STALE_AFTER_MS} — the owner died.
 * - a FRESH `running` — a live install owns it. Sealing it would declare
 *   someone else's in-flight work finished.
 * - `requested` — a founder-approval state; never hijack a pending decision.
 * - `success` — already honest.
 */
function isClaimableOverInstalledCrew(
  operation: { status: string; startedAt: Date },
  now: number,
): boolean {
  if (operation.status === "failure" || operation.status === "pending") return true;
  if (operation.status === "running") {
    return now - operation.startedAt.getTime() >= OPERATION_CLAIM_STALE_AFTER_MS;
  }
  return false;
}

/**
 * Classify a company's crew provisioning. Three cheap indexed queries; no
 * network. Throws on a DB error — callers treat that as "skip this company",
 * never as "healthy" (a repair pass that silently reads an outage as health is
 * the exact failure class T2.3's `unknown` witness was written to avoid).
 */
export async function diagnoseCrewProvisioning(
  db: Db,
  companyId: string,
): Promise<CrewRepairDiagnosis> {
  const crewRows = (await db
    .select({
      id: agents.id,
      name: agents.name,
      templateOrigin: agents.templateOrigin,
      templateVersion: agents.templateVersion,
      adapterType: agents.adapterType,
      adapterConfig: agents.adapterConfig,
      runtimeConfig: agents.runtimeConfig,
      skillKeys: agents.skillKeys,
    })
    .from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.kind, "aoa")))) as CrewAgentSnapshot[];

  const roster = crewRows.filter((row) => !INFRASTRUCTURE_AGENT_NAMES.has(row.name));
  const managedCrew = roster.filter((row) => isMarketplaceManagedOrigin(row.templateOrigin));
  const unmanagedCrew = roster.filter((row) => !isMarketplaceManagedOrigin(row.templateOrigin));

  const [teamRow] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.companyId, companyId), eq(teams.templateOrigin, DEFAULT_CREW_TEAM_ITEM_ID)))
    .limit(1);

  const [operationRow] = await db
    .select({
      id: marketplaceInstallOperations.id,
      status: marketplaceInstallOperations.status,
      startedAt: marketplaceInstallOperations.startedAt,
    })
    .from(marketplaceInstallOperations)
    .where(
      and(
        eq(marketplaceInstallOperations.companyId, companyId),
        eq(marketplaceInstallOperations.idempotencyKey, crewBootstrapIdempotencyKey(companyId)),
      ),
    )
    .limit(1);

  const teamId = teamRow?.id ?? null;
  const operation = operationRow
    ? {
        id: operationRow.id,
        status: operationRow.status,
        startedAt: new Date(operationRow.startedAt as unknown as string | Date),
      }
    : null;

  // "Installed" is team row AND at least one managed crew agent — the same
  // both-directions witness `installTeam` guarantees (it refuses to write a team
  // row with zero agents). Leftover `…@legacy` rows for roles the catalog does
  // not carry (e.g. the retired Dispatcher) do NOT make an installed company
  // look broken; otherwise every such company would be re-diagnosed and
  // re-attempted on every pass forever, with nothing to adopt.
  const installed = teamId !== null && managedCrew.length > 0;

  let verdict: CrewRepairVerdict;
  if (installed) {
    verdict =
      operation && isClaimableOverInstalledCrew(operation, Date.now())
        ? "operation-row-stale"
        : "healthy";
  } else if (roster.length === 0) {
    verdict = "crewless";
  } else {
    verdict = "unmanaged";
  }

  return { companyId, verdict, teamId, managedCrew, unmanagedCrew, operation };
}

export type CrewRepairResult =
  | { action: "none"; verdict: CrewRepairVerdict }
  | { action: "operation-repaired"; operationId: string; teamId: string }
  | { action: "reprovisioned"; outcome: CrewProvisioningOutcome }
  | {
      action: "adopted";
      teamId: string;
      /** Catalog agent ids now stamped onto pre-existing rows. */
      adoptedItemIds: string[];
      /** Roster members whose adoption failed — still `…@legacy`, retryable. */
      failedItemIds: string[];
    }
  /** Diagnosed as repairable, but deliberately not repaired. Always logged. */
  | { action: "skipped"; verdict: CrewRepairVerdict; reason: string };

export interface CrewRepairDeps {
  /** Catalog items — the same array the boot update pass already loaded. */
  catalogItems: readonly CatalogItem[];
  instructionsService: AgentInstructionsServiceLike;
  /** Attribution for a repaired/synthesized install operation row. */
  requestedByUserId?: string | null;
  /** Test seam. Default: the real {@link provisionCompanyCrew}. */
  provision?: typeof provisionCompanyCrew;
}

interface TeamTemplateBody {
  slug: string;
  description?: string;
  manifest?: Record<string, unknown>;
  agents: Array<{ templateOrigin: string; name: string }>;
}

/**
 * Diagnose one company and repair it if it is degraded.
 *
 * Diagnosis ALWAYS runs first and gates everything. That ordering is
 * load-bearing, not stylistic: calling `provisionCompanyCrew` on a company that
 * already has crew rows is what mints the duplicate roster, and the only thing
 * standing between the two is this classification.
 *
 * @throws only from {@link diagnoseCrewProvisioning} (a DB failure). Every
 * repair action past that point is contained and reported in the result.
 */
export async function repairCompanyCrew(
  db: Db,
  companyId: string,
  deps: CrewRepairDeps,
): Promise<CrewRepairResult> {
  const diagnosis = await diagnoseCrewProvisioning(db, companyId);

  if (diagnosis.verdict === "healthy") {
    return { action: "none", verdict: "healthy" };
  }

  if (diagnosis.verdict === "operation-row-stale") {
    // The install committed; only its bookkeeping is wrong. Re-installing would
    // duplicate the roster, and leaving the row `failure` keeps it claimable by
    // the next provisioning pass — so the ONLY correct action is to correct the
    // audit row.
    const operationId = await sealBootstrapOperation(db, {
      companyId,
      teamId: diagnosis.teamId!,
      existingOperationId: diagnosis.operation?.id ?? null,
      requestedByUserId: deps.requestedByUserId ?? null,
    });
    logger.warn(
      { companyId, operationId, teamId: diagnosis.teamId, priorStatus: diagnosis.operation?.status },
      "crew repair: the crew is installed but its install operation row still reported failure — " +
        "corrected to success so a later provisioning pass cannot claim it and re-install",
    );
    return { action: "operation-repaired", operationId, teamId: diagnosis.teamId! };
  }

  if (diagnosis.verdict === "crewless") {
    // Nothing to collide with: this is the one state where the ordinary
    // provisioning path is exactly right, degrade-to-legacy included.
    logger.warn(
      { companyId },
      "crew repair: company has no crew at all — re-running crew provisioning",
    );
    const provision = deps.provision ?? provisionCompanyCrew;
    const outcome = await provision(db, companyId, {
      requestedByUserId: deps.requestedByUserId ?? null,
    });
    logger.info({ companyId, mode: outcome.mode }, "crew repair: re-provisioning finished");
    return { action: "reprovisioned", outcome };
  }

  return adoptUnmanagedCrew(db, diagnosis, deps);
}

/**
 * Re-point a company's `…@legacy`/NULL-origin crew rows at their catalog
 * templates, then give them the `teams` row + `team_members` links an install
 * would have written.
 *
 * Fails closed at every branch that cannot be resolved to a specific existing
 * row: no roster, no catalog item, no name match → nothing is written.
 */
async function adoptUnmanagedCrew(
  db: Db,
  diagnosis: CrewRepairDiagnosis,
  deps: CrewRepairDeps,
): Promise<CrewRepairResult> {
  const { companyId } = diagnosis;
  const catalogById = new Map(deps.catalogItems.map((item) => [item.id, item]));
  const teamItem = catalogById.get(DEFAULT_CREW_TEAM_ITEM_ID);
  if (!teamItem || teamItem.type !== "team") {
    return skip(diagnosis, `${DEFAULT_CREW_TEAM_ITEM_ID} is not in the catalog`);
  }

  let teamBody: TeamTemplateBody;
  try {
    teamBody = JSON.parse(
      await fetchCatalogResource(teamItem, "team template (crew repair)"),
    ) as TeamTemplateBody;
  } catch (err) {
    return skip(diagnosis, `team template unavailable: ${errText(err)}`);
  }

  const roster = Array.isArray(teamBody.agents) ? teamBody.agents : [];
  if (roster.length === 0) {
    // Same fail-closed stance as installTeam's empty-roster refusal: an empty
    // team.json must never become a team row that reads as a healthy install.
    return skip(diagnosis, "team.json declares no agents");
  }

  // Only rows a fresh install would have COLLIDED with are adoptable. Matching
  // on the roster's own `name` is not a heuristic — it is the same key
  // `resolveAgentNameConflict` uses, so "adoptable" and "would have been
  // renamed to `-2`" are the same set by construction.
  const unmanagedByName = new Map(diagnosis.unmanagedCrew.map((row) => [row.name, row]));
  const managedByOrigin = new Map(
    diagnosis.managedCrew.map((row) => [row.templateOrigin as string, row]),
  );

  const adoptable: Array<{ row: CrewAgentSnapshot; item: CatalogItem }> = [];
  const unresolvable: string[] = [];
  for (const entry of roster) {
    if (managedByOrigin.has(entry.templateOrigin)) continue; // already in the pipeline
    const row = unmanagedByName.get(entry.name);
    if (!row) continue; // no local counterpart — team-reconcile installs it later
    const item = catalogById.get(entry.templateOrigin);
    if (!item || item.type !== "agent") {
      unresolvable.push(entry.templateOrigin);
      continue;
    }
    adoptable.push({ row, item });
  }

  if (adoptable.length === 0 && managedByOrigin.size === 0) {
    // Crew rows exist but not one of them maps onto the roster (e.g. every agent
    // was renamed). Installing the team here would put a second, parallel crew
    // beside rows we could not account for — so refuse and say why.
    return skip(
      diagnosis,
      `none of this company's ${diagnosis.unmanagedCrew.length} crew agent(s) match a roster entry ` +
        `by name (roster: ${roster.map((r) => r.name).join(", ")}) — refusing to install alongside ` +
        "crew rows that could not be accounted for",
    );
  }

  const adoptedItemIds: string[] = [];
  const failedItemIds: string[] = [...unresolvable];
  for (const { row, item } of adoptable) {
    try {
      await applyCrewAgentUpdate({
        db,
        agentRow: { ...row, companyId },
        catalogItem: item,
        instructionsService: deps.instructionsService,
        setTemplateOrigin: item.id,
      });
      adoptedItemIds.push(item.id);
    } catch (err) {
      // Per-agent isolation: one unreachable agent.json must not strand the
      // rest. The row is untouched (applyCrewAgentUpdate fetches before it
      // writes), so it stays `…@legacy` and adoptable on the next pass.
      failedItemIds.push(item.id);
      logger.error(
        { err, companyId, agentId: row.id, catalogItemId: item.id },
        "crew repair: failed to adopt a legacy crew agent — it stays @legacy and retryable",
      );
    }
  }

  const rosterOrigins = roster.map((entry) => entry.templateOrigin);
  const teamId =
    diagnosis.teamId ??
    (await createCrewTeamRow(db, { companyId, teamItem, teamBody, rosterOrigins }));

  if (!teamId) {
    return skip(
      diagnosis,
      "no crew agent is marketplace-managed after adoption — refusing to write an empty team row",
    );
  }

  await linkCrewTeamMembers(db, { companyId, teamId, rosterOrigins });

  const operationId = await sealBootstrapOperation(db, {
    companyId,
    teamId,
    existingOperationId: diagnosis.operation?.id ?? null,
    requestedByUserId: deps.requestedByUserId ?? null,
  });

  logger.info(
    { companyId, teamId, operationId, adoptedItemIds, failedItemIds },
    "crew repair: adopted legacy crew rows into marketplace management — this company is now " +
      "inside the crew update pipeline (crew-updater no longer skips it)",
  );
  return { action: "adopted", teamId, adoptedItemIds, failedItemIds };
}

function skip(diagnosis: CrewRepairDiagnosis, reason: string): CrewRepairResult {
  logger.warn(
    { companyId: diagnosis.companyId, verdict: diagnosis.verdict, reason },
    "crew repair: SKIPPED — the company stays degraded and excluded from crew updates",
  );
  return { action: "skipped", verdict: diagnosis.verdict, reason };
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Write the `teams` row an install would have written — but only if at least one
 * crew agent actually carries a roster origin, mirroring `installTeam`'s refusal
 * to commit an empty team. A team row with no members is a permanent false
 * witness: `inspectCrewTeamInstall` would read `installed` forever, suppressing
 * both the legacy seeders and any future repair.
 *
 * @returns the new team id, or null if there was nothing to anchor it to.
 */
async function createCrewTeamRow(
  db: Db,
  opts: {
    companyId: string;
    teamItem: CatalogItem;
    teamBody: TeamTemplateBody;
    rosterOrigins: string[];
  },
): Promise<string | null> {
  const { companyId, teamItem, teamBody, rosterOrigins } = opts;
  const members = await selectRosterMembers(db, companyId, rosterOrigins);
  if (members.length === 0) return null;

  const slug = await resolveTeamSlugConflict({
    db,
    companyId,
    desiredSlug: teamBody.slug || "aoa-default-crew",
  });
  const [row] = await db
    .insert(teams)
    .values({
      companyId,
      // D21: company-wide, no parent department — same as the bootstrap install.
      parentProjectId: null,
      name: teamItem.name,
      slug,
      description: teamBody.description ?? teamItem.description,
      manifest: teamBody.manifest ?? {},
      templateOrigin: teamItem.id,
      templateVersion: teamItem.version,
    })
    .returning({ id: teams.id });
  return row.id;
}

/** Crew agents whose `templateOrigin` is one of the roster's catalog ids. */
async function selectRosterMembers(
  db: Db,
  companyId: string,
  rosterOrigins: string[],
): Promise<Array<{ id: string; templateOrigin: string | null }>> {
  const rows = (await db
    .select({ id: agents.id, templateOrigin: agents.templateOrigin })
    .from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.kind, "aoa")))) as Array<{
    id: string;
    templateOrigin: string | null;
  }>;
  const wanted = new Set(rosterOrigins);
  return rows.filter((row) => row.templateOrigin !== null && wanted.has(row.templateOrigin));
}

/**
 * Link every adopted roster member into the crew team, skipping any that is
 * already a member. The first member of an empty team becomes `lead` — the
 * `team_members_one_lead_uq` partial unique index allows exactly one.
 */
async function linkCrewTeamMembers(
  db: Db,
  opts: { companyId: string; teamId: string; rosterOrigins: string[] },
): Promise<void> {
  const { companyId, teamId, rosterOrigins } = opts;
  const members = await selectRosterMembers(db, companyId, rosterOrigins);
  const existing = (await db
    .select({ agentId: teamMembers.agentId, role: teamMembers.role })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, teamId))) as Array<{ agentId: string; role: string }>;
  const existingIds = new Set(existing.map((m) => m.agentId));
  let hasLead = existing.some((m) => m.role === "lead");

  for (const member of members) {
    if (existingIds.has(member.id)) continue;
    try {
      await db
        .insert(teamMembers)
        .values({ teamId, agentId: member.id, role: hasLead ? "member" : "lead" });
      hasLead = true;
    } catch (err) {
      logger.warn(
        { err, companyId, teamId, agentId: member.id },
        "crew repair: could not link an adopted crew agent to the crew team",
      );
    }
  }
}

/**
 * Make the `bootstrap-crew:<companyId>` operation row terminal and honest.
 *
 * Load-bearing, not cosmetic. `claimOperationForDispatch` treats `pending`,
 * `failure`, and stale `running` as claimable; `success` is not. So an
 * un-sealed row is a standing invitation for the next `provisionCompanyCrew`
 * to re-run `installTeam` over a company that already has its roster — the
 * duplicate-`Scout-2` failure this whole module exists to avoid.
 */
async function sealBootstrapOperation(
  db: Db,
  opts: {
    companyId: string;
    teamId: string;
    existingOperationId: string | null;
    requestedByUserId: string | null;
  },
): Promise<string> {
  const { companyId, teamId, existingOperationId, requestedByUserId } = opts;
  if (existingOperationId) {
    await updateOperation(db, existingOperationId, {
      status: "success",
      resultEntityId: teamId,
      errorMessage: null,
      completedAt: new Date(),
    });
    return existingOperationId;
  }

  const idempotencyKey = crewBootstrapIdempotencyKey(companyId);
  const [inserted] = await db
    .insert(marketplaceInstallOperations)
    .values({
      companyId,
      catalogItemId: DEFAULT_CREW_TEAM_ITEM_ID,
      itemType: "team",
      status: "success",
      resultEntityId: teamId,
      idempotencyKey,
      requestedByUserId: requestedByUserId ?? "system:crew-repair",
      completedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: marketplaceInstallOperations.id });
  if (inserted) return inserted.id;

  // Lost a race with a concurrent writer on the partial unique index — adopt
  // whatever row won and make it terminal.
  const [existing] = await db
    .select({ id: marketplaceInstallOperations.id })
    .from(marketplaceInstallOperations)
    .where(
      and(
        eq(marketplaceInstallOperations.companyId, companyId),
        eq(marketplaceInstallOperations.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  if (!existing) {
    throw new Error(`crew repair: operation row for ${idempotencyKey} vanished mid-seal`);
  }
  await updateOperation(db, existing.id, {
    status: "success",
    resultEntityId: teamId,
    errorMessage: null,
    completedAt: new Date(),
  });
  return existing.id;
}

// ── Boot-time reconcile ──────────────────────────────────────────────────────

/**
 * How many companies one pass may repair. Repair is network-heavy per company
 * (one team.json + one agent.json + instruction files per adopted member), so an
 * instance hosting many degraded companies must not turn a boot into a CDN
 * stampede. The remainder are picked up by the next pass — repair is permanent,
 * so the backlog strictly shrinks.
 */
export const CREW_REPAIR_MAX_PER_PASS = 5;

/**
 * Minimum gap between repair attempts for the SAME company.
 *
 * Deliberately process-local (see {@link recentAttempts}). It is the guard
 * against a tight re-entry — an operator hitting the route in a loop, or the
 * 24h interval landing next to a boot — not against a crash-looping process.
 * Nothing durable is claimed here, and nothing needs to be: a failed repair
 * writes nothing (adoption fetches before it writes, per-agent), and
 * {@link CREW_REPAIR_MAX_PER_PASS} bounds each pass regardless.
 */
export const CREW_REPAIR_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/** companyId → last attempt timestamp. Cleared on restart, by design. */
const recentAttempts = new Map<string, number>();

/** Test seam — drops the in-process cooldown state. */
export function resetCrewRepairCooldowns(): void {
  recentAttempts.clear();
}

export interface CrewRepairPassResult {
  inspected: number;
  /** Companies that were degraded and were changed by this pass. */
  repaired: number;
  /** Degraded but deliberately not repaired (fail-closed), or on cooldown. */
  skipped: number;
  /** Diagnosis or repair threw. */
  failed: number;
}

/**
 * Boot/interval reconcile: diagnose every company and repair the degraded ones.
 *
 * **Why a boot pass and not only a route:** the companies that need this are, by
 * construction, the ones whose founder has no idea anything is wrong — their
 * crew looks present and simply never receives an update. A button only helps
 * someone who already knows to press it.
 *
 * The pass costs one indexed diagnosis per company and NOTHING else for a
 * healthy one, so the steady state is nearly free; it reuses the catalog the
 * caller already loaded, so it adds zero catalog fetches. Callers must pass a
 * catalog — with none available (a genuinely offline instance) there is nothing
 * to repair towards, and the pass should simply not be invoked.
 */
export async function runCrewRepairPass(opts: {
  db: Db;
  companyIds: readonly string[];
  catalogItems: readonly CatalogItem[];
  instructionsService: AgentInstructionsServiceLike;
  maxPerPass?: number;
  cooldownMs?: number;
  now?: number;
}): Promise<CrewRepairPassResult> {
  const { db, companyIds, catalogItems, instructionsService } = opts;
  const maxPerPass = opts.maxPerPass ?? CREW_REPAIR_MAX_PER_PASS;
  const cooldownMs = opts.cooldownMs ?? CREW_REPAIR_COOLDOWN_MS;
  const now = opts.now ?? Date.now();
  const result: CrewRepairPassResult = { inspected: 0, repaired: 0, skipped: 0, failed: 0 };

  let budget = maxPerPass;
  for (const companyId of companyIds) {
    try {
      // Diagnosis runs for EVERY company, budget or no budget — three indexed
      // queries, in line with what the surrounding update pass already spends
      // per company. Stopping the loop on budget exhaustion would make
      // `inspected` a function of list order and hide how many companies are
      // degraded, which is the one number an operator actually wants.
      const diagnosis = await diagnoseCrewProvisioning(db, companyId);
      result.inspected += 1;
      if (diagnosis.verdict === "healthy") continue;

      if (budget <= 0) {
        result.skipped += 1;
        continue;
      }

      const lastAttempt = recentAttempts.get(companyId);
      if (lastAttempt !== undefined && now - lastAttempt < cooldownMs) {
        result.skipped += 1;
        continue;
      }
      recentAttempts.set(companyId, now);
      budget -= 1;

      const repair = await repairCompanyCrew(db, companyId, {
        catalogItems,
        instructionsService,
        requestedByUserId: "system:crew-repair",
      });
      if (repair.action === "skipped") result.skipped += 1;
      else result.repaired += 1;
    } catch (err) {
      result.failed += 1;
      logger.warn({ err, companyId }, "crew repair pass failed for company");
    }
  }

  if (result.repaired > 0 || result.failed > 0) {
    logger.info(result, "crew provisioning repair pass complete");
  }
  return result;
}
