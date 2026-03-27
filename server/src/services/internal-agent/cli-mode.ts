import { execSync } from "node:child_process";
import { platform } from "node:os";
import type { AgentTool } from "./types.js";
import type { AgentStreamChunk } from "./agent-loop.js";

// ── CLI Detection ─────────────────────────────────────────────────────────────

// Maps config values (from DB/constants) to binary names
const CLI_BINARY_MAP: Record<string, string> = {
  claude_cli: "claude",
  codex: "codex",
  opencode: "opencode",
};

export interface CLIDetectionResult {
  available: boolean;
  path?: string;
  error?: string;
}

export async function detectCliTool(tool: string): Promise<CLIDetectionResult> {
  const binary = CLI_BINARY_MAP[tool];
  if (!binary) {
    return {
      available: false,
      error: `Unsupported CLI tool: '${tool}'. Supported: ${Object.keys(CLI_BINARY_MAP).join(", ")}`,
    };
  }

  const cmd = platform() === "win32" ? `where ${binary}` : `which ${binary}`;

  try {
    const result = execSync(cmd, { encoding: "utf8", timeout: 5000 }).trim();
    const firstLine = result.split("\n")[0].trim();
    return { available: true, path: firstLine };
  } catch {
    return {
      available: false,
      error: `CLI tool '${tool}' (binary: '${binary}') not found in PATH. Install it or switch to API mode in Settings.`,
    };
  }
}

// ── MCP Config Builder ────────────────────────────────────────────────────────

interface McpConfigParams {
  companyId: string;
  userId: string;
  userRole: string;
  bridgeEntrypoint: string;
}

interface McpConfig {
  mcpServers: {
    aoa: {
      command: string;
      args: string[];
      env: Record<string, string>;
    };
  };
}

export function buildMcpConfig(params: McpConfigParams): McpConfig {
  return {
    mcpServers: {
      aoa: {
        command: "node",
        args: [params.bridgeEntrypoint],
        env: {
          AOA_SESSION_COMPANY_ID: params.companyId,
          AOA_SESSION_USER_ID: params.userId,
          AOA_SESSION_USER_ROLE: params.userRole,
          ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
        },
      },
    },
  };
}

export function toolToMcpFormat(tool: AgentTool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
  };
}

// ── Output Parsing ────────────────────────────────────────────────────────────

// Initial implementation: all stdout is treated as text content.
export function parseCliOutput(line: string): AgentStreamChunk[] {
  return [{ type: "text", delta: line }];
}
