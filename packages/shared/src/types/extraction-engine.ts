/**
 * Shared types for the extraction engine-status probe.
 * Consumed by the GET /companies/:cid/extraction/engine-status route (server)
 * and the LLMProvidersSection / UI engine-status display (frontend).
 */

/** Which engine is active for discussion extraction. */
export type ExtractionEngineStatus = "cli" | "api" | "none";

/** CLI probe result embedded in the status response. */
export interface ExtractionEngineCliStatus {
  /** Whether the CLI binary was found on PATH. */
  available: boolean;
  /** The CLI tool key that was probed (e.g. "claude_cli", "codex"). */
  tool: string;
}

/**
 * Response body for GET /companies/:cid/extraction/engine-status.
 *
 * engine:  "cli"  — local CLI binary is available (keyless).
 *          "api"  — no CLI but a hosted provider key is configured.
 *          "none" — neither; extraction will fail until one is set up.
 * cli:     raw probe result (always present; available=false when no binary).
 * apiKey:  true when at least one hosted provider key is reachable.
 */
export interface ExtractionEngineStatusResponse {
  engine: ExtractionEngineStatus;
  cli: ExtractionEngineCliStatus;
  apiKey: boolean;
}
