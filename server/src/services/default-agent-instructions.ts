import fs from "node:fs/promises";

const DEFAULT_AGENT_BUNDLE_FILES = {
  default: ["AGENTS.md"],
  cxo: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
  lead: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
  commander: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
  // Threads crew (P1) — 4-file bundles, mirrors commander.
  router: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
  planner: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
  dispatcher: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
  memory_keeper: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
  scribe: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
} as const;

type DefaultAgentBundleRole = keyof typeof DEFAULT_AGENT_BUNDLE_FILES;

const DEFAULT_AGENT_BUNDLE_DIRS: Record<DefaultAgentBundleRole, string> = {
  default: "default",
  cxo: "cxo",
  lead: "lead",
  commander: "commander",
  router: "router",
  planner: "planner",
  dispatcher: "dispatcher",
  memory_keeper: "memory_keeper",
  scribe: "scribe",
};

function resolveDefaultAgentBundleUrl(role: DefaultAgentBundleRole, fileName: string) {
  const dir = DEFAULT_AGENT_BUNDLE_DIRS[role];
  return new URL(`../onboarding-assets/${dir}/${fileName}`, import.meta.url);
}

export async function loadDefaultAgentInstructionsBundle(role: DefaultAgentBundleRole): Promise<Record<string, string>> {
  const fileNames = DEFAULT_AGENT_BUNDLE_FILES[role];
  const entries = await Promise.all(
    fileNames.map(async (fileName) => {
      const content = await fs.readFile(resolveDefaultAgentBundleUrl(role, fileName), "utf8");
      return [fileName, content] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * Map an agent's free-form `role` string to the bundle dir it should load.
 *
 * - `cxo`  → 4-file Executive bundle (`onboarding-assets/cxo/`)
 * - `lead` → 4-file Lead bundle (`onboarding-assets/lead/`)
 * - anything else (`general`, legacy `ceo`/`cto`/etc., empty string) → single
 *   `onboarding-assets/default/AGENTS.md`. The defensive fallback keeps old
 *   bundle imports and any orphan role values from breaking agent boot.
 */
export function resolveDefaultAgentInstructionsBundleRole(role: string): DefaultAgentBundleRole {
  if (role === "cxo") return "cxo";
  if (role === "lead") return "lead";
  return "default";
}
