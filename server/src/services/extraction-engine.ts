/**
 * Extraction ENGINE ROUTER.
 *
 * Decides — BEFORE any hosted-key precheck — whether a discussion entry should
 * be extracted via a local CLI (`claude` / `codex`, keyless) or a hosted API
 * provider (`anthropic` / `openai`, key-gated).
 *
 * This is the P0 that makes keyless extraction actually run. The legacy
 * `extractFromDiscussionEntry` path used to `resolveAvailableProvider` FIRST and
 * mark the entry `skipped` when no hosted key resolved — which meant a keyless
 * CLI path could never fire. The fix: choose the engine first; the CLI engine
 * bypasses provider resolution entirely.
 *
 * AUTO resolution order:
 *   1. If a CLI is available (binary on PATH, probed via `detectCliTool`) → "cli".
 *   2. Else if a hosted provider key is configured → "api".
 *   3. Else throw (no extraction engine at all).
 *
 * The `opts` injection points (`cliAvailable`, `apiKey`) let unit tests drive
 * the decision without real binaries or keys.
 */

import { eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { internalAgentConfig } from "@armyofagents/db";
import { detectCliTool } from "./internal-agent/cli-mode.js";
import { resolveAvailableProvider } from "./internal-agent/providers/index.js";

/** Engines the router can select. */
export type ExtractionEngine = "cli" | "api";

/** Default CLI tool when a company has no configured Commander CLI tool. */
export const DEFAULT_EXTRACTION_CLI_TOOL = "claude_cli";

/**
 * CLI tools that the one-shot extractor (`extraction-cli.ts`) can actually
 * drive — i.e. have a real extractor implementation. `detectCliTool` also
 * recognizes `opencode` (and future tools) for Commander CHAT, but
 * `extractViaCli` has no extractor for them. Without this allow-list an
 * opencode-configured company would resolve to "cli", then every extraction
 * would throw "Unsupported CLI tool" AND the hosted-API fallback would be
 * skipped (engine already committed to "cli"). Keep this in sync with
 * `extraction-cli.ts`'s CLI_BINARY_MAP.
 */
export const EXTRACTION_SUPPORTED_CLI_TOOLS = new Set([
  "claude_cli",
  "claude",
  "codex",
]);

export interface ProbeExtractionCliResult {
  available: boolean;
  /** The CLI tool key that was probed (e.g. "claude_cli", "codex"). */
  tool: string;
  error?: string;
}

/**
 * Resolve the CLI tool a company would use for extraction. Reuses the
 * Commander CLI tool hint (`internal_agent_config.cliTool`) when present,
 * falling back to the keyless default (`claude_cli`).
 */
export async function resolveCompanyCliTool(
  db: Db,
  companyId: string,
): Promise<string> {
  const [config] = await db
    .select({ cliTool: internalAgentConfig.cliTool })
    .from(internalAgentConfig)
    .where(eq(internalAgentConfig.companyId, companyId));

  return config?.cliTool ?? DEFAULT_EXTRACTION_CLI_TOOL;
}

/**
 * Probe whether the configured extraction CLI binary is on PATH.
 *
 * Reuses `detectCliTool` (the same PATH-detection the Commander chat path uses)
 * so the two transports agree on what "available" means.
 *
 * @param cliTool  CLI tool key (e.g. "claude_cli", "codex"). Defaults to
 *                 `DEFAULT_EXTRACTION_CLI_TOOL` when omitted.
 */
export async function probeExtractionCli(
  cliTool: string = DEFAULT_EXTRACTION_CLI_TOOL,
): Promise<ProbeExtractionCliResult> {
  const detection = await detectCliTool(cliTool);
  return {
    available: detection.available,
    tool: cliTool,
    error: detection.error,
  };
}

export interface ResolveExtractionEngineOptions {
  /**
   * Inject CLI availability (skips the real PATH probe). When set, the router
   * uses this value verbatim instead of calling `probeExtractionCli`.
   */
  cliAvailable?: boolean;
  /**
   * Inject hosted-key availability (skips the real provider resolution). When
   * set, the router uses this value verbatim instead of calling
   * `resolveAvailableProvider`.
   */
  apiKey?: boolean;
}

/**
 * AUTO-resolve the extraction engine for a company.
 *
 *   1. Determine the company's configured CLI tool (Commander hint, else default).
 *   2. If a CLI is available → "cli".
 *   3. Else if a hosted provider key is configured → "api".
 *   4. Else throw (message matches /no extraction engine/i) guiding the user to
 *      install a CLI + `claude login`, or set a key in Settings → LLM Providers.
 *
 * Test injection: `opts.cliAvailable` / `opts.apiKey` short-circuit the real
 * probes so unit tests can drive the decision without binaries or keys.
 */
export async function resolveExtractionEngine(
  db: Db,
  companyId: string,
  opts: ResolveExtractionEngineOptions = {},
): Promise<ExtractionEngine> {
  // 1. CLI availability — injected for tests, else a real PATH probe.
  let cliAvailable: boolean;
  if (opts.cliAvailable !== undefined) {
    cliAvailable = opts.cliAvailable;
  } else {
    const cliTool = await resolveCompanyCliTool(db, companyId);
    // Only probe CLIs that extraction can actually drive. An unsupported
    // extraction CLI (e.g. opencode, which detectCliTool recognizes for chat)
    // must NOT report available — otherwise we'd commit to "cli" and skip the
    // hosted-API fallback, then fail every extraction. Treat it as unavailable
    // so resolution falls through to "api" (or the no-engine guidance).
    if (!EXTRACTION_SUPPORTED_CLI_TOOLS.has(cliTool)) {
      cliAvailable = false;
    } else {
      const probe = await probeExtractionCli(cliTool);
      cliAvailable = probe.available;
    }
  }

  if (cliAvailable) {
    return "cli";
  }

  // 2. Hosted provider key — injected for tests, else a real resolution.
  let apiKeyAvailable: boolean;
  if (opts.apiKey !== undefined) {
    apiKeyAvailable = opts.apiKey;
  } else {
    try {
      await resolveAvailableProvider(db, companyId);
      apiKeyAvailable = true;
    } catch {
      apiKeyAvailable = false;
    }
  }

  if (apiKeyAvailable) {
    return "api";
  }

  // 3. Neither — there is no extraction engine at all.
  throw new Error(
    "No extraction engine available. Install a CLI (e.g. the Claude Code CLI) " +
      "and run its login flow (`claude login`), or set a provider key in " +
      "Settings → LLM Providers.",
  );
}
