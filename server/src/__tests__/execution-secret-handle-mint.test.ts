// DAT-008 slice 1 — the execution-secret-handle MINT decision.
//
// Pure decision function, so this is a direct-import unit suite (the repo's
// "pure function tests" pattern) with no drizzle mocking. Every guard here is
// mutation-tested; a guard whose removal leaves this suite green is not a guard.
//
// The three-way per-agent split (design revision 1, R2) is the load-bearing part:
// an agent that carries its own provider key must NEVER be silently switched onto
// the company key by the act of cutting over.

import { describe, expect, it } from "vitest";
import {
  decideExecutionSecretHandle,
  type ExecutionSecretMintInput,
} from "../services/execution-secret-handle-mint.js";

const TARGET = { ownerId: "anthropic", secretName: "provider:anthropic", envVar: "ANTHROPIC_API_KEY" } as const;

function input(overrides: Partial<ExecutionSecretMintInput> = {}): ExecutionSecretMintInput {
  return {
    deploymentMode: "cloud_auth",
    adapterType: "claude_local",
    executorPrincipalKind: "agent",
    providerKeyTarget: TARGET,
    providerBinding: null,
    placementOwner: "managed_cloud",
    credentialKind: "company_api_key",
    targetGeneration: 7,
    ...overrides,
  };
}

describe("decideExecutionSecretHandle — admission", () => {
  it("mints a provider_key handle for a v1 adapter on a cloud deployment with no agent override", () => {
    const decision = decideExecutionSecretHandle(input());
    expect(decision).toEqual({
      mint: true,
      refKind: "provider_key",
      refId: "provider:anthropic",
      envTarget: "ANTHROPIC_API_KEY",
      secretVersion: null,
      boundTargetGeneration: 7,
    });
  });

  // Both mint branches are asserted. Covering only the company-key branch left the
  // secret_ref branch free to default an unpinned generation to 0 (mutant M17
  // survived on exactly that), which would pin every agent-secret handle to a
  // generation no target has.
  it.each([
    ["company key", null],
    ["agent secret_ref", { type: "secret_ref", secretId: "sec-agent-own", version: 1 } as const],
  ])("pins the generation it was given on the %s branch, never a default", (_label, providerBinding) => {
    expect(decideExecutionSecretHandle(input({ providerBinding, targetGeneration: 12 })))
      .toMatchObject({ mint: true, boundTargetGeneration: 12 });
    // A null generation is UNPINNED and must survive as null rather than becoming 0.
    expect(decideExecutionSecretHandle(input({ providerBinding, targetGeneration: null })))
      .toMatchObject({ mint: true, boundTargetGeneration: null });
  });
});

describe("decideExecutionSecretHandle — the three-way per-agent split (R2)", () => {
  it("binds the AGENT's own secret when the provider env var is a secret_ref", () => {
    const decision = decideExecutionSecretHandle(input({
      providerBinding: { type: "secret_ref", secretId: "sec-agent-own", version: 3 },
    }));
    // The company key must NOT appear anywhere in this decision.
    expect(decision).toEqual({
      mint: true,
      refKind: "company_secret",
      refId: "sec-agent-own",
      envTarget: "ANTHROPIC_API_KEY",
      secretVersion: 3,
      boundTargetGeneration: 7,
    });
  });

  it("carries a 'latest' version selector through unchanged", () => {
    expect(decideExecutionSecretHandle(input({
      providerBinding: { type: "secret_ref", secretId: "sec-agent-own", version: "latest" },
    }))).toMatchObject({ refKind: "company_secret", secretVersion: "latest" });
  });

  it("REFUSES to mint when the agent carries a plain literal — the job stays on legacy", () => {
    expect(decideExecutionSecretHandle(input({ providerBinding: { type: "plain" } })))
      .toEqual({ mint: false, reason: "agent_plain_literal_override" });
  });

  it("treats an explicitly EMPTY plain override as an override, not as absent", () => {
    // secrets.ts:288 — "An explicitly-set empty string is an INTENTIONAL override and
    // is left alone." Canonicalization erases the value, so an empty plain arrives as
    // {type:"plain"} and must refuse exactly like a non-empty one.
    expect(decideExecutionSecretHandle(input({ providerBinding: { type: "plain" } })))
      .toEqual({ mint: false, reason: "agent_plain_literal_override" });
  });
});

describe("decideExecutionSecretHandle — refusals", () => {
  it("refuses on a non-cloud deployment (Rule #11: self-hosted uses the local CLI login)", () => {
    for (const mode of ["local_trusted", "single_tenant", "authenticated_local"]) {
      expect(decideExecutionSecretHandle(input({ deploymentMode: mode })))
        .toEqual({ mint: false, reason: "not_cloud_deployment" });
    }
  });

  it("admits every mode the shared cloud predicate admits, and only those", () => {
    expect(decideExecutionSecretHandle(input({ deploymentMode: "cloud_auth" })))
      .toMatchObject({ mint: true });
    expect(decideExecutionSecretHandle(input({ deploymentMode: "authenticated" })))
      .toMatchObject({ mint: true });
  });

  it("refuses when the executor principal is not an agent", () => {
    for (const kind of ["user", "system", "service", "service_instance"]) {
      expect(decideExecutionSecretHandle(input({ executorPrincipalKind: kind })))
        .toEqual({ mint: false, reason: "executor_not_agent" });
    }
  });

  it("refuses when the adapter is outside the v1 sandboxed-coding scope", () => {
    expect(decideExecutionSecretHandle(input({ adapterType: "hermes_local" })))
      .toEqual({ mint: false, reason: "adapter_not_v1_scope" });
    expect(decideExecutionSecretHandle(input({ adapterType: "gemini_local" })))
      .toEqual({ mint: false, reason: "adapter_not_v1_scope" });
  });

  it("admits both v1 adapters", () => {
    expect(decideExecutionSecretHandle(input({ adapterType: "claude_local" }))).toMatchObject({ mint: true });
    expect(decideExecutionSecretHandle(input({
      adapterType: "codex_local",
      providerKeyTarget: { ownerId: "openai", secretName: "provider:openai", envVar: "OPENAI_API_KEY" },
    }))).toMatchObject({ mint: true, refId: "provider:openai", envTarget: "OPENAI_API_KEY" });
  });

  it("refuses when the adapter resolves no company key target", () => {
    expect(decideExecutionSecretHandle(input({ providerKeyTarget: null })))
      .toEqual({ mint: false, reason: "adapter_has_no_company_key" });
  });
});

describe("decideExecutionSecretHandle — deferral #3, two independent owner authorities", () => {
  it("refuses to mint a company key for an owner_desktop placement", () => {
    expect(decideExecutionSecretHandle(input({
      placementOwner: "owner_desktop",
      credentialKind: "personal_subscription",
    }))).toEqual({ mint: false, reason: "owner_desktop_target" });
  });

  it("refuses when the two authorities DISAGREE — desktop owner, company credential", () => {
    // This is the case the tautological check could never catch: the placement owner
    // and the job's own credential binding are derived independently, so a disagreement
    // means one of them is wrong and neither may be trusted.
    expect(decideExecutionSecretHandle(input({
      placementOwner: "owner_desktop",
      credentialKind: "company_api_key",
    }))).toEqual({ mint: false, reason: "owner_authority_disagreement" });
  });

  it("refuses when the two authorities DISAGREE — cloud owner, personal credential", () => {
    expect(decideExecutionSecretHandle(input({
      placementOwner: "managed_cloud",
      credentialKind: "personal_subscription",
    }))).toEqual({ mint: false, reason: "owner_authority_disagreement" });
  });

  it("admits organization_dedicated with a company credential", () => {
    expect(decideExecutionSecretHandle(input({
      placementOwner: "organization_dedicated",
      credentialKind: "company_api_key",
    }))).toMatchObject({ mint: true });
  });

  it("refuses an unplaced decision — no owner means no generation to pin to", () => {
    expect(decideExecutionSecretHandle(input({ placementOwner: null })))
      .toEqual({ mint: false, reason: "owner_authority_disagreement" });
  });
});

describe("decideExecutionSecretHandle — refusal precedence", () => {
  it("checks the deployment mode before anything else", () => {
    // Every other input is simultaneously invalid; the mode reason must still win,
    // so a self-hosted deployment can never be reported as an adapter/owner problem.
    expect(decideExecutionSecretHandle(input({
      deploymentMode: "local_trusted",
      executorPrincipalKind: "user",
      adapterType: "hermes_local",
      providerKeyTarget: null,
      placementOwner: "owner_desktop",
      credentialKind: "company_api_key",
    }))).toEqual({ mint: false, reason: "not_cloud_deployment" });
  });

  it("refuses the owner disagreement even when an agent override would otherwise bind", () => {
    expect(decideExecutionSecretHandle(input({
      placementOwner: "owner_desktop",
      credentialKind: "company_api_key",
      providerBinding: { type: "secret_ref", secretId: "sec-agent-own", version: 1 },
    }))).toEqual({ mint: false, reason: "owner_authority_disagreement" });
  });
});
