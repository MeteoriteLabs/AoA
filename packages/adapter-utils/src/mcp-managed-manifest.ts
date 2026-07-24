import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Ownership manifest for the JSON-config MCP writers (opencode, gemini).
 *
 * ── THE PROBLEM (Plan 2b B5) ────────────────────────────────────────────────
 * Both JSON writers used to remove exactly one key — the bridge's
 * (`delete existingMcp[serverName]`) — and splice it back. That is fine for a
 * single fixed name, but external connectors are a SET that changes between
 * runs. When a founder deletes or disables a connector, the next run simply
 * stops writing it — and the entry a PREVIOUS run wrote stays in the file
 * forever. The agent keeps being offered a revoked connector. These files
 * persist (unlike claude's per-run tmpdir, which is unlinked on cleanup), so
 * nothing else cleans them up.
 *
 * Sweeping requires knowing which entries AoA owns. codex solves this with
 * sentinel COMMENT fences around its managed region. JSON has no comments.
 *
 * ── OPTIONS CONSIDERED ──────────────────────────────────────────────────────
 *  (a) In-file manifest key, e.g. a top-level `"$aoaManagedMcpServers": [...]`.
 *      REJECTED — empirically fatal. opencode validates its whole config and
 *      REFUSES unknown top-level keys:
 *
 *          $ opencode mcp list
 *          Error: Configuration is invalid at .../opencode.json
 *          ↳ Unrecognized key: $aoaManagedMcpServers
 *
 *      An invalid config does not degrade gracefully: opencode loads NO MCP
 *      servers at all, so AoA's own bridge dies with it and the agent silently
 *      runs toolless — the exact failure this whole workstream exists to close.
 *
 *  (b) Marker nested INSIDE each server entry (`mcp.<name>.aoaManaged = true`).
 *      REJECTED. opencode does tolerate this today (probed: the entry loads and
 *      `mcp list` connects), but that leniency is an unspecified upstream
 *      implementation detail of one zod schema, not a contract. The day
 *      opencode tightens it, we land in failure (a) — total MCP loss on every
 *      AoA opencode run. gemini's tolerance was NOT verifiable here at all (its
 *      startup hits an auth wall before config load can be observed), so this
 *      option would ship an unverified assumption to a second CLI.
 *
 *  (c) Name prefixing (`aoa-<connector>`). REJECTED — the server name is the
 *      connector's identity and shows up in tool names; renaming it here would
 *      make the same connector address differently on different adapters.
 *
 *  (d) SIDECAR manifest file — CHOSEN.
 *
 * ── THE TRADEOFF ACCEPTED ───────────────────────────────────────────────────
 * A sidecar sits entirely outside the CLI's schema surface, so it CANNOT break
 * the CLI, and correctness does not depend on any unverified upstream leniency.
 * That is the property worth buying, given the blast radius of being wrong.
 *
 * What we pay for it:
 *  1. One extra file next to the config (opencode: the agent cwd, often a real
 *     repo — the plan already tracks `opencode.json` pollution there; gemini:
 *     inside the AoA-created `.gemini/`). Dot-prefixed to stay out of the way.
 *  2. Two files that can DESYNC, because two writes are not one atomic unit.
 *     The failure is bounded by write ORDER: the manifest is written AFTER the
 *     config, so a crash in between leaves a manifest that under-claims. An
 *     under-claiming manifest degrades to today's behaviour (a stale entry
 *     survives one more sweep); an over-claiming one could delete a key AoA
 *     never wrote. Given constraint "never delete a user's entry", leaking a
 *     stale entry is strictly the safer direction, so the order is deliberate.
 *  3. If a user deletes the sidecar, the sweep forgets what it owned and stale
 *     entries persist — again, degrades to today's behaviour, never to data
 *     loss.
 *
 * ── SAFETY INVARIANT ────────────────────────────────────────────────────────
 * The sweep removes ONLY names this module recorded, i.e. names AoA itself
 * wrote on a previous run. A key AoA has never written is never touched, so a
 * user's hand-added server survives every sweep. (A user who hand-adds a server
 * whose name AoA previously managed does lose it — indistinguishable from our
 * own stale entry, and the same "AoA owns names it wrote" rule the codex fence
 * applies.)
 */

/**
 * Sidecar filename. This is a PERSISTED ON-DISK CONTRACT: renaming it orphans
 * every already-written manifest, and the entries they describe would never be
 * swept again.
 */
export const AOA_MCP_MANIFEST_FILENAME = ".aoa-mcp-managed.json";

interface ManifestShape {
  /** Server names AoA wrote into the sibling config on the last run. */
  managedServerNames?: unknown;
}

/**
 * Read the server names a previous run recorded as AoA-owned in `dir`.
 *
 * Every failure mode — missing file, unreadable file, malformed JSON, wrong
 * value shape — returns `[]`. That means "sweep nothing", which leaves stale
 * entries in place. Deliberate: the alternative (guessing) can only ever delete
 * a user's data, and a stale entry is recoverable on the next healthy run.
 */
export async function readAoaManagedServerNames(dir: string): Promise<string[]> {
  try {
    const text = await fs.readFile(path.join(dir, AOA_MCP_MANIFEST_FILENAME), "utf8");
    const parsed = JSON.parse(text) as ManifestShape | null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const names = parsed.managedServerNames;
    if (!Array.isArray(names)) return [];
    return names.filter((n): n is string => typeof n === "string");
  } catch {
    return [];
  }
}

/**
 * Record the server names AoA owns in `dir`, replacing any previous record.
 *
 * Names are sorted and de-duplicated so the file is byte-identical across runs
 * with the same connector set (the writers' idempotence contract extends here —
 * a churning sidecar would show up as repo noise on every single run).
 *
 * Written atomically (temp + rename) for the same reason the configs are: a
 * torn manifest read back as malformed JSON would silently disable sweeping.
 */
export async function writeAoaManagedServerNames(
  dir: string,
  names: readonly string[],
): Promise<void> {
  const target = path.join(dir, AOA_MCP_MANIFEST_FILENAME);
  const unique = Array.from(new Set(names)).sort();
  const body = `${JSON.stringify({ managedServerNames: unique }, null, 2)}\n`;

  const tempPath = path.join(
    dir,
    `${AOA_MCP_MANIFEST_FILENAME}.tmp-${process.pid}-${randomUUID()}`,
  );
  await fs.writeFile(tempPath, body, "utf8");
  try {
    await renameWithRetry(tempPath, target);
  } catch (err) {
    await fs.unlink(tempPath).catch(() => {});
    throw err;
  }
}

/**
 * Remove every previously-AoA-managed key from a destination map of MCP server
 * entries, returning a NULL-PROTOTYPE copy of the survivors (the user's own
 * entries plus anything AoA never claimed).
 *
 * Null prototype is load-bearing, not defensive habit: these keys are untrusted
 * connector names from DB rows, and callers go on to assign more names into
 * this map. Assigning `__proto__` onto a normal object literal replaces the
 * prototype instead of creating a key — the server silently vanishes and every
 * unknown name then reads through to the attacker's entry. `JSON.parse` gives
 * `__proto__` as a plain own property, so such a key genuinely can arrive here
 * from an existing config file.
 */
export function sweepAoaManagedEntries<T>(
  existingEntries: Record<string, T>,
  previouslyManaged: readonly string[],
): Record<string, T> {
  const managed = new Set(previouslyManaged);
  const out: Record<string, T> = Object.create(null);
  for (const [name, value] of Object.entries(existingEntries)) {
    if (managed.has(name)) continue;
    out[name] = value;
  }
  return out;
}

/**
 * fs.rename() with a small retry budget for the Windows EPERM/EBUSY case where
 * the destination is briefly locked by a concurrent rename in flight. Same
 * contract as the copies inside the opencode and gemini writers — POSIX
 * rename(2) is atomic and never throws these codes for a same-fs move, so on
 * Linux/macOS this loop always exits on attempt 1.
 */
async function renameWithRetry(src: string, dst: string, maxAttempts = 10): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await fs.rename(src, dst);
      return;
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") throw err;
      await new Promise((r) => setTimeout(r, 5 + Math.random() * 10));
    }
  }
  throw lastErr;
}
