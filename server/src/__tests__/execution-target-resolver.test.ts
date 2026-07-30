// server/src/__tests__/execution-target-resolver.test.ts
import { describe, expect, it } from "vitest";
import {
  chooseExecutionTargetRow,
  executionTargetToAdapterConfig,
} from "../services/execution-target-resolver.js";

describe("executionTargetToAdapterConfig hardening (P5 review gap #1)", () => {
  it("FORCES allowHostGateway false + hardened isolation + network none for a TENANT-authored target, ignoring weakened config", () => {
    const cfg = executionTargetToAdapterConfig({
      id: "t", slug: "s", kind: "dedicated_worker", trustClass: "dedicated_tenant", status: "active",
      organizationId: "org-1",
      config: { image: "x", network: "bridge", allowHostGateway: true, isolation: { capDropAll: false, readOnlyRootfs: false, noNewPrivileges: false } },
    }) as Record<string, unknown>;
    expect(cfg.allowHostGateway).toBe(false); // SSRF host-gateway route stays closed
    expect(cfg.network).toBe("none"); // a tenant cannot choose bridge egress
    const iso = cfg.isolation as Record<string, unknown>;
    expect(iso.capDropAll).toBe(true); // hardened flags cannot be turned off by tenant config
    expect(iso.readOnlyRootfs).toBe(true);
    expect(iso.noNewPrivileges).toBe(true);
    expect(cfg.image).toBe("x"); // benign field still honored
  });
  it("FORCES allowHostGateway false for an OPERATOR (system) target even when its config sets it true, but honors operator network", () => {
    const cfg = executionTargetToAdapterConfig({
      id: "t", slug: "pool", kind: "pooled_gvisor", trustClass: "shared_multitenant", status: "active",
      organizationId: null,
      config: { network: "bridge", allowHostGateway: true },
    }) as Record<string, unknown>;
    expect(cfg.allowHostGateway).toBe(false); // never routed to the control-plane host
    expect(cfg.network).toBe("bridge"); // operator may set bridge (Gate-B egress firewall governs it)
  });
  it("local_host target yields no override (local driver)", () => {
    expect(
      executionTargetToAdapterConfig({ id: "t", slug: "cp", kind: "local_host", trustClass: "local_trusted", status: "active", organizationId: null }),
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
