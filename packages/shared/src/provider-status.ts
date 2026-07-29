import { z } from "zod";
import { PROBE_OUTCOMES } from "./probe-outcome.js";

export const PROVIDER_STATUS_CONTRACT_VERSION = 1 as const;

export const PROVIDER_CREDENTIAL_STATES = [
  "not_configured",
  "checking",
  "verified",
  "expired",
  "revoked",
  "verification_failed",
] as const;
export const PROVIDER_EXECUTION_STATES = [
  "not_checked",
  "checking",
  "compatible",
  "stale",
  "target_offline",
  "unsupported",
  "quota_limited",
  "probe_failed",
] as const;
export const PROVIDER_ASSIGNMENT_STATES = [
  "commander_subscription",
  "company_key_fallback",
  "not_assigned",
  "unsupported",
] as const;

const nullableIso = z.string().datetime().nullable();

export const providerCredentialStatusSchema = z.object({
  state: z.enum(PROVIDER_CREDENTIAL_STATES),
  method: z.enum(["api_key", "subscription", "none"]),
  scope: z.enum(["company", "personal", "none"]),
  /** Redacted display label only; raw email/user identifiers are forbidden. */
  ownerDisplay: z.string().nullable(),
  checkedAt: nullableIso,
});

export const providerExecutionStatusSchema = z.object({
  state: z.enum(PROVIDER_EXECUTION_STATES),
  outcome: z.enum(PROBE_OUTCOMES),
  executionTargetId: z.string().min(1),
  sourceFingerprint: z.string().min(1).nullable(),
  testedAt: nullableIso,
  /** Computed by the server, never by a browser clock. */
  staleAt: nullableIso,
});

export const providerAssignmentStatusSchema = z.object({
  state: z.enum(PROVIDER_ASSIGNMENT_STATES),
  intendedAgentId: z.string().nullable(),
  intendedAgentName: z.string().nullable(),
  credentialSource: z.enum(["personal_subscription", "company_api_key"]).nullable(),
  approvedAt: nullableIso,
  revokedAt: nullableIso,
});

export const providerCanonicalStatusSchema = z.object({
  version: z.literal(PROVIDER_STATUS_CONTRACT_VERSION),
  credential: providerCredentialStatusSchema,
  execution: providerExecutionStatusSchema,
  assignment: providerAssignmentStatusSchema,
});

export type ProviderCredentialStatus = z.infer<typeof providerCredentialStatusSchema>;
export type ProviderExecutionStatus = z.infer<typeof providerExecutionStatusSchema>;
export type ProviderAssignmentStatus = z.infer<typeof providerAssignmentStatusSchema>;
export type ProviderCanonicalStatus = z.infer<typeof providerCanonicalStatusSchema>;
