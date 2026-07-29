import { describe, it, expect, vi } from "vitest";
import { createSelfServeOrganization } from "../services/organizations.js";

// Sequence-style fake db (see CLAUDE.md Test Patterns).
function fakeDb() {
  const inserts: any[] = [];
  const db: any = {
    insert: (tbl: any) => ({
      values: (v: any) => ({ returning: async () => { inserts.push({ tbl, v }); return [{ id: v.id ?? "org-new", ...v }]; } }),
    }),
  };
  return { db, inserts };
}

describe("createSelfServeOrganization", () => {
  it("creates the org and makes the caller its owner", async () => {
    const { db, inserts } = fakeDb();
    const ensureOrgOwner = vi.fn(async () => "m1");
    const org = await createSelfServeOrganization(db, { name: "Acme", ownerUserId: "u1" }, { ensureOrgOwner } as any);
    expect(org.name).toBe("Acme");
    expect(ensureOrgOwner).toHaveBeenCalledWith(org.id, "u1");
    expect(inserts.some((i) => i.v.name === "Acme")).toBe(true);
  });
});
