import { createToolRegistry } from "./tool-registry.js";
import type { AgentTool, ToolCategory } from "./types.js";
// Build MCP-surface entries from the EXPORTED TOOL_DEFINITIONS (the authoritative
// schema list). Category is derived from the EXPORTED family handler maps.
// NOTE: askFounderToolHandlers is NOT re-exported from mcp/tools/index.ts — do not
// import it (it won't compile). The single ask_founder tool is categorized by name.
import {
  TOOL_DEFINITIONS,
  readToolHandlers,
  writeToolHandlers,
  documentToolHandlers,
  approvalToolHandlers,
  skillToolHandlers,
} from "../../mcp/tools/index.js";

export type ToolSurface = "commander" | "mcp";
export type ReadWrite = "read" | "write";

export interface ToolManifestEntry {
  name: string;
  surface: ToolSurface;
  category: string;
  readWrite: ReadWrite;
  requiredRole: "founder" | "team_lead" | "team_member" | null;
  description: string;
  /** Reserved for cross-surface mapping (scope §5 WS-0). Always null in R1. */
  mcpAlias: string | null;
}

// Commander write-signal rule (deterministic from registry fields):
//   write iff category ∈ {action, workflow, discussion} OR requiresConfirmation.
//   else read. Advisory metadata for the cheat-sheet — real gating lives in
//   authorize-tool.ts, so an approximate-but-deterministic rule is acceptable.
const COMMANDER_WRITE_CATEGORIES: ReadonlySet<ToolCategory> = new Set([
  "action",
  "workflow",
  "discussion",
]);

function commanderReadWrite(tool: AgentTool): ReadWrite {
  if (COMMANDER_WRITE_CATEGORIES.has(tool.category)) return "write";
  return tool.requiresConfirmation ? "write" : "read";
}

function mcpCategory(name: string): string {
  if (name in readToolHandlers) return "read";
  if (name in writeToolHandlers) return "write";
  if (name in documentToolHandlers) return "document";
  if (name in approvalToolHandlers) return "approval";
  if (name in skillToolHandlers) return "skill";
  if (name === "ask_founder") return "ask"; // askFounderToolHandlers is not exported
  return "other";
}

// MCP write-signal heuristic (advisory; scope §5 WS-0 marks MCP fields
// "reserved"). read iff family=read OR name is a getter/list; else write.
function mcpReadWrite(name: string, category: string): ReadWrite {
  if (category === "read") return "read";
  if (/^(list-|get-)/.test(name) || name === "me") return "read";
  return "write";
}

export function buildToolManifest(): ToolManifestEntry[] {
  const commander: ToolManifestEntry[] = createToolRegistry().map((tool) => ({
    name: tool.name,
    surface: "commander",
    category: tool.category,
    readWrite: commanderReadWrite(tool),
    requiredRole: tool.requiredRole ?? null,
    description: tool.description,
    mcpAlias: null,
  }));

  const mcp: ToolManifestEntry[] = TOOL_DEFINITIONS.map((def) => {
    const category = mcpCategory(def.name);
    return {
      name: def.name,
      surface: "mcp",
      category,
      readWrite: mcpReadWrite(def.name, category),
      requiredRole: null,
      description: def.description,
      mcpAlias: null,
    };
  });

  // Stable ordering so serialization is deterministic (drift gate depends on it).
  return [...commander, ...mcp].sort((a, b) =>
    a.surface === b.surface
      ? a.name.localeCompare(b.name)
      : a.surface.localeCompare(b.surface),
  );
}

export function serializeToolManifest(entries: ToolManifestEntry[]): string {
  return (
    JSON.stringify(
      {
        $generated:
          "DO NOT EDIT — run `pnpm gen:tools`. Source: createToolRegistry() + mcp TOOL_DEFINITIONS.",
        version: 1,
        tools: entries,
      },
      null,
      2,
    ) + "\n"
  );
}
