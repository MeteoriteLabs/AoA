// Plan 3a Task 7 (C2) — the connector approve/reject truth table, unit-tested
// against the EXPORTED helpers rather than through approvalService.
//
// WHY DIRECTLY: approve()/reject() need a mocked drizzle db, a mocked
// @armyofagents/db module graph and a resolved approval row before the connector
// branch is even reached — five moving parts between the test and the one
// decision under test. `assertTransportAllowed` set the precedent in this
// codebase: extract the decision, test the truth table directly, and keep a
// separate wiring test (approvals-mcp-connector.test.ts) proving approvalService
// actually calls it.
//
// THE DEFECT THESE PIN:
//   approve():  flipped ANY non-active connector straight to `active`, so
//               approving a connector that requires a secret and has none
//               ACTIVATED IT UNCREDENTIALED — the one thing the design forbids.
//   reject():   guarded on `status === "pending_approval"` only, so rejecting a
//               connector sitting in `needs_credentials` was a SILENT NO-OP and
//               it stayed on a path that later reaches `active`.
//
// No module mocks are needed: approvals.ts imports drizzle/@armyofagents/db, but
// these helpers are pure over the injected `svc`, and the import graph resolves
// fine unmocked in vitest (the helpers never touch a Db handle).

import { describe, expect, it, vi } from "vitest";
import { applyConnectorApproval, applyConnectorRejection } from "../services/approvals.js";

const CO = "co1";

/** A connector row stub + an observable update(). */
function makeSvc(connector: Record<string, unknown> | null) {
  return {
    getById: vi.fn().mockResolvedValue(connector),
    update: vi.fn().mockResolvedValue({}),
  };
}

describe("applyConnectorApproval — credentials gate the activation (C2)", () => {
  it("approving a connector that requires a secret it does not have yields needs_credentials, NOT active", async () => {
    const svc = makeSvc({
      id: "c1",
      companyId: CO,
      status: "pending_approval",
      requiresSecret: true,
      secretRef: null,
    });

    await applyConnectorApproval(svc as never, CO, "c1", "authenticated");

    expect(svc.update).toHaveBeenCalledWith("c1", { status: "needs_credentials" });
    expect(svc.update).not.toHaveBeenCalledWith("c1", { status: "active" });
  });

  it("approving a connector whose required secret IS bound activates it", async () => {
    const svc = makeSvc({
      id: "c1",
      companyId: CO,
      status: "pending_approval",
      requiresSecret: true,
      secretRef: "mcp:notion",
    });

    await applyConnectorApproval(svc as never, CO, "c1", "authenticated");

    expect(svc.update).toHaveBeenCalledWith("c1", { status: "active" });
  });

  it("approving a connector that needs no secret at all activates it", async () => {
    const svc = makeSvc({
      id: "c1",
      companyId: CO,
      status: "pending_approval",
      requiresSecret: false,
      secretRef: null,
    });

    await applyConnectorApproval(svc as never, CO, "c1", "authenticated");

    expect(svc.update).toHaveBeenCalledWith("c1", { status: "active" });
  });

  it("treats a missing/undefined requiresSecret as 'no secret required' (BYO rows predate the column)", async () => {
    const svc = makeSvc({ id: "c1", companyId: CO, status: "pending_approval" });

    await applyConnectorApproval(svc as never, CO, "c1", "authenticated");

    expect(svc.update).toHaveBeenCalledWith("c1", { status: "active" });
  });

  it("treats an empty-string secretRef as unbound (an empty ref resolves to no credential)", async () => {
    const svc = makeSvc({
      id: "c1",
      companyId: CO,
      status: "pending_approval",
      requiresSecret: true,
      secretRef: "",
    });

    await applyConnectorApproval(svc as never, CO, "c1", "authenticated");

    expect(svc.update).toHaveBeenCalledWith("c1", { status: "needs_credentials" });
  });

  it("re-approving an already-needs_credentials connector is a no-op (idempotent)", async () => {
    const svc = makeSvc({
      id: "c1",
      companyId: CO,
      status: "needs_credentials",
      requiresSecret: true,
      secretRef: null,
    });

    await applyConnectorApproval(svc as never, CO, "c1", "authenticated");

    expect(svc.update).not.toHaveBeenCalled();
  });

  it("re-approving an already-active connector is a no-op (idempotent)", async () => {
    const svc = makeSvc({
      id: "c1",
      companyId: CO,
      status: "active",
      requiresSecret: false,
      secretRef: null,
    });

    await applyConnectorApproval(svc as never, CO, "c1", "authenticated");

    expect(svc.update).not.toHaveBeenCalled();
  });
});

describe("applyConnectorApproval — tenancy + null tolerance (never throw after the status flip)", () => {
  it("ignores a connector belonging to another company", async () => {
    const svc = makeSvc({
      id: "c1",
      companyId: "OTHER",
      status: "pending_approval",
      requiresSecret: false,
      secretRef: null,
    });

    await applyConnectorApproval(svc as never, CO, "c1", "authenticated");

    expect(svc.update).not.toHaveBeenCalled();
  });

  it("is a no-op and does NOT throw when the connector was deleted between create and approve", async () => {
    const svc = makeSvc(null);

    await expect(
      applyConnectorApproval(svc as never, CO, "c1", "authenticated"),
    ).resolves.toBeUndefined();
    expect(svc.update).not.toHaveBeenCalled();
  });
});

describe("applyConnectorRejection — covers needs_credentials, not just pending_approval", () => {
  it("rejecting a needs_credentials connector disables it (was a silent no-op)", async () => {
    const svc = makeSvc({
      id: "c1",
      companyId: CO,
      status: "needs_credentials",
      requiresSecret: true,
      secretRef: null,
    });

    await applyConnectorRejection(svc as never, CO, "c1");

    expect(svc.update).toHaveBeenCalledWith("c1", { status: "disabled" });
  });

  it("rejecting a pending_approval connector disables it (unchanged behaviour)", async () => {
    const svc = makeSvc({
      id: "c1",
      companyId: CO,
      status: "pending_approval",
      requiresSecret: false,
      secretRef: null,
    });

    await applyConnectorRejection(svc as never, CO, "c1");

    expect(svc.update).toHaveBeenCalledWith("c1", { status: "disabled" });
  });

  it("does NOT disable an already-active connector (reject closes an install, it is not a kill switch)", async () => {
    const svc = makeSvc({
      id: "c1",
      companyId: CO,
      status: "active",
      requiresSecret: false,
      secretRef: null,
    });

    await applyConnectorRejection(svc as never, CO, "c1");

    expect(svc.update).not.toHaveBeenCalled();
  });

  it("ignores a connector belonging to another company", async () => {
    const svc = makeSvc({
      id: "c1",
      companyId: "OTHER",
      status: "pending_approval",
      requiresSecret: false,
      secretRef: null,
    });

    await applyConnectorRejection(svc as never, CO, "c1");

    expect(svc.update).not.toHaveBeenCalled();
  });

  it("is a no-op and does NOT throw when the connector is already gone", async () => {
    const svc = makeSvc(null);

    await expect(applyConnectorRejection(svc as never, CO, "c1")).resolves.toBeUndefined();
    expect(svc.update).not.toHaveBeenCalled();
  });
});
