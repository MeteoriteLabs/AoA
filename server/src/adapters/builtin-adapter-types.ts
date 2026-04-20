/**
 * Adapter types shipped with AoA. External plugins must not replace these.
 *
 * Ported from Paperclip (2026-04-20, Phase 0 Task 0.3). The set differs from
 * Paperclip's because AoA registers a different builtin lineup — in particular
 * AoA uses "openclaw" (not "openclaw_gateway"), has no "pi_local", and adds
 * three API adapters (claude_api, openai_api, gemini_api).
 */
export const BUILTIN_ADAPTER_TYPES = new Set([
  "claude_local",
  "codex_local",
  "cursor",
  "gemini_local",
  "openclaw",
  "opencode_local",
  "hermes_local",
  "process",
  "http",
  "claude_api",
  "openai_api",
  "gemini_api",
]);
