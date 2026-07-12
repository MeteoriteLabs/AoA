import { describe, it, expect } from "vitest";
import { promoteFirstUserToInstanceAdmin } from "../services/first-user-bootstrap.js";

// Fake db exposing a transaction with a chainable select + capturable insert.
function makeDb(existingAdmins: unknown[]) {
  const inserted: Array<Record<string, unknown>> = [];
  const lockCalls: unknown[] = [];
  const tx = {
    execute: async (arg: unknown) => {
      lockCalls.push(arg);
      return undefined;
    },
    select: () => ({ from: () => ({ where: async () => existingAdmins }) }),
    insert: () => ({ values: async (v: Record<string, unknown>) => { inserted.push(v); } }),
  };
  const db = { transaction: async (fn: (t: typeof tx) => unknown) => await fn(tx) } as any;
  return { db, inserted, lockCalls };
}

describe("promoteFirstUserToInstanceAdmin (RB3/A7)", () => {
  it("promotes when NO instance_admin exists yet", async () => {
    const { db, inserted, lockCalls } = makeDb([]);
    const did = await promoteFirstUserToInstanceAdmin(db, "u1");
    expect(did).toBe(true);
    expect(inserted[0]).toMatchObject({ userId: "u1", role: "instance_admin" });
    expect(lockCalls.length).toBe(1); // advisory lock acquired inside the txn
  });

  it("does NOT promote when an instance_admin already exists", async () => {
    const { db, inserted } = makeDb([{ id: "existing" }]);
    const did = await promoteFirstUserToInstanceAdmin(db, "u2");
    expect(did).toBe(false);
    expect(inserted.length).toBe(0);
  });
});
