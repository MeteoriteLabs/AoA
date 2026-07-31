import { describe, it, expect, vi } from "vitest";
import { createSelfServeOrganization } from "../services/organizations.js";

// Sequence-style fake db (see CLAUDE.md Test Patterns).
function fakeDb() {
  const inserts: any[] = [];
  const db: any = {
    insert: (tbl: any) => ({
      values: (v: any) => ({ returning: async () => { inserts.push({ tbl, v }); return [{ id: v.id ?? "org-new", ...v }]; } }),
    }),
    // Fix 5: createSelfServeOrganization now wraps insert + owner-membership in
    // one db.transaction. The fake models a pass-through tx (callback runs on the
    // same fake handle) so the unit test still exercises the happy path. Real
    // rollback is proven in organizations-transaction.integration.test.ts.
    transaction: async (fn: (tx: any) => Promise<any>) => fn(db),
  };
  return { db, inserts };
}

describe("createSelfServeOrganization", () => {
  it("creates the org and makes the caller its owner", async () => {
    const { db, inserts } = fakeDb();
    const ensureOrgOwner = vi.fn(async () => "m1");
    // 3rd arg is now a FACTORY (handle) => { ensureOrgOwner } so the membership
    // write can bind to the transaction handle.
    const org = await createSelfServeOrganization(
      db,
      { name: "Acme", ownerUserId: "u1" },
      (() => ({ ensureOrgOwner })) as any,
    );
    expect(org.name).toBe("Acme");
    expect(ensureOrgOwner).toHaveBeenCalledWith(org.id, "u1");
    expect(inserts.some((i) => i.v.name === "Acme")).toBe(true);
  });
});
