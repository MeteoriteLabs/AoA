interface RuntimeSkillEntry { key: string; name: string; markdown: string; trustLevel?: string; }
interface BuildArgs {
  companyId: string;
  agentId: string;
  resolve: (companyId: string, agentId: string) => Promise<RuntimeSkillEntry[]>;
  maxChars?: number;
}

/**
 * Build a "## Skills" prompt section from the agent's resolved skills.
 * Inlined into the assembled prompt (the chat path has no skillsDir/cwd
 * plumbing; inlining is adapter-uniform and keeps the spawn byte-stable).
 * Any resolution failure → empty string (never blocks the turn).
 */
export async function buildSkillsSection(args: BuildArgs): Promise<string> {
  try {
    const entries = await args.resolve(args.companyId, args.agentId);
    if (!entries || entries.length === 0) return "";
    const cap = args.maxChars ?? 12000;
    let body = "";
    for (const e of entries) {
      const block = `### ${e.name}\n${e.markdown}\n`;
      if (body.length + block.length > cap) break;
      body += block;
    }
    return body.trim() ? `## Skills\n${body.trim()}` : "";
  } catch {
    return "";
  }
}
