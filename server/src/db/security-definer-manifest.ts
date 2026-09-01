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
  /** Why this function may hold owner authority. */
  readonly rationale: string;
};

export const SECURITY_DEFINER_FUNCTION_MANIFEST: readonly SecurityDefinerFunction[] = [
  {
    schema: "public",
    name: "canary_preflight_evidence",
    identityArguments: "p_company_id uuid, p_default_env_id uuid",
    // The canary preflight runs on the app pool and nothing else calls this.
    executeGrantees: ["aoa_app"],
    rationale:
      "BLOCKER E. Returns three scalars the CLI-006 canary gate needs from tables the " +
      "non-owner aoa_app pool holds zero privileges on. Both arguments are company-scoped in " +
      "the body, and the return type structurally cannot carry company_secret_versions.material " +
      "or environment_leases.metadata.",
  },
];
