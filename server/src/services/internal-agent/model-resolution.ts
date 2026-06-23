/**
 * Generalized model resolution for all adapter types (Unit B core).
 * Reuses the proven helpers from codex-model.ts for shell-safety validation
 * and Codex-specific compatibility checks.
 *
 * See docs/aoa/plans/ Phase 1 provider-switching engine.
 */
import {
  isShellSafeModel,
  isCodexCompatibleModel,
  resolveCodexChatModel,
} from "./codex-model.js";

export class ShellUnsafeModelError extends Error {
  constructor(model: string) {
    super(`Unsafe model identifier: ${JSON.stringify(model)}`);
    this.name = "ShellUnsafeModelError";
  }
}

export interface ResolveModelStatus {
  authMode: "subscription" | "chatgpt" | "apikey" | "unknown";
  defaultModelResolved: string | null;
}

export interface ResolvedModel {
  model?: string;
  omitModelFlag: boolean;
  note?: string;
}

/**
 * Resolve the model identifier to pass to an adapter's CLI invocation.
 *
 * Tier order:
 *   1. Shell-safety gate — throws `ShellUnsafeModelError` for any non-empty
 *      model that contains shell-special characters. This is always first,
 *      regardless of adapter.
 *   2. Adapter-specific logic:
 *      - `codex_local`: delegates to `resolveCodexChatModel` (validates
 *        compatibility, falls back to gpt-5.5).
 *      - `gemini_local`: "auto" (or empty) → omit the model flag entirely so
 *        Gemini CLI applies its own default.
 *      - All others (claude_local, opencode_local, …): empty → omit; else
 *        pass through verbatim (adapter applies its own default when omitted).
 */
export function resolveModel(
  adapterType: string,
  requested: string | null | undefined,
  status: ResolveModelStatus,
): ResolvedModel {
  const m = (requested ?? "").trim();

  // Shell-safety is the unconditional first gate.
  if (m && !isShellSafeModel(m)) throw new ShellUnsafeModelError(m);

  if (adapterType === "codex_local") {
    // Reuse the proven Commander resolver: validates compatibility, falls back
    // to gpt-5.5. Pass null for empty so resolveCodexChatModel skips it.
    const resolved = resolveCodexChatModel(m || null, status.defaultModelResolved);
    const note =
      m && !isCodexCompatibleModel(m)
        ? `"${m}" is not supported on a ChatGPT Codex login; using ${resolved}.`
        : undefined;
    return { model: resolved, omitModelFlag: false, note };
  }

  if (adapterType === "gemini_local") {
    // Gemini CLI picks its own best model when no flag is passed; "auto" is
    // the canonical AoA signal for "let the CLI decide".
    return !m || m === "auto"
      ? { omitModelFlag: true }
      : { model: m, omitModelFlag: false };
  }

  // claude_local / opencode_local / openclaw / process / http / others:
  // empty → omit (adapter applies its own default); non-empty → pass through.
  return m ? { model: m, omitModelFlag: false } : { omitModelFlag: true };
}
