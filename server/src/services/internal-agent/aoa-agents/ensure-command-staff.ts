import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents, aoaAgentTriggers } from "@armyofagents/db";
import { seedRoleInstructionBundle } from "./seed-commander-bundle.js";
import { agentInstructionsService } from "../../agent-instructions.js";

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
  { key: "memory_keeper", name: "Memory Keeper", trigger: "outbox" },
] as const;

export type CommandStaffRoleKey = (typeof COMMAND_STAFF_ROLES)[number]["key"];

/** Per-role tool allowlist. Decisions #15/#16/#52: no direct memory writes for crew. */
export function roleToolAllowlist(role: CommandStaffRoleKey): string[] {
  switch (role) {
    case "router":
      return ["search_discussions", "query_departments"];
    case "planner":
      return ["search_discussions", "query_tasks", "query_dependency_chain"];
    case "dispatcher":
      return ["create_task", "assign_task", "add_task_dependency", "wakeup_agent", "query_agents"];
    case "memory_keeper":
      return ["suggest_memory", "find_similar_memory", "detect_conflicts"];
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

  // Atomic insert with ON CONFLICT DO NOTHING (agents_aoa_name_per_company_idx).
  const [inserted] = await db
    .insert(agents)
    .values({
      companyId,
      name: role.name,
      kind: "aoa",
      role: "general",
      status: "idle",
      adapterType: "process",
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

  // D2 idempotent backfill: merge toolAllowlist into existing row's runtimeConfig
  // so pre-D2 rows aren't stranded by default-deny.
  if (!inserted) {
    const rc = existingRc ?? {};
    const aoaCfg = (rc.aoa as Record<string, unknown>) ?? {};
    if (!Array.isArray(aoaCfg.toolAllowlist)) {
      const updatedRc = {
        ...rc,
        aoa: { ...aoaCfg, toolAllowlist },
      };
      await db.update(agents)
        .set({ runtimeConfig: updatedRc, updatedAt: new Date() })
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
