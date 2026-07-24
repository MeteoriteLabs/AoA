/**
 * @fileoverview Protected AoA agents (D23, T2.5) — which agents the product
 * refuses to uninstall, and how a row is recognised as one of them.
 *
 * **Why this is server-side and not catalog metadata.** Whether an agent is
 * essential to AoA is an *AoA fact*. A published `agent.v1` artifact cannot
 * carry it (Commander is not published at all), a company cannot opt out of it,
 * and it must hold for rows that predate the marketplace entirely. Same class of
 * fact as {@link file://./marketplace-install/crew-install-defaults.ts}'s
 * install defaults.
 *
 * ── Why identity, not `templateOrigin` ──────────────────────────────────────
 *
 * T2.5 was originally specified as a protected-**origin** set. That design
 * cannot protect Steward, and never will:
 * `backfillCrewTemplateOrigin`'s `CREW_NAMES` (the column's ONLY writer — no
 * seeder writes it) omits Steward and Chronicler, so their rows keep
 * `templateOrigin = NULL` permanently. And the NULL is load-bearing elsewhere:
 * the marketplace-managed gate requires a non-NULL, non-`@legacy` origin, so
 * stamping Steward a real origin would make every company self-report as
 * marketplace-managed and suppress its entire crew.
 *
 * So the set is keyed on the agent's **canonical role slug**, recovered from
 * either signal that can carry it:
 *
 * | signal                                   | example                                        |
 * |------------------------------------------|------------------------------------------------|
 * | `templateOrigin` (backfilled `@legacy`)  | `aoa-curated/standard-crew/commander@legacy`    |
 * | `templateOrigin` (catalog item id)       | `agent:aoa-curated/aoa-steward` (post-T2.4)     |
 * | `name`                                   | `Steward` — the only signal a NULL-origin row has |
 *
 * Either signal alone is enough (fail-closed: over-matching keeps an essential
 * agent alive, under-matching destroys it). The origin signal is what survives
 * a rename; the name signal is what covers a row the backfill never reached.
 *
 * ── What this does NOT claim ────────────────────────────────────────────────
 *
 * This is a **guardrail against destructive operations, not an authorization
 * boundary.** A founder who first renames a NULL-origin Steward through
 * `PATCH /agents/:id` erases its last identifying signal, and the guard will no
 * longer recognise the row. That gap closes for Steward the moment T2.4
 * publishes it (the origin then carries the slug through any rename), and it
 * never applied to Commander, which `backfillCrewTemplateOrigin` stamps at
 * first boot. Do not describe this module as tamper-proof.
 *
 * Deliberately broad in the other direction too: a third-party agent that a
 * founder names `Commander`, or that ships under an id ending `…/aoa-steward`,
 * is treated as protected. That is a recoverable annoyance (rename it, then
 * delete); the inverse is not recoverable.
 */

/** An agent AoA refuses to let a marketplace operation destroy. */
export interface ProtectedAgentRole {
  /** Canonical role slug — the value both signals normalise to. */
  slug: string;
  /** The display name AoA seeds the agent under. */
  name: string;
  /** Why it is protected. Surfaced verbatim in the refusal copy. */
  why: string;
}

/**
 * The protected set.
 *
 * Deliberately narrow: only agents whose absence breaks a product surface with
 * no founder-visible cause. Every other crew agent (Scout, Engineer,
 * Chronicler, …) is catalog-managed and legitimately removable.
 */
export const PROTECTED_AGENT_ROLES: readonly ProtectedAgentRole[] = [
  {
    slug: "commander",
    name: "Commander",
    why: "Commander is AoA's built-in assistant — the Commander surface and every proactive check run through it",
  },
  {
    slug: "steward",
    name: "Steward",
    why: "Steward curates the Inbox Hub; without it hub items lose their summaries silently",
  },
] as const;

const BY_SLUG: ReadonlyMap<string, ProtectedAgentRole> = new Map(
  PROTECTED_AGENT_ROLES.map((role) => [role.slug, role]),
);

/** Canonical slugs, for callers that only need membership. */
export const PROTECTED_AGENT_SLUGS: ReadonlySet<string> = new Set(
  PROTECTED_AGENT_ROLES.map((r) => r.slug),
);

/** Display names exactly as AoA seeds them. */
export const PROTECTED_AGENT_NAMES: ReadonlySet<string> = new Set(
  PROTECTED_AGENT_ROLES.map((r) => r.name),
);

/**
 * `"Memory Keeper"` → `"memory-keeper"`. Matches the slug shape
 * `backfillCrewTemplateOrigin` derives with
 * `lower(replace(name, ' ', '-'))`, so a name and its backfilled origin
 * normalise to the same value.
 */
export function agentRoleSlugFromName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * Recover the role slug a `templateOrigin` names, across all three shapes the
 * column actually holds:
 *   - `aoa-curated/standard-crew/commander@legacy` → `commander`
 *   - `agent:aoa-curated/aoa-steward`              → `steward`
 *   - `null`                                       → `null`
 *
 * The `aoa-` prefix is stripped because published crew ids carry it and the
 * backfilled legacy slugs do not.
 */
export function agentRoleSlugFromOrigin(origin: string | null | undefined): string | null {
  if (!origin) return null;
  const withoutLegacy = origin.endsWith("@legacy")
    ? origin.slice(0, -"@legacy".length)
    : origin;
  const tail = withoutLegacy.split("/").pop()?.trim().toLowerCase();
  if (!tail) return null;
  return tail.replace(/^aoa-/, "");
}

/** The minimum an agent row must expose to be classified. */
export interface ProtectedAgentCandidate {
  name: string;
  templateOrigin?: string | null;
}

/**
 * The protected role this row is, or `null`.
 *
 * Checks the origin slug first so a **renamed** row is still recognised, then
 * falls back to the name — the only signal a NULL-origin Steward has.
 */
export function protectedAgentRole(row: ProtectedAgentCandidate): ProtectedAgentRole | null {
  const fromOrigin = agentRoleSlugFromOrigin(row.templateOrigin);
  if (fromOrigin) {
    const match = BY_SLUG.get(fromOrigin);
    if (match) return match;
  }
  return BY_SLUG.get(agentRoleSlugFromName(row.name)) ?? null;
}

/** Filter a batch of rows down to the protected ones, in input order. */
export function protectedAgentsIn<T extends ProtectedAgentCandidate>(
  rows: readonly T[],
): { agent: T; role: ProtectedAgentRole }[] {
  const found: { agent: T; role: ProtectedAgentRole }[] = [];
  for (const agent of rows) {
    const role = protectedAgentRole(agent);
    if (role) found.push({ agent, role });
  }
  return found;
}

/**
 * Refusal copy naming every protected agent that blocked the operation, so the
 * founder can act on it without reading a log.
 *
 * @param operation - human phrasing of what was refused, e.g.
 *   `"Uninstalling this team"` or `"Deleting this agent"`.
 */
export function protectedAgentRefusal(
  blocked: readonly { name: string; role: ProtectedAgentRole }[],
  operation: string,
): string {
  const detail = blocked.map((b) => `${b.name} (${b.role.why})`).join("; ");
  return (
    `${operation} would remove ${blocked.length === 1 ? "a protected AoA agent" : "protected AoA agents"}: ` +
    `${detail}. Protected agents are part of AoA itself and cannot be uninstalled.`
  );
}
