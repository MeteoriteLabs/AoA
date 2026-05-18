import fs from "node:fs/promises";
import path from "node:path";
import { loadDefaultAgentInstructionsBundle } from "../../default-agent-instructions.js";

interface SeedArgs {
  agent: { id: string; companyId: string; name: string; adapterConfig: Record<string, unknown> | null };
  // agentInstructionsService() instance (no-arg factory); injected for testability.
  service: { ensureWritableBundle: (agent: unknown, opts?: { clearLegacyPromptTemplate?: boolean }) => Promise<{ adapterConfig: Record<string, unknown>; state: { rootPath?: string | null; entryFile: string } }> };
}

/**
 * Idempotently seed the Commander instruction bundle. Provisions a managed
 * bundle root via ensureWritableBundle, then writes each default commander
 * file ONLY if it does not already exist (never clobbers user edits — the
 * back-fill/idempotency requirement). Returns the adapterConfig to persist
 * on the agents row so the bundle is linked.
 */
export async function seedCommanderInstructionBundle(args: SeedArgs): Promise<Record<string, unknown>> {
  const { agent, service } = args;
  const { adapterConfig, state } = await service.ensureWritableBundle(agent, { clearLegacyPromptTemplate: true });
  const root = state.rootPath;
  if (!root) return adapterConfig;
  const files = await loadDefaultAgentInstructionsBundle("commander");
  await fs.mkdir(root, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const dest = path.join(root, name);
    const exists = await fs.stat(dest).then((s) => s.isFile()).catch(() => false);
    if (!exists) await fs.writeFile(dest, content, "utf8");
  }
  return adapterConfig;
}
