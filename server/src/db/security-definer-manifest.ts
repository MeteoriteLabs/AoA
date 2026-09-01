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
  /** Why this function may hold owner authority. */
  readonly rationale: string;
};

export const SECURITY_DEFINER_FUNCTION_MANIFEST: readonly SecurityDefinerFunction[] = [
  {
    schema: "public",
    name: "canary_preflight_evidence",
    identityArguments: "p_company_id uuid, p_default_env_id uuid",
    rationale:
      "BLOCKER E. Returns three scalars the CLI-006 canary gate needs from tables the " +
      "non-owner aoa_app pool holds zero privileges on. Both arguments are company-scoped in " +
      "the body, and the return type structurally cannot carry company_secret_versions.material " +
      "or environment_leases.metadata.",
  },
];
