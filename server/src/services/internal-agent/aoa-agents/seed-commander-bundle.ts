import fs from "node:fs/promises";
import path from "node:path";
import { loadDefaultAgentInstructionsBundle } from "../../default-agent-instructions.js";

// adapterConfig typed as `unknown` to match AgentLike in agent-instructions.ts (contravariance).
type SeedAgentShape = { id: string; companyId: string; name: string; adapterConfig: unknown };

interface SeedRoleArgs {
  /** Bundle role key — must be registered in default-agent-instructions.ts.
   *  Phase D batch 1: `navigator` is the new key for the role formerly known
   *  as `router`. Both are accepted while the rename rolls out. `engineer`
   *  replaces `maker`; `scout` is net-new. */
  role:
    | "commander"
    | "router"
    | "navigator"
    | "planner"
    | "dispatcher"
    | "memory_keeper"
    | "scribe"
    | "adjutant"
    | "maker"
    | "engineer"
    | "scout";
  agent: { id: string; companyId: string; name: string; adapterConfig: Record<string, unknown> | null };
  // Injected for testability. The real implementation passes agentInstructionsService() with
  // ensureWritableBundle aliased from ensureManagedBundle (see ensure-commander.ts).
  service: { ensureWritableBundle: (agent: SeedAgentShape, opts?: { clearLegacyPromptTemplate?: boolean }) => Promise<{ adapterConfig: Record<string, unknown>; state: { rootPath?: string | null; entryFile: string } }> };
}

/**
 * Idempotently seed a role's instruction bundle. Provisions a managed writable
 * bundle root via ensureWritableBundle, then writes each default file ONLY if it
 * does not already exist (never clobbers founder edits). Returns the adapterConfig
 * to persist on the agents row so the bundle is linked.
 */
export async function seedRoleInstructionBundle(args: SeedRoleArgs): Promise<Record<string, unknown>> {
  const { role, agent, service } = args;
  const { adapterConfig, state } = await service.ensureWritableBundle(agent, { clearLegacyPromptTemplate: true });
  const root = state.rootPath;
  if (!root) return adapterConfig;
  const files = await loadDefaultAgentInstructionsBundle(role);
  await fs.mkdir(root, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const dest = path.join(root, name);
    const exists = await fs.stat(dest).then((s) => s.isFile()).catch(() => false);
    if (!exists) await fs.writeFile(dest, content, "utf8");
  }
  return adapterConfig;
}

/** Back-compat wrapper — delegates to seedRoleInstructionBundle with role='commander'. */
export async function seedCommanderInstructionBundle(args: {
  agent: { id: string; companyId: string; name: string; adapterConfig: Record<string, unknown> | null };
  service: SeedRoleArgs["service"];
}): Promise<Record<string, unknown>> {
  return seedRoleInstructionBundle({ role: "commander", agent: args.agent, service: args.service });
}
