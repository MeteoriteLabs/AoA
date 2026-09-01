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
    name: "canary_preflight_evidence_leases",
    identityArguments: "p_company_id uuid",
    // The canary preflight runs on the app pool and nothing else calls this.
    executeGrantees: ["aoa_app"],
    // The ONLY evidence read that touches environment_leases. `aoa_app` holds zero
    // privileges on it, which is the whole reason this function exists.
    authorityRelations: ["public.environment_leases"],
    executionConfig: ['search_path=""'],
    bodySha256: "8a644c52848737e4bce6b7e5a7ceb1b702a459df56ac1aabe9450b8ca1d99146",
    rationale:
      "BLOCKER E. Returns lease ids for one Company from a table the non-owner aoa_app pool " +
      "holds zero privileges on. Company-scoped in the body; the return type is a bare uuid, " +
      "so it structurally cannot carry environment_leases.metadata, which is secret-bearing " +
      "at rest.",
  },
  {
    schema: "public",
    name: "canary_preflight_evidence_scalars",
    identityArguments: "p_company_id uuid, p_default_env_id uuid",
    executeGrantees: ["aoa_app"],
    // Reads three relations `aoa_app` cannot touch; deliberately does NOT read
    // environment_leases, so the two scalar-only store members never scan the lease
    // inventory (the round-6 split).
    authorityRelations: [
      "public.environments",
      "public.runtime_provider_keys",
      "public.company_secret_versions",
    ],
    executionConfig: ['search_path=""'],
    bodySha256: "633a2b7270b9d20c677d66142c5b48c64a751f260c9e32cbce80d24b259af8e7",
    rationale:
      "BLOCKER E. Returns exactly one row carrying the platform-default environment id and the " +
      "current provider-control key generation. Both arguments are company-scoped in the body " +
      "(the env predicate carries company_id, without which it is a cross-tenant existence " +
      "oracle), and the return type structurally cannot carry company_secret_versions.material.",
  },
];
