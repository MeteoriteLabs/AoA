const BUNDLE_ORDER = ["AGENTS.md", "SOUL.md", "TOOLS.md", "HEARTBEAT.md"] as const;

type CommanderAgentShape = { id: string; companyId: string; name: string; adapterConfig: Record<string, unknown> | null };

interface LoadArgs {
  agent: CommanderAgentShape;
  service: { readFile: (agent: CommanderAgentShape, relativePath: string) => Promise<{ content: string }> };
}

/**
 * Concatenate the Commander instruction bundle into one persona string
 * (AGENTS → SOUL → TOOLS → HEARTBEAT). Returns null if the bundle cannot be
 * read so the caller can fall back to the SYSTEM_INSTRUCTIONS constant.
 */
export async function loadCommanderPersona(args: LoadArgs): Promise<string | null> {
  const { agent, service } = args;
  try {
    const parts: string[] = [];
    for (const name of BUNDLE_ORDER) {
      const f = await service.readFile(agent, name).catch(() => null);
      if (f && f.content && f.content.trim().length > 0) parts.push(f.content);
    }
    if (parts.length === 0) return null;
    return parts.join("\n\n");
  } catch {
    return null;
  }
}
