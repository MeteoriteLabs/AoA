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
    if (val.transport === "http" && !val.url) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["url"], message: "http requires url" });
    }
    if (val.transport === "stdio" && !val.command) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["command"],
        message: "stdio requires command",
      });
    }
  });

export type McpConnectorCatalogEntry = z.infer<typeof McpConnectorCatalogEntrySchema>;

/**
 * Parse PER ENTRY, dropping bad ones. This is the forward-compat property
 * catalog.json lacks: a future field or entry shape we do not understand costs
 * us that entry, never the whole file.
 */
export function parseMcpConnectorCatalog(input: unknown): {
  entries: McpConnectorCatalogEntry[];
  dropped: string[];
} {
  const entries: McpConnectorCatalogEntry[] = [];
  const dropped: string[] = [];
  const raw = (input as { entries?: unknown[] })?.entries;
  if (!Array.isArray(raw)) return { entries, dropped };
  for (const item of raw) {
    const parsed = McpConnectorCatalogEntrySchema.safeParse(item);
    if (parsed.success) {
      entries.push(parsed.data);
    } else {
      const id = (item as { id?: unknown })?.id;
      dropped.push(typeof id === "string" ? id : "<unidentified>");
    }
  }
  return { entries, dropped };
}
