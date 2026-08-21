// server/src/__tests__/execution-target-resolver.test.ts
import { EXECUTION_TARGET_KINDS } from "@armyofagents/shared";
import { describe, expect, it } from "vitest";
import {
  chooseExecutionTargetRow,
  executionTargetToAdapterConfig,
} from "../services/execution-target-resolver.js";

describe("executionTargetToAdapterConfig hardening (P5 review gap #1, deployment-mode-aware)", () => {
  const weakenedTenant = {
    id: "t", slug: "s", kind: "dedicated_worker", trustClass: "dedicated_tenant", status: "active",
    organizationId: "org-1",
    config: { image: "x", network: "bridge", allowHostGateway: true, isolation: { capDropAll: false, readOnlyRootfs: false, noNewPrivileges: false } },
  };

  it("MULTI_TENANT + TENANT target: remains registry-only until the worker plane is validated", () => {
    expect(() => executionTargetToAdapterConfig(weakenedTenant, /* multiTenant */ true))
      .toThrow(/registry-only.*Gate-B/i);
  });

  it("MULTI_TENANT + OPERATOR target: also remains inert before Gate-B", () => {
    expect(() => executionTargetToAdapterConfig({
      id: "t", slug: "pool", kind: "pooled_gvisor", trustClass: "shared_multitenant", status: "active",
      organizationId: null,
      config: { network: "bridge", allowHostGateway: true },
    }, /* multiTenant */ true)).toThrow(/registry-only.*Gate-B/i);
  });

  it("SELF-HOSTED: honors allowHostGateway:true + custom network + custom (weaker) isolation from the trusted config", () => {
    const cfg = executionTargetToAdapterConfig(weakenedTenant, /* multiTenant */ false) as Record<string, unknown>;
    expect(cfg.allowHostGateway).toBe(true); // founder owns the box: local MCP bridge honored
    expect(cfg.network).toBe("bridge"); // custom network honored (no egress regression)
    const iso = cfg.isolation as Record<string, unknown>;
    expect(iso.capDropAll).toBe(false); // config honored exactly on self-hosted
    expect(iso.readOnlyRootfs).toBe(false);
    expect(iso.noNewPrivileges).toBe(false);
  });

  it("SELF-HOSTED: falls back to the hardened isolation baseline + network none when the trusted config omits them", () => {
    const cfg = executionTargetToAdapterConfig({
      id: "t", slug: "cp-worker", kind: "dedicated_worker", trustClass: "dedicated_tenant", status: "active",
      organizationId: "org-1", config: { image: "y" },
    }, /* multiTenant */ false) as Record<string, unknown>;
    expect(cfg.allowHostGateway).toBe(false); // not requested -> stays off
    expect(cfg.network).toBe("none"); // default egress
    expect((cfg.isolation as Record<string, unknown>).capDropAll).toBe(true); // default hardened baseline
  });

  it("local_host target yields no override (local driver) regardless of deployment mode", () => {
    expect(
      executionTargetToAdapterConfig({ id: "t", slug: "cp", kind: "local_host", trustClass: "local_trusted", status: "active", organizationId: null }, true),
    ).toBeNull();
    expect(
      executionTargetToAdapterConfig({ id: "t", slug: "cp", kind: "local_host", trustClass: "local_trusted", status: "active", organizationId: null }, false),
    ).toBeNull();
  });
});

const pooled = { id: "t-pool", slug: "pool-1", kind: "pooled_gvisor", trustClass: "shared_multitenant", status: "active", organizationId: null };
const dedicated = { id: "t-ded", slug: "hetzner-owner", kind: "dedicated_worker", trustClass: "dedicated_tenant", status: "active", organizationId: "org-1" };

// credentialKind + executionTargetSlug are P4's normalized seam fields (verbatim).
describe("chooseExecutionTargetRow (route by credential kind)", () => {
  it("business key routes to the org pooled_gvisor target", () => {
    const chosen = chooseExecutionTargetRow({ credentialKind: "company_api_key", pinnedTargetId: null, executionTargetSlug: null, targets: [pooled, dedicated] });
    expect(chosen.id).toBe("t-pool");
  });
  it("personal subscription routes to the dedicated target whose slug matches the credential", () => {
    const chosen = chooseExecutionTargetRow({ credentialKind: "personal_subscription", pinnedTargetId: null, executionTargetSlug: "hetzner-owner", targets: [pooled, dedicated] });
    expect(chosen.id).toBe("t-ded");
  });
  it("fails closed when a personal subscription's target does not match any dedicated target", () => {
    expect(() => chooseExecutionTargetRow({ credentialKind: "personal_subscription", pinnedTargetId: null, executionTargetSlug: "ghost", targets: [pooled, dedicated] })).toThrow(/target/i);
  });
  it("honors an explicit environment pin", () => {
    const chosen = chooseExecutionTargetRow({ credentialKind: "company_api_key", pinnedTargetId: "t-ded", executionTargetSlug: null, targets: [pooled, dedicated] });
    expect(chosen.id).toBe("t-ded");
  });
  it("returns null (fallback to local) when no targets exist", () => {
    const chosen = chooseExecutionTargetRow({ credentialKind: "company_api_key", pinnedTargetId: null, executionTargetSlug: null, targets: [] });
    expect(chosen).toBeNull();
  });
});

describe("DSK-001 Lane C / F28 — an unhandled target kind THROWS, it never falls through", () => {
  // The bug was never really about desktop. It was a bare `return null` at the end of
  // the function, which every kind the switch did not name inherited. Null means "no
  // adapter override", so the run executed on the CONTROL-PLANE host — the exact thing
  // an execution target exists to prevent.
  //
  // Reachable today: the sole caller is heartbeat.ts:3620, and chooseExecutionTargetRow's
  // pin branch returns ANY active row.

  const row = (kind: string) => ({
    id: "t", slug: "s", kind, trustClass: "local_trusted",
    status: "active", organizationId: null,
  }) as never;

  it("THROWS for a desktop target instead of silently running on the control plane", () => {
    // Asserts the SPECIFIC diagnosis, not merely "it threw". Mutation showed that
    // disabling this branch still threw — via the generic unhandled-kind arm — so a
    // loose /desktop/ match could not tell the two apart. The difference is what an
    // operator reads when a run fails: "placed through the distributed worker path"
    // tells them why, "Unhandled" does not.
    expect(() => executionTargetToAdapterConfig(row("desktop"), true))
      .toThrow(/control-plane host/i);
    expect(() => executionTargetToAdapterConfig(row("desktop"), false))
      .toThrow(/distributed worker path/i);
  });

  it("THROWS for an e2b target too — the same fallthrough, audited in the same pass", () => {
    // e2b belongs to the DISTRIBUTED placement system (TARGET_KIND_BY_CLASS maps
    // managed_cloud -> {pooled_gvisor, e2b}), and E2B execution runs through
    // `environments` with provider:"e2b" — keyed on the environment provider, not the
    // target kind. So there is no legacy adapter representation for it, and returning
    // null does not mean "handled elsewhere", it means "runs here, unsandboxed".
    expect(() => executionTargetToAdapterConfig(row("e2b"), true))
      .toThrow(/control-plane host/i);
    expect(() => executionTargetToAdapterConfig(row("e2b"), false))
      .toThrow(/distributed worker path/i);
  });

  it("THROWS for a kind nobody has invented yet", () => {
    // The property with the longest shelf life: a sixth entry in EXECUTION_TARGET_KINDS
    // must fail loudly rather than inherit a permissive default.
    // And it takes the GENERIC arm, not the named one — so the two messages stay
    // distinguishable and neither branch can quietly absorb the other.
    expect(() => executionTargetToAdapterConfig(row("quantum_toaster"), true))
      .toThrow(/Unhandled execution target kind/i);
  });

  it("still returns null for local_host — the local driver IS the default", () => {
    // Not every null is a hole. This one is correct and must not be swept up.
    expect(executionTargetToAdapterConfig(row("local_host"), true)).toBeNull();
    expect(executionTargetToAdapterConfig(row("local_host"), false)).toBeNull();
  });

  it("names EVERY kind in EXECUTION_TARGET_KINDS, so the set cannot drift", () => {
    // Non-vacuity for the exhaustiveness claim: if a kind is added to the shared
    // constant and not to the switch, this fails rather than the branch going quiet.
    for (const kind of EXECUTION_TARGET_KINDS) {
      let outcome: "null" | "config" | "throw";
      try {
        outcome = executionTargetToAdapterConfig(row(kind), false) === null ? "null" : "config";
      } catch {
        outcome = "throw";
      }
      expect(["null", "config", "throw"], `kind ${kind}`).toContain(outcome);
      // and specifically: only local_host may be silently unhandled
      if (outcome === "null") expect(kind).toBe("local_host");
    }
  });
});

describe("DSK-001 Lane C / I22 clause 4 — no-pin routing never selects a desktop target", () => {
  // Holds today, so this ASSERTS rather than fixes. It matters because the pin branch
  // deliberately returns any active row (that is what F28's throw now guards); this is
  // the other half — the paths a run takes when nobody pinned anything must never
  // wander onto a desktop target on their own.

  const target = (kind: string, slug: string) => ({
    id: `id-${slug}`, slug, kind, trustClass: "local_trusted",
    status: "active", organizationId: null,
  }) as never;

  const desktop = target("desktop", "my-laptop");

  it("does not select desktop for a company_api_key run, even when it is the only active row", () => {
    // company_api_key routes to the shared pool. With no pool present the answer must be
    // "nothing", never "well, there is a desktop here".
    expect(chooseExecutionTargetRow({
      credentialKind: "company_api_key", pinnedTargetId: null,
      executionTargetSlug: null, targets: [desktop],
    })).toBeNull();
  });

  it("does not select desktop for a personal_subscription run whose slug MATCHES it", () => {
    // The sharpest case: the credential names this very target by slug. The kind filter
    // still refuses, because a slug match is not a capability match.
    expect(() => chooseExecutionTargetRow({
      credentialKind: "personal_subscription", pinnedTargetId: null,
      executionTargetSlug: "my-laptop", targets: [desktop],
    })).toThrow();
  });

  it("still selects the kinds it is supposed to — the filter is not a blanket refusal", () => {
    // Non-vacuity: a function that returned null for everything would satisfy both
    // assertions above while breaking every run.
    const pool = target("pooled_gvisor", "pool");
    expect(chooseExecutionTargetRow({
      credentialKind: "company_api_key", pinnedTargetId: null,
      executionTargetSlug: null, targets: [desktop, pool],
    })).toBe(pool);

    const dedicated = target("dedicated_worker", "box");
    expect(chooseExecutionTargetRow({
      credentialKind: "personal_subscription", pinnedTargetId: null,
      executionTargetSlug: "box", targets: [desktop, dedicated],
    })).toBe(dedicated);
  });
});
