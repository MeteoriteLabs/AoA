import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents, aoaAgentTriggers } from "@armyofagents/db";
import { seedRoleInstructionBundle } from "./seed-commander-bundle.js";
import { agentInstructionsService } from "../../agent-instructions.js";
import {
  resolveCrewAdapterForCompany,
  needsAdapterBackfill,
  mergeAdapterConfig,
} from "./resolve-crew-adapter.js";

/**
 * Plan 3 Task 2 — Command Staff roles (Router, Planner, Dispatcher, Memory Keeper).
 * Each is seeded as an agents.kind='aoa' row, idempotently, mirroring the
 * ensureCommanderAgent / ensureExtractionAgent pattern.
 *
 * Decisions #15/#16/#52: Memory Keeper can only PROPOSE memory (status='pending').
 * Agentic roles (router, planner, dispatcher) require autonomyLevel ≥ 2 to fire
 * (enforced in autonomy.ts + dispatcher.ts). Core roles (scribe, memory_keeper,
 * curator) are always active (min autonomy = 0).
 */

export const COMMAND_STAFF_ROLES = [
  { key: "router", name: "Router", trigger: "mention" },
  { key: "planner", name: "Planner", trigger: "phase-advance" },
  { key: "dispatcher", name: "Dispatcher", trigger: "phase-advance" },
  // T1.4 part 1 (v1-completion plan F4): Memory Keeper was kind='outbox'
  // but the dispatcher's outbox drain is hardcoded to the extraction agent —
  // MK never ran. Switched to 'sweep' so the periodic memory-keeper sweep
  // driver (sweep-memory-keeper.ts) wakes MK every 4hr per active thread.
  // Existing rows are migrated below in ensureRole (kind='outbox' → 'sweep').
  // T1.4 part 2 will additionally seed an 'event' trigger for entry.added.
  { key: "memory_keeper", name: "Memory Keeper", trigger: "sweep" },
] as const;

export type CommandStaffRoleKey = (typeof COMMAND_STAFF_ROLES)[number]["key"];

/** Per-role tool allowlist. Decisions #15/#16/#52: no direct memory writes for crew. */
export function roleToolAllowlist(role: CommandStaffRoleKey): string[] {
  switch (role) {
    case "router":
      // C2 batch 1: Router needs find_similar_threads to suggest a sibling
      // thread instead of routing to a department when the topic has been
      // discussed before. get_thread_summary + thread.listEntries help it
      // read the topic of an existing thread without polluting the thread itself.
      // C2 batch 2: attach_to_thread lets the Router promote an inbox item to
      // an existing thread when a confident match is found, and spin_off_thread
      // lets it create a new thread for orphaned material that doesn't belong
      // in any current discussion.
      return [
        "search_discussions",
        "query_departments",
        "find_similar_threads",
        "get_thread_summary",
        "thread.listEntries",
        "thread.createLink",
        "attach_to_thread",
        "spin_off_thread",
      ];
    case "planner":
      // C2 batch 1: Planner owns scope proposals + setting intent on a thread
      // when escalating from discuss → scope. Needs listEntries to read the
      // thread context before proposing.
      return [
        "search_discussions",
        "query_tasks",
        "query_dependency_chain",
        "thread.listEntries",
        "get_thread_summary",
        "thread.setIntent",
        "thread.postScopeProposal",
        "thread.updateSummary",
      ];
    case "dispatcher":
      return [
        "create_task",
        "assign_task",
        "add_task_dependency",
        "wakeup_agent",
        "query_agents",
        // Dispatcher reads the proposal before creating tasks
        "thread.listEntries",
        "get_thread_summary",
      ];
    case "memory_keeper":
      // C2 batch 1: Memory Keeper benefits from cross-thread retrieval to
      // surface duplicate or related memory patterns across threads.
      return [
        "suggest_memory",
        "find_similar_memory",
        "detect_conflicts",
        "find_similar_threads",
        "thread.listEntries",
      ];
  }
}

const ROLE_INSTRUCTIONS: Record<CommandStaffRoleKey, string> = {
  router:
    "You are the Router. When an @agent mention arrives in a thread, identify the " +
    "most relevant department or project for the thread's content using " +
    "search_discussions and query_departments. Return a structured routing " +
    "recommendation. Do not create tasks or write memory.",
  planner:
    "You are the Planner. When a thread phase advances, review pending extracted " +
    "items using query_tasks and query_dependency_chain. Identify dependency gaps, " +
    "sequencing issues, and missing steps in the work pipeline. Return a structured " +
    "plan recommendation. Do not create tasks directly.",
  dispatcher:
    "You are the Dispatcher. When a thread phase advances and a plan is ready, " +
    "translate the plan into concrete tasks using create_task, assign them to the " +
    "right agents with assign_task, wire dependencies with add_task_dependency, " +
    "and wake agents with wakeup_agent. Do not write memory.",
  memory_keeper:
    "You are the Memory Keeper. Review discussion entries and extracted items for " +
    "patterns worth capturing in memory. Propose memory items using suggest_memory " +
    "(status='pending' only — the founder approves). Use find_similar_memory to " +
    "avoid duplicates and detect_conflicts to flag contradictions. " +
    "CRITICAL: You may only PROPOSE memory (status='pending'). You must never call " +
    "create_memory or update_memory directly. Decisions #15/#16/#52.",
};

async function ensureRole(db: Db, companyId: string, role: (typeof COMMAND_STAFF_ROLES)[number]): Promise<string> {
  const toolAllowlist = roleToolAllowlist(role.key);
  const instruction = ROLE_INSTRUCTIONS[role.key];

  // Resolve the right CLI adapter for this company's configured provider
  // (P1-B fix — see ensure-adjutant.ts for context).
  const crewAdapter = await resolveCrewAdapterForCompany(db, companyId);

  // Atomic insert with ON CONFLICT DO NOTHING (agents_aoa_name_per_company_idx).
  const [inserted] = await db
    .insert(agents)
    .values({
      companyId,
      name: role.name,
      kind: "aoa",
      role: "general",
      status: "idle",
      adapterType: crewAdapter.adapterType,
      adapterConfig: crewAdapter.adapterConfig,
      runtimeConfig: {
        aoa: { role: "member", instruction, toolAllowlist },
        heartbeat: { enabled: false, intervalSec: 0 },
      },
    })
    .onConflictDoNothing()
    .returning({ id: agents.id, runtimeConfig: agents.runtimeConfig });

  let agentId: string;
  let existingRc: Record<string, unknown> | undefined;

  if (inserted) {
    agentId = inserted.id;
    existingRc = inserted.runtimeConfig;

    // Seed the trigger for this role.
    await db.insert(aoaAgentTriggers).values({
      companyId,
      agentId,
      kind: role.trigger,
      enabled: true,
      config: { role: role.key },
    });
  } else {
    // Conflict: another concurrent caller inserted first. Fetch the winner.
    const [existing] = await db
      .select({ id: agents.id, runtimeConfig: agents.runtimeConfig })
      .from(agents)
      .where(
        and(
          eq(agents.companyId, companyId),
          eq(agents.kind, "aoa"),
          eq(agents.name, role.name),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new Error(
        `Command staff role '${role.name}' for company ${companyId} disappeared after conflict`,
      );
    }
    agentId = existing.id;
    existingRc = existing.runtimeConfig;
  }

  // T1.4 part 1 — Memory Keeper trigger migration. Pre-T1.4 seeds wrote
  // kind='outbox' which was dead code (the dispatcher's outbox drain is
  // hardcoded to the extraction agent — MK never ran). Migrate any existing
  // outbox row for this agent to kind='sweep' with config.role='memory_keeper'
  // so the new sweep-memory-keeper.ts driver picks it up. Guarded on
  // kind='outbox' so the UPDATE is a no-op on fresh post-T1.4 rows; safe to
  // run on every ensureRole call (idempotent).
  if (!inserted && role.key === "memory_keeper") {
    await db
      .update(aoaAgentTriggers)
      .set({
        kind: "sweep",
        config: { role: "memory_keeper" },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(aoaAgentTriggers.agentId, agentId),
          eq(aoaAgentTriggers.kind, "outbox"),
        ),
      );
  }

  // D2 idempotent backfill: merge toolAllowlist into existing row's runtimeConfig.
  // P1-B backfill: upgrade adapter_type='process' (no command) rows to the
  // resolved CLI adapter — these rows are unrunnable until upgraded.
  if (!inserted) {
    const rc = existingRc ?? {};
    const aoaCfg = (rc.aoa as Record<string, unknown>) ?? {};
    const updates: Record<string, unknown> = {};

    if (!Array.isArray(aoaCfg.toolAllowlist)) {
      updates.runtimeConfig = {
        ...rc,
        aoa: { ...aoaCfg, toolAllowlist },
      };
    }

    const [current] = await db
      .select({ adapterType: agents.adapterType, adapterConfig: agents.adapterConfig })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    if (current && needsAdapterBackfill(current.adapterType, current.adapterConfig as Record<string, unknown> | null)) {
      updates.adapterType = crewAdapter.adapterType;
      updates.adapterConfig = mergeAdapterConfig(current.adapterConfig as Record<string, unknown> | null, crewAdapter.adapterConfig);
    }

    if (Object.keys(updates).length > 0) {
      await db.update(agents)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(agents.id, agentId));
    }
  }

  // P1.6: seed the role's editable instruction bundle (idempotent; never clobbers
  // founder edits). Non-fatal: seeding failure must not block role provisioning.
  try {
    const row = await db
      .select({ id: agents.id, companyId: agents.companyId, name: agents.name, adapterConfig: agents.adapterConfig })
      .from(agents)
      .where(eq(agents.id, agentId))
      .then((r: { id: string; companyId: string; name: string; adapterConfig: Record<string, unknown> | null }[]) => r[0]);
    if (row) {
      const nextAdapterConfig = await seedRoleInstructionBundle({
        role: role.key,
        agent: { id: row.id, companyId: row.companyId, name: row.name, adapterConfig: row.adapterConfig },
        service: agentInstructionsService(),
      });
      await db.update(agents).set({ adapterConfig: nextAdapterConfig, updatedAt: new Date() }).where(eq(agents.id, agentId));
    }
  } catch {
    /* non-fatal — runner falls back to the instruction string */
  }

  return agentId;
}

/**
 * Idempotently seed all four Command Staff roles for a company.
 * Call this from the company bootstrap path alongside ensureCommanderAgent
 * and ensureExtractionAgent.
 */
export async function ensureCommandStaff(db: Db, companyId: string): Promise<void> {
  for (const role of COMMAND_STAFF_ROLES) {
    await ensureRole(db, companyId, role);
  }
}

/**
 * Locked decisions #15/#16/#52: crew may only PROPOSE memory (status 'pending').
 * The founder (or team_lead for active_context) approves. Agents never write
 * identity/domain directly.
 *
 * Wire this into any code path that processes a crew memory write request.
 */
export function assertCrewMemoryWrite(item: { layer: string; status: string }): void {
  if (item.status !== "pending") {
    throw new Error(
      `Crew may only propose memory (status 'pending'); refused status '${item.status}' for layer '${item.layer}'`,
    );
  }
}
