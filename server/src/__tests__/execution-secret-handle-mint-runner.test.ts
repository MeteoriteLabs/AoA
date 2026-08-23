// DAT-008 slice 1 — the impure half of the mint (input gathering + write).
//
// The repo surface is two functions, so this needs no drizzle mocking: the runner
// declares `ExecutionSecretMintRepo` precisely so it can be driven by a pair of
// stubs. What is under test here is NOT the decision (that is
// `execution-secret-handle-mint.test.ts`) but the gathering: which env binding is
// read, what is written, and what is deliberately NOT read.

import { describe, expect, it, vi } from "vitest";
import {
  mintExecutionSecretHandleForPlacement,
  providerBindingForEnvVar,
  type ExecutionSecretMintRepo,
} from "../services/execution-secret-handle-mint-runner.js";

function repo(agent: { adapterType: string; adapterConfig: Record<string, unknown> } | null) {
  const inserted: unknown[] = [];
  const stub: ExecutionSecretMintRepo = {
    loadAgentAdapterBinding: vi.fn(async () => agent),
    insertExecutionSecretHandle: vi.fn(async (values) => {
      inserted.push(values);
      return { handle: values.handle, minted: true };
    }),
  };
  return { stub, inserted };
}

const BASE = {
  organizationId: "org-1",
  companyId: "co-1",
  jobId: "job-1",
  executorPrincipalKind: "agent",
  executorPrincipalId: "agent-1",
  placementOwner: "managed_cloud",
  credentialKind: "company_api_key",
  targetGeneration: 4,
  deploymentMode: "cloud_auth",
  newHandleId: () => "11111111-2222-4333-8444-555555555555",
} as const;

describe("providerBindingForEnvVar", () => {
  it("returns null when the agent sets no value for that env var", () => {
    expect(providerBindingForEnvVar({ env: { OTHER: "x" } }, "ANTHROPIC_API_KEY")).toBeNull();
    expect(providerBindingForEnvVar({}, "ANTHROPIC_API_KEY")).toBeNull();
  });

  it("reads ONLY the requested env var", () => {
    const config = { env: { OPENAI_API_KEY: { type: "secret_ref", secretId: "other" } } };
    expect(providerBindingForEnvVar(config, "ANTHROPIC_API_KEY")).toBeNull();
  });

  it("classifies a secret_ref, defaulting an absent version to latest", () => {
    expect(providerBindingForEnvVar(
      { env: { ANTHROPIC_API_KEY: { type: "secret_ref", secretId: "sec-9" } } },
      "ANTHROPIC_API_KEY",
    )).toEqual({ type: "secret_ref", secretId: "sec-9", version: "latest" });
  });

  it("classifies a bare legacy string as plain, not as absent", () => {
    // EnvBinding still accepts a bare string as legacy plaintext. Reading it as
    // "absent" would silently swap the agent's own key for the company key.
    expect(providerBindingForEnvVar({ env: { ANTHROPIC_API_KEY: "sk-literal" } }, "ANTHROPIC_API_KEY"))
      .toEqual({ type: "plain" });
  });

  it("classifies an explicitly EMPTY value as plain — an intentional override", () => {
    expect(providerBindingForEnvVar({ env: { ANTHROPIC_API_KEY: "" } }, "ANTHROPIC_API_KEY"))
      .toEqual({ type: "plain" });
    expect(providerBindingForEnvVar({ env: { ANTHROPIC_API_KEY: { type: "plain", value: "" } } }, "ANTHROPIC_API_KEY"))
      .toEqual({ type: "plain" });
  });

  it.each([
    ["a number", 42],
    ["an empty object", {}],
    ["an unknown discriminant", { type: "bogus" }],
    ["a secret_ref with no id", { type: "secret_ref" }],
    ["a secret_ref with an empty id", { type: "secret_ref", secretId: "" }],
    ["null", null],
  ])("refuses to mint on a malformed binding (%s) rather than substituting the company key", (_label, raw) => {
    // canonicalizeBinding does not VALIDATE: several of these reach its secret_ref
    // arm and produce `secretId: undefined`, which would mint a company_secret
    // handle pointing at nothing. An unusable override must refuse, never fall back.
    expect(providerBindingForEnvVar({ env: { ANTHROPIC_API_KEY: raw } }, "ANTHROPIC_API_KEY"))
      .toEqual({ type: "plain" });
  });

  it("treats a non-object env as no binding rather than throwing", () => {
    expect(providerBindingForEnvVar({ env: "nope" }, "ANTHROPIC_API_KEY")).toBeNull();
    expect(providerBindingForEnvVar({ env: ["a"] }, "ANTHROPIC_API_KEY")).toBeNull();
    expect(providerBindingForEnvVar({ env: null }, "ANTHROPIC_API_KEY")).toBeNull();
  });
});

describe("mintExecutionSecretHandleForPlacement", () => {
  it("writes a sandbox_local_only env handle with a null destination", async () => {
    const { stub, inserted } = repo({ adapterType: "claude_local", adapterConfig: {} });
    const outcome = await mintExecutionSecretHandleForPlacement(stub, BASE);

    expect(outcome).toEqual({
      minted: true,
      handle: "11111111-2222-4333-8444-555555555555",
      refKind: "provider_key",
      deduped: false,
    });
    expect(inserted[0]).toMatchObject({
      handle: "11111111-2222-4333-8444-555555555555",
      refKind: "provider_key",
      refId: "provider:anthropic",
      materialization: "env",
      usePolicy: "sandbox_local_only",
      envTarget: "ANTHROPIC_API_KEY",
      boundTargetGeneration: 4,
      ownerPrincipalKind: "agent",
      ownerPrincipalId: "agent-1",
    });
  });

  it("binds the AGENT's own secret when the provider env var is a secret_ref", async () => {
    const { stub, inserted } = repo({
      adapterType: "claude_local",
      adapterConfig: { env: { ANTHROPIC_API_KEY: { type: "secret_ref", secretId: "sec-own", version: 2 } } },
    });
    await mintExecutionSecretHandleForPlacement(stub, BASE);
    expect(inserted[0]).toMatchObject({ refKind: "company_secret", refId: "sec-own" });
  });

  it("mints NOTHING when the agent carries a plain literal", async () => {
    const { stub, inserted } = repo({
      adapterType: "claude_local",
      adapterConfig: { env: { ANTHROPIC_API_KEY: "sk-literal" } },
    });
    expect(await mintExecutionSecretHandleForPlacement(stub, BASE))
      .toEqual({ minted: false, reason: "agent_plain_literal_override" });
    expect(inserted).toHaveLength(0);
  });

  it("never looks up an agent for a non-agent executor", async () => {
    const { stub } = repo({ adapterType: "claude_local", adapterConfig: {} });
    const outcome = await mintExecutionSecretHandleForPlacement(stub, {
      ...BASE, executorPrincipalKind: "user",
    });
    expect(outcome).toEqual({ minted: false, reason: "executor_not_agent" });
    expect(stub.loadAgentAdapterBinding).not.toHaveBeenCalled();
  });

  it("mints nothing when the agent row is missing", async () => {
    // A missing agent leaves the adapter type empty, so the v1-scope gate refuses
    // first. That is the fail-closed direction AND it is non-disclosing: the refusal
    // reason does not distinguish "no such agent" from "adapter out of scope".
    const { stub, inserted } = repo(null);
    expect(await mintExecutionSecretHandleForPlacement(stub, BASE))
      .toEqual({ minted: false, reason: "adapter_not_v1_scope" });
    expect(inserted).toHaveLength(0);
  });

  it("does not touch the database on a self-hosted deployment", async () => {
    const { stub } = repo({ adapterType: "claude_local", adapterConfig: {} });
    expect(await mintExecutionSecretHandleForPlacement(stub, { ...BASE, deploymentMode: "local_trusted" }))
      .toEqual({ minted: false, reason: "not_cloud_deployment" });
    expect(stub.insertExecutionSecretHandle).not.toHaveBeenCalled();
  });

  it("reports a deduped write without minting a second handle", async () => {
    const stub: ExecutionSecretMintRepo = {
      loadAgentAdapterBinding: vi.fn(async () => ({ adapterType: "claude_local", adapterConfig: {} })),
      insertExecutionSecretHandle: vi.fn(async () => ({ handle: "pre-existing", minted: false })),
    };
    expect(await mintExecutionSecretHandleForPlacement(stub, BASE))
      .toEqual({ minted: true, handle: "pre-existing", refKind: "provider_key", deduped: true });
  });

  it("generates a UUID handle id, never a slug the wire would reject", async () => {
    const { stub, inserted } = repo({ adapterType: "claude_local", adapterConfig: {} });
    await mintExecutionSecretHandleForPlacement(stub, { ...BASE, newHandleId: undefined });
    expect((inserted[0] as { handle: string }).handle)
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("scopes the agent lookup to the job's company", async () => {
    const { stub } = repo({ adapterType: "claude_local", adapterConfig: {} });
    await mintExecutionSecretHandleForPlacement(stub, BASE);
    expect(stub.loadAgentAdapterBinding).toHaveBeenCalledWith({ companyId: "co-1", agentId: "agent-1" });
  });
});
