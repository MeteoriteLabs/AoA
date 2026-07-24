import { z } from "zod";

/**
 * Schema for `connectors.json` — a SECOND CDN artifact, deliberately separate
 * from catalog.json.
 *
 * WHY SEPARATE: MarketplaceCatalogFileSchema.parse() rejects the WHOLE array on
 * one unknown `type` enum value, and the sync failure path preserves the previous
 * cache — so publishing a new item type silently freezes the catalog forever on
 * every older instance (server/src/services/aoa-marketplace.ts:107,116). Connectors
 * therefore never touch catalog.json. (Decision #96's `.strip()` covers unknown
 * FIELDS, not unknown ENUM VALUES.)
 *
 * SECRETS (D5): entries carry header/env template KEYS only — never a value, never
 * a placeholder. The founder binds a real secret after install.
 */

const SERVER_NAME_RE = /^[a-z0-9-]+$/;

// RFC 7230 §3.2.6 token charset for HTTP header field-names. Deliberately
// excludes `:` and whitespace — those are exactly what would let a "key" smuggle
// a `Name: value` pair (or a whole secret) past this schema and into the
// downstream TOML/JSON header-map writers (Plan 2b's codex `env_http_headers`).
// This keeps the docstring above ("Values never appear here") actually
// enforced, not just documented.
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

// POSIX environment-variable name charset. Deliberately excludes `=` and
// whitespace — those are exactly what would let a "key" smuggle a `NAME=value`
// pair (or a whole secret) past this schema and into downstream env-map
// writers. Same rationale as HEADER_NAME_RE above.
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Fail-closed: an entry with no trust block is community, never verified. */
export const McpConnectorTrustSchema = z
  .object({
    tier: z.enum(["verified", "community", "unverified"]).default("community"),
  })
  .default({ tier: "community" });

export const McpConnectorCatalogEntrySchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    serverName: z.string().regex(SERVER_NAME_RE),
    transport: z.enum(["http", "stdio"]),
    url: z.string().url().optional(),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).default([]),
    /**
     * Header NAMES this connector authenticates with. Values never appear here.
     * Constrained to the RFC 7230 token charset (no `:`, no whitespace) so this
     * field cannot smuggle a `Name: value` pair — or a bare credential — through
     * the catalog and into a downstream header-map writer.
     */
    headerTemplateKeys: z.array(z.string().regex(HEADER_NAME_RE)).default([]),
    /**
     * Env var NAMES a stdio server expects. Values never appear here.
     * Constrained to the POSIX env-name charset (no `=`, no whitespace) so this
     * field cannot smuggle a `NAME=value` pair — or a bare credential — through
     * the catalog and into a downstream env-map writer.
     */
    envTemplateKeys: z.array(z.string().regex(ENV_NAME_RE)).default([]),
    requiresSecret: z.boolean().default(false),
    secretLabel: z.string().max(200).optional(),
    docsUrl: z.string().url().optional(),
    trust: McpConnectorTrustSchema,
  })
  .strict()
  .superRefine((val, ctx) => {
    // Symmetric with server/src/routes/mcp-connectors.ts's BYO connector schema:
    // each transport requires its own field and forbids the other transport's
    // field, so the two error surfaces read consistently.
    if (val.transport === "http") {
      if (!val.url) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["url"],
          message: "http transport requires url",
        });
      }
      if (val.command !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["command"],
          message: "http transport forbids command",
        });
      }
    } else if (val.transport === "stdio") {
      if (!val.command) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["command"],
          message: "stdio transport requires command",
        });
      }
      if (val.url !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["url"],
          message: "stdio transport forbids url",
        });
      }
    }
  });

export type McpConnectorCatalogEntry = z.infer<typeof McpConnectorCatalogEntrySchema>;

/**
 * Parse PER ENTRY, dropping bad ones. This is the forward-compat property
 * catalog.json lacks: a future field or entry shape we do not understand costs
 * us that entry, never the whole file.
 *
 * This function never throws, for any input — that guarantee is the entire
 * point of this module, so callers (e.g. P3a-10's fetch+cache layer) can call
 * it directly on an untrusted CDN response body.
 *
 * Return shape: `{ entries, dropped, malformed }`.
 *
 * - `malformed` is `true` when the ENVELOPE itself could not be understood:
 *   `input` is not a non-null object, `entries` is absent, or `entries` is
 *   present but not an array. In this case `entries` and `dropped` are always
 *   `[]` — there was nothing to iterate.
 * - `malformed` is `false` whenever we successfully read an array out of
 *   `entries`, INCLUDING when that array is legitimately empty (`{ entries: [] }`
 *   yields `{ entries: [], dropped: [], malformed: false }`). A legitimately
 *   empty catalog and an unintelligible response are otherwise indistinguishable
 *   from `entries.length === 0` alone, which is exactly the ambiguity a cache
 *   layer must not paper over: `malformed: true` should keep serving the last
 *   known-good cache, while `malformed: false` (even with zero entries) is a
 *   real answer from the CDN and can replace it.
 * - Per-entry validation failures (an item that isn't a well-formed
 *   `McpConnectorCatalogEntry`) never set `malformed` — they are recorded in
 *   `dropped` by `id` (or `"<unidentified>"` when the item isn't an object or
 *   its `id` isn't a string), and parsing continues with the remaining items.
 */
export function parseMcpConnectorCatalog(input: unknown): {
  entries: McpConnectorCatalogEntry[];
  dropped: string[];
  malformed: boolean;
} {
  const entries: McpConnectorCatalogEntry[] = [];
  const dropped: string[] = [];

  if (typeof input !== "object" || input === null) {
    return { entries, dropped, malformed: true };
  }
  const raw = (input as { entries?: unknown }).entries;
  if (!Array.isArray(raw)) {
    return { entries, dropped, malformed: true };
  }

  for (const item of raw) {
    const parsed = McpConnectorCatalogEntrySchema.safeParse(item);
    if (parsed.success) {
      entries.push(parsed.data);
    } else {
      const id = typeof item === "object" && item !== null ? (item as { id?: unknown }).id : undefined;
      dropped.push(typeof id === "string" ? id : "<unidentified>");
    }
  }
  return { entries, dropped, malformed: false };
}
