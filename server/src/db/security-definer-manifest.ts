// server/src/db/security-definer-manifest.ts
//
// Every SECURITY DEFINER function in the application schema, as data.
//
// A definer function runs with the OWNER's authority regardless of caller, so it is the
// entire privilege-escalation surface that the table, column and sequence scans in
// `assertExactServingRoleAuthority` cannot see — before migration 0266 there was no
// `prosecdef` reference anywhere in this repository. Anything not listed here is drift,
// and drift is a fatal boot error.

export type SecurityDefinerFunction = {
  readonly schema: string;
  readonly name: string;
  /** `pg_get_function_identity_arguments` output, matched exactly. */
  readonly identityArguments: string;
  /**
   * The ONLY roles that may hold `EXECUTE`, besides the function owner (which always may,
   * implicitly). Enumerating the definer surface is only half a certificate: a manifested
   * function whose ACL widens is owner-authority code reachable by a role that was never
   * meant to reach it, and the identity scan alone cannot see that. `PUBLIC` is never a
   * legal entry here — a definer function executable by PUBLIC is the escalation this
   * manifest exists to prevent.
   */
  readonly executeGrantees: readonly string[];
  /**
   * The schema-qualified relations whose authority this function borrows — i.e. every
   * relation its body reads. The function's owner MUST own all of them.
   *
   * Owner is not a bounded axis, it is a pinned one. `ALTER FUNCTION … OWNER TO` rewrites
   * the ACL's grantor/grantee entries to the new owner, so an owner swap is INVISIBLE to
   * an exact-ACL comparison that normalizes against the current owner. A less-privileged
   * owner silently restores the BLOCKER E `preflight_error` outage (the body loses the
   * privileges it depends on); a more-privileged one silently widens the definer context.
   * Pinning against the relations themselves is deployment-independent — it hardcodes no
   * role name, and it states the actual invariant: a definer function may hold exactly the
   * authority of the data it reads.
   */
  readonly authorityRelations: readonly string[];
  /**
   * Expected `pg_proc.proconfig` — the per-function `SET` clauses, matched exactly.
   *
   * `CREATE OR REPLACE FUNCTION` PRESERVES the owner and the ACL, so a replacement that
   * keeps the identity and the `SECURITY DEFINER` setting but drops `SET search_path = ''`
   * is invisible to every identity, owner and ACL assertion. Without that pin, name
   * resolution inside owner-authority code becomes caller-controlled.
   */
  readonly executionConfig: readonly string[];
  /**
   * SHA-256 of `pg_proc.prosrc` with carriage returns stripped, lowercase hex.
   *
   * The last thing `CREATE OR REPLACE` can change invisibly is the BODY — dropping a
   * `company_id` predicate turns this into the cross-tenant existence oracle that review
   * caught in this plan's first revision. Pinning the body makes any change to owner-
   * authority code a deliberate, reviewed manifest edit.
   *
   * CR-stripped because `packages/db/src/migrations/` carries no `eol=lf` pin in
   * `.gitattributes`: a Windows checkout with `core.autocrlf=true` stores the migration
   * with CRLF and Linux CI with LF, so a raw hash would pin one platform and fail boot on
   * the other. The scan normalizes the same way.
   */
  readonly bodySha256: string;
  /** Why this function may hold owner authority. */
  readonly rationale: string;
};

export const SECURITY_DEFINER_FUNCTION_MANIFEST: readonly SecurityDefinerFunction[] = [
  {
    schema: "public",
    name: "canary_preflight_evidence_companies",
    identityArguments: "p_organization_id uuid",
    executeGrantees: ["aoa_operator"],
    // The enumeration moved INSIDE the definer surface (migration 0267) precisely so the
    // gate's pool needs no `companies` grant. That absence is what let EXECUTE move off
    // aoa_app -- aoa_operator holds no grant on companies or organizations at all.
    authorityRelations: ["public.companies"],
    executionConfig: ['search_path=""'],
    bodySha256: "f225bf33116c15d8b5a6e4a9960f166cab1b442ba5850b9e2eeae7a1d12ca0e4",
    rationale:
      "BLOCKER E / round 7. Enumerates one Organization's Companies so the canary gate needs " +
      "no companies grant on its pool. EXECUTE is aoa_operator ONLY. Note this is a WIDENING " +
      "for aoa_operator, which holds no grant on companies or organizations -- the capability " +
      "moves off a broad pool onto a narrow one rather than being removed.",
  },
  {
    schema: "public",
    name: "canary_preflight_evidence_leases",
    identityArguments: "p_organization_id uuid, p_company_id uuid",
    executeGrantees: ["aoa_operator"],
    authorityRelations: ["public.environment_leases", "public.companies"],
    executionConfig: ['search_path=""'],
    bodySha256: "42efbfa50d3ff1b666b6e0a9ba40f758a7ded78d9ac5a1886fe6b0df57cd1217",
    rationale:
      "BLOCKER E / round 7. Returns lease ids for one Company from a table the serving roles " +
      "hold zero privileges on. EXECUTE is granted to aoa_operator ONLY: aoa_app is the " +
      "tenant-facing pool (HTTP requests, outbox worker, admission bridge, live-event log), so " +
      "moving the grant narrows WHICH surface can reach owner authority. The organization " +
      "predicate is defence in depth, NOT a boundary -- p_organization_id is caller-supplied " +
      "and companies carries no RLS. The binder is the grantee, not the parameter. Return type " +
      "is a bare uuid, so it cannot carry environment_leases.metadata, which is secret-bearing " +
      "at rest.",
  },
  {
    schema: "public",
    name: "canary_preflight_evidence_scalars",
    identityArguments: "p_organization_id uuid, p_company_id uuid, p_default_env_id uuid",
    executeGrantees: ["aoa_operator"],
    // Deliberately does NOT read environment_leases: the round-6 split keeps the scalar
    // reads off the lease inventory, and the round-7 change must not silently undo it.
    authorityRelations: [
      "public.environments",
      "public.runtime_provider_keys",
      "public.company_secret_versions",
      "public.companies",
    ],
    executionConfig: ['search_path=""'],
    bodySha256: "1aad28e0fa0ba14aebbf708d6469025f6bb0e46bcc78c1d64b37db1fc9a03e14",
    rationale:
      "BLOCKER E / round 7. Returns exactly one row carrying the platform-default environment " +
      "id and the current provider-control key generation. EXECUTE is aoa_operator ONLY -- that " +
      "grant is the boundary; the organization predicate is defence in depth. The return type " +
      "structurally cannot carry company_secret_versions.material.",
  },
];
