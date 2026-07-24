/**
 * @fileoverview Repair a company whose crew provisioning degraded (T2.3b).
 *
 * **Why this exists.** `provisionCompanyCrew` runs at exactly one instant —
 * company creation — and `crew-updater.ts` skips `…@legacy` and NULL-origin
 * rows *forever*. So one CDN blip, cold cache, deadline, or process restart at
 * that instant permanently excludes the company from every future crew update.
 * T2.3's fail-open degrade is only an acceptable trade because this module
 * exists: the degraded state has to be recoverable, or "born updateable" is one
 * network call wide.
 *
 * ── What repair does, and the one thing it deliberately does NOT do ──────────
 *
 * Repair **adopts the pointer, never the content.** For a company whose crew is
 * `…@legacy`/NULL it rewrites two columns — `templateOrigin` and
 * `templateVersion` — and leaves instructions, `skillKeys`, `runtimeConfig`,
 * triggers and adapter exactly as the founder has them. That is enough to
 * un-freeze the company: `checkCrewUpdates` then sees a managed row at
 * {@link ADOPTED_TEMPLATE_VERSION}, which can never equal a published version,
 * so it routes the content change through the company's own `agentUpdatePolicy`
 * — auto-apply, or a founder-visible pending update + notification.
 *
 * The alternative — having repair call `applyCrewAgentUpdate` itself — was
 * built first and rejected. It runs
 * `materializeManagedBundle(..., { replaceExisting: true })`, whose first act is
 * `fs.rm(root, { recursive: true, force: true })` on the directory holding the
 * founder's instruction edits, **outside the transaction** and **without
 * consulting `agentUpdatePolicy`** (whose default is `notify`). An unattended
 * boot pass that deletes founder-edited files with no consent and no signal is
 * not a repair; and if the transaction then failed, the row stayed legacy while
 * the edits were already gone. Pointer-only adoption has none of that: the only
 * writes are DB writes, all inside one transaction.
 *
 * ── The three degraded shapes ───────────────────────────────────────────────
 *
 * The **roster** (`team.json`) is the sole authority on what counts as crew —
 * not a hardcoded name list. Everything is decided by matching the roster
 * against this company's `kind='aoa'` rows:
 *
 * 1. **No roster row matches, nothing adopted** → genuinely crewless. This is
 *    the residual state T2.3's `unknown` witness leaves behind. Nothing can
 *    collide, so {@link provisionCompanyCrew} is re-run verbatim.
 * 2. **Some roster rows match** → adopt them. Re-running the provisioner here
 *    would be wrong: `installTeam` inserts a fresh row per roster entry and
 *    `resolveAgentNameConflict` renames each collision, minting `Scout-2` /
 *    `default-crew-2` sharing one `templateOrigin` while leaving the ORIGINAL
 *    rows — the ones tasks, runs and assignments point at by id — still frozen.
 * 3. **Installed, but the operation row still reads claimable** → seal it. The
 *    T2.3 averted-clobber repair writes that row on the connection that just
 *    failed; when the DB is what broke, it stays claimable and the next
 *    provisioning pass re-installs over a committed roster.
 *
 * **All-or-nothing.** If any roster member that HAS a local row cannot be
 * adopted, repair writes nothing at all. A partial adoption plus a team row is
 * the worst state available: `reconcileTeamMembers` cannot tell "no local
 * counterpart" from "adoption failed here", so it installs a duplicate under a
 * renamed name, and the original row is then permanently unreachable (the next
 * pass sees the origin already present and skips it).
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import {
  agents,
  companySkills,
  teams,
  teamMembers,
  marketplaceInstallOperations,
} from "@armyofagents/db";
import type { CatalogItem } from "@armyofagents/shared";
import { logger } from "../middleware/logger.js";
import { marketplaceNotifications } from "./marketplace-notifications.js";
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
 * The `templateVersion` an adopted row carries.
 *
 * It must be non-null (`crew-updater` skips rows without one) and must never
 * equal a published catalog version (or the updater would think the row is
 * synced when it still holds legacy content). A `0.0.0` prerelease satisfies
 * both and is honest about what the row actually contains: pre-catalog content
 * of unknown provenance. Do NOT replace this with the current catalog version —
 * that would claim the row is up to date with content it has never seen.
 */
export const ADOPTED_TEMPLATE_VERSION = "0.0.0-legacy";

/** Aggregate budget for repair's resource fetches (team.json + skill bodies). */
export const CREW_REPAIR_FETCH_DEADLINE_MS = 30_000;

/** A `templateOrigin` that puts the row inside the update pipeline. */
export function isMarketplaceManagedOrigin(origin: string | null): origin is string {
  return origin !== null && origin.length > 0 && !origin.endsWith("@legacy");
}

export interface CrewAgentSnapshot {
  id: string;
  name: string;
  templateOrigin: string | null;
  templateVersion: string | null;
}

export type CrewRepairVerdict =
  /** Crew team row + at least one managed crew agent, audit row honest. */
  | "healthy"
  /** Installed, but the bootstrap operation row is still claimable. */
  | "operation-row-stale"
  /**
   * Anything else. Deliberately NOT split into "crewless" vs "unmanaged" here:
   * that distinction can only be made against the roster, which costs a network
   * fetch, and a cheap diagnosis that guessed it would guess wrong exactly when
   * the roster changes (e.g. when T2.4 moves Steward into the crew).
   */
  | "degraded";

export interface CrewRepairDiagnosis {
  companyId: string;
  verdict: CrewRepairVerdict;
  /** The `teams` row for `team:aoa-curated/default-crew`, if it exists. */
  teamId: string | null;
  /** `kind='aoa'` rows already inside the update pipeline. */
  managedCrew: CrewAgentSnapshot[];
  /** `kind='aoa'` rows with a `…@legacy`/NULL origin. */
  unmanagedCrew: CrewAgentSnapshot[];
  /** The `bootstrap-crew:<companyId>` operation row, if one was ever written. */
  operation: { id: string; status: string; startedAt: Date } | null;
}

/**
 * Is this operation row a lie that a later provisioning pass could act on?
 *
 * Mirrors `claimOperationForDispatch` exactly, and that is the point: a row is
 * only worth sealing if it is CLAIMABLE, because claimable-over-a-committed-crew
 * is the whole hazard.
 * - `failure` — claimable now.
 * - `pending` — claimable now, at any age (nobody has started it).
 * - `running` older than {@link OPERATION_CLAIM_STALE_AFTER_MS} — owner died.
 * - a FRESH `running` — a live install owns it; sealing would declare someone
 *   else's in-flight work finished.
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
 * Classify a company's crew provisioning. Three indexed queries; no network.
 * Throws on a DB error — callers treat that as "skip this company", never as
 * "healthy" (a pass that silently reads an outage as health is the exact
 * failure class T2.3's `unknown` witness was written to avoid).
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
    })
    .from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.kind, "aoa")))) as CrewAgentSnapshot[];

  const managedCrew = crewRows.filter((row) => isMarketplaceManagedOrigin(row.templateOrigin));
  const unmanagedCrew = crewRows.filter((row) => !isMarketplaceManagedOrigin(row.templateOrigin));

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
  // both-directions witness `installTeam` guarantees (it refuses to write a
  // team row with zero agents).
  const installed = teamId !== null && managedCrew.length > 0;

  let verdict: CrewRepairVerdict;
  if (installed) {
    verdict =
      operation && isClaimableOverInstalledCrew(operation, Date.now())
        ? "operation-row-stale"
        : "healthy";
  } else {
    verdict = "degraded";
  }

  return { companyId, verdict, teamId, managedCrew, unmanagedCrew, operation };
}

/** Why repair declined to act. Kept distinct so an operator can tell them apart. */
export type CrewRepairSkipReason =
  | "cooldown"
  | "install-in-flight"
  | "team-item-not-in-catalog"
  | "team-template-unavailable"
  | "empty-roster"
  | "unadoptable-roster-member"
  | "skill-content-unavailable";

export type CrewRepairResult =
  | { action: "none"; verdict: CrewRepairVerdict }
  | { action: "operation-repaired"; operationId: string; teamId: string }
  | { action: "reprovisioned"; outcome: CrewProvisioningOutcome }
  | {
      action: "adopted";
      teamId: string;
      /** Catalog agent ids now stamped onto pre-existing rows. Never partial. */
      adoptedItemIds: string[];
      /**
       * Roster members with no local row at all. NOT a failure — repair writes
       * the team row + links, and `reconcileTeamMembers` installs these on its
       * own pass (e.g. Reviewer, which has no legacy seeder).
       */
      unmatchedItemIds: string[];
      /** Catalog skill ids installed so the roster's `skillKeys` can resolve. */
      installedSkillIds: string[];
    }
  /** Diagnosed as repairable, but deliberately not repaired. Always logged. */
  | { action: "skipped"; verdict: CrewRepairVerdict; reason: CrewRepairSkipReason; detail: string };

export interface CrewRepairDeps {
  /** Catalog items — the same array the boot update pass already loaded. */
  catalogItems: readonly CatalogItem[];
  /** Attribution for a repaired/synthesized install operation row. */
  requestedByUserId?: string | null;
  /**
   * Bypass {@link CREW_REPAIR_COOLDOWN_MS}. For a deliberate operator action
   * (the founder route with `force`), never for the unattended pass.
   */
  force?: boolean;
  /** Test seam. Default: the real {@link provisionCompanyCrew}. */
  provision?: typeof provisionCompanyCrew;
}

interface RosterEntry {
  templateOrigin: string;
  name: string;
}

interface TeamTemplateBody {
  slug: string;
  description?: string;
  manifest?: Record<string, unknown>;
  agents: RosterEntry[];
}

/**
 * Diagnose one company and repair it if it is degraded.
 *
 * Diagnosis ALWAYS runs first and gates everything. That ordering is
 * load-bearing, not stylistic: acting on a company that already has crew rows
 * is what mints a duplicate roster, and the only thing standing between the two
 * is this classification.
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

  // The cooldown lives HERE, not in the pass, so every entry point is gated —
  // the founder route included. A loop on the route otherwise drives unbounded
  // fetches, and on a crewless company each call is a full provisioning attempt
  // (catalog wait + install deadline + ~27 fetches).
  if (!deps.force && !claimRepairAttempt(companyId)) {
    return skip(diagnosis, "cooldown", "a repair for this company was attempted recently");
  }

  if (diagnosis.verdict === "operation-row-stale") {
    const operationId = await sealBootstrapOperation(db, {
      companyId,
      teamId: diagnosis.teamId!,
      existingOperationId: diagnosis.operation?.id ?? null,
      requestedByUserId: deps.requestedByUserId ?? null,
    });
    logger.warn(
      { companyId, operationId, teamId: diagnosis.teamId, priorStatus: diagnosis.operation?.status },
      "crew repair: the crew is installed but its install operation row was still claimable — " +
        "sealed to success so a later provisioning pass cannot re-install over it",
    );
    return { action: "operation-repaired", operationId, teamId: diagnosis.teamId! };
  }

  return repairDegradedCrew(db, diagnosis, deps);
}

async function repairDegradedCrew(
  db: Db,
  diagnosis: CrewRepairDiagnosis,
  deps: CrewRepairDeps,
): Promise<CrewRepairResult> {
  const { companyId } = diagnosis;

  // A live bootstrap owns this company's crew provisioning. Sealing the
  // operation row inside the repair transaction excludes a bootstrap that has
  // not created its row yet (it blocks on the unique idempotency index), but it
  // cannot un-do one that is ALREADY mid-install — that would leave two team
  // rows sharing one templateOrigin. `pending` and `failure` are claimable by
  // anyone and are safe to take; a fresh `running` and `requested` are not.
  const op = diagnosis.operation;
  if (
    op &&
    (op.status === "requested" ||
      (op.status === "running" && Date.now() - op.startedAt.getTime() < OPERATION_CLAIM_STALE_AFTER_MS))
  ) {
    return skip(
      diagnosis,
      "install-in-flight",
      `install operation ${op.id} is ${op.status} and not yet stale — leaving it to its owner`,
    );
  }

  const catalogById = new Map(deps.catalogItems.map((item) => [item.id, item]));
  const teamItem = catalogById.get(DEFAULT_CREW_TEAM_ITEM_ID);
  if (!teamItem || teamItem.type !== "team") {
    return skip(diagnosis, "team-item-not-in-catalog", `${DEFAULT_CREW_TEAM_ITEM_ID} is absent`);
  }

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), CREW_REPAIR_FETCH_DEADLINE_MS);
  timer.unref?.();
  try {
    let teamBody: TeamTemplateBody;
    try {
      teamBody = JSON.parse(
        await fetchCatalogResource(teamItem, "team template (crew repair)", deadline.signal),
      ) as TeamTemplateBody;
    } catch (err) {
      return skip(diagnosis, "team-template-unavailable", errText(err));
    }

    const roster = Array.isArray(teamBody.agents) ? teamBody.agents : [];
    if (roster.length === 0) {
      // Same fail-closed stance as installTeam's empty-roster refusal: an empty
      // team.json must never become a team row that reads as a healthy install.
      return skip(diagnosis, "empty-roster", "team.json declares no agents");
    }

    // ── Partition the company's crew against the roster ────────────────────
    // The roster is the ONLY authority on what is crew. Matching by the roster's
    // own `name` is not a heuristic — it is the same key
    // `resolveAgentNameConflict` uses, so "adoptable" and "would have been
    // renamed to `-2` by a re-install" are the same set by construction.
    const byOrigin = new Map(
      diagnosis.managedCrew.map((row) => [row.templateOrigin as string, row]),
    );
    const byName = new Map(
      [...diagnosis.managedCrew, ...diagnosis.unmanagedCrew].map((row) => [row.name, row]),
    );

    const adoptable: Array<{ row: CrewAgentSnapshot; entry: RosterEntry }> = [];
    const alreadyAdopted: string[] = [];
    const unmatched: string[] = [];
    for (const entry of roster) {
      if (byOrigin.has(entry.templateOrigin)) {
        alreadyAdopted.push(entry.templateOrigin);
        continue;
      }
      const row = byName.get(entry.name);
      if (!row) {
        unmatched.push(entry.templateOrigin);
        continue;
      }
      // A same-named row already managed under a DIFFERENT origin is not ours
      // to re-point. Fail closed rather than guess.
      if (isMarketplaceManagedOrigin(row.templateOrigin)) {
        return skip(
          diagnosis,
          "unadoptable-roster-member",
          `agent "${entry.name}" is already managed as ${row.templateOrigin}, not ${entry.templateOrigin}`,
        );
      }
      const item = catalogById.get(entry.templateOrigin);
      if (!item || item.type !== "agent") {
        // ALL-OR-NOTHING. Adopting the rest and writing the team row would let
        // reconcileTeamMembers install a renamed duplicate for this one, after
        // which the original row is unreachable forever.
        return skip(
          diagnosis,
          "unadoptable-roster-member",
          `${entry.templateOrigin} (matched local agent "${entry.name}") is not an agent in the catalog`,
        );
      }
      adoptable.push({ row, entry });
    }

    if (adoptable.length === 0 && alreadyAdopted.length === 0) {
      // Not one roster member has a local row: genuinely crewless. This is the
      // one shape where nothing can collide, so the ordinary provisioning path
      // is exactly right — degrade-to-legacy included.
      logger.warn({ companyId }, "crew repair: no roster member has a local row — re-provisioning");
      const provision = deps.provision ?? provisionCompanyCrew;
      const outcome = await provision(db, companyId, {
        requestedByUserId: deps.requestedByUserId ?? null,
      });
      logger.info({ companyId, mode: outcome.mode }, "crew repair: re-provisioning finished");
      return { action: "reprovisioned", outcome };
    }

    // ── B3: the roster's skills, or the crew advertises keys it cannot load ──
    // `installTeam` inserts a `company_skills` row per required skill; adoption
    // must too, or `handleUseSkill` answers "Skill not found for this company"
    // for every declared key — and `reconcileTeamMembers` would install Reviewer
    // with the same dangling keys.
    let skillsToInstall: Array<{ item: CatalogItem; markdown: string }>;
    try {
      skillsToInstall = await loadMissingRosterSkills(db, {
        companyId,
        teamItem,
        catalogById,
        signal: deadline.signal,
      });
    } catch (err) {
      return skip(diagnosis, "skill-content-unavailable", errText(err));
    }

    const rosterOrigins = roster.map((entry) => entry.templateOrigin);
    const committed = await db.transaction(async (tx) => {
      // Serialize repairs for this company, and (because the operation row is
      // sealed in the SAME transaction, on the unique idempotency key) exclude a
      // concurrent bootstrap too. `teams` has no unique index on
      // (companyId, templateOrigin), so nothing else prevents two team rows.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`crew-repair:${companyId}`}))`);

      // Re-read inside the lock: a racing repair may have finished since the
      // diagnosis, in which case there is nothing left to create.
      const [existingTeam] = await tx
        .select({ id: teams.id })
        .from(teams)
        .where(
          and(eq(teams.companyId, companyId), eq(teams.templateOrigin, DEFAULT_CREW_TEAM_ITEM_ID)),
        )
        .limit(1);

      for (const { row, entry } of adoptable) {
        // POINTER ONLY. No instructions, no skillKeys, no runtimeConfig, no
        // triggers, no adapter — see this module's docblock.
        await tx
          .update(agents)
          .set({
            templateOrigin: entry.templateOrigin,
            templateVersion: ADOPTED_TEMPLATE_VERSION,
            updatedAt: new Date(),
          })
          .where(eq(agents.id, row.id));
      }

      for (const skill of skillsToInstall) {
        await tx
          .insert(companySkills)
          .values({
            companyId,
            key: skill.item.id,
            slug: skill.item.id.split("/").pop() ?? skill.item.id,
            name: skill.item.name,
            description: skill.item.description,
            markdown: skill.markdown,
            sourceType: "catalog",
            sourceLocator: skill.item.id,
            sourceRef: skill.item.version,
            trustLevel: "markdown_only",
            compatibility: "compatible",
            fileInventory: [],
            metadata: {
              catalogCategory: skill.item.category,
              catalogTags: skill.item.tags,
              catalogTrustTier: skill.item.trust.tier,
              installedAt: new Date().toISOString(),
            },
          })
          .onConflictDoNothing();
      }

      let teamId = existingTeam?.id ?? null;
      if (!teamId) {
        const slug = await resolveTeamSlugConflict({
          db: tx as unknown as Db,
          companyId,
          desiredSlug: teamBody.slug || "aoa-default-crew",
        });
        const [inserted] = await tx
          .insert(teams)
          .values({
            companyId,
            // D21: company-wide, no parent department — as the bootstrap install.
            parentProjectId: null,
            name: teamItem.name,
            slug,
            description: teamBody.description ?? teamItem.description,
            manifest: teamBody.manifest ?? {},
            templateOrigin: teamItem.id,
            templateVersion: teamItem.version,
          })
          .returning({ id: teams.id });
        teamId = inserted.id;
      }

      await linkRosterMembers(tx as unknown as Db, { companyId, teamId, rosterOrigins });
      const operationId = await sealBootstrapOperation(tx as unknown as Db, {
        companyId,
        teamId,
        existingOperationId: diagnosis.operation?.id ?? null,
        requestedByUserId: deps.requestedByUserId ?? null,
      });
      return { teamId, operationId };
    });

    const adoptedItemIds = adoptable.map(({ entry }) => entry.templateOrigin);
    const installedSkillIds = skillsToInstall.map((s) => s.item.id);
    logger.info(
      {
        companyId,
        teamId: committed.teamId,
        operationId: committed.operationId,
        adoptedItemIds,
        unmatchedItemIds: unmatched,
        installedSkillIds,
        adoptedTemplateVersion: ADOPTED_TEMPLATE_VERSION,
      },
      "crew repair: adopted legacy crew rows into marketplace management (pointer only — content " +
        "is left to the policy-respecting update path). This company is now inside the crew " +
        "update pipeline.",
    );
    // Founder-visible, because a boot pass silently changing how their agents
    // are governed is exactly the kind of thing that should not be silent.
    await marketplaceNotifications
      .crewRepaired(db, companyId, adoptedItemIds.length)
      .catch((err: unknown) =>
        logger.warn({ err, companyId }, "crew repair: founder notification failed"),
      );

    return {
      action: "adopted",
      teamId: committed.teamId,
      adoptedItemIds,
      unmatchedItemIds: unmatched,
      installedSkillIds,
    };
  } finally {
    clearTimeout(timer);
    // Abort, don't merely stop the clock: on any exit every fetch still in
    // flight must be cancelled rather than left running against the CDN.
    deadline.abort();
  }
}

/**
 * Fetch bodies for the roster's required skills that this company does not have
 * yet. Already-installed keys are skipped without a fetch, so a repair on a
 * company that already has them costs nothing here.
 *
 * @throws if any needed body cannot be fetched — the caller fails closed, since
 * a crew advertising skill keys with no rows behind them is the defect this
 * exists to prevent.
 */
async function loadMissingRosterSkills(
  db: Db,
  opts: {
    companyId: string;
    teamItem: CatalogItem;
    catalogById: Map<string, CatalogItem>;
    signal: AbortSignal;
  },
): Promise<Array<{ item: CatalogItem; markdown: string }>> {
  const { companyId, teamItem, catalogById, signal } = opts;
  const required = (teamItem.requires ?? [])
    .filter((req) => req.type === "skill")
    .map((req) => catalogById.get(req.id))
    .filter((item): item is CatalogItem => !!item && item.type === "skill");
  if (required.length === 0) return [];

  const existing = (await db
    .select({ key: companySkills.key })
    .from(companySkills)
    .where(
      and(
        eq(companySkills.companyId, companyId),
        inArray(
          companySkills.key,
          required.map((item) => item.id),
        ),
      ),
    )) as Array<{ key: string }>;
  const have = new Set(existing.map((row) => row.key));

  const out: Array<{ item: CatalogItem; markdown: string }> = [];
  for (const item of required) {
    if (have.has(item.id)) continue;
    const markdown =
      item.content?.inline ??
      (await fetchCatalogResource(item, "skill content (crew repair)", signal));
    out.push({ item, markdown });
  }
  return out;
}

function skip(
  diagnosis: CrewRepairDiagnosis,
  reason: CrewRepairSkipReason,
  detail: string,
): CrewRepairResult {
  if (reason === "cooldown") {
    logger.debug(
      { companyId: diagnosis.companyId, verdict: diagnosis.verdict, reason, detail },
      "crew repair: not attempted (cooldown)",
    );
  } else {
    logger.warn(
      { companyId: diagnosis.companyId, verdict: diagnosis.verdict, reason, detail },
      "crew repair: SKIPPED — the company stays degraded and excluded from crew updates",
    );
  }
  return { action: "skipped", verdict: diagnosis.verdict, reason, detail };
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Link every crew row carrying a roster origin into the crew team, skipping any
 * that is already a member. The first member of an empty team becomes `lead` —
 * the `team_members_one_lead_uq` partial unique index allows exactly one.
 *
 * Errors are NOT swallowed: this runs inside the repair transaction, and a
 * half-linked team is a state `reconcileTeamMembers` would "fix" by installing
 * a duplicate.
 */
async function linkRosterMembers(
  db: Db,
  opts: { companyId: string; teamId: string; rosterOrigins: string[] },
): Promise<void> {
  const { companyId, teamId, rosterOrigins } = opts;
  const rows = (await db
    .select({ id: agents.id, templateOrigin: agents.templateOrigin })
    .from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.kind, "aoa")))) as Array<{
    id: string;
    templateOrigin: string | null;
  }>;
  const wanted = new Set(rosterOrigins);
  const members = rows.filter(
    (row) => row.templateOrigin !== null && wanted.has(row.templateOrigin),
  );

  const existing = (await db
    .select({ agentId: teamMembers.agentId, role: teamMembers.role })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, teamId))) as Array<{ agentId: string; role: string }>;
  const existingIds = new Set(existing.map((m) => m.agentId));
  let hasLead = existing.some((m) => m.role === "lead");

  for (const member of members) {
    if (existingIds.has(member.id)) continue;
    await db
      .insert(teamMembers)
      .values({ teamId, agentId: member.id, role: hasLead ? "member" : "lead" });
    hasLead = true;
  }
}

/**
 * Make the `bootstrap-crew:<companyId>` operation row terminal and honest.
 *
 * Load-bearing, not cosmetic. `claimOperationForDispatch` treats `pending`,
 * `failure`, and stale `running` as claimable; `success` is not. So an unsealed
 * row is a standing invitation for the next `provisionCompanyCrew` to re-run
 * `installTeam` over a company that already has its roster.
 *
 * Only ever called on a COMPLETE repair — never over a partial adoption, which
 * would make the audit record false AND put the row beyond a retry's reach.
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

// ── Attempt throttling ───────────────────────────────────────────────────────

/**
 * Minimum gap between repair attempts for the SAME company, enforced inside
 * {@link repairCompanyCrew} so EVERY entry point is covered — the founder route
 * included (it can opt out per call with `force`).
 *
 * Deliberately process-local. It is the guard against tight re-entry — a route
 * in a loop, or the 24h interval landing next to a boot — not against a
 * crash-looping process. Nothing durable is claimed here and nothing needs to
 * be: a failed repair writes nothing (all writes are one transaction), and
 * {@link CREW_REPAIR_MAX_PER_PASS} bounds each pass regardless.
 */
export const CREW_REPAIR_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/** companyId → last attempt timestamp. Cleared on restart, by design. */
const recentAttempts = new Map<string, number>();

/** Test seam: the clock the cooldown reads. */
let repairClock: () => number = () => Date.now();

/** @returns true if this caller may attempt a repair now. */
function claimRepairAttempt(companyId: string): boolean {
  const now = repairClock();
  const last = recentAttempts.get(companyId);
  if (last !== undefined && now - last < CREW_REPAIR_COOLDOWN_MS) return false;
  recentAttempts.set(companyId, now);
  return true;
}

/** Test seam — drops the in-process cooldown state and restores the real clock. */
export function resetCrewRepairCooldowns(): void {
  recentAttempts.clear();
  repairClock = () => Date.now();
}

/** Test seam — pin the cooldown clock. */
export function setCrewRepairClock(clock: () => number): void {
  repairClock = clock;
}

// ── Boot-time reconcile ──────────────────────────────────────────────────────

/**
 * How many companies one pass may actually repair. Repair is network-bearing
 * per company (team.json + any missing skill bodies), so an instance hosting
 * many degraded companies must not turn a boot into a CDN stampede. The
 * remainder are taken by later passes — repair is permanent, so the backlog
 * strictly shrinks.
 *
 * Only *productive* work consumes budget: a company that skips fail-closed must
 * not burn a slot, or a handful of unrepairable companies would starve every
 * company behind them, forever.
 */
export const CREW_REPAIR_MAX_PER_PASS = 5;

export interface CrewRepairPassResult {
  inspected: number;
  /** Companies that were degraded and were changed by this pass. */
  repaired: number;
  /** Degraded, attempted, and deliberately not repaired (fail-closed). */
  skippedFailClosed: number;
  /** Degraded but within {@link CREW_REPAIR_COOLDOWN_MS} of a prior attempt. */
  skippedCooldown: number;
  /** Degraded but this pass had already spent its budget. */
  skippedOverBudget: number;
  /** Diagnosis or repair threw. */
  failed: number;
}

/**
 * Boot/interval reconcile: diagnose every company and repair the degraded ones.
 *
 * **Why a pass and not only a route:** the companies that need this are, by
 * construction, the ones whose founder has no idea anything is wrong — the crew
 * looks present and simply never receives an update. A button only helps
 * someone who already knows to press it.
 *
 * Costs one diagnosis per company and NOTHING else for a healthy one, and
 * reuses the catalog the caller already loaded, so it adds zero catalog fetches.
 */
export async function runCrewRepairPass(opts: {
  db: Db;
  companyIds: readonly string[];
  catalogItems: readonly CatalogItem[];
  maxPerPass?: number;
}): Promise<CrewRepairPassResult> {
  const { db, companyIds, catalogItems } = opts;
  const maxPerPass = opts.maxPerPass ?? CREW_REPAIR_MAX_PER_PASS;
  const result: CrewRepairPassResult = {
    inspected: 0,
    repaired: 0,
    skippedFailClosed: 0,
    skippedCooldown: 0,
    skippedOverBudget: 0,
    failed: 0,
  };

  // A cache row can exist whose `items` array lacks the crew team (an empty or
  // partial catalog). Without that item there is nothing to repair TOWARDS, and
  // a crewless company would enter provisioning only to degrade to legacy off a
  // catalog that never had the team. Gate on the item, not on "a catalog exists".
  const teamItem = catalogItems.find(
    (item) => item.id === DEFAULT_CREW_TEAM_ITEM_ID && item.type === "team",
  );
  if (!teamItem) {
    logger.debug(
      { teamItemId: DEFAULT_CREW_TEAM_ITEM_ID },
      "crew repair pass: crew team item absent from the catalog — nothing to repair towards",
    );
    return result;
  }

  let budget = maxPerPass;
  for (const companyId of companyIds) {
    try {
      // Diagnosis runs for EVERY company, budget or no budget — three indexed
      // queries, in line with what the surrounding update pass already spends
      // per company. Stopping the loop on budget exhaustion would make
      // `inspected` a function of list order and hide how many are degraded.
      const diagnosis = await diagnoseCrewProvisioning(db, companyId);
      result.inspected += 1;
      if (diagnosis.verdict === "healthy") continue;

      if (budget <= 0) {
        result.skippedOverBudget += 1;
        continue;
      }

      const repair = await repairCompanyCrew(db, companyId, {
        catalogItems,
        requestedByUserId: "system:crew-repair",
      });
      if (repair.action === "skipped") {
        if (repair.reason === "cooldown") result.skippedCooldown += 1;
        else result.skippedFailClosed += 1;
        // Neither consumes budget: a skip did no productive work, and charging
        // for it lets a few unrepairable companies starve the rest forever.
      } else {
        result.repaired += 1;
        budget -= 1;
      }
    } catch (err) {
      result.failed += 1;
      logger.warn({ err, companyId }, "crew repair pass failed for company");
    }
  }

  if (result.repaired > 0 || result.failed > 0 || result.skippedFailClosed > 0) {
    logger.info(result, "crew provisioning repair pass complete");
  }
  return result;
}
