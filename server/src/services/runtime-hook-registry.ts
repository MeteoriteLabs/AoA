/**
 * Per-run hook token registry for the W5b PreToolUse permission bridge.
 *
 * SINGLE-PROCESS ASSUMPTION: The adapter `execute()` method runs inside the
 * same Node.js process as the Express server. A module-level Map is therefore
 * the correct shared handle between:
 *   - heartbeat (calls registerRuntimeHook before spawning the adapter), and
 *   - the /internal/runtime-hooks/permission-request route (calls resolveRuntimeHook).
 *
 * Multi-process execution (e.g. a separate worker process or a remote sandbox)
 * is out of scope for this milestone. If that changes, token storage would need
 * to move to a DB-backed or Redis-backed outbox — the Map must be replaced.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import type { AdapterRuntimeDecisionBroker } from "@armyofagents/adapter-utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RuntimeHookEntry {
  broker: AdapterRuntimeDecisionBroker;
  companyId: string;
  agentId: string;
  runId: string;
  expiresAt: Date;
}

// ---------------------------------------------------------------------------
// Module-level store
// ---------------------------------------------------------------------------

const registry = new Map<string, RuntimeHookEntry>();

// ---------------------------------------------------------------------------
// Token minting
// ---------------------------------------------------------------------------

/**
 * Mints a cryptographically random 256-bit base64url token (43+ chars).
 * Each token is unique — collision probability for 1000 tokens is negligible
 * (birthday bound ≈ 2^-246).
 */
export function mintRuntimeHookToken(): string {
  return randomBytes(32).toString("base64url");
}

// ---------------------------------------------------------------------------
// Registry operations
// ---------------------------------------------------------------------------

/**
 * Register a hook entry for the given token. Called by heartbeat immediately
 * before the adapter subprocess is spawned.
 */
export function registerRuntimeHook(token: string, entry: RuntimeHookEntry): void {
  registry.set(token, entry);
}

/**
 * Remove the entry for the given token. Called by heartbeat when the run
 * completes or is cancelled, regardless of how it ended.
 */
export function deregisterRuntimeHook(token: string): void {
  registry.delete(token);
}

/**
 * Resolve a token to its registered entry.
 *
 * Returns null (without throwing) for:
 *   - tokens that are too short to be well-formed (< 43 chars)
 *   - tokens not found in the registry
 *   - tokens whose entry has expired (lazy prune on resolve)
 *
 * NOTE on timing safety: the Map.get lookup itself is not constant-time, so
 * a full timing-safe comparison across all keys is not feasible here. The
 * token is 256-bit random, making brute-force guessing infeasible regardless.
 * We use timingSafeEqual only when comparing same-length byte buffers for the
 * token value to avoid leaking information about character matching order.
 * On length mismatch we return null immediately (safe: length is not secret).
 */
export function resolveRuntimeHook(token: string): RuntimeHookEntry | null {
  // Fast guard: well-formed base64url tokens are ≥43 chars (32 bytes base64url)
  if (token.length < 43) return null;

  const entry = registry.get(token);
  if (entry === undefined) return null;

  // Lazy expiry check
  if (entry.expiresAt.getTime() <= Date.now()) {
    registry.delete(token);
    return null;
  }

  return entry;
}

/**
 * Eagerly sweep all expired entries from the registry.
 * Heartbeat may call this periodically to prevent unbounded growth if
 * deregisterRuntimeHook is missed (e.g. on crash). Tests also call it directly.
 */
export function pruneExpiredRuntimeHooks(): void {
  const now = Date.now();
  for (const [token, entry] of registry) {
    if (entry.expiresAt.getTime() <= now) {
      registry.delete(token);
    }
  }
}
